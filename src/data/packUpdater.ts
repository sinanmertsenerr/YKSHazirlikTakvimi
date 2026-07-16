import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { deserializeDatabaseAsync } from 'expo-sqlite';
import { z } from 'zod';

import bundledManifestJson from '../../assets/pack/manifest.json';
import {
  CURRENT_PACK_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
} from '../../scripts/lib/content-schemas';

import {
  calendarPackSchema,
  coefficientsPackSchema,
  newsPackSchema,
  rankTablesPackSchema,
  topicGroupMappingsPackSchema,
  topicGroupStatisticsPackSchema,
  topicsPackSchema,
} from '@/data/content';
import { type SettingsState, useSettingsStore } from '@/stores/settings';

export const PACK_SCHEMA_VERSION = CURRENT_PACK_SCHEMA_VERSION;
export const PACK_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;
export const FAILED_CHECK_BACKOFF_MS = 15 * 60 * 1000;
const PACK_ROOT_NAME = 'yks-content-packs';
const ACTIVE_POINTER_SLOT_NAMES = ['active-pack.a.json', 'active-pack.b.json'] as const;
const LEGACY_ACTIVE_POINTER_NAME = 'active-pack.json';
const MANIFEST_TIMEOUT_MS = 15_000;
const FILE_DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_JSON_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PACK_FILE_BYTES = 250 * 1024 * 1024;
const MAX_TOTAL_PACK_BYTES = 300 * 1024 * 1024;
const MAX_CONCURRENT_FILE_OPERATIONS = 3;

const manifestFileSchema = z
  .object({
    path: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    bytes: z.number().int().nonnegative().max(MAX_PACK_FILE_BYTES),
  })
  .strict();

export const packManifestSchema = z
  .object({
    schemaVersion: z.literal(PACK_SCHEMA_VERSION),
    packVersion: z.string().regex(/^\d{4}\.\d{2}\.\d+$/),
    minAppVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    examYear: z.number().int().min(2026).max(2100),
    files: z
      .object({
        topics: manifestFileSchema,
        coefficients: manifestFileSchema,
        rankTables: manifestFileSchema,
        programs: manifestFileSchema,
        calendar: manifestFileSchema,
        news: manifestFileSchema,
        topicGroupStatistics: manifestFileSchema,
        topicGroupMappings: manifestFileSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const paths = Object.values(manifest.files).map((descriptor) => descriptor.path);
    for (const [index, path] of paths.entries()) {
      if (path === 'manifest.json') {
        context.addIssue({
          code: 'custom',
          path: ['files'],
          message: 'manifest.json is reserved.',
        });
      }
      if (paths.indexOf(path) !== index) {
        context.addIssue({
          code: 'custom',
          path: ['files'],
          message: `Duplicate file path: ${path}`,
        });
      }
    }
    const totalBytes = Object.values(manifest.files).reduce(
      (total, descriptor) => total + descriptor.bytes,
      0,
    );
    if (totalBytes > MAX_TOTAL_PACK_BYTES) {
      context.addIssue({ code: 'custom', path: ['files'], message: 'Pack is too large.' });
    }
  });

export const activePointerSchema = z
  .object({
    schemaVersion: z.literal(PACK_SCHEMA_VERSION),
    packVersion: z.string().regex(/^\d{4}\.\d{2}\.\d+$/),
    directoryName: z.string().regex(/^\d{4}\.\d{2}\.\d+$/),
    activatedAt: z.number().int().nonnegative(),
  })
  .strict();

export type PackManifest = z.infer<typeof packManifestSchema>;
export type PackFileKey = keyof PackManifest['files'];
type PackFileDescriptor = PackManifest['files'][PackFileKey];

export type PackValidationHook = (context: {
  key: PackFileKey;
  file: File;
  manifest: PackManifest;
}) => void | Promise<void>;

export type PackLocation =
  | { source: 'downloaded'; version: string; directory: Directory; manifest: PackManifest }
  | { source: 'bundled'; version: string; directory: null; manifest: PackManifest | null };

export type PackUpdateResult =
  | { status: 'throttled'; checkedAt: number; active: PackLocation }
  | { status: 'up-to-date'; checkedAt: number; active: PackLocation; manifest: PackManifest }
  | { status: 'incompatible'; checkedAt: number; active: PackLocation; manifest: PackManifest }
  | {
      status: 'updated';
      checkedAt: number;
      active: Extract<PackLocation, { source: 'downloaded' }>;
    }
  | { status: 'failed'; checkedAt: number; active: PackLocation; error: Error };

export type CheckForPackUpdateOptions = {
  /** Bypasses only the automatic check window; version and compatibility checks still apply. */
  force?: boolean;
  baseUrl?: string;
  now?: number;
  validateFile?: PackValidationHook;
};

const bundledManifestResult = packManifestSchema.safeParse(bundledManifestJson);
const bundledManifest = bundledManifestResult.success ? bundledManifestResult.data : null;

type PackCheckTimestamps = Pick<
  SettingsState,
  'lastPackCheckTs' | 'lastPackSuccessTs' | 'lastPackFailureTs'
>;

export function nextAutomaticPackCheckAt(state: PackCheckTimestamps): number | null {
  const lastAttempt = state.lastPackCheckTs;
  if (lastAttempt === null) return null;
  const latestSucceededAt = state.lastPackSuccessTs ?? 0;
  const latestFailedAt = state.lastPackFailureTs ?? 0;
  const interval =
    latestFailedAt >= latestSucceededAt && latestFailedAt === lastAttempt
      ? FAILED_CHECK_BACKOFF_MS
      : PACK_CHECK_INTERVAL_MS;
  return lastAttempt + interval;
}

export function shouldThrottlePackCheck(
  state: PackCheckTimestamps,
  now: number,
  force = false,
): boolean {
  if (force) return false;
  const nextCheckAt = nextAutomaticPackCheckAt(state);
  return nextCheckAt !== null && now >= (state.lastPackCheckTs ?? 0) && now < nextCheckAt;
}

export class PackUpdateCoordinator {
  private inFlight: { force: boolean; promise: Promise<PackUpdateResult> } | null = null;

  run(
    options: CheckForPackUpdateOptions,
    operation: (options: CheckForPackUpdateOptions) => Promise<PackUpdateResult>,
  ): Promise<PackUpdateResult> {
    const force = options.force === true;
    const current = this.inFlight;
    if (current) {
      if (!force || current.force) return current.promise;
      return current.promise.then(
        () => this.run(options, operation),
        () => this.run(options, operation),
      );
    }

    const operationPromise = Promise.resolve().then(() => operation(options));
    let trackedPromise: Promise<PackUpdateResult>;
    trackedPromise = operationPromise.finally(() => {
      if (this.inFlight?.promise === trackedPromise) this.inFlight = null;
    });
    this.inFlight = { force, promise: trackedPromise };
    return trackedPromise;
  }
}

const updateCoordinator = new PackUpdateCoordinator();

function packRoot(): Directory {
  return new Directory(Paths.document, PACK_ROOT_NAME);
}

function versionsRoot(): Directory {
  return new Directory(packRoot(), 'versions');
}

function pointerFile(
  name: (typeof ACTIVE_POINTER_SLOT_NAMES)[number] | typeof LEGACY_ACTIVE_POINTER_NAME,
): File {
  return new File(packRoot(), name);
}

function bundledPackLocation(): Extract<PackLocation, { source: 'bundled' }> {
  return {
    source: 'bundled',
    version: bundledManifest?.packVersion ?? 'bundled',
    directory: null,
    manifest: bundledManifest,
  };
}

function ensurePackDirectories(): void {
  packRoot().create({ intermediates: true, idempotent: true });
  versionsRoot().create({ intermediates: true, idempotent: true });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function safeJsonParse(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  const configured = baseUrl ?? String(Constants.expoConfig?.extra?.packBaseUrl ?? '');
  const normalized = configured.trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(normalized)) {
    throw new Error('A secure HTTPS content pack URL is not configured.');
  }
  return normalized;
}

function parseVersion(version: string): { core: number[]; prerelease: string[] | null } {
  const [core = '', prerelease] = version.split('-', 2);
  return {
    core: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
    prerelease: prerelease ? prerelease.split('.') : null,
  };
}

export function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  const length = Math.max(leftVersion.core.length, rightVersion.core.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftVersion.core[index] ?? 0) - (rightVersion.core[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (!leftVersion.prerelease && !rightVersion.prerelease) return 0;
  if (!leftVersion.prerelease) return 1;
  if (!rightVersion.prerelease) return -1;
  const prereleaseLength = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function shouldInstallRemotePack(remoteVersion: string, activeVersion: string): boolean {
  return activeVersion === 'bundled' || compareVersions(remoteVersion, activeVersion) > 0;
}

export function shouldUseDownloadedPack(
  downloadedVersion: string,
  bundledVersion: string | null,
): boolean {
  return bundledVersion === null || compareVersions(downloadedVersion, bundledVersion) > 0;
}

async function sha256(file: File): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} identifier.`);
}

export function validateJsonDocument(
  key: Exclude<PackFileKey, 'programs'>,
  document: unknown,
): void {
  if (key === 'topics') {
    const result = topicsPackSchema.safeParse(document);
    if (!result.success) throw new Error('Schema validation failed for topics.json.');
    const subjects = result.data.exams.flatMap((exam) =>
      exam.sections.flatMap((section) => section.subjects),
    );
    const topics = subjects.flatMap((subject) => subject.topics);
    assertUnique(
      subjects.map((subject) => subject.id),
      'subject',
    );
    assertUnique(
      topics.map((topic) => topic.id),
      'topic',
    );
    for (const topic of topics) {
      for (const question of topic.questions) {
        if (!question.sourceUrl.startsWith('https://')) {
          throw new Error('Question source URLs must use HTTPS.');
        }
        const yearCount = topic.yearlyStats.find((stat) => stat.year === question.year)?.count;
        const questionsInYear = topic.questions.filter(
          (item) => item.year === question.year && item.countsTowardStats,
        ).length;
        if (
          question.countsTowardStats &&
          (yearCount === null || (yearCount !== undefined && questionsInYear > yearCount))
        ) {
          throw new Error(`Question metadata exceeds yearly count for topic ${topic.id}.`);
        }
      }
    }
    return;
  }
  if (key === 'coefficients') {
    const result = coefficientsPackSchema.safeParse(document);
    if (!result.success) throw new Error('Schema validation failed for coefficients.json.');
    return;
  }
  if (key === 'rankTables') {
    const result = rankTablesPackSchema.safeParse(document);
    if (!result.success) throw new Error('Schema validation failed for rank-tables.json.');
    return;
  }
  if (key === 'calendar') {
    const result = calendarPackSchema.safeParse(document);
    if (!result.success) throw new Error('Schema validation failed for calendar.json.');
    assertUnique(
      result.data.events.map((event) => event.id),
      'calendar event',
    );
    return;
  }
  if (key === 'topicGroupStatistics') {
    const result = topicGroupStatisticsPackSchema.safeParse(document);
    if (!result.success) {
      throw new Error('Schema validation failed for topic-group-statistics.json.');
    }
    return;
  }
  if (key === 'topicGroupMappings') {
    const result = topicGroupMappingsPackSchema.safeParse(document);
    if (!result.success) {
      throw new Error('Schema validation failed for topic-group-mappings.json.');
    }
    return;
  }
  const result = newsPackSchema.safeParse(document);
  if (!result.success) throw new Error('Schema validation failed for news.json.');
  assertUnique(
    result.data.items.map((item) => item.id),
    'news item',
  );
  if (result.data.items.some((item) => !item.url.startsWith('https://'))) {
    throw new Error('News URLs must use HTTPS.');
  }
}

/** Keeps activation behind a single validation barrier so a partial candidate cannot be committed. */
export async function activateOnlyAfterValidation<Result>(
  validateCandidate: () => void | Promise<void>,
  activateCandidate: () => Result | Promise<Result>,
): Promise<Result> {
  await validateCandidate();
  return activateCandidate();
}

async function validateProgramsDatabase(file: File): Promise<void> {
  const bytes = await file.bytes();
  const header = bytes.slice(0, 16);
  const sqliteHeader = Array.from(header, (byte) => String.fromCharCode(byte)).join('');
  if (sqliteHeader !== 'SQLite format 3\u0000') {
    throw new Error('Downloaded programs database is not a valid SQLite file.');
  }

  const database = await deserializeDatabaseAsync(bytes, { useNewConnection: true });
  try {
    const integrity = await database.getFirstAsync<{ integrity_check: string }>(
      'PRAGMA integrity_check',
    );
    if (integrity?.integrity_check !== 'ok') {
      throw new Error('Downloaded programs database failed integrity_check.');
    }
    const foreignKeyFailure = await database.getFirstAsync<Record<string, unknown>>(
      'PRAGMA foreign_key_check',
    );
    if (foreignKeyFailure) throw new Error('Downloaded programs database has broken foreign keys.');
    const schemaVersion = await database.getFirstAsync<{ value: string }>(
      "SELECT value FROM pack_metadata WHERE key = 'schemaVersion'",
    );
    if (schemaVersion?.value !== String(CURRENT_SCHEMA_VERSION)) {
      throw new Error('Downloaded programs database has an unsupported schema version.');
    }
    const tables = await database.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('pack_metadata','program','program_year')",
    );
    if (new Set(tables.map((table) => table.name)).size !== 3) {
      throw new Error('Downloaded programs database is missing required tables.');
    }
    const [programColumns, programYearColumns] = await Promise.all([
      database.getAllAsync<{ name: string }>('PRAGMA table_info(program)'),
      database.getAllAsync<{ name: string }>('PRAGMA table_info(program_year)'),
    ]);
    const programColumnNames = new Set(programColumns.map((column) => column.name));
    const programYearColumnNames = new Set(programYearColumns.map((column) => column.name));
    for (const column of ['id', 'verified', 'source', 'verified_at']) {
      if (!programColumnNames.has(column)) {
        throw new Error(`Downloaded programs database is missing program.${column}.`);
      }
    }
    for (const column of ['program_id', 'year', 'verified', 'source', 'verified_at']) {
      if (!programYearColumnNames.has(column)) {
        throw new Error(`Downloaded programs database is missing program_year.${column}.`);
      }
    }
    const invalidProgram = await database.getFirstAsync<{ id: string }>(
      `SELECT id FROM program
       WHERE verified != 1 OR source IS NULL OR verified_at IS NULL
          OR datetime(verified_at) IS NULL
       LIMIT 1`,
    );
    const invalidProgramYear = await database.getFirstAsync<{ program_id: string }>(
      `SELECT program_id FROM program_year
       WHERE verified != 1 OR source IS NULL OR verified_at IS NULL
          OR datetime(verified_at) IS NULL
       LIMIT 1`,
    );
    if (invalidProgram || invalidProgramYear) {
      throw new Error('Downloaded programs database contains unverified or unsourced rows.');
    }
  } finally {
    await database.closeAsync();
  }
}

async function validateDownloadedFile(
  key: PackFileKey,
  file: File,
  manifest: PackManifest,
  hook?: PackValidationHook,
): Promise<void> {
  const descriptor = manifest.files[key];
  if (!file.exists) throw new Error(`Downloaded pack file is missing: ${descriptor.path}`);
  if (file.size !== descriptor.bytes) {
    throw new Error(`Size mismatch for ${descriptor.path}.`);
  }
  if (key !== 'programs' && descriptor.bytes > MAX_JSON_FILE_BYTES) {
    throw new Error(`JSON pack file is unexpectedly large: ${descriptor.path}.`);
  }
  const actualHash = await sha256(file);
  if (actualHash.toLowerCase() !== descriptor.sha256.toLowerCase()) {
    throw new Error(`SHA-256 mismatch for ${descriptor.path}.`);
  }

  if (key !== 'programs') {
    const document = safeJsonParse(await file.text(), descriptor.path);
    validateJsonDocument(key, document);
  } else {
    await validateProgramsDatabase(file);
  }

  await hook?.({ key, file, manifest });
}

export function canReuseValidatedPackFile(
  active: PackFileDescriptor | undefined,
  candidate: PackFileDescriptor,
): boolean {
  return (
    active !== undefined &&
    active.bytes === candidate.bytes &&
    active.sha256.toLowerCase() === candidate.sha256.toLowerCase()
  );
}

export async function runWithConcurrency<Item>(
  items: readonly Item[],
  concurrency: number,
  operation: (item: Item) => void | Promise<void>,
): Promise<void> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error('Concurrency must be a positive integer.');
  }
  let nextIndex = 0;
  let failed = false;
  let firstError: unknown;
  const worker = async () => {
    while (!failed && nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item === undefined) continue;
      try {
        await operation(item);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  if (failed) throw firstError;
}

async function readManifestFromDirectory(directory: Directory): Promise<PackManifest | null> {
  const file = new File(directory, 'manifest.json');
  if (!file.exists) return null;
  const parsed = packManifestSchema.safeParse(safeJsonParse(await file.text(), 'manifest.json'));
  return parsed.success ? parsed.data : null;
}

function hasCompleteDeclaredFiles(directory: Directory, manifest: PackManifest): boolean {
  return Object.values(manifest.files).every((descriptor) => {
    const file = new File(directory, descriptor.path);
    return file.exists && file.size === descriptor.bytes;
  });
}

type ActivePointer = z.infer<typeof activePointerSchema>;

export function retainedVersionDirectoryNames(
  pointers: readonly Pick<ActivePointer, 'activatedAt' | 'directoryName'>[],
): string[] {
  const retained: string[] = [];
  for (const pointer of [...pointers].sort((left, right) => right.activatedAt - left.activatedAt)) {
    if (!retained.includes(pointer.directoryName)) retained.push(pointer.directoryName);
    if (retained.length === 2) break;
  }
  return retained;
}

async function readActivePointer(file: File): Promise<ActivePointer | null> {
  if (!file.exists) return null;
  try {
    const result = activePointerSchema.safeParse(safeJsonParse(await file.text(), file.name));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the last fully activated downloaded pack. If the pointer or directory is unavailable,
 * callers can keep using their statically bundled content without throwing during startup.
 */
export async function getActivePackLocation(): Promise<PackLocation> {
  try {
    const files = [
      ...ACTIVE_POINTER_SLOT_NAMES.map((name) => pointerFile(name)),
      pointerFile(LEGACY_ACTIVE_POINTER_NAME),
    ];
    const pointers = (
      await Promise.all(files.map(async (file) => ({ file, value: await readActivePointer(file) })))
    )
      .filter((candidate): candidate is { file: File; value: ActivePointer } => !!candidate.value)
      .sort((left, right) => right.value.activatedAt - left.value.activatedAt);

    for (const pointer of pointers) {
      const directory = new Directory(versionsRoot(), pointer.value.directoryName);
      if (!directory.exists) continue;
      const manifest = await readManifestFromDirectory(directory);
      if (!manifest || manifest.packVersion !== pointer.value.packVersion) continue;
      if (!shouldUseDownloadedPack(manifest.packVersion, bundledManifest?.packVersion ?? null)) {
        continue;
      }
      if (!hasCompleteDeclaredFiles(directory, manifest)) continue;
      return { source: 'downloaded', version: manifest.packVersion, directory, manifest };
    }
    return bundledPackLocation();
  } catch {
    return bundledPackLocation();
  }
}

/** Removes only pointers to a runtime-corrupt version so resolution can use rollback or bundled. */
export async function invalidateDownloadedPackVersion(version: string): Promise<void> {
  const files = [
    ...ACTIVE_POINTER_SLOT_NAMES.map((name) => pointerFile(name)),
    pointerFile(LEGACY_ACTIVE_POINTER_NAME),
  ];
  for (const file of files) {
    const pointer = await readActivePointer(file);
    if (pointer?.packVersion !== version || !file.exists) continue;
    try {
      file.delete();
    } catch {
      // A still-readable pointer will be retried; live bundled references remain untouched.
    }
  }
}

export async function getActivePackFile(key: PackFileKey): Promise<File | null> {
  const active = await getActivePackLocation();
  if (active.source === 'bundled') return null;
  const file = new File(active.directory, active.manifest.files[key].path);
  return file.exists ? file : null;
}

async function fetchManifest(baseUrl: string): Promise<PackManifest> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/manifest.json`, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Content manifest request failed (${response.status}).`);
    const advertisedLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(advertisedLength) && advertisedLength > MAX_MANIFEST_BYTES) {
      throw new Error('The remote content manifest is unexpectedly large.');
    }
    const text = await response.text();
    if (text.length > MAX_MANIFEST_BYTES) {
      throw new Error('The remote content manifest is unexpectedly large.');
    }
    const result = packManifestSchema.safeParse(safeJsonParse(text, 'manifest.json'));
    if (!result.success) {
      throw new Error('The remote content manifest is incompatible or invalid.');
    }
    return result.data;
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadPackFile(url: string, destination: File): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FILE_DOWNLOAD_TIMEOUT_MS);
  try {
    await File.downloadFileAsync(url, destination, {
      idempotent: true,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function reusePreviouslyValidatedFile(
  key: PackFileKey,
  source: File,
  destination: File,
  manifest: PackManifest,
): Promise<void> {
  await source.copy(destination, { overwrite: true });
  if (!destination.exists || destination.size !== manifest.files[key].bytes) {
    throw new Error(`Could not reuse validated pack file: ${manifest.files[key].path}`);
  }
  // The source belongs to an immutable, atomically activated pack and its declared payload hash is
  // identical to the candidate descriptor. Re-running SQLite integrity checks and JSON parsing
  // would add latency without increasing trust in the copied bytes.
}

async function installCandidateFile(
  key: PackFileKey,
  candidateDirectory: Directory,
  manifest: PackManifest,
  baseUrl: string,
  reusableSource: File | null,
  hook?: PackValidationHook,
): Promise<void> {
  const descriptor = manifest.files[key];
  const destination = new File(candidateDirectory, descriptor.path);
  if (reusableSource) {
    let reused = false;
    try {
      await reusePreviouslyValidatedFile(key, reusableSource, destination, manifest);
      reused = true;
    } catch {
      if (destination.exists) {
        try {
          destination.delete();
        } catch {
          // The subsequent idempotent download can overwrite a partial copy when supported.
        }
      }
    }
    if (reused) {
      await hook?.({ key, file: destination, manifest });
      return;
    }
  }
  await downloadPackFile(`${baseUrl}/${descriptor.path}`, destination);
  await validateDownloadedFile(key, destination, manifest, hook);
}

function writeManifest(directory: Directory, manifest: PackManifest): void {
  const file = new File(directory, 'manifest.json');
  file.create({ overwrite: true });
  file.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

async function activatePack(
  staging: Directory,
  manifest: PackManifest,
  now: number,
): Promise<Directory> {
  const destination = new Directory(versionsRoot(), manifest.packVersion);
  if (destination.exists) destination.delete();
  await staging.move(destination);

  const slotPointers = [
    await readActivePointer(pointerFile(ACTIVE_POINTER_SLOT_NAMES[0])),
    await readActivePointer(pointerFile(ACTIVE_POINTER_SLOT_NAMES[1])),
  ] as const;
  const [firstSlotPointer, secondSlotPointer] = slotPointers;
  const legacyPointer = await readActivePointer(pointerFile(LEGACY_ACTIVE_POINTER_NAME));
  const targetSlotIndex =
    firstSlotPointer === null
      ? 0
      : secondSlotPointer === null
        ? 1
        : firstSlotPointer.activatedAt <= secondSlotPointer.activatedAt
          ? 0
          : 1;
  const lastActivatedAt = Math.max(
    legacyPointer?.activatedAt ?? 0,
    ...slotPointers.map((pointer) => pointer?.activatedAt ?? 0),
  );
  const temporaryPointer = new File(packRoot(), `active-${Crypto.randomUUID()}.json`);
  temporaryPointer.create({ overwrite: true });
  temporaryPointer.write(
    `${JSON.stringify({
      schemaVersion: PACK_SCHEMA_VERSION,
      packVersion: manifest.packVersion,
      directoryName: manifest.packVersion,
      activatedAt: Math.max(now, lastActivatedAt + 1),
    })}\n`,
  );
  const targetSlotName =
    targetSlotIndex === 0 ? ACTIVE_POINTER_SLOT_NAMES[0] : ACTIVE_POINTER_SLOT_NAMES[1];
  await temporaryPointer.move(pointerFile(targetSlotName), {
    overwrite: true,
  });
  const legacyFile = pointerFile(LEGACY_ACTIVE_POINTER_NAME);
  if (legacyFile.exists) {
    try {
      legacyFile.delete();
    } catch {
      // The newer slot has a greater activation timestamp and remains authoritative.
    }
  }
  await pruneOldValidatedVersionDirectories();
  return destination;
}

function removeStaleStagingDirectories(): void {
  const root = packRoot();
  if (!root.exists) return;
  for (const entry of root.list()) {
    if (entry instanceof Directory && entry.name.startsWith('staging-')) {
      try {
        entry.delete();
      } catch {
        // A stale directory is harmless and can be retried on a later check.
      }
    } else if (
      entry instanceof File &&
      entry.name.startsWith('active-') &&
      entry.name !== LEGACY_ACTIVE_POINTER_NAME &&
      !ACTIVE_POINTER_SLOT_NAMES.includes(entry.name as (typeof ACTIVE_POINTER_SLOT_NAMES)[number])
    ) {
      try {
        entry.delete();
      } catch {
        // The valid pointer slot remains available even if temp cleanup fails.
      }
    }
  }
}

async function pruneOldValidatedVersionDirectories(): Promise<void> {
  try {
    const pointers = (
      await Promise.all(
        ACTIVE_POINTER_SLOT_NAMES.map((name) => readActivePointer(pointerFile(name))),
      )
    ).filter((pointer): pointer is ActivePointer => pointer !== null);
    const retained = new Set(retainedVersionDirectoryNames(pointers));
    const root = versionsRoot();
    if (!root.exists) return;

    for (const entry of root.list()) {
      if (!(entry instanceof Directory) || retained.has(entry.name)) continue;
      try {
        const manifest = await readManifestFromDirectory(entry);
        if (!manifest || manifest.packVersion !== entry.name) continue;
        entry.delete();
      } catch {
        // Cleanup is best-effort; pointer activation has already completed safely.
      }
    }
  } catch {
    // Cleanup failure must never roll back an already activated pack.
  }
}

async function performPackCheck(options: CheckForPackUpdateOptions): Promise<PackUpdateResult> {
  const now = options.now ?? Date.now();
  const settings = useSettingsStore.getState();
  const active = await getActivePackLocation();
  if (shouldThrottlePackCheck(settings, now, options.force)) {
    return { status: 'throttled', checkedAt: now, active };
  }

  let staging: Directory | null = null;
  try {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const manifest = await fetchManifest(baseUrl);
    const currentAppVersion = Constants.expoConfig?.version ?? '0.0.0';

    if (compareVersions(currentAppVersion, manifest.minAppVersion) < 0) {
      settings.setPackCheckSuccess(active.version, now);
      return { status: 'incompatible', checkedAt: now, active, manifest };
    }
    if (!shouldInstallRemotePack(manifest.packVersion, active.version)) {
      settings.setPackCheckSuccess(active.version, now);
      return { status: 'up-to-date', checkedAt: now, active, manifest };
    }

    ensurePackDirectories();
    removeStaleStagingDirectories();
    staging = new Directory(packRoot(), `staging-${manifest.packVersion}-${Crypto.randomUUID()}`);
    staging.create({ intermediates: true });
    const candidateDirectory = staging;

    const directory = await activateOnlyAfterValidation(
      async () => {
        const operations = (Object.keys(manifest.files) as PackFileKey[]).map((key) => {
          const activeDescriptor =
            active.source === 'downloaded' ? active.manifest.files[key] : undefined;
          const source =
            active.source === 'downloaded' &&
            activeDescriptor !== undefined &&
            canReuseValidatedPackFile(activeDescriptor, manifest.files[key])
              ? new File(active.directory, activeDescriptor.path)
              : null;
          return { key, source };
        });
        const install = ({ key, source }: (typeof operations)[number]) =>
          installCandidateFile(
            key,
            candidateDirectory,
            manifest,
            baseUrl,
            source,
            options.validateFile,
          );
        // Finish every fallible network transfer before spending I/O on unchanged local copies.
        await runWithConcurrency(
          operations.filter((operation) => operation.source === null),
          MAX_CONCURRENT_FILE_OPERATIONS,
          install,
        );
        await runWithConcurrency(
          operations.filter((operation) => operation.source !== null),
          MAX_CONCURRENT_FILE_OPERATIONS,
          install,
        );
        writeManifest(candidateDirectory, manifest);
      },
      () => activatePack(candidateDirectory, manifest, now),
    );
    staging = null;
    const downloaded: Extract<PackLocation, { source: 'downloaded' }> = {
      source: 'downloaded',
      version: manifest.packVersion,
      directory,
      manifest,
    };
    settings.setPackCheckSuccess(manifest.packVersion, now);
    return { status: 'updated', checkedAt: now, active: downloaded };
  } catch (error) {
    if (staging?.exists) {
      try {
        staging.delete();
      } catch {
        // The active pointer was never changed, so cleanup can safely wait until a later check.
      }
    }
    const packError = toError(error);
    settings.setPackCheckFailure(now, packError.message);
    return { status: 'failed', checkedAt: now, active, error: packError };
  }
}

/** Runs at most one network/install transaction at a time. */
export function checkForPackUpdate(
  options: CheckForPackUpdateOptions = {},
): Promise<PackUpdateResult> {
  return updateCoordinator.run(options, performPackCheck);
}
