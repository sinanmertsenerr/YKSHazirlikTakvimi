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

const yokAtlasPageSchema = z.object({
  content: z.array(yokAtlasRowSchema),
  number: z.int().nonnegative(),
  numberOfElements: z.int().nonnegative(),
  size: z.int().positive(),
  totalElements: z.int().nonnegative(),
  totalPages: z.int().nonnegative(),
  yil: z.int().min(2018).max(2100),
  source: z.literal('snapshot'),
});

export type YokAtlasRow = z.infer<typeof yokAtlasRowSchema>;
export type YokAtlasScoreType = (typeof YOK_ATLAS_SCORE_TYPES)[number];

export type ImportStatistics = {
  receivedRows: number;
  importedPrograms: number;
  skippedByUniversityType: Record<string, number>;
  omittedScholarshipLabels: Record<string, number>;
};

export type FetchStatistics = {
  requestCount: number;
  snapshotYear: number;
  snapshotSource: 'snapshot';
  totalsByScoreType: Record<YokAtlasScoreType, number>;
};

export type FetchYokAtlasOptions = {
  expectedYear?: number;
  pageSize?: number;
  requestDelayMs?: number;
  retries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (message: string) => void;
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

function toProgramType(value: string): ProgramsFixture['programs'][number]['type'] | null {
  switch (value.toLocaleUpperCase('tr-TR')) {
    case 'DEVLET':
      return 'devlet';
    case 'VAKIF':
      return 'vakif';
    case 'KKTC':
      return 'kibris';
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
  row: YokAtlasRow,
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
  return {
    year,
    quota,
    // The public response does not expose a proven, year-by-year placed field. Do not infer it.
    placed: null,
    minScore,
    minRank,
    verified: true,
    verifiedAt,
    source,
    approximate: false,
    sample: false,
  };
}

export function normalizeYokAtlasRow(
  input: unknown,
  verifiedAt: string,
): {
  program: ProgramsFixture['programs'][number] | null;
  skippedUniversityType: string | null;
  omittedScholarshipLabel: string | null;
} {
  const row = yokAtlasRowSchema.parse(input);
  z.iso.datetime({ offset: true }).parse(verifiedAt);

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
  if (!row.ilAdi) {
    throw new Error(`${id} is a supported university type but has no official city value`);
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
      city: sourceOnly(row.ilAdi),
      type,
      scoreType: toScoreType(row.puanTuru),
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
): BuildYokAtlasFixtureResult {
  const programs = new Map<string, ProgramsFixture['programs'][number]>();
  const statistics: ImportStatistics = {
    receivedRows: rows.length,
    importedPrograms: 0,
    skippedByUniversityType: {},
    omittedScholarshipLabels: {},
  };

  for (const input of rows) {
    const normalized = normalizeYokAtlasRow(input, verifiedAt);
    if (!normalized.program) {
      incrementCounter(
        statistics.skippedByUniversityType,
        normalized.skippedUniversityType ?? '<unknown>',
      );
      continue;
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
  }

  const sortedPrograms = [...programs.values()].sort((left, right) =>
    left.id.localeCompare(right.id, 'en', { numeric: true }),
  );
  if (!sortedPrograms.length) throw new Error('YÖK Atlas import produced no supported programs');
  statistics.importedPrograms = sortedPrograms.length;

  const fixture = programsFixtureSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    dataStatus: {
      verified: true,
      approximate: false,
      sample: false,
      source: YOK_ATLAS_API_URL,
      note: {
        tr: 'YÖK Atlas kamuya açık tercih kılavuzu snapshot verisinden alınmış resmî lisans programlarıdır. İngilizce arayüzde kurum ve program adları kaynak dilinde korunur.',
        en: 'Official undergraduate programs imported from the public YÖK Atlas preference-guide snapshot. Institution and program names remain in the source language.',
      },
    },
    programs: sortedPrograms,
  });

  return { fixture, statistics };
}

function makeSearchBody(
  scoreType: YokAtlasScoreType,
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
  scoreType: YokAtlasScoreType,
  birimTuruId: number,
  page: number,
  size: number,
  options: Required<Pick<FetchYokAtlasOptions, 'retries' | 'timeoutMs' | 'fetchImpl'>>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const response = await options.fetchImpl(YOK_ATLAS_API_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent':
            'YKSHazirlikTakvimi/1.0 (+https://github.com/sinanmertsener/YKSHazirlikTakvimi; static-content-importer)',
        },
        body: JSON.stringify(makeSearchBody(scoreType, birimTuruId, page, size)),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      const retryable =
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      if (!response.ok) {
        const error = new Error(
          `YÖK Atlas ${scoreType} page ${page} returned HTTP ${response.status}`,
        );
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
        throw new Error(`YÖK Atlas ${scoreType} page ${page} exceeded the 32 MiB safety limit`);
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
        for (const row of result.content) {
          if (row.puanTuru !== scoreType) {
            throw new Error(`YÖK Atlas ${scoreType} query returned a ${row.puanTuru} row`);
          }
          const rowYear = parseNonnegativeInteger(row.yil, `${row.kilavuzKodu}.yil`);
          if (rowYear !== result.yil) {
            throw new Error(`YÖK Atlas row ${row.kilavuzKodu} has an unexpected year ${rowYear}`);
          }
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
