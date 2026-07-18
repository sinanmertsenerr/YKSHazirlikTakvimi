/* eslint-disable import/first */

jest.mock('expo-file-system', () => ({
  Directory: jest.fn(),
  File: jest.fn(),
  Paths: { document: 'document' },
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn(),
  randomUUID: jest.fn(() => 'uuid'),
}));
jest.mock('expo-sqlite', () => ({ deserializeDatabaseAsync: jest.fn() }));
jest.mock('@/data/content', () => {
  const schemas = jest.requireActual<typeof import('../../scripts/lib/content-schemas')>(
    '../../scripts/lib/content-schemas',
  );
  return {
    calendarPackSchema: schemas.calendarSchema,
    coefficientsPackSchema: schemas.coefficientsSchema,
    newsPackSchema: schemas.newsSchema,
    rankTablesPackSchema: schemas.rankTablesSchema,
    topicGroupMappingsPackSchema: schemas.topicGroupMappingsSchema,
    topicGroupStatisticsPackSchema: schemas.topicGroupStatisticsSchema,
    topicsPackSchema: schemas.topicsSchema,
  };
});
jest.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: jest.fn() },
}));

import { generateKeyPairSync } from 'node:crypto';

import coefficientsJson from '../../content/coefficients.json';
import rankTablesJson from '../../content/rank-tables.json';
import topicGroupStatisticsJson from '../../content/topic-group-statistics.json';
import { signPackManifest } from '../../scripts/lib/pack-signature-node';

import { useSettingsStore } from '@/stores/settings';

import {
  activateOnlyAfterValidation,
  activePointerSchema,
  canReuseValidatedPackFile,
  checkForPackUpdate,
  compareVersions,
  FAILED_CHECK_BACKOFF_MS,
  nextAutomaticPackCheckAt,
  PACK_CHECK_INTERVAL_MS,
  PACK_SCHEMA_VERSION,
  PackUpdateCoordinator,
  packManifestSchema,
  retainedVersionDirectoryNames,
  runWithConcurrency,
  shouldInstallRemotePack,
  shouldThrottlePackCheck,
  shouldUseDownloadedPack,
  validateJsonDocument,
  type PackUpdateResult,
} from './packUpdater';

const descriptor = (path: string) => ({ path, sha256: 'a'.repeat(64), bytes: 1 });

const validManifest = {
  schemaVersion: PACK_SCHEMA_VERSION,
  packVersion: '2026.07.2',
  minAppVersion: '1.0.0',
  examYear: 2026,
  files: {
    topics: descriptor('topics.json'),
    coefficients: descriptor('coefficients.json'),
    rankTables: descriptor('rank-tables.json'),
    programs: descriptor('programs.db'),
    calendar: descriptor('calendar.json'),
    news: descriptor('news.json'),
    topicGroupStatistics: descriptor('topic-group-statistics.json'),
    topicGroupMappings: descriptor('topic-group-mappings.json'),
  },
};

const testKeyId = 'pack-updater-test';
const testKeyPair = generateKeyPairSync('ed25519');
const testPublicJwk = testKeyPair.publicKey.export({ format: 'jwk' });
if (!testPublicJwk.x) throw new Error('Missing test Ed25519 public key.');
const testTrustedKeys = {
  [testKeyId]: testPublicJwk.x
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(testPublicJwk.x.length / 4) * 4, '='),
};
const validSignature = signPackManifest(
  validManifest,
  testKeyId,
  String(testKeyPair.privateKey.export({ format: 'pem', type: 'pkcs8' })),
  testTrustedKeys,
);

describe('content pack version ordering', () => {
  it('orders numeric pack segments instead of comparing strings', () => {
    expect(compareVersions('2026.07.10', '2026.07.9')).toBe(1);
    expect(compareVersions('2026.08.1', '2026.07.99')).toBe(1);
    expect(compareVersions('2026.07.1', '2026.07.1')).toBe(0);
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1);
  });

  it('never replaces a real bundled version with an equal or older remote pack', () => {
    expect(shouldInstallRemotePack('2026.07.2', '2026.07.3')).toBe(false);
    expect(shouldInstallRemotePack('2026.07.3', '2026.07.3')).toBe(false);
    expect(shouldInstallRemotePack('2026.07.4', '2026.07.3')).toBe(true);
    expect(shouldInstallRemotePack('2026.07.1', 'bundled')).toBe(true);
  });

  it('lets an app upgrade outrank an older or equal downloaded pointer offline', () => {
    expect(shouldUseDownloadedPack('2026.07.2', '2026.07.3')).toBe(false);
    expect(shouldUseDownloadedPack('2026.07.3', '2026.07.3')).toBe(false);
    expect(shouldUseDownloadedPack('2026.07.4', '2026.07.3')).toBe(true);
    expect(shouldUseDownloadedPack('2026.07.4', null)).toBe(true);
  });

  it('retains only the active and newest rollback version directories', () => {
    expect(
      retainedVersionDirectoryNames([
        { directoryName: '2026.07.1', activatedAt: 10 },
        { directoryName: '2026.07.2', activatedAt: 20 },
        { directoryName: '2026.07.3', activatedAt: 30 },
      ]),
    ).toEqual(['2026.07.3', '2026.07.2']);
  });

  it('accepts only schema-v3 manifests and active pointers', () => {
    expect(packManifestSchema.safeParse(validManifest).success).toBe(true);
    expect(packManifestSchema.safeParse({ ...validManifest, schemaVersion: 1 }).success).toBe(
      false,
    );

    const pointer = {
      schemaVersion: PACK_SCHEMA_VERSION,
      packVersion: '2026.07.2',
      directoryName: '2026.07.2',
      activatedAt: 1,
    };
    expect(activePointerSchema.safeParse(pointer).success).toBe(true);
    expect(activePointerSchema.safeParse({ ...pointer, schemaVersion: 1 }).success).toBe(false);
  });

  it('rejects reserved, duplicate and oversized manifest paths', () => {
    const result = packManifestSchema.safeParse({
      schemaVersion: PACK_SCHEMA_VERSION,
      packVersion: '2026.07.2',
      minAppVersion: '1.0.0',
      examYear: 2026,
      files: {
        topics: descriptor('topics.json'),
        coefficients: descriptor('topics.json'),
        rankTables: descriptor('rank-tables.json'),
        programs: descriptor('programs.db'),
        calendar: descriptor('calendar.json'),
        news: descriptor('manifest.json'),
        topicGroupStatistics: descriptor('topic-group-statistics.json'),
        topicGroupMappings: descriptor('topic-group-mappings.json'),
      },
    });
    expect(result.success).toBe(false);
    expect(
      packManifestSchema.safeParse({
        ...validManifest,
        files: { ...validManifest.files, news: descriptor('manifest.sig') },
      }).success,
    ).toBe(false);
  });

  it('rejects legacy synthetic coefficients before activation', () => {
    expect(() =>
      validateJsonDocument('coefficients', {
        schemaVersion: 1,
        year: 2026,
        base: 100,
        obpMultiplier: 0.12,
        rules: { aytWarningTytRawScoreBelow: 150, verified: false },
        scoreTypes: [{ id: 'tyt', netCoefficients: { 'tyt-turkce': 3.32 } }],
      }),
    ).toThrow('Schema validation failed for coefficients.json.');

    expect(() => validateJsonDocument('coefficients', coefficientsJson)).not.toThrow();
  });

  it('rejects an unavailable rank document that contains points', () => {
    expect(() =>
      validateJsonDocument('rankTables', {
        ...rankTablesJson,
        tables: [{ scoreType: 'tyt', points: [{ score: 500, rank: 1 }] }],
      }),
    ).toThrow('Schema validation failed for rank-tables.json.');
    expect(() => validateJsonDocument('rankTables', rankTablesJson)).not.toThrow();
  });

  it('accepts the strict pending topic-group envelope and rejects invented pending counts', () => {
    expect(() =>
      validateJsonDocument('topicGroupStatistics', topicGroupStatisticsJson),
    ).not.toThrow();
    expect(() =>
      validateJsonDocument('topicGroupStatistics', {
        ...topicGroupStatisticsJson,
        groups: [{ id: 'invented' }],
      }),
    ).toThrow('Schema validation failed for topic-group-statistics.json.');
  });

  it('never invokes activation when any candidate validation fails', async () => {
    const activate = jest.fn(() => 'activated');
    await expect(
      activateOnlyAfterValidation(
        () =>
          validateJsonDocument('coefficients', {
            schemaVersion: 1,
            base: 100,
            netCoefficients: { 'tyt-turkce': 3.32 },
          }),
        activate,
      ),
    ).rejects.toThrow('Schema validation failed for coefficients.json.');
    expect(activate).not.toHaveBeenCalled();
  });
});

describe('content pack check coordination and persistent backoff', () => {
  const bundled = {
    source: 'bundled' as const,
    version: 'bundled',
    directory: null,
    manifest: null,
  };
  const result: PackUpdateResult = { status: 'throttled', checkedAt: 1, active: bundled };

  it('uses the shorter success interval and persistent failure backoff', () => {
    expect(
      nextAutomaticPackCheckAt({
        lastPackCheckTs: 1000,
        lastPackSuccessTs: 1000,
        lastPackFailureTs: null,
      }),
    ).toBe(1000 + PACK_CHECK_INTERVAL_MS);
    expect(
      nextAutomaticPackCheckAt({
        lastPackCheckTs: 2000,
        lastPackSuccessTs: 1000,
        lastPackFailureTs: 2000,
      }),
    ).toBe(2000 + FAILED_CHECK_BACKOFF_MS);
    expect(
      shouldThrottlePackCheck(
        {
          lastPackCheckTs: 2000,
          lastPackSuccessTs: 1000,
          lastPackFailureTs: 2000,
        },
        2000 + FAILED_CHECK_BACKOFF_MS - 1,
      ),
    ).toBe(true);
    expect(
      shouldThrottlePackCheck(
        {
          lastPackCheckTs: 2000,
          lastPackSuccessTs: 1000,
          lastPackFailureTs: 2000,
        },
        2001,
        true,
      ),
    ).toBe(false);
  });

  it('queues a forced request behind a non-forced check instead of losing force semantics', async () => {
    const coordinator = new PackUpdateCoordinator();
    const calls: boolean[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const operation = jest.fn(async (options: { force?: boolean }) => {
      calls.push(options.force === true);
      if (calls.length === 1) await firstGate;
      return result;
    });

    const automatic = coordinator.run({}, operation);
    await Promise.resolve();
    const forcedOne = coordinator.run({ force: true }, operation);
    const forcedTwo = coordinator.run({ force: true }, operation);
    expect(calls).toEqual([false]);

    releaseFirst();
    await expect(Promise.all([automatic, forcedOne, forcedTwo])).resolves.toEqual([
      result,
      result,
      result,
    ]);
    expect(calls).toEqual([false, true]);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('shares an already-forced transaction with automatic callers', async () => {
    const coordinator = new PackUpdateCoordinator();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operation = jest.fn(async () => {
      await gate;
      return result;
    });
    const forced = coordinator.run({ force: true }, operation);
    const automatic = coordinator.run({}, operation);
    release();
    await Promise.all([forced, automatic]);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('content-addressed candidate installation helpers', () => {
  it('reuses only a byte-identical, hash-identical previously validated payload', () => {
    const candidate = descriptor('news.json');
    expect(canReuseValidatedPackFile(candidate, { ...candidate, path: 'renamed.json' })).toBe(true);
    expect(canReuseValidatedPackFile({ ...candidate, bytes: 2 }, candidate)).toBe(false);
    expect(canReuseValidatedPackFile({ ...candidate, sha256: 'b'.repeat(64) }, candidate)).toBe(
      false,
    );
    expect(canReuseValidatedPackFile(undefined, candidate)).toBe(false);
  });

  it('bounds concurrent file work without dropping any operation', async () => {
    let active = 0;
    let maximum = 0;
    const completed: number[] = [];
    await runWithConcurrency([0, 1, 2, 3, 4, 5, 6], 3, async (value) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
      completed.push(value);
      active -= 1;
    });
    expect(maximum).toBe(3);
    expect(completed.sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    await expect(runWithConcurrency([1], 0, () => undefined)).rejects.toThrow('positive integer');
  });

  it('waits for in-flight workers before surfacing the first failure', async () => {
    const completed: number[] = [];
    await expect(
      runWithConcurrency([0, 1, 2], 2, async (value) => {
        if (value === 0) {
          await Promise.resolve();
          throw new Error('download failed');
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 3));
        completed.push(value);
      }),
    ).rejects.toThrow('download failed');
    expect(completed).toEqual([1]);
  });
});

describe('persisted updater outcomes', () => {
  const mockGetSettings = useSettingsStore.getState as jest.Mock;

  afterEach(() => {
    jest.restoreAllMocks();
    mockGetSettings.mockReset();
  });

  it('records a failed forced check so relaunch backoff and UI diagnostics survive', async () => {
    const setPackCheckFailure = jest.fn();
    mockGetSettings.mockReturnValue({
      lastPackCheckTs: null,
      lastPackSuccessTs: null,
      lastPackFailureTs: null,
      setPackCheckFailure,
      setPackCheckSuccess: jest.fn(),
    });

    const result = await checkForPackUpdate({
      baseUrl: 'http://insecure.example/pack',
      force: true,
      now: 4321,
    });
    expect(result.status).toBe('failed');
    expect(setPackCheckFailure).toHaveBeenCalledWith(
      4321,
      'A secure HTTPS content pack URL is not configured.',
    );
  });

  it('rejects a tampered manifest signature before version decisions', async () => {
    const setPackCheckFailure = jest.fn();
    mockGetSettings.mockReturnValue({
      lastPackCheckTs: null,
      lastPackSuccessTs: null,
      lastPackFailureTs: null,
      setPackCheckFailure,
      setPackCheckSuccess: jest.fn(),
    });
    const signed = validSignature.signatures[0]!;
    const tamperedSignature = {
      ...validSignature,
      signatures: [
        {
          ...signed,
          signature: `${signed.signature.startsWith('A') ? 'B' : 'A'}${signed.signature.slice(1)}`,
        },
      ],
    };
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(validManifest),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(tamperedSignature),
      } as unknown as Response);

    const result = await checkForPackUpdate({
      baseUrl: 'https://content.example/pack',
      force: true,
      now: 4999,
      fetchImpl,
      trustedKeys: testTrustedKeys,
    });
    expect(result.status).toBe('failed');
    expect(setPackCheckFailure).toHaveBeenCalledWith(
      4999,
      'Content pack manifest signature is not trusted or valid.',
    );
  });

  it('records a successful manifest check and clears earlier diagnostics', async () => {
    const setPackCheckSuccess = jest.fn();
    mockGetSettings.mockReturnValue({
      lastPackCheckTs: null,
      lastPackSuccessTs: null,
      lastPackFailureTs: null,
      setPackCheckFailure: jest.fn(),
      setPackCheckSuccess,
    });
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(validManifest),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(validSignature),
      } as unknown as Response);

    const result = await checkForPackUpdate({
      baseUrl: 'https://content.example/pack',
      force: true,
      now: 5000,
      fetchImpl,
      trustedKeys: testTrustedKeys,
    });
    expect(['incompatible', 'up-to-date']).toContain(result.status);
    expect(setPackCheckSuccess).toHaveBeenCalledWith(expect.any(String), 5000);
  });
});
