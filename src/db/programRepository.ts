import { Asset } from 'expo-asset';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { defaultDatabaseDirectory, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import {
  CURRENT_SCHEMA_VERSION,
  programExtrasSchema,
  type ProgramExtras,
} from '../../scripts/lib/content-schemas';

import {
  programsPack,
  programsPackSchema,
  reloadActiveContent,
  useContentRevisionStore,
  type Program,
} from '@/data/content';
import { getActivePackLocation, invalidateDownloadedPackVersion } from '@/data/packUpdater';
import {
  buildFavoriteProgramIdsQuery,
  buildProgramCitiesQuery,
  buildProgramConditionsQuery,
  buildProgramDetailQuery,
  buildProgramExtrasQuery,
  buildProgramLanguagesQuery,
  buildProgramListQuery,
  buildProgramNetsQuery,
  buildProgramQuotaCategoriesQuery,
  buildProgramYearsQuery,
  buildProgramsByIdsQuery,
  orderRecordsByIds,
  type ProgramListFilters,
  type ProgramQueryLanguage,
  type SqlQuery,
  uniqueFavoriteIds,
} from '@/db/programQueries';
import { expandProgramSearch } from '@/features/programs/searchAliases';
import { trSearch } from '@/utils/format';
import { withPerformancePhase } from '@/utils/performanceDiagnostics';

type ProgramRow = {
  id: string;
  university: string;
  university_en: string;
  name: string;
  name_en: string;
  city: string;
  city_en: string;
  type: Program['type'];
  score_type: Program['scoreType'];
  scholarship: Program['scholarship'];
  language: string | null;
  language_en: string | null;
  verified: number;
  source: string | null;
  verified_at: string | null;
  approximate: number;
  sample: number;
};

type ProgramYearRow = {
  program_id: string;
  year: number;
  quota: number | null;
  placed: number | null;
  min_score: number | null;
  min_rank: number | null;
  verified: number;
  source: string | null;
  verified_at: string | null;
  approximate: number;
  sample: number;
};

type ProgramExtrasRow = {
  faculty: string | null;
  district: string | null;
  education_type: string | null;
  duration_years: number | null;
  program_group: string | null;
  tuition: number | null;
  accreditation: string | null;
  accreditation_note: string | null;
  tyc: number;
  applied_education_model: string | null;
  min_rank_requirement: number | null;
  min_rank_requirement_note: string | null;
  staff_professor: number | null;
  staff_docent: number | null;
  staff_doctor_faculty: number | null;
  staff_lecturer: number | null;
  staff_research_assistant: number | null;
};

type ProgramConditionRow = { code: string; text: string };

type ProgramQuotaCategoryRow = {
  year: number;
  category: string;
  quota: number | null;
  placed: number | null;
};

type ProgramNetRow = {
  year: number;
  score_type: string;
  coefficient: number | null;
  min_score: number | null;
  obp: number | null;
  tyt_turkce: number | null;
  tyt_sosyal: number | null;
  tyt_matematik: number | null;
  tyt_fen: number | null;
  ayt_matematik: number | null;
  ayt_fizik: number | null;
  ayt_kimya: number | null;
  ayt_biyoloji: number | null;
  ayt_edebiyat: number | null;
  ayt_tarih1: number | null;
  ayt_cografya1: number | null;
  ayt_tarih2: number | null;
  ayt_cografya2: number | null;
  ayt_felsefe: number | null;
  ayt_din: number | null;
  ydt_dil: number | null;
};

export type { ProgramExtras };

type DatabaseLocation = {
  key: string;
  name: string;
  directory: string;
  file: File;
  validationMarker: File;
  identity: string;
  expectedBytes: number;
  expectedSha256: string;
  source: 'bundled' | 'downloaded';
  packVersion: string;
};

type DatabaseEntry = {
  key: string;
  source: DatabaseLocation['source'];
  packVersion: string;
  database: Promise<SQLiteDatabase>;
  location: DatabaseLocation;
  users: number;
  stale: boolean;
  closing: boolean;
};

type DatabaseLocationCache = {
  contentRevision: number;
  request: Promise<DatabaseLocation>;
};

type ValidationMarker = {
  key: string;
  identity: string;
  bytes: number;
  schemaVersion: number;
};

export type ProgramPage = {
  programs: Program[];
  hasMore: boolean;
};

export type ProgramPageQuery = ProgramListFilters & {
  favoriteIds?: readonly string[];
  limit?: number;
  offset?: number;
};

const DEFAULT_PAGE_SIZE = 60;
const FAVORITE_BIND_CHUNK = 300;
const programRuntimeSchema = programsPackSchema.shape.programs.element;
let databaseEntry: DatabaseEntry | null = null;
let databaseEntryRequest: Promise<DatabaseEntry> | null = null;
let databaseLocationCache: DatabaseLocationCache | null = null;

function sqliteBoolean(value: number): boolean | number {
  if (value === 0) return false;
  if (value === 1) return true;
  return value;
}

function databaseIdentity(sha256: string, bytes: number): string {
  return `${sha256.toLowerCase()}-${bytes}`;
}

function validationMarkerFor(
  identity: string,
  source: DatabaseLocation['source'],
  packVersion: string,
): File {
  const safeVersion = packVersion.replace(/[^a-z0-9.-]/gi, '-');
  return new File(
    defaultDatabaseDirectory,
    `yks-programs-validated-${source}-${safeVersion}-${identity}.json`,
  );
}

function deleteIfPresent(file: File): void {
  if (!file.exists) return;
  try {
    file.delete();
  } catch {
    // A failed cleanup is harmless: size/hash/marker validation still fails closed next time.
  }
}

function invalidateValidationMarker(location: DatabaseLocation): void {
  deleteIfPresent(location.validationMarker);
}

async function hasValidValidationMarker(location: DatabaseLocation): Promise<boolean> {
  const marker = location.validationMarker;
  if (!marker.exists) return false;
  try {
    const parsed = JSON.parse(await marker.text()) as Partial<ValidationMarker>;
    if (
      parsed.key === location.key &&
      parsed.identity === location.identity &&
      parsed.bytes === location.expectedBytes &&
      parsed.schemaVersion === CURRENT_SCHEMA_VERSION &&
      location.file.exists &&
      location.file.size === location.expectedBytes
    ) {
      return true;
    }
  } catch {
    // Interrupted or malformed marker writes are treated exactly like a missing marker.
  }
  deleteIfPresent(marker);
  return false;
}

function writeValidationMarker(location: DatabaseLocation): void {
  const marker: ValidationMarker = {
    key: location.key,
    identity: location.identity,
    bytes: location.expectedBytes,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
  location.validationMarker.create({ overwrite: true });
  location.validationMarker.write(`${JSON.stringify(marker)}\n`);
}

async function sha256(file: File): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fileMatchesManifest(
  file: File,
  expectedBytes: number,
  expectedSha256: string,
): Promise<boolean> {
  return (
    file.exists &&
    file.size === expectedBytes &&
    (await sha256(file)).toLowerCase() === expectedSha256.toLowerCase()
  );
}

function clearDatabaseLocationCache(): void {
  databaseLocationCache = null;
}

async function resolveDatabaseLocation(): Promise<DatabaseLocation> {
  const active = await getActivePackLocation();
  const descriptor = active.manifest?.files.programs;
  if (!descriptor) throw new Error('The active content manifest has no programs database');
  const identity = databaseIdentity(descriptor.sha256, descriptor.bytes);
  const validationMarker = validationMarkerFor(identity, active.source, active.version);

  if (active.source === 'downloaded') {
    const name = descriptor.path;
    const file = new File(active.directory, name);
    return {
      key: file.uri,
      name,
      directory: active.directory.uri,
      file,
      validationMarker,
      identity,
      expectedBytes: descriptor.bytes,
      expectedSha256: descriptor.sha256,
      source: 'downloaded',
      packVersion: active.version,
    };
  }

  const moduleId = require('../../assets/pack/programs.db') as number;
  const asset = Asset.fromModule(moduleId);
  await withPerformancePhase('catalog.asset-download', () => asset.downloadAsync());
  if (!asset.localUri) throw new Error('Bundled programs database could not be loaded');

  const destination = new File(defaultDatabaseDirectory, `yks-programs-bundled-${identity}.db`);
  const location: DatabaseLocation = {
    key: destination.uri,
    name: destination.name,
    directory: defaultDatabaseDirectory,
    file: destination,
    validationMarker,
    identity,
    expectedBytes: descriptor.bytes,
    expectedSha256: descriptor.sha256,
    source: 'bundled',
    packVersion: active.version,
  };
  const markerValid = await hasValidValidationMarker(location);
  let copyRequired = !destination.exists || destination.size !== descriptor.bytes;
  if (!copyRequired && !markerValid) {
    copyRequired = !(await withPerformancePhase('catalog.hash-existing', () =>
      fileMatchesManifest(destination, descriptor.bytes, descriptor.sha256),
    ));
  }
  if (copyRequired) {
    invalidateValidationMarker(location);
    deleteIfPresent(destination);
    const source = new File(asset.localUri);
    if (source.size !== descriptor.bytes) {
      throw new Error('Bundled programs database size does not match its manifest');
    }
    const copiedAndVerified = await withPerformancePhase('catalog.copy-and-hash', async () => {
      await source.copy(destination, { overwrite: true });
      return fileMatchesManifest(destination, descriptor.bytes, descriptor.sha256);
    });
    if (!copiedAndVerified) {
      deleteIfPresent(destination);
      throw new Error('Bundled programs database hash does not match its manifest');
    }
  }
  return location;
}

async function getDatabaseLocation(): Promise<DatabaseLocation> {
  const contentRevision = useContentRevisionStore.getState().revision;
  if (databaseLocationCache?.contentRevision === contentRevision) {
    return databaseLocationCache.request;
  }
  const request = resolveDatabaseLocation();
  databaseLocationCache = { contentRevision, request };
  try {
    return await request;
  } catch (error) {
    if (databaseLocationCache?.request === request) clearDatabaseLocationCache();
    throw error;
  }
}

async function openValidatedDatabase(location: DatabaseLocation): Promise<SQLiteDatabase> {
  const database = await withPerformancePhase('catalog.open', () =>
    openDatabaseAsync(location.name, { useNewConnection: true }, location.directory),
  );
  let quickCheckFailed = false;
  try {
    const alreadyValidated = await hasValidValidationMarker(location);
    if (!alreadyValidated) {
      const integrity = await withPerformancePhase('catalog.quick-check', () =>
        database.getFirstAsync<{ quick_check: unknown }>('PRAGMA quick_check(1)'),
      );
      if (integrity?.quick_check !== 'ok') {
        quickCheckFailed = true;
        throw new Error('The program database failed its runtime integrity check');
      }
    }
    const metadata = await database.getFirstAsync<{ value: unknown }>(
      "SELECT value FROM pack_metadata WHERE key = 'schemaVersion' LIMIT 1",
    );
    if (metadata?.value !== String(CURRENT_SCHEMA_VERSION)) {
      throw new Error('The program database schema metadata is unsupported');
    }
    if (!alreadyValidated) {
      try {
        writeValidationMarker(location);
      } catch {
        invalidateValidationMarker(location);
      }
    }
    return database;
  } catch (error) {
    invalidateValidationMarker(location);
    await database.closeAsync().catch(() => undefined);
    if (quickCheckFailed && location.source === 'bundled') deleteIfPresent(location.file);
    throw error;
  }
}

function closeWhenUnused(entry: DatabaseEntry): void {
  if (!entry.stale || entry.users > 0 || entry.closing) return;
  entry.closing = true;
  void entry.database.then((database) => database.closeAsync()).catch(() => undefined);
}

async function resolveDatabaseEntry(): Promise<DatabaseEntry> {
  const location = await getDatabaseLocation();
  if (databaseEntry?.key === location.key) return databaseEntry;

  const previous = databaseEntry;
  const next: DatabaseEntry = {
    key: location.key,
    source: location.source,
    packVersion: location.packVersion,
    database: openValidatedDatabase(location),
    location,
    users: 0,
    stale: false,
    closing: false,
  };
  databaseEntry = next;
  if (previous) {
    previous.stale = true;
    closeWhenUnused(previous);
  }
  return next;
}

async function getDatabaseEntry(): Promise<DatabaseEntry> {
  if (databaseEntryRequest) return databaseEntryRequest;
  const request = resolveDatabaseEntry();
  databaseEntryRequest = request;
  try {
    return await request;
  } finally {
    if (databaseEntryRequest === request) databaseEntryRequest = null;
  }
}

async function runProgramDatabaseOperation<T>(
  entry: DatabaseEntry,
  operation: (database: SQLiteDatabase) => Promise<T>,
): Promise<T> {
  entry.users += 1;
  try {
    const database = await entry.database;
    return await operation(database);
  } catch (error) {
    invalidateValidationMarker(entry.location);
    clearDatabaseLocationCache();
    if (databaseEntry === entry) {
      entry.stale = true;
      databaseEntry = null;
    }
    throw error;
  } finally {
    entry.users -= 1;
    closeWhenUnused(entry);
  }
}

async function withProgramDatabase<T>(operation: (database: SQLiteDatabase) => Promise<T>) {
  if (Platform.OS === 'web') throw new Error('The program SQLite pack is unavailable on web');
  const entry = await getDatabaseEntry();
  try {
    return await runProgramDatabaseOperation(entry, operation);
  } catch (error) {
    if (entry.source !== 'downloaded') throw error;

    // A valid-size SQLite file can still be corrupted after activation. Remove only this pack's
    // pointers, align JSON content with the rollback/bundled pack, then retry exactly once.
    await invalidateDownloadedPackVersion(entry.packVersion);
    clearDatabaseLocationCache();
    try {
      await reloadActiveContent();
    } catch {
      // Database fallback remains independently safe even if a JSON rollback also proves invalid.
    }
    const fallback = await getDatabaseEntry();
    if (fallback.key === entry.key) throw error;
    return runProgramDatabaseOperation(fallback, operation);
  }
}

/** Opens and validates the active program database before the browse screen needs its first page. */
export async function prewarmProgramDatabase(): Promise<void> {
  if (Platform.OS === 'web') return;
  await withPerformancePhase('catalog.prewarm', () => withProgramDatabase(async () => undefined));
}

async function all<Row>(database: SQLiteDatabase, query: SqlQuery): Promise<Row[]> {
  return database.getAllAsync<Row>(query.sql, query.parameters);
}

function mapProgram(row: ProgramRow, years: ProgramYearRow[]): Program | null {
  const candidate = {
    id: row.id,
    university: { tr: row.university, en: row.university_en },
    name: { tr: row.name, en: row.name_en },
    city:
      row.city === null && row.city_en === null
        ? null
        : { tr: row.city ?? '', en: row.city_en ?? '' },
    type: row.type,
    scoreType: row.score_type,
    scholarship: row.scholarship,
    language:
      row.language === null && row.language_en === null
        ? null
        : { tr: row.language ?? '', en: row.language_en ?? '' },
    verified: sqliteBoolean(row.verified),
    verifiedAt: row.verified_at,
    approximate: sqliteBoolean(row.approximate),
    sample: sqliteBoolean(row.sample),
    source: row.source,
    years: years.map((year) => ({
      year: year.year,
      quota: year.quota,
      placed: year.placed,
      minScore: year.min_score,
      minRank: year.min_rank,
      verified: sqliteBoolean(year.verified),
      verifiedAt: year.verified_at,
      source: year.source,
      approximate: sqliteBoolean(year.approximate),
      sample: sqliteBoolean(year.sample),
    })),
  };
  const parsed = programRuntimeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

async function hydratePrograms(
  database: SQLiteDatabase,
  rows: ProgramRow[],
  orderedIds?: readonly string[],
): Promise<Program[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const yearRows = await all<ProgramYearRow>(database, buildProgramYearsQuery(ids));
  const yearsByProgram = new Map<string, ProgramYearRow[]>();
  for (const year of yearRows) {
    const years = yearsByProgram.get(year.program_id) ?? [];
    years.push(year);
    yearsByProgram.set(year.program_id, years);
  }

  const programs = rows.flatMap((row) => {
    const program = mapProgram(row, yearsByProgram.get(row.id) ?? []);
    if (!program && __DEV__) {
      // A drop on a CURRENT binary means the pack and the runtime schema drifted (old
      // binaries dropping newer categories is by design and never reaches this code).
      // hasMore stays SQL-side on purpose: offset pagination needs the pre-drop count.
      console.warn(`Program row ${row.id} failed runtime validation and was dropped`);
    }
    return program ? [program] : [];
  });
  if (!orderedIds) return programs;
  return orderRecordsByIds(programs, orderedIds);
}

async function queryFavoritePage(
  database: SQLiteDatabase,
  query: ProgramPageQuery,
  limit: number,
  offset: number,
): Promise<ProgramPage> {
  const favorites = uniqueFavoriteIds(query.favoriteIds ?? []);
  if (!favorites.length) return { programs: [], hasMore: false };

  const matchingIds = new Set<string>();
  for (let start = 0; start < favorites.length; start += FAVORITE_BIND_CHUNK) {
    const chunk = favorites.slice(start, start + FAVORITE_BIND_CHUNK);
    const rows = await all<{ id: string }>(database, buildFavoriteProgramIdsQuery(query, chunk));
    for (const row of rows) matchingIds.add(row.id);
  }
  const orderedMatches = favorites.filter((id) => matchingIds.has(id));
  const pageIds = orderedMatches.slice(offset, offset + limit + 1);
  const hasMore = pageIds.length > limit;
  const visibleIds = pageIds.slice(0, limit);
  if (!visibleIds.length) return { programs: [], hasMore };
  const rows = await all<ProgramRow>(database, buildProgramsByIdsQuery(visibleIds));
  return {
    programs: await hydratePrograms(database, rows, visibleIds),
    hasMore,
  };
}

// Parity with the SQL walk-back in buildProgramListQuery: rank by the most recent year
// that has a PUBLISHED min_rank (fixture years are newest-first, but this doesn't rely
// on that ordering); programs with no ranked year at all sort last.
function latestRankedMinRank(program: Program): number {
  let bestYear = Number.NEGATIVE_INFINITY;
  let bestRank = Number.MAX_SAFE_INTEGER;
  for (const year of program.years) {
    if (year.minRank !== null && year.year > bestYear) {
      bestYear = year.year;
      bestRank = year.minRank;
    }
  }
  return bestRank;
}

function fallbackPage(query: ProgramPageQuery, limit: number, offset: number): ProgramPage {
  const favoriteIds = query.favoriteIds ? uniqueFavoriteIds(query.favoriteIds) : null;
  // null (not an empty Map) when the query is not favorites-scoped: an empty Map is
  // truthy, so the membership filter below would silently reject every row.
  const favoriteOrder = favoriteIds ? new Map(favoriteIds.map((id, index) => [id, index])) : null;
  // Same expansion source as the SQL path (parity): TR queries may carry alias
  // expansions; the literal term is always patterns[0].
  const searchPatterns =
    query.language === 'tr'
      ? expandProgramSearch(query.search ?? '')
      : [trSearch(query.search ?? '')].filter(Boolean);
  const filtered = programsPack.programs
    .flatMap((program) => {
      const publishable = fallbackProgram(program);
      return publishable ? [publishable] : [];
    })
    .filter((program) => program.scoreType === query.scoreType)
    .filter((program) => !query.city || program.city?.[query.language] === query.city)
    .filter(
      (program) =>
        !query.instructionLanguage ||
        program.language?.[query.language] === query.instructionLanguage,
    )
    .filter((program) => !query.type || program.type === query.type)
    .filter((program) => !query.scholarship || program.scholarship === query.scholarship)
    .filter((program) => !favoriteOrder || favoriteOrder.has(program.id))
    .filter((program) => {
      if (!searchPatterns.length) return true;
      const haystack = trSearch(
        `${program.name[query.language]} ${program.university[query.language]}`,
      );
      return searchPatterns.some((pattern) => haystack.includes(pattern));
    })
    .sort((left, right) => {
      if (favoriteOrder) {
        return (favoriteOrder.get(left.id) ?? 0) - (favoriteOrder.get(right.id) ?? 0);
      }
      return (
        latestRankedMinRank(left) - latestRankedMinRank(right) || left.id.localeCompare(right.id)
      );
    });
  return {
    programs: filtered.slice(offset, offset + limit),
    hasMore: filtered.length > offset + limit,
  };
}

function fallbackProgram(program: Program): Program | null {
  const years = program.years.filter(
    (year) =>
      year.verified &&
      Boolean(year.source) &&
      Boolean(year.verifiedAt) &&
      !year.approximate &&
      !year.sample,
  );
  return program.verified &&
    Boolean(program.source) &&
    Boolean(program.verifiedAt) &&
    !program.approximate &&
    !program.sample &&
    years.length
    ? { ...program, years }
    : null;
}

/** Reads only one bounded list page and its verified yearly rows from SQLite. */
export async function queryProgramPage(query: ProgramPageQuery): Promise<ProgramPage> {
  const limit = query.limit ?? DEFAULT_PAGE_SIZE;
  const offset = query.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new RangeError('Program page size must be between 1 and 200');
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError('Program page offset must be a nonnegative integer');
  }
  if (Platform.OS === 'web') return fallbackPage(query, limit, offset);

  const phase = query.favoriteIds
    ? 'catalog.query-page.favorites'
    : query.search?.trim()
      ? 'catalog.query-page.search'
      : 'catalog.query-page.browse';
  return withPerformancePhase(phase, () =>
    withProgramDatabase(async (database) => {
      if (query.favoriteIds) return queryFavoritePage(database, query, limit, offset);
      const rows = await all<ProgramRow>(database, buildProgramListQuery(query, limit + 1, offset));
      const hasMore = rows.length > limit;
      return {
        programs: await hydratePrograms(database, rows.slice(0, limit)),
        hasMore,
      };
    }),
  );
}

/** Reads a single verified program for the detail screen. */
export async function queryProgramById(id: string): Promise<Program | null> {
  if (!id.trim()) return null;
  if (Platform.OS === 'web') {
    const program = programsPack.programs.find((candidate) => candidate.id === id);
    return program ? fallbackProgram(program) : null;
  }
  return withProgramDatabase(async (database) => {
    const rows = await all<ProgramRow>(database, buildProgramDetailQuery(id));
    return (await hydratePrograms(database, rows))[0] ?? null;
  });
}

const NET_SUBJECT_COLUMN_MAP = [
  ['tyt_turkce', 'tytTurkce'],
  ['tyt_sosyal', 'tytSosyal'],
  ['tyt_matematik', 'tytMatematik'],
  ['tyt_fen', 'tytFen'],
  ['ayt_matematik', 'aytMatematik'],
  ['ayt_fizik', 'aytFizik'],
  ['ayt_kimya', 'aytKimya'],
  ['ayt_biyoloji', 'aytBiyoloji'],
  ['ayt_edebiyat', 'aytEdebiyat'],
  ['ayt_tarih1', 'aytTarih1'],
  ['ayt_cografya1', 'aytCografya1'],
  ['ayt_tarih2', 'aytTarih2'],
  ['ayt_cografya2', 'aytCografya2'],
  ['ayt_felsefe', 'aytFelsefe'],
  ['ayt_din', 'aytDin'],
  ['ydt_dil', 'ydtDil'],
] as const;

function mapProgramExtras(
  row: ProgramExtrasRow,
  conditions: ProgramConditionRow[],
  categories: ProgramQuotaCategoryRow[],
  nets: ProgramNetRow[],
): ProgramExtras | null {
  const staffValues = {
    professor: row.staff_professor,
    docent: row.staff_docent,
    doctorFaculty: row.staff_doctor_faculty,
    lecturer: row.staff_lecturer,
    researchAssistant: row.staff_research_assistant,
  };
  const candidate = {
    faculty: row.faculty,
    district: row.district,
    educationType: row.education_type,
    durationYears: row.duration_years,
    programGroup: row.program_group,
    tuition: row.tuition,
    accreditation: row.accreditation,
    accreditationNote: row.accreditation_note,
    tyc: sqliteBoolean(row.tyc),
    appliedEducationModel: row.applied_education_model,
    minRankRequirement: row.min_rank_requirement,
    minRankRequirementNote: row.min_rank_requirement_note,
    staff: Object.values(staffValues).every((value) => value === null) ? null : staffValues,
    conditions: conditions.map((condition) => ({ code: condition.code, text: condition.text })),
    quotaCategories: categories.map((category) => ({
      category: category.category,
      year: category.year,
      quota: category.quota,
      placed: category.placed,
    })),
    nets: nets.map((net) => ({
      year: net.year,
      scoreType: net.score_type,
      coefficient: net.coefficient,
      minScore: net.min_score,
      obp: net.obp,
      nets: Object.fromEntries(
        NET_SUBJECT_COLUMN_MAP.flatMap(([column, subject]) =>
          net[column] === null ? [] : [[subject, net[column]]],
        ),
      ),
    })),
  };
  const parsed = programExtrasSchema.safeParse(candidate);
  if (!parsed.success && __DEV__) {
    console.warn('Program extras failed runtime validation and were dropped');
  }
  return parsed.success ? parsed.data : null;
}

/**
 * True when a query failed only because the open pack predates the detail schema
 * (rollback/older downloaded pack). Detected INSIDE the database operation so the
 * shared error path never invalidates a structurally healthy pack over it.
 */
function isMissingDetailSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such (table|column)/i.test(message);
}

/** Reads the official YÖK Atlas detail data of one program; null when unavailable. */
export async function queryProgramExtras(id: string): Promise<ProgramExtras | null> {
  if (!id.trim()) return null;
  // The web fallback JSON carries no detail data; the detail screen renders base cards.
  if (Platform.OS === 'web') return null;
  return withProgramDatabase(async (database) => {
    try {
      const extrasRows = await all<ProgramExtrasRow>(database, buildProgramExtrasQuery(id));
      const extras = extrasRows[0];
      if (!extras) return null;
      const [conditions, categories, nets] = await Promise.all([
        all<ProgramConditionRow>(database, buildProgramConditionsQuery(id)),
        all<ProgramQuotaCategoryRow>(database, buildProgramQuotaCategoriesQuery(id)),
        all<ProgramNetRow>(database, buildProgramNetsQuery(id)),
      ]);
      return mapProgramExtras(extras, conditions, categories, nets);
    } catch (error) {
      if (isMissingDetailSchemaError(error)) return null;
      throw error;
    }
  });
}

/** Reads the small distinct city facet without loading any program or yearly row. */
export async function queryProgramCities(language: ProgramQueryLanguage): Promise<string[]> {
  if (Platform.OS === 'web') {
    return [
      ...new Set(
        programsPack.programs.flatMap((program) => {
          const publishable = fallbackProgram(program);
          return publishable?.city ? [publishable.city[language]] : [];
        }),
      ),
    ].sort();
  }
  return withProgramDatabase(async (database) => {
    const rows = await all<{ city: unknown }>(database, buildProgramCitiesQuery(language));
    return rows.flatMap((row) =>
      typeof row.city === 'string' && row.city.trim() ? [row.city] : [],
    );
  });
}

/** Reads the bounded distinct instruction-language facet without loading program rows. */
export async function queryProgramLanguages(language: ProgramQueryLanguage): Promise<string[]> {
  if (Platform.OS === 'web') {
    return [
      ...new Set(
        programsPack.programs.flatMap((program) => {
          const publishable = fallbackProgram(program);
          const value = publishable?.language?.[language];
          return value ? [value] : [];
        }),
      ),
    ].sort();
  }
  return withProgramDatabase(async (database) => {
    const rows = await all<{ instruction_language: unknown }>(
      database,
      buildProgramLanguagesQuery(language),
    );
    return rows.flatMap((row) =>
      typeof row.instruction_language === 'string' && row.instruction_language.trim()
        ? [row.instruction_language]
        : [],
    );
  });
}
