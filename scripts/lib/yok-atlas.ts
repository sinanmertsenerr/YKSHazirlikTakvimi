import { z } from 'zod';

import {
  CURRENT_SCHEMA_VERSION,
  programsFixtureSchema,
  type ProgramsFixture,
} from './content-schemas.ts';
import {
  preserveStableRecordVerificationTimes,
  preserveVerifiedAtIfUnchanged,
} from './semantic-stability.ts';
import { fetchYokAtlas } from './yok-atlas-fetch.ts';

export const YOK_ATLAS_API_URL = 'https://yokatlas.yok.gov.tr/api/tercih-kilavuz/search';
export const YOK_ATLAS_DETAIL_BASE_URL = 'https://yokatlas.yok.gov.tr/detay';
export const YOK_ATLAS_SCORE_TYPES = ['SAY', 'EA', 'SÖZ', 'DİL', 'TYT'] as const;
// YÖK Atlas keeps the two program levels behind distinct birimTuruId selectors (lisans
// wizard t4 posts 46, önlisans wizard t3 posts 47 — verified against the live search API:
// puanTuru TYT alone and TYT+birimTuruId 47 both return the same snapshot totals). TYT is
// the only önlisans placement score; the other four place lisans programs only.
export const YOK_ATLAS_LEVELS = [
  { level: 'lisans', birimTuruId: 46, scoreTypes: ['SAY', 'EA', 'SÖZ', 'DİL'] },
  { level: 'onlisans', birimTuruId: 47, scoreTypes: ['TYT'] },
] as const;
// Özel yetenek (talent-exam, ÖSYM TABLO 5) programs live behind a third selector.
// Verified live 2026-07-16: the SPA bundle lists {label:"ÖZEL YETENEK",value:48} beside
// 46/47 and the search API accepts birimTuruId 48 with puanTuru null. The level is
// swept OUTSIDE YOK_ATLAS_LEVELS because none of the merkezi invariants hold for it:
// rows have no per-scoreType partitioning, no central cutoffs, and an INDEPENDENT
// snapshot year (observed 2026 while merkezi still served 2025). allowEmpty: the level
// returns 0 rows until each year's kılavuz loads — an empty sweep is the expected
// steady state, never an import failure.
export const YOK_ATLAS_TALENT_LEVEL = {
  level: 'ozelyetenek',
  birimTuruId: 48,
  allowEmpty: true,
} as const;

const numberLikeSchema = z.union([
  z.number().finite(),
  z
    .string()
    .trim()
    .regex(/^-?\d+(?:\.\d+)?$/),
]);
const nullableNumberLikeSchema = numberLikeSchema.nullish();

export const yokAtlasRowSchema = z.object({
  kilavuzKodu: numberLikeSchema,
  yil: numberLikeSchema,
  universiteAdi: z.string().trim().min(1),
  birimAdi: z.string().trim().min(1),
  ilAdi: z.string().trim().min(1).nullish(),
  universiteTuru: z.string().trim().min(1),
  puanTuru: z.enum(YOK_ATLAS_SCORE_TYPES),
  bursOraniAdi: z.string().trim().min(1).nullish(),
  ogrenimDiliAdi: z.string().trim().min(1).nullish(),
  kontenjan: nullableNumberLikeSchema,
  // gkY = genel kontenjana yerleşen. Proven against the SPA's own render code (the
  // "Kontenjan ve Yerleşme" table binds {kategori:"Genel", kontenjan, yerlesen:E.gkY}
  // and the doluluk doughnut charts gkY as "Yerleşen Öğrenci") — canary-pinned in
  // import-yok-atlas-programs. Only the CURRENT year exposes it; no gk1Y/gk2Y exists.
  gkY: nullableNumberLikeSchema,
  minPuan: nullableNumberLikeSchema,
  basariSirasi: nullableNumberLikeSchema,
  gk1: nullableNumberLikeSchema,
  gk2: nullableNumberLikeSchema,
  gk3: nullableNumberLikeSchema,
  minPuan1: nullableNumberLikeSchema,
  minPuan2: nullableNumberLikeSchema,
  minPuan3: nullableNumberLikeSchema,
  basariSirasi1: nullableNumberLikeSchema,
  basariSirasi2: nullableNumberLikeSchema,
  basariSirasi3: nullableNumberLikeSchema,
});

// TABLO 5 rows have no proven cutoff contract yet (the level stays empty until the
// yearly kılavuz loads): only identity fields are required, puanTuru is free-form, and
// any surprise shape aborts the import loudly instead of publishing guessed data.
export const yokAtlasTalentRowSchema = yokAtlasRowSchema.extend({
  puanTuru: z.string().trim().min(1).nullish(),
});

// The page envelope is shared across levels; row validation happens per level because
// merkezi rows carry the strict 5-value puanTuru enum while TABLO 5 rows do not.
const yokAtlasPageSchema = z.object({
  content: z.array(z.unknown()),
  number: z.int().nonnegative(),
  numberOfElements: z.int().nonnegative(),
  size: z.int().positive(),
  totalElements: z.int().nonnegative(),
  totalPages: z.int().nonnegative(),
  yil: z.int().min(2018).max(2100),
  source: z.literal('snapshot'),
});

export type YokAtlasRow = z.infer<typeof yokAtlasRowSchema>;
export type YokAtlasTalentRow = z.infer<typeof yokAtlasTalentRowSchema>;
export type YokAtlasScoreType = (typeof YOK_ATLAS_SCORE_TYPES)[number];

export type ImportStatistics = {
  receivedRows: number;
  receivedTalentRows: number;
  importedPrograms: number;
  importedTalentPrograms: number;
  skippedByUniversityType: Record<string, number>;
  omittedScholarshipLabels: Record<string, number>;
};

export type FetchStatistics = {
  requestCount: number;
  snapshotYear: number;
  snapshotSource: 'snapshot';
  totalsByScoreType: Record<YokAtlasScoreType, number>;
};

export type TalentFetchStatistics = {
  requestCount: number;
  /** Reported even for an empty sweep — TABLO 5's snapshot year is independent of merkezi. */
  snapshotYear: number;
  rowCount: number;
};

export type FetchYokAtlasOptions = {
  expectedYear?: number;
  pageSize?: number;
  requestDelayMs?: number;
  retries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (message: string) => void;
  /**
   * Receives every RAW page row before schema parsing strips unmodeled fields. The
   * details importer consumes the same sweep through this hook so the program fixture
   * and the details fixture can never come from two different snapshots.
   */
  onRawRow?: (raw: unknown) => void;
};

export type BuildYokAtlasFixtureResult = {
  fixture: ProgramsFixture;
  statistics: ImportStatistics;
};

export function stabilizeYokAtlasFixture(
  candidateInput: unknown,
  previousInput: unknown,
): ProgramsFixture {
  const candidate = programsFixtureSchema.parse(candidateInput);
  const previous = programsFixtureSchema.safeParse(previousInput);
  if (!previous.success) return candidate;

  const previousById = new Map<string, ProgramsFixture['programs'][number]>();
  for (const program of previous.data.programs) {
    if (previousById.has(program.id)) {
      throw new Error(`Duplicate previous program key: ${program.id}`);
    }
    previousById.set(program.id, program);
  }

  const programs = candidate.programs.map((program) => {
    const previousProgram = previousById.get(program.id);
    if (!previousProgram) return program;
    const withStableYears = {
      ...program,
      years: preserveStableRecordVerificationTimes(program.years, previousProgram.years, (year) =>
        String(year.year),
      ),
    };
    return preserveVerifiedAtIfUnchanged(withStableYears, previousProgram);
  });

  return programsFixtureSchema.parse({ ...candidate, programs });
}

function parseNumber(
  value: z.infer<typeof nullableNumberLikeSchema>,
  label: string,
): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a finite number`);
  return parsed;
}

function parseNonnegativeInteger(
  value: z.infer<typeof nullableNumberLikeSchema>,
  label: string,
): number | null {
  const parsed = parseNumber(value, label);
  if (parsed === null) return null;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
  return parsed;
}

function parsePositiveMetric(
  value: z.infer<typeof nullableNumberLikeSchema>,
  label: string,
  integer: boolean,
): number | null {
  const parsed = parseNumber(value, label);
  if (parsed === null || parsed === 0) return null;
  if (parsed < 0 || (integer && !Number.isSafeInteger(parsed))) {
    throw new Error(`${label} must be zero/missing or a positive${integer ? ' integer' : ''}`);
  }
  return parsed;
}

// All five live universiteTuru values map 1:1 (live-verified 2026-07-17: DEVLET 12060,
// VAKIF 8045, KKTC 1158, VAKIF MYO 181, YURTDISI VAKIF 41, YURTDISI KAMU 117 rows).
// The source spells the foreign values in plain ASCII ("YURTDISI", not "YURTDIŞI").
// An unknown NEW value still returns null and is skip-counted, never guessed.
function toProgramType(value: string): ProgramsFixture['programs'][number]['type'] | null {
  switch (value.toLocaleUpperCase('tr-TR')) {
    case 'DEVLET':
      return 'devlet';
    case 'VAKIF':
      return 'vakif';
    case 'KKTC':
      return 'kibris';
    case 'VAKIF MYO':
      return 'vakif-myo';
    case 'YURTDISI VAKIF':
      return 'yurtdisi-vakif';
    case 'YURTDISI KAMU':
      return 'yurtdisi-kamu';
    default:
      return null;
  }
}

function toScoreType(value: YokAtlasScoreType): ProgramsFixture['programs'][number]['scoreType'] {
  if (value === 'SAY') return 'say';
  if (value === 'EA') return 'ea';
  if (value === 'DİL') return 'dil';
  if (value === 'TYT') return 'tyt';
  return 'soz';
}

function toScholarship(value: string | null | undefined): {
  scholarship: ProgramsFixture['programs'][number]['scholarship'];
  omittedLabel: string | null;
} {
  if (!value) return { scholarship: null, omittedLabel: null };
  switch (value.toLocaleUpperCase('tr-TR')) {
    case 'BURSLU':
      return { scholarship: 'burslu', omittedLabel: null };
    case '%50 İNDİRİMLİ':
      return { scholarship: '%50', omittedLabel: null };
    case '%25 İNDİRİMLİ':
      return { scholarship: '%25', omittedLabel: null };
    case 'ÜCRETLİ':
      return { scholarship: 'ucretli', omittedLabel: null };
    case 'ÜCRETSİZ':
      return { scholarship: null, omittedLabel: null };
    default:
      return { scholarship: null, omittedLabel: value };
  }
}

function programDetailUrl(id: string): string {
  return `${YOK_ATLAS_DETAIL_BASE_URL}/${encodeURIComponent(id)}`;
}

function incrementCounter(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function makeYear(
  row: YokAtlasTalentRow,
  year: number,
  suffix: '' | '1' | '2' | '3',
  source: string,
  verifiedAt: string,
): ProgramsFixture['programs'][number]['years'][number] | null {
  const quotaKey = suffix ? (`gk${suffix}` as const) : ('kontenjan' as const);
  const scoreKey = suffix ? (`minPuan${suffix}` as const) : ('minPuan' as const);
  const rankKey = suffix ? (`basariSirasi${suffix}` as const) : ('basariSirasi' as const);
  const quota = parseNonnegativeInteger(row[quotaKey], `${row.kilavuzKodu}.${year}.quota`);
  const minScore = parsePositiveMetric(row[scoreKey], `${row.kilavuzKodu}.${year}.minScore`, false);
  const minRank = parsePositiveMetric(row[rankKey], `${row.kilavuzKodu}.${year}.minRank`, true);

  if (suffix && quota === null && minScore === null && minRank === null) return null;
  // gkY (genel yerleşen) exists for the CURRENT year only; historical years stay null and
  // are filled from the official ÖSYM archive tables at build time. A 0 next to a fully
  // cutoff-less year is indistinguishable from "placement not run yet" (a freshly loaded
  // kılavuz), so only a published cutoff or a positive count is trusted as a real total.
  let placed: number | null = null;
  if (!suffix) {
    const generalPlaced = parseNonnegativeInteger(row.gkY, `${row.kilavuzKodu}.${year}.placed`);
    if (generalPlaced !== null && (generalPlaced > 0 || minScore !== null || minRank !== null)) {
      placed = generalPlaced;
    }
  }
  return {
    year,
    quota,
    placed,
    minScore,
    minRank,
    verified: true,
    verifiedAt,
    source,
    approximate: false,
    sample: false,
  };
}

type NormalizedRowResult = {
  program: ProgramsFixture['programs'][number] | null;
  skippedUniversityType: string | null;
  omittedScholarshipLabel: string | null;
};

export function normalizeYokAtlasRow(input: unknown, verifiedAt: string): NormalizedRowResult {
  const row = yokAtlasRowSchema.parse(input);
  z.iso.datetime({ offset: true }).parse(verifiedAt);
  return buildNormalizedProgram(row, toScoreType(row.puanTuru), verifiedAt);
}

/** TABLO 5 rows always map to the 'yetenek' score type regardless of any puanTuru label. */
export function normalizeYokAtlasTalentRow(
  input: unknown,
  verifiedAt: string,
): NormalizedRowResult {
  const row = yokAtlasTalentRowSchema.parse(input);
  z.iso.datetime({ offset: true }).parse(verifiedAt);
  return buildNormalizedProgram(row, 'yetenek', verifiedAt);
}

// YokAtlasRow is structurally assignable to YokAtlasTalentRow (its puanTuru enum
// narrows the talent schema's free-form string), so one builder serves both levels.
function buildNormalizedProgram(
  row: YokAtlasTalentRow,
  scoreType: ProgramsFixture['programs'][number]['scoreType'],
  verifiedAt: string,
): NormalizedRowResult {
  const idNumber = parseNonnegativeInteger(row.kilavuzKodu, 'kilavuzKodu');
  if (!idNumber) throw new Error('kilavuzKodu must be a positive integer');
  const id = String(idNumber);
  const currentYear = parseNonnegativeInteger(row.yil, `${id}.yil`);
  if (!currentYear || currentYear < 2018 || currentYear > 2100) {
    throw new Error(`${id}.yil is outside the supported range`);
  }

  const type = toProgramType(row.universiteTuru);
  if (!type) {
    return {
      program: null,
      skippedUniversityType: row.universiteTuru,
      omittedScholarshipLabel: null,
    };
  }
  // Foreign programs carry no il in the source (their city lives inside the university
  // name, e.g. "(BİŞKEK)") and the official UI renders "--" — mirrored as null, never
  // derived. A missing il on a DOMESTIC row is still snapshot corruption and aborts.
  const isForeign = type === 'yurtdisi-vakif' || type === 'yurtdisi-kamu';
  if (!row.ilAdi && !isForeign) {
    throw new Error(`${id} is a domestic university type but has no official city value`);
  }

  const source = programDetailUrl(id);
  const { scholarship, omittedLabel } = toScholarship(row.bursOraniAdi);
  const years = [
    makeYear(row, currentYear, '', source, verifiedAt),
    makeYear(row, currentYear - 1, '1', source, verifiedAt),
    makeYear(row, currentYear - 2, '2', source, verifiedAt),
    makeYear(row, currentYear - 3, '3', source, verifiedAt),
  ].filter((year): year is NonNullable<typeof year> => Boolean(year));

  const sourceOnly = (value: string) => ({ tr: value, en: value });
  return {
    program: {
      id,
      university: sourceOnly(row.universiteAdi),
      name: sourceOnly(row.birimAdi),
      city: row.ilAdi ? sourceOnly(row.ilAdi) : null,
      type,
      scoreType,
      scholarship,
      language: row.ogrenimDiliAdi ? sourceOnly(row.ogrenimDiliAdi) : null,
      verified: true,
      verifiedAt,
      approximate: false,
      sample: false,
      source,
      years,
    },
    skippedUniversityType: null,
    omittedScholarshipLabel: omittedLabel,
  };
}

export function buildYokAtlasFixture(
  rows: unknown[],
  verifiedAt: string,
  talentRows: unknown[] = [],
): BuildYokAtlasFixtureResult {
  const programs = new Map<string, ProgramsFixture['programs'][number]>();
  const statistics: ImportStatistics = {
    receivedRows: rows.length,
    receivedTalentRows: talentRows.length,
    importedPrograms: 0,
    importedTalentPrograms: 0,
    skippedByUniversityType: {},
    omittedScholarshipLabels: {},
  };

  // Merkezi and talent rows share one Map on purpose: ÖSYM YÖP codes are a single
  // namespace across kılavuz tables, so a cross-level collision is snapshot corruption
  // and must abort the whole import loudly, exactly like a same-level duplicate.
  const addNormalizedRow = (normalized: NormalizedRowResult): void => {
    if (!normalized.program) {
      incrementCounter(
        statistics.skippedByUniversityType,
        normalized.skippedUniversityType ?? '<unknown>',
      );
      return;
    }
    if (normalized.omittedScholarshipLabel) {
      incrementCounter(statistics.omittedScholarshipLabels, normalized.omittedScholarshipLabel);
    }
    if (programs.has(normalized.program.id)) {
      throw new Error(
        `Duplicate YÖP code ${normalized.program.id}; aborting because the paginated snapshot is not stable`,
      );
    }
    programs.set(normalized.program.id, normalized.program);
  };

  for (const input of rows) addNormalizedRow(normalizeYokAtlasRow(input, verifiedAt));
  for (const input of talentRows) addNormalizedRow(normalizeYokAtlasTalentRow(input, verifiedAt));

  const sortedPrograms = [...programs.values()].sort((left, right) =>
    left.id.localeCompare(right.id, 'en', { numeric: true }),
  );
  if (!sortedPrograms.length) throw new Error('YÖK Atlas import produced no supported programs');
  statistics.importedPrograms = sortedPrograms.length;
  statistics.importedTalentPrograms = sortedPrograms.filter(
    (program) => program.scoreType === 'yetenek',
  ).length;

  const fixture = programsFixtureSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    dataStatus: {
      verified: true,
      approximate: false,
      sample: false,
      source: YOK_ATLAS_API_URL,
      note: {
        tr: 'YÖK Atlas kamuya açık tercih kılavuzu snapshot verisinden alınmış resmî yükseköğretim programlarıdır (merkezi yerleştirme ve özel yetenek). İngilizce arayüzde kurum ve program adları kaynak dilinde korunur.',
        en: 'Official higher-education programs imported from the public YÖK Atlas preference-guide snapshot (central placement and talent-exam levels). Institution and program names remain in the source language.',
      },
    },
    programs: sortedPrograms,
  });

  return { fixture, statistics };
}

function makeSearchBody(
  scoreType: YokAtlasScoreType | null,
  birimTuruId: number,
  page: number,
  size: number,
) {
  return {
    filters: {
      puanTuru: scoreType,
      universiteId: null,
      birimGrupId: null,
      ilKodu: null,
      birimTuruId,
      universiteTuru: null,
      bursOraniId: null,
      ogrenimTuruId: null,
      kilavuzKodu: null,
      minBasariSirasi: null,
      maxBasariSirasi: null,
    },
    page,
    size,
    sortBy: 'basariSirasi',
    direction: 'ASC',
  };
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1_000, 10_000));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, Math.min(date - Date.now(), 10_000));
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchPage(
  scoreType: YokAtlasScoreType | null,
  birimTuruId: number,
  page: number,
  size: number,
  options: Required<Pick<FetchYokAtlasOptions, 'retries' | 'timeoutMs' | 'fetchImpl'>>,
) {
  const label = scoreType ?? 'ÖZEL YETENEK';
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const response = await fetchYokAtlas(
        YOK_ATLAS_API_URL,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent':
              'YKSHazirlikTakvimi/1.0 (+https://github.com/sinanmertsener/YKSHazirlikTakvimi; static-content-importer)',
          },
          body: JSON.stringify(makeSearchBody(scoreType, birimTuruId, page, size)),
          signal: AbortSignal.timeout(options.timeoutMs),
        },
        options.fetchImpl,
      );
      const retryable =
        response.status === 408 ||
        // 418 is YÖK Atlas's observed rate-limit signal alongside the standard 429.
        response.status === 418 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      if (!response.ok) {
        const error = new Error(`YÖK Atlas ${label} page ${page} returned HTTP ${response.status}`);
        if (!retryable || attempt === options.retries) throw error;
        lastError = error;
        await wait(retryAfterMs(response) ?? Math.min(500 * 2 ** attempt, 5_000));
        continue;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLocaleLowerCase('en-US').includes('application/json')) {
        throw new Error(`YÖK Atlas returned unexpected content type ${contentType || '<missing>'}`);
      }
      const text = await response.text();
      if (text.length > 32 * 1024 * 1024) {
        throw new Error(`YÖK Atlas ${label} page ${page} exceeded the 32 MiB safety limit`);
      }
      return yokAtlasPageSchema.parse(JSON.parse(text) as unknown);
    } catch (error) {
      lastError = error;
      if (attempt === options.retries) break;
      await wait(Math.min(500 * 2 ** attempt, 5_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function fetchAllYokAtlasPrograms(
  options: FetchYokAtlasOptions = {},
): Promise<{ rows: YokAtlasRow[]; statistics: FetchStatistics }> {
  const pageSize = options.pageSize ?? 500;
  const requestDelayMs = options.requestDelayMs ?? 250;
  if (!Number.isSafeInteger(pageSize) || pageSize < 10 || pageSize > 1_000) {
    throw new Error('pageSize must be an integer from 10 through 1000');
  }
  if (!Number.isSafeInteger(requestDelayMs) || requestDelayMs < 0 || requestDelayMs > 10_000) {
    throw new Error('requestDelayMs must be an integer from 0 through 10000');
  }

  const fetchOptions = {
    retries: options.retries ?? 3,
    timeoutMs: options.timeoutMs ?? 20_000,
    fetchImpl: options.fetchImpl ?? fetch,
  };
  const rows: YokAtlasRow[] = [];
  const totalsByScoreType = {} as Record<YokAtlasScoreType, number>;
  let requestCount = 0;
  let snapshotYear: number | null = null;

  for (const { birimTuruId, scoreTypes } of YOK_ATLAS_LEVELS) {
    for (const scoreType of scoreTypes) {
      let expectedTotal: number | null = null;
      let totalPages: number | null = null;
      for (let page = 0; totalPages === null || page < totalPages; page += 1) {
        if (requestCount > 100) throw new Error('YÖK Atlas import exceeded the 100-request guard');
        if (requestCount && requestDelayMs) await wait(requestDelayMs);
        options.onProgress?.(
          `YÖK Atlas ${scoreType}: page ${page + 1}${totalPages ? `/${totalPages}` : ''}`,
        );
        const result = await fetchPage(scoreType, birimTuruId, page, pageSize, fetchOptions);
        requestCount += 1;

        if (result.number !== page || result.numberOfElements !== result.content.length) {
          throw new Error(
            `YÖK Atlas ${scoreType} page ${page} pagination metadata is inconsistent`,
          );
        }
        if (result.totalElements > 25_000 || result.totalPages > 100) {
          throw new Error(`YÖK Atlas ${scoreType} response exceeded the snapshot safety limits`);
        }
        if (expectedTotal === null) {
          expectedTotal = result.totalElements;
          totalPages = result.totalPages;
        } else if (expectedTotal !== result.totalElements || totalPages !== result.totalPages) {
          throw new Error(`YÖK Atlas ${scoreType} snapshot changed during pagination`);
        }
        if (snapshotYear === null) snapshotYear = result.yil;
        if (
          snapshotYear !== result.yil ||
          (options.expectedYear && result.yil !== options.expectedYear)
        ) {
          throw new Error(
            `YÖK Atlas snapshot year ${result.yil} did not match ${options.expectedYear ?? snapshotYear}`,
          );
        }
        for (const raw of result.content) {
          const row = yokAtlasRowSchema.parse(raw);
          if (row.puanTuru !== scoreType) {
            throw new Error(`YÖK Atlas ${scoreType} query returned a ${row.puanTuru} row`);
          }
          const rowYear = parseNonnegativeInteger(row.yil, `${row.kilavuzKodu}.yil`);
          if (rowYear !== result.yil) {
            throw new Error(`YÖK Atlas row ${row.kilavuzKodu} has an unexpected year ${rowYear}`);
          }
          options.onRawRow?.(raw);
          rows.push(row);
        }
      }
      const scoreRowCount = rows.filter((row) => row.puanTuru === scoreType).length;
      if (scoreRowCount !== expectedTotal) {
        throw new Error(
          `YÖK Atlas ${scoreType} returned ${scoreRowCount} rows, expected ${expectedTotal}`,
        );
      }
      totalsByScoreType[scoreType] = scoreRowCount;
    }
  }

  if (snapshotYear === null) throw new Error('YÖK Atlas returned no snapshot year');
  return {
    rows,
    statistics: {
      requestCount,
      snapshotYear,
      snapshotSource: 'snapshot',
      totalsByScoreType,
    },
  };
}

/**
 * Sweeps the özel yetenek level (birimTuruId 48, puanTuru null — TABLO 5). Unlike the
 * merkezi sweep this tolerates an EMPTY result (the level carries no rows until each
 * year's kılavuz loads) and tracks its own snapshot year, which is independent of the
 * merkezi levels' year. Every other failure mode still aborts loudly.
 */
export async function fetchAllYokAtlasTalentPrograms(
  options: FetchYokAtlasOptions = {},
): Promise<{ rows: YokAtlasTalentRow[]; statistics: TalentFetchStatistics }> {
  const pageSize = options.pageSize ?? 500;
  const requestDelayMs = options.requestDelayMs ?? 250;
  if (!Number.isSafeInteger(pageSize) || pageSize < 10 || pageSize > 1_000) {
    throw new Error('pageSize must be an integer from 10 through 1000');
  }
  if (!Number.isSafeInteger(requestDelayMs) || requestDelayMs < 0 || requestDelayMs > 10_000) {
    throw new Error('requestDelayMs must be an integer from 0 through 10000');
  }

  const fetchOptions = {
    retries: options.retries ?? 3,
    timeoutMs: options.timeoutMs ?? 20_000,
    fetchImpl: options.fetchImpl ?? fetch,
  };
  const rows: YokAtlasTalentRow[] = [];
  let requestCount = 0;
  let snapshotYear: number | null = null;
  let expectedTotal: number | null = null;
  let totalPages: number | null = null;

  for (let page = 0; totalPages === null || page < totalPages; page += 1) {
    if (requestCount > 100) throw new Error('YÖK Atlas import exceeded the 100-request guard');
    if (requestCount && requestDelayMs) await wait(requestDelayMs);
    options.onProgress?.(
      `YÖK Atlas ÖZEL YETENEK: page ${page + 1}${totalPages ? `/${totalPages}` : ''}`,
    );
    const result = await fetchPage(
      null,
      YOK_ATLAS_TALENT_LEVEL.birimTuruId,
      page,
      pageSize,
      fetchOptions,
    );
    requestCount += 1;

    if (result.number !== page || result.numberOfElements !== result.content.length) {
      throw new Error(`YÖK Atlas ÖZEL YETENEK page ${page} pagination metadata is inconsistent`);
    }
    if (result.totalElements > 25_000 || result.totalPages > 100) {
      throw new Error('YÖK Atlas ÖZEL YETENEK response exceeded the snapshot safety limits');
    }
    if (expectedTotal === null) {
      expectedTotal = result.totalElements;
      totalPages = result.totalPages;
    } else if (expectedTotal !== result.totalElements || totalPages !== result.totalPages) {
      throw new Error('YÖK Atlas ÖZEL YETENEK snapshot changed during pagination');
    }
    if (snapshotYear === null) snapshotYear = result.yil;
    if (snapshotYear !== result.yil) {
      throw new Error(
        `YÖK Atlas ÖZEL YETENEK snapshot year ${result.yil} did not match ${snapshotYear}`,
      );
    }
    for (const raw of result.content) {
      const row = yokAtlasTalentRowSchema.parse(raw);
      const rowYear = parseNonnegativeInteger(row.yil, `${row.kilavuzKodu}.yil`);
      if (rowYear !== result.yil) {
        throw new Error(`YÖK Atlas row ${row.kilavuzKodu} has an unexpected year ${rowYear}`);
      }
      options.onRawRow?.(raw);
      rows.push(row);
    }
  }

  if (rows.length !== (expectedTotal ?? 0)) {
    throw new Error(
      `YÖK Atlas ÖZEL YETENEK returned ${rows.length} rows, expected ${expectedTotal ?? 0}`,
    );
  }
  if (snapshotYear === null) throw new Error('YÖK Atlas ÖZEL YETENEK returned no snapshot year');
  return {
    rows,
    statistics: { requestCount, snapshotYear, rowCount: rows.length },
  };
}
