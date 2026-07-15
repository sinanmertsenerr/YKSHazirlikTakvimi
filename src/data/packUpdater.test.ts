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

import coefficientsJson from '../../content/coefficients.json';
import rankTablesJson from '../../content/rank-tables.json';
import topicGroupStatisticsJson from '../../content/topic-group-statistics.json';

import {
  activateOnlyAfterValidation,
  activePointerSchema,
  compareVersions,
  PACK_SCHEMA_VERSION,
  packManifestSchema,
  retainedVersionDirectoryNames,
  shouldInstallRemotePack,
  shouldUseDownloadedPack,
  validateJsonDocument,
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
