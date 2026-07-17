import { z } from 'zod';

import type { ProgramsFixture } from './content-schemas.ts';

// ÖSYM yearly placement archives (Tablo-4 lisans + Tablo-3 önlisans), discovered and
// row-verified live on 2026-07-17. These are STATIC official publications: past years
// never change, so the archive fixture is generated once by `npm run import:osym-archive`
// and committed; the weekly YÖK Atlas cron never touches it. Column layouts drift across
// three schema families (2018-2020 flat compound-name, 2021-2022 split columns,
// 2023-2024 merged five-tier quota headers), so parsing is header-driven, never
// positional. No year publishes a başarı sırası (rank) column — historical minRank
// stays honestly null; unlike the wizard, these files DO publish real placed counts.
export const OSYM_ARCHIVE_SOURCES = [
  { year: 2018, level: 'lisans', url: 'https://dokuman.osym.gov.tr/pdfdokuman/2018/YKS/YER/tablo4_08072021.xlsx' },
  { year: 2018, level: 'onlisans', url: 'https://dokuman.osym.gov.tr/pdfdokuman/2018/YKS/YER/tablo3_08072021.xlsx' },
  { year: 2019, level: 'lisans', url: 'https://dokuman.osym.gov.tr/pdfdokuman/2019/YKS/YER/tablo4_08072021.xlsx' },
  { year: 2019, level: 'onlisans', url: 'https://dokuman.osym.gov.tr/pdfdokuman/2019/YKS/YER/tablo3_08072021.xlsx' },
  { year: 2020, level: 'lisans', url: 'https://dokuman.osym.gov.tr/pdfdokuman/2020/YKS/YER/tablo4_08072021.xlsx' },
  { year: 2020, level: 'onlisans', url: 'https://dokuman.osym.gov.tr/pdfdokuman/2020/YKS/YER/tablo3_08072021.xlsx' },
  { year: 2021, level: 'lisans', url: 'https://dokuman.osym.gov.tr/pdfdokuman/2021/YKS/YERLESTIRME/tablo4_17092021.xlsx' },
  { year: 2021, level: 'onlisans', url: 'https://dokuman.osym.gov.tr/pdfdokuman/2021/YKS/YERLESTIRME/tablo3_17092021.xlsx' },
  { year: 2022, level: 'lisans', url: 'https://dokuman.osym.gov.tr/pdfdokuman/2022/YKS/YERLESTIRME/yks_yerlestirme_tablo4_2022.xlsx' },
  { year: 2022, level: 'onlisans', url: 'https://dokuman.osym.gov.tr/pdfdokuman/2022/YKS/YERLESTIRME/yks_yerlestirme_tablo3_2022.xlsx' },
  { year: 2023, level: 'lisans', url: 'https://dokuman.osym.gov.tr/pdfdokuman/2023/YKS/YERLESTIRME/tablo4yd_22082023.xlsx' },
  { year: 2023, level: 'onlisans', url: 'https://dokuman.osym.gov.tr/pdfdokuman/2023/YKS/YERLESTIRME/tablo3yd_22082023.xlsx' },
  { year: 2024, level: 'lisans', url: 'https://dokuman.osym.gov.tr/pdfdokuman/2024/YKS/YERLESTIRME/tablo-4minmax_b27082024.xlsx' },
  { year: 2024, level: 'onlisans', url: 'https://dokuman.osym.gov.tr/pdfdokuman/2024/YKS/YERLESTIRME/tablo-3minmax_d27082024.xlsx' },
] as const;

export type OsymArchiveLevel = (typeof OSYM_ARCHIVE_SOURCES)[number]['level'];

const scoreTypeSchema = z.enum(['say', 'ea', 'soz', 'tyt', 'dil']);

const archiveRecordSchema = z
  .object({
    year: z.int().min(2018).max(2024),
    level: z.enum(['lisans', 'onlisans']),
    code: z.string().regex(/^[1-9]\d{5,9}$/),
    scoreType: scoreTypeSchema,
    quota: z.int().nonnegative().nullable(),
    placed: z.int().nonnegative().nullable(),
    minScore: z.number().positive().nullable(),
    university: z.string().trim().min(1),
    name: z.string().trim().min(1),
  })
  .strict();

export const osymArchiveFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    authority: z.literal('Ölçme, Seçme ve Yerleştirme Merkezi (ÖSYM)'),
    generatedAt: z.iso.datetime({ offset: true }),
    note: z.string().min(1),
    sources: z
      .array(
        z
          .object({
            year: z.int().min(2018).max(2024),
            level: z.enum(['lisans', 'onlisans']),
            url: z.url(),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
            bytes: z.int().positive(),
            rows: z.int().nonnegative(),
            skippedRows: z.record(z.string(), z.int().positive()),
          })
          .strict(),
      )
      .min(1),
    records: z.array(archiveRecordSchema),
  })
  .strict();

export type OsymArchiveFixture = z.infer<typeof osymArchiveFixtureSchema>;
export type OsymArchiveRecord = z.infer<typeof archiveRecordSchema>;

// Local Turkish fold for join keys only (ı/İ-safe, diacritics stripped, spaces
// collapsed). Deliberately self-contained: scripts must not import app modules, and the
// key never leaves this file, so drift against src/utils/format.trSearch cannot leak.
export function foldJoinText(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i') // dotless ı has no NFKD decomposition — fold explicitly
    .replace(/\s+/g, ' ')
    .trim();
}

export function archiveNameKey(university: string, name: string, scoreType: string): string {
  // The 2020 files append the institution type to the name ("EGE ÜNİVERSİTESİ (İZMİR)
  // (Devlet Üniversitesi)") — strip it so the cross-year name join keeps working; city
  // parentheses are kept because they genuinely disambiguate campuses.
  const cleanUniversity = foldJoinText(university).replace(
    /\s*\((devlet|vakif|kktc) universitesi\)/g,
    '',
  );
  return `${cleanUniversity}|${foldJoinText(name)}|${scoreType}`;
}

function toScoreType(raw: string): OsymArchiveRecord['scoreType'] | null {
  switch (raw.toLocaleUpperCase('tr-TR').replace(/[^A-ZĞÜŞİÖÇI]/g, '')) {
    case 'SAY':
      return 'say';
    case 'EA':
      return 'ea';
    case 'SÖZ':
      return 'soz';
    case 'DİL':
      return 'dil';
    case 'TYT':
      return 'tyt';
    default:
      return null;
  }
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const rich = value as { richText?: { text: string }[]; result?: unknown; text?: string };
    if (Array.isArray(rich.richText)) return rich.richText.map((part) => part.text).join('');
    if (typeof rich.text === 'string') return rich.text;
    if (rich.result !== undefined) return cellText(rich.result);
    return '';
  }
  return String(value);
}

function parseCount(value: unknown): number | null {
  const text = cellText(value).trim();
  if (!text) return null;
  const parsed = Number(text.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 0 && Number.isSafeInteger(rounded) ? rounded : null;
}

function parseScore(value: unknown): number | null {
  const text = cellText(value).trim();
  if (!text) return null;
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

type WorksheetLike = {
  rowCount: number;
  getRow(index: number): {
    getCell(column: number): { value: unknown; isMerged: boolean; master: { value: unknown } };
    cellCount: number;
  };
};

function mergedCellText(row: ReturnType<WorksheetLike['getRow']>, column: number): string {
  const cell = row.getCell(column);
  return cellText(cell.isMerged ? cell.master.value : cell.value).trim();
}

type ColumnMap = {
  code: number;
  scoreType: number;
  quota: number;
  placed: number;
  minScore: number;
  programName: number;
  universityName: number | null;
};

// Header-driven column resolution. Composite header = group row (merged tier labels in
// 2023+) + the "Program Kodu" row itself, so one resolver covers all three families.
// The FIRST tier is always the Genel Yerleştirme group, and preference regexes keep the
// resolver away from OB/Depremzede/34-yaş/Şehit tiers even if ordering ever shifts.
function resolveColumns(worksheet: WorksheetLike): { columns: ColumnMap; firstDataRow: number } {
  for (let rowIndex = 1; rowIndex <= Math.min(worksheet.rowCount, 12); rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const above = rowIndex > 1 ? worksheet.getRow(rowIndex - 1) : null;
    const headers: string[] = [];
    for (let column = 1; column <= Math.max(row.cellCount, 40); column += 1) {
      const composite = `${above ? mergedCellText(above, column) : ''} ${mergedCellText(row, column)}`;
      headers[column] = foldJoinText(composite);
    }
    const find = (patterns: RegExp[], banned = /okul birinci|\bob\b|deprem|yas ustu|sehit|en buyuk/): number | null => {
      for (const pattern of patterns) {
        for (let column = 1; column < headers.length; column += 1) {
          const header = headers[column] ?? '';
          if (header && pattern.test(header) && !banned.test(header)) return column;
        }
      }
      return null;
    };

    const code = find([/program kodu/]);
    if (!code) continue;
    const scoreType = find([/puan tur/]);
    const quota = find([/genel yerlestirme kontenjan/, /genel kontenjan/, /genel kont/, /kontenjan/, /\bkont\b/]);
    const placed = find([/genel yerlestirme yerles/, /genel yerles/, /yerlesen/, /yerles/]);
    const minScore = find([/genel yerlestirme en kucuk/, /en kucuk puan/, /en kucuk/]);
    const programName = find([/program adi/]);
    const universityName = find([/universite adi/]);
    // In the merged two-row headers (2023+) "Program Kodu" also surfaces on the GROUP
    // row via its vertical merge, where the tier sub-headers aren't visible yet — keep
    // scanning; the sub-header row one below resolves every column.
    if (!scoreType || !quota || !placed || !minScore || !programName) continue;
    return {
      columns: { code, scoreType, quota, placed, minScore, programName, universityName },
      firstDataRow: rowIndex + 1,
    };
  }
  throw new Error(
    'ÖSYM sheet has no complete header row (Program Kodu + Puan Türü + Kontenjan + Yerleşen + En Küçük Puan + Program Adı) within the first 12 rows',
  );
}

// 2018-2020 pack the identity into one string: "ÜNİVERSİTE (İL)/Fakülte/Program".
function splitCompoundProgramName(compound: string): { university: string; name: string } | null {
  const parts = compound
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return { university: parts[0]!, name: parts[parts.length - 1]! };
}

export type ParsedSheet = {
  records: Omit<OsymArchiveRecord, 'year' | 'level'>[];
  skippedRows: Record<string, number>;
};

export function parseOsymWorksheet(worksheet: WorksheetLike): ParsedSheet {
  const { columns, firstDataRow } = resolveColumns(worksheet);
  const records: ParsedSheet['records'] = [];
  const skippedRows: Record<string, number> = {};
  const skip = (reason: string): void => {
    skippedRows[reason] = (skippedRows[reason] ?? 0) + 1;
  };

  for (let rowIndex = firstDataRow; rowIndex <= worksheet.rowCount; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    const codeText = mergedCellText(row, columns.code).replace(/\D/g, '');
    if (!codeText) continue; // blank/spacer rows carry no code
    if (!/^[1-9]\d{5,9}$/.test(codeText)) {
      skip('invalid-program-code');
      continue;
    }
    const scoreType = toScoreType(mergedCellText(row, columns.scoreType));
    if (!scoreType) {
      skip(`unsupported-score-type:${mergedCellText(row, columns.scoreType) || '<empty>'}`);
      continue;
    }
    let university: string;
    let name: string;
    if (columns.universityName) {
      university = mergedCellText(row, columns.universityName);
      name = mergedCellText(row, columns.programName);
    } else {
      const split = splitCompoundProgramName(mergedCellText(row, columns.programName));
      if (!split) {
        skip('unsplittable-program-name');
        continue;
      }
      university = split.university;
      name = split.name;
    }
    if (!university || !name) {
      skip('missing-identity');
      continue;
    }
    records.push({
      code: codeText,
      scoreType,
      quota: parseCount(row.getCell(columns.quota).value),
      placed: parseCount(row.getCell(columns.placed).value),
      minScore: parseScore(row.getCell(columns.minScore).value),
      university,
      name,
    });
  }
  return { records, skippedRows };
}

export type ArchiveMergeStats = {
  archiveRecords: number;
  matchedByCode: number;
  matchedByNameKey: number;
  yearsAttached: number;
  /** Wizard-owned years whose null quota/placed were filled from the ÖSYM row. */
  yearsFieldFilled: number;
  programsEnriched: number;
  unmatchedRecords: number;
  ambiguousNameKeys: number;
  placedOverQuotaYears: number;
};

type FixtureProgram = ProgramsFixture['programs'][number];

/**
 * Enriches the current wizard fixture with historical ÖSYM years, at BUILD time only
 * (the wizard fixture file itself is never rewritten). Join order: YÖP code first;
 * unresolved years then fall back to a unique (university, program adı, puan türü) key —
 * this is what heals YÖK's own broken-history programs whose code was re-issued between
 * years (e.g. Ege Bilgisayar İng 103490470→103490617, live-verified 2026-07-17). Years
 * the wizard already carries always win (they have ranks); archive rows for programs
 * that no longer exist are dropped and counted, never guessed onto a current program.
 */
export function mergeArchiveYears(
  programs: FixtureProgram[],
  archive: OsymArchiveFixture,
): { programs: FixtureProgram[]; stats: ArchiveMergeStats } {
  const sourceUrlByYearLevel = new Map<string, string>();
  for (const source of archive.sources) {
    sourceUrlByYearLevel.set(`${source.year}|${source.level}`, source.url);
  }

  const byCode = new Map<string, OsymArchiveRecord[]>();
  const byNameKey = new Map<string, OsymArchiveRecord[]>();
  const ambiguousKeys = new Set<string>();
  for (const record of archive.records) {
    const codeRecords = byCode.get(record.code) ?? [];
    codeRecords.push(record);
    byCode.set(record.code, codeRecords);
    const key = archiveNameKey(record.university, record.name, record.scoreType);
    const keyRecords = byNameKey.get(key) ?? [];
    // The same key resolving to two DIFFERENT codes in one year is a real identity
    // clash (two distinct programs) — the fallback must never guess between them.
    if (keyRecords.some((other) => other.year === record.year && other.code !== record.code)) {
      ambiguousKeys.add(key);
    }
    keyRecords.push(record);
    byNameKey.set(key, keyRecords);
  }

  const programNameKeyCounts = new Map<string, number>();
  for (const program of programs) {
    const key = archiveNameKey(program.university.tr, program.name.tr, program.scoreType);
    programNameKeyCounts.set(key, (programNameKeyCounts.get(key) ?? 0) + 1);
  }

  const stats: ArchiveMergeStats = {
    archiveRecords: archive.records.length,
    matchedByCode: 0,
    matchedByNameKey: 0,
    yearsAttached: 0,
    yearsFieldFilled: 0,
    programsEnriched: 0,
    unmatchedRecords: 0,
    ambiguousNameKeys: ambiguousKeys.size,
    placedOverQuotaYears: 0,
  };
  const consumed = new Set<OsymArchiveRecord>();

  const merged = programs.map((program) => {
    const candidates = new Map<number, { record: OsymArchiveRecord; via: 'code' | 'name' }>();
    for (const record of byCode.get(program.id) ?? []) {
      candidates.set(record.year, { record, via: 'code' });
    }
    const key = archiveNameKey(program.university.tr, program.name.tr, program.scoreType);
    if (!ambiguousKeys.has(key) && programNameKeyCounts.get(key) === 1) {
      for (const record of byNameKey.get(key) ?? []) {
        if (!candidates.has(record.year)) candidates.set(record.year, { record, via: 'name' });
      }
    }
    if (!candidates.size) return program;

    const yearsByYear = new Map(program.years.map((year) => [year.year, year]));
    const additions: FixtureProgram['years'] = [];
    let fieldsFilledOnProgram = false;
    for (const { record, via } of candidates.values()) {
      consumed.add(record);
      const existing = yearsByYear.get(record.year);
      if (existing) {
        // The wizard row stays authoritative for scores/ranks; only its NULL kontenjan/
        // yerleşen holes are filled from the official ÖSYM table for the same year.
        if (
          (existing.quota === null && record.quota !== null) ||
          (existing.placed === null && record.placed !== null)
        ) {
          yearsByYear.set(record.year, {
            ...existing,
            quota: existing.quota ?? record.quota,
            placed: existing.placed ?? record.placed,
          });
          stats.yearsFieldFilled += 1;
          fieldsFilledOnProgram = true;
        }
        continue;
      }
      const source = sourceUrlByYearLevel.get(`${record.year}|${record.level}`);
      if (!source) throw new Error(`Archive record ${record.code}/${record.year} has no source URL`);
      if (record.quota !== null && record.placed !== null && record.placed > record.quota) {
        // Real ÖSYM data: ek yerleştirme/okul birincisi placements can exceed the
        // genel kontenjan. Kept verbatim — official numbers are never clamped.
        stats.placedOverQuotaYears += 1;
      }
      additions.push({
        year: record.year,
        quota: record.quota,
        placed: record.placed,
        minScore: record.minScore,
        minRank: null, // ÖSYM publishes no rank column in any year (verified 2018-2024)
        verified: true,
        verifiedAt: archive.generatedAt,
        source,
        approximate: false,
        sample: false,
      });
      stats.yearsAttached += 1;
      if (via === 'code') stats.matchedByCode += 1;
      else stats.matchedByNameKey += 1;
    }
    if (!additions.length && !fieldsFilledOnProgram) return program;
    stats.programsEnriched += 1;
    return {
      ...program,
      years: [...yearsByYear.values(), ...additions].sort((left, right) => right.year - left.year),
    };
  });

  stats.unmatchedRecords = archive.records.length - consumed.size;
  return { programs: merged, stats };
}
