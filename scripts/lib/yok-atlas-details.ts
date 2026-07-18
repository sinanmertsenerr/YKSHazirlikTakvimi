import { z } from 'zod';

import {
  PROGRAM_NET_SUBJECTS,
  PROGRAM_QUOTA_CATEGORIES,
  type ProgramNetSubject,
  type ProgramQuotaCategory,
} from './content-schemas.ts';
import { fetchYokAtlas } from './yok-atlas-fetch.ts';

// YÖK Atlas program DETAILS + NETS importer library.
//
// The current YÖK Atlas ("Yükseköğretim Program Atlası", React SPA) exposes exactly two
// public data surfaces, both live-verified 2026-07-17:
//   1. POST /api/tercih-kilavuz/search — the wizard rows. Beyond the cutoff fields the
//      main importer consumes, each row carries the ENTIRE official detail panel of the
//      SPA's /detay/<code> page: quota categories with placed counts, kosul texts,
//      academic staff counts, tuition, accreditation, TYÇ, faculty/district, etc.
//   2. POST /api/netler/search — "Yerleşen Son Kişinin Netleri": per program-year the
//      last-placed candidate's TYT/AYT/YDT nets, OBP, katsayı and taban puan. Archived
//      per year from 2023 (2022 and older return zero rows — live-verified).
// The legacy panel endpoints (lisans-dynamic/*.php: cinsiyet, il, lise dağılımları...)
// are dead — every old URL now serves the SPA shell — so this file mirrors the FULL
// data universe the official Atlas publishes today, not a subset of it.
//
// Field semantics are proven against the SPA's own render code (never guessed): the
// kontenjan table binds the category labels below to these exact fields, and the header
// list binds ucret/akreditasyon/tyc/uygulamaliEgitimModeli/minBasariSirasi. Fields the
// SPA never renders (tustt*/tusktp/kpss*/dus — present in the API but with no official
// label anywhere) are deliberately NOT imported; see the provenance "excludedFields".

export const YOK_ATLAS_NETS_API_URL = 'https://yokatlas.yok.gov.tr/api/netler/search';

/** Nets are archived per placement year starting 2023 (older years return zero rows). */
export const YOK_ATLAS_NETS_FIRST_YEAR = 2023;

const trimmedText = z.string().trim().min(1);
const numberLikeSchema = z.union([
  z.number().finite(),
  z
    .string()
    .trim()
    .regex(/^-?\d+(?:\.\d+)?$/),
]);
const nullableNumberLikeSchema = numberLikeSchema.nullish();

// Quota categories exactly as the official SPA's "Kontenjan ve Yerleşme" table binds
// them ({kategori:"Genel", kontenjan:E.kontenjan, yerlesen:E.gkY} and friends).
// The placed key for the 34+ category is "y34" in the live API (probe-verified), even
// though the SPA source reads E.y34Y in one spot — the API response is authoritative.
export const YOK_ATLAS_QUOTA_CATEGORIES = [
  { category: 'genel', quotaField: 'kontenjan', placedField: 'gkY', officialLabel: 'Genel' },
  {
    category: 'okul-birincisi',
    quotaField: 'kontenjanObs',
    placedField: 'obkY',
    officialLabel: 'Okul Birincisi',
  },
  { category: 'deprem', quotaField: 'kontenjanDep', placedField: 'dprmY', officialLabel: 'Deprem' },
  {
    category: 'sehit-gazi',
    quotaField: 'kontenjanSgy',
    placedField: 'sgyY',
    officialLabel: 'Şehit Gazi',
  },
  {
    category: 'kadin-34',
    quotaField: 'kontenjanY34',
    placedField: 'y34',
    officialLabel: '34 Yaş Üstü Kadın',
  },
] as const satisfies readonly {
  category: ProgramQuotaCategory;
  quotaField: string;
  placedField: string;
  officialLabel: string;
}[];

// Loose source schema: only the fields this importer consumes, everything nullish —
// per-row presence genuinely varies (devlet rows have no ucret, önlisans has no TUS...).
// z.object() strips the fields we deliberately exclude.
const detailSourceRowSchema = z.object({
  kilavuzKodu: numberLikeSchema,
  yil: numberLikeSchema,
  fymkAdi: trimmedText.nullish(),
  ilceAdi: trimmedText.nullish(),
  ogrenimTuruAdi: trimmedText.nullish(),
  ogrenimSuresi: nullableNumberLikeSchema,
  birimGrupId: nullableNumberLikeSchema,
  birimGrupAdi: trimmedText.nullish(),
  ucret: nullableNumberLikeSchema,
  akreditasyon: trimmedText.nullish(),
  akreditasyonAck: trimmedText.nullish(),
  tyc: z.string().trim().nullish(),
  uygulamaliEgitimModeli: trimmedText.nullish(),
  minBasariSirasi: nullableNumberLikeSchema,
  minBasariSirasiKosul: trimmedText.nullish(),
  prof: nullableNumberLikeSchema,
  doc: nullableNumberLikeSchema,
  dou: nullableNumberLikeSchema,
  ogrGor: nullableNumberLikeSchema,
  arGor: nullableNumberLikeSchema,
  kosul: z.string().trim().nullish(),
  kosulList: z.array(z.record(z.string(), z.string())).nullish(),
  minPuan: nullableNumberLikeSchema,
  basariSirasi: nullableNumberLikeSchema,
  kontenjan: nullableNumberLikeSchema,
  kontenjanObs: nullableNumberLikeSchema,
  kontenjanDep: nullableNumberLikeSchema,
  kontenjanSgy: nullableNumberLikeSchema,
  kontenjanY34: nullableNumberLikeSchema,
  gkY: nullableNumberLikeSchema,
  obkY: nullableNumberLikeSchema,
  dprmY: nullableNumberLikeSchema,
  sgyY: nullableNumberLikeSchema,
  y34: nullableNumberLikeSchema,
});

const NET_FIELD_MAPPINGS = [
  { source: 'tytTrkNet', target: 'tytTurkce' },
  { source: 'tytSosNet', target: 'tytSosyal' },
  { source: 'tytMatNet', target: 'tytMatematik' },
  { source: 'tytFenNet', target: 'tytFen' },
  { source: 'aytMatNet', target: 'aytMatematik' },
  { source: 'aytFizNet', target: 'aytFizik' },
  { source: 'aytKimNet', target: 'aytKimya' },
  { source: 'aytBioNet', target: 'aytBiyoloji' },
  { source: 'aytTdeNet', target: 'aytEdebiyat' },
  { source: 'aytTrh1Net', target: 'aytTarih1' },
  { source: 'aytCog1Net', target: 'aytCografya1' },
  { source: 'aytTrh2Net', target: 'aytTarih2' },
  { source: 'aytCog2Net', target: 'aytCografya2' },
  { source: 'aytFelNet', target: 'aytFelsefe' },
  { source: 'aytDinNet', target: 'aytDin' },
  { source: 'ydtYdilNet', target: 'ydtDil' },
] as const satisfies readonly { source: string; target: ProgramNetSubject }[];

// Nets can legitimately be negative (net = doğru − yanlış/4); |net| beyond any real
// section size means response corruption, not data.
const netValueSchema = z.union([
  z.number().finite().min(-120).max(120),
  z
    .string()
    .trim()
    .regex(/^-?\d+(?:\.\d+)?$/),
]);

const netsSourceRowSchema = z.object({
  yil: numberLikeSchema,
  kilavuzKodu: numberLikeSchema,
  puanTuru: z.enum(['SAY', 'EA', 'SÖZ', 'DİL', 'TYT']),
  katsayi: nullableNumberLikeSchema,
  tabanPuan: nullableNumberLikeSchema,
  obp: nullableNumberLikeSchema,
  tytTrkNet: netValueSchema.nullish(),
  tytSosNet: netValueSchema.nullish(),
  tytMatNet: netValueSchema.nullish(),
  tytFenNet: netValueSchema.nullish(),
  aytMatNet: netValueSchema.nullish(),
  aytFizNet: netValueSchema.nullish(),
  aytKimNet: netValueSchema.nullish(),
  aytBioNet: netValueSchema.nullish(),
  aytTdeNet: netValueSchema.nullish(),
  aytTrh1Net: netValueSchema.nullish(),
  aytCog1Net: netValueSchema.nullish(),
  aytTrh2Net: netValueSchema.nullish(),
  aytCog2Net: netValueSchema.nullish(),
  aytFelNet: netValueSchema.nullish(),
  aytDinNet: netValueSchema.nullish(),
  ydtYdilNet: netValueSchema.nullish(),
});

export type YokAtlasNetsSourceRow = z.infer<typeof netsSourceRowSchema>;

// The nets envelope matches the search page envelope minus `yil` (live-verified: the
// nets endpoint reports no snapshot year; each ROW carries its own year instead).
const netsPageSchema = z.object({
  content: z.array(z.unknown()),
  number: z.int().nonnegative(),
  numberOfElements: z.int().nonnegative(),
  size: z.int().positive(),
  totalElements: z.int().nonnegative(),
  totalPages: z.int().nonnegative(),
  source: z.literal('snapshot'),
});

const conditionCodeSchema = z.string().regex(/^\d{1,4}$/);

const localizedNoteSchema = z.object({ tr: z.string().min(1), en: z.string().min(1) }).strict();

const staffSchema = z
  .object({
    professor: z.int().nonnegative().nullable(),
    docent: z.int().nonnegative().nullable(),
    doctorFaculty: z.int().nonnegative().nullable(),
    lecturer: z.int().nonnegative().nullable(),
    researchAssistant: z.int().nonnegative().nullable(),
  })
  .strict();

const quotaCategoryRecordSchema = z
  .object({
    category: z.enum(PROGRAM_QUOTA_CATEGORIES),
    quota: z.int().nonnegative().nullable(),
    placed: z.int().nonnegative().nullable(),
  })
  .strict();

const programNetsRecordSchema = z
  .object({
    year: z.int().min(YOK_ATLAS_NETS_FIRST_YEAR).max(2100),
    scoreType: z.enum(['say', 'ea', 'soz', 'dil', 'tyt']),
    coefficient: z.number().positive().max(1).nullable(),
    minScore: z.number().positive().max(700).nullable(),
    obp: z.number().positive().max(600).nullable(),
    // partialRecord: only the subjects of the program's own score type are published.
    nets: z.partialRecord(z.enum(PROGRAM_NET_SUBJECTS), z.number().min(-120).max(120)),
  })
  .strict();

const programDetailsRecordSchema = z
  .object({
    id: z.string().regex(/^[1-9]\d{5,9}$/),
    year: z.int().min(2018).max(2100),
    faculty: z.string().min(1).nullable(),
    district: z.string().min(1).nullable(),
    educationType: z.string().min(1).nullable(),
    durationYears: z.int().positive().max(10).nullable(),
    programGroup: z.string().min(1).nullable(),
    programGroupId: z.int().positive().nullable(),
    tuition: z.int().positive().nullable(),
    accreditation: z.string().min(1).nullable(),
    accreditationNote: z.string().min(1).nullable(),
    tyc: z.boolean(),
    appliedEducationModel: z.string().min(1).nullable(),
    minRankRequirement: z.int().positive().nullable(),
    minRankRequirementNote: z.string().min(1).nullable(),
    staff: staffSchema.nullable(),
    conditionCodes: z.array(conditionCodeSchema),
    quotaCategories: z.array(quotaCategoryRecordSchema),
    nets: z.array(programNetsRecordSchema),
  })
  .strict();

export const programsDetailsFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    authority: z.literal('Yükseköğretim Kurulu (YÖK)'),
    generatedAt: z.iso.datetime({ offset: true }),
    source: z
      .object({
        searchApiUrl: z.url(),
        netsApiUrl: z.url(),
        snapshotYear: z.int().min(2018).max(2100),
        netYears: z.array(z.int().min(YOK_ATLAS_NETS_FIRST_YEAR).max(2100)).min(1),
      })
      .strict(),
    note: localizedNoteSchema,
    conditions: z.record(conditionCodeSchema, z.string().min(1)),
    programs: z.array(programDetailsRecordSchema).min(1),
  })
  .strict();

export type ProgramsDetailsFixture = z.infer<typeof programsDetailsFixtureSchema>;
export type ProgramDetailsRecord = ProgramsDetailsFixture['programs'][number];

export type DetailsBuildStatistics = {
  receivedRows: number;
  detailRecords: number;
  conditionCount: number;
  /** kosul codes the source lists without publishing a text for (kept code-only). */
  conditionCodesWithoutText: number;
  netRowsReceived: number;
  netRowsAttached: number;
  /** Nets rows whose program code is not in the current wizard snapshot (closed programs). */
  netRowsDropped: number;
  tuitionPrograms: number;
  accreditedPrograms: number;
};

function parseNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a finite number`);
  return parsed;
}

function parseNonnegativeInteger(value: unknown, label: string): number | null {
  const parsed = parseNumber(value, label);
  if (parsed === null) return null;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
  return parsed;
}

function parsePositiveInteger(value: unknown, label: string): number | null {
  const parsed = parseNonnegativeInteger(value, label);
  return parsed === null || parsed === 0 ? null : parsed;
}

function parsePositiveNumber(value: unknown, label: string): number | null {
  const parsed = parseNumber(value, label);
  if (parsed === null || parsed === 0) return null;
  if (parsed < 0) throw new Error(`${label} must be zero/missing or positive`);
  return parsed;
}

function toNetScoreType(
  value: YokAtlasNetsSourceRow['puanTuru'],
): 'say' | 'ea' | 'soz' | 'dil' | 'tyt' {
  if (value === 'SAY') return 'say';
  if (value === 'EA') return 'ea';
  if (value === 'DİL') return 'dil';
  if (value === 'TYT') return 'tyt';
  return 'soz';
}

/**
 * Parses the kosul contract of one row: `kosul` is the ordered comma-joined code list
 * and `kosulList` carries `{code: fullText}` pairs. The source legitimately publishes
 * SOME codes without a text (live-verified: foreign programs list e.g. 343/342 in
 * kosul with no kosulList entry) — those codes are kept as official references and
 * counted; the UI shows them text-less rather than us inventing wording. A kosulList
 * entry for a code NOT in kosul, or a malformed entry, is still snapshot corruption.
 */
function parseConditions(
  row: z.infer<typeof detailSourceRowSchema>,
  id: string,
): { codes: string[]; texts: Map<string, string>; textlessCodes: number } {
  const codes = (row.kosul ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
  const texts = new Map<string, string>();
  for (const code of codes) {
    if (!/^\d{1,4}$/.test(code)) throw new Error(`${id} has a malformed kosul code "${code}"`);
  }
  const uniqueCodes = new Set(codes);
  if (uniqueCodes.size !== codes.length) throw new Error(`${id} repeats a kosul code`);
  for (const entry of row.kosulList ?? []) {
    const keys = Object.keys(entry);
    if (keys.length !== 1) throw new Error(`${id} has a kosulList entry with ${keys.length} keys`);
    const code = keys[0]!;
    const text = entry[code]?.trim();
    if (!uniqueCodes.has(code)) throw new Error(`${id} kosulList names unlisted code ${code}`);
    if (!text) throw new Error(`${id} kosul ${code} has an empty official text`);
    texts.set(code, text);
  }
  const textlessCodes = codes.filter((code) => !texts.has(code)).length;
  return { codes, texts, textlessCodes };
}

function normalizeDetailRow(raw: unknown): {
  record: ProgramDetailsRecord;
  conditionTexts: Map<string, string>;
  textlessConditionCodes: number;
} {
  const row = detailSourceRowSchema.parse(raw);
  const idNumber = parseNonnegativeInteger(row.kilavuzKodu, 'kilavuzKodu');
  if (!idNumber) throw new Error('kilavuzKodu must be a positive integer');
  const id = String(idNumber);
  const year = parseNonnegativeInteger(row.yil, `${id}.yil`);
  if (!year || year < 2018 || year > 2100) {
    throw new Error(`${id}.yil is outside the supported range`);
  }

  const staffValues = {
    professor: parseNonnegativeInteger(row.prof, `${id}.prof`),
    docent: parseNonnegativeInteger(row.doc, `${id}.doc`),
    doctorFaculty: parseNonnegativeInteger(row.dou, `${id}.dou`),
    lecturer: parseNonnegativeInteger(row.ogrGor, `${id}.ogrGor`),
    researchAssistant: parseNonnegativeInteger(row.arGor, `${id}.arGor`),
  };
  const staff = Object.values(staffValues).every((value) => value === null) ? null : staffValues;

  // Same trust rule as the main importer's placed field: a freshly loaded kılavuz (no
  // cutoffs published yet) reports zeros that mean "placement not run", not "0 placed".
  const minScore = parsePositiveNumber(row.minPuan, `${id}.minPuan`);
  const minRank = parsePositiveNumber(row.basariSirasi, `${id}.basariSirasi`);
  const generalPlaced = parseNonnegativeInteger(row.gkY, `${id}.gkY`);
  const placedTrusted =
    minScore !== null || minRank !== null || (generalPlaced !== null && generalPlaced > 0);

  const quotaCategories: ProgramDetailsRecord['quotaCategories'] = [];
  for (const definition of YOK_ATLAS_QUOTA_CATEGORIES) {
    const quota = parseNonnegativeInteger(
      row[definition.quotaField],
      `${id}.${definition.quotaField}`,
    );
    const placedRaw = parseNonnegativeInteger(
      row[definition.placedField],
      `${id}.${definition.placedField}`,
    );
    const placed = placedTrusted ? placedRaw : null;
    if (quota === null && placed === null) continue;
    quotaCategories.push({ category: definition.category, quota, placed });
  }

  const { codes, texts, textlessCodes } = parseConditions(row, id);

  const record: ProgramDetailsRecord = {
    id,
    year,
    faculty: row.fymkAdi ?? null,
    district: row.ilceAdi ?? null,
    educationType: row.ogrenimTuruAdi ?? null,
    durationYears: parsePositiveInteger(row.ogrenimSuresi, `${id}.ogrenimSuresi`),
    programGroup: row.birimGrupAdi ?? null,
    programGroupId: parsePositiveInteger(row.birimGrupId, `${id}.birimGrupId`),
    tuition: parsePositiveInteger(row.ucret, `${id}.ucret`),
    accreditation: row.akreditasyon ?? null,
    accreditationNote: row.akreditasyonAck ?? null,
    tyc: row.tyc === '*',
    appliedEducationModel: row.uygulamaliEgitimModeli ?? null,
    minRankRequirement: parsePositiveInteger(row.minBasariSirasi, `${id}.minBasariSirasi`),
    minRankRequirementNote: row.minBasariSirasiKosul ?? null,
    staff,
    conditionCodes: codes,
    quotaCategories,
    nets: [],
  };
  return { record, conditionTexts: texts, textlessConditionCodes: textlessCodes };
}

export function normalizeNetsRow(raw: unknown): {
  id: string;
  net: ProgramDetailsRecord['nets'][number];
} {
  const row = netsSourceRowSchema.parse(raw);
  const idNumber = parseNonnegativeInteger(row.kilavuzKodu, 'nets.kilavuzKodu');
  if (!idNumber) throw new Error('nets.kilavuzKodu must be a positive integer');
  const id = String(idNumber);
  const year = parseNonnegativeInteger(row.yil, `${id}.nets.yil`);
  if (!year || year < YOK_ATLAS_NETS_FIRST_YEAR || year > 2100) {
    throw new Error(`${id}.nets.yil is outside the supported range`);
  }

  const nets: Record<string, number> = {};
  for (const mapping of NET_FIELD_MAPPINGS) {
    const value = row[mapping.source];
    if (value === null || value === undefined) continue;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${id}.${mapping.source} is not finite`);
    nets[mapping.target] = parsed;
  }

  return {
    id,
    net: {
      year,
      scoreType: toNetScoreType(row.puanTuru),
      coefficient: parsePositiveNumber(row.katsayi, `${id}.katsayi`),
      minScore: parsePositiveNumber(row.tabanPuan, `${id}.tabanPuan`),
      obp: parsePositiveNumber(row.obp, `${id}.obp`),
      nets,
    },
  };
}

export function buildProgramsDetailsFixture(input: {
  rawRows: unknown[];
  netsRows: unknown[];
  snapshotYear: number;
  netYears: number[];
  generatedAt: string;
}): { fixture: ProgramsDetailsFixture; statistics: DetailsBuildStatistics } {
  const records = new Map<string, ProgramDetailsRecord>();
  const conditions = new Map<string, string>();
  let conditionCodesWithoutText = 0;

  for (const raw of input.rawRows) {
    const { record, conditionTexts, textlessConditionCodes } = normalizeDetailRow(raw);
    if (records.has(record.id)) {
      throw new Error(`Duplicate YÖP code ${record.id} in the details sweep`);
    }
    conditionCodesWithoutText += textlessConditionCodes;
    for (const [code, text] of conditionTexts) {
      const existing = conditions.get(code);
      if (existing !== undefined && existing !== text) {
        // One kılavuz publishes one text per code; a mid-sweep divergence means the
        // snapshot changed under us and nothing trustworthy can be published.
        throw new Error(`Kosul ${code} has two different official texts in one snapshot`);
      }
      conditions.set(code, text);
    }
    records.set(record.id, record);
  }
  if (!records.size) throw new Error('YÖK Atlas details sweep produced no records');

  let netRowsAttached = 0;
  let netRowsDropped = 0;
  // Same duplicate policy as the fetcher: a byte-identical repeat of a row the source
  // itself duplicated is lossless and skipped; a differing payload is real ambiguity.
  const seenNetPayloads = new Map<string, string>();
  for (const raw of input.netsRows) {
    const { id, net } = normalizeNetsRow(raw);
    const key = `${id}:${net.year}`;
    const payload = JSON.stringify(raw);
    const existing = seenNetPayloads.get(key);
    if (existing !== undefined) {
      if (existing === payload) continue;
      throw new Error(`Program ${id} year ${net.year} has two DIFFERENT nets rows`);
    }
    seenNetPayloads.set(key, payload);
    const record = records.get(id);
    if (!record) {
      netRowsDropped += 1;
      continue;
    }
    record.nets.push(net);
    netRowsAttached += 1;
  }
  for (const record of records.values()) {
    record.nets.sort((left, right) => right.year - left.year);
  }

  const programs = [...records.values()].sort((left, right) =>
    left.id.localeCompare(right.id, 'en', { numeric: true }),
  );

  const fixture = programsDetailsFixtureSchema.parse({
    schemaVersion: 1,
    authority: 'Yükseköğretim Kurulu (YÖK)',
    generatedAt: input.generatedAt,
    source: {
      searchApiUrl: 'https://yokatlas.yok.gov.tr/api/tercih-kilavuz/search',
      netsApiUrl: YOK_ATLAS_NETS_API_URL,
      snapshotYear: input.snapshotYear,
      netYears: [...input.netYears].sort((a, b) => a - b),
    },
    note: {
      tr:
        'YÖK Atlas kamuya açık API verisinden alınan resmî program detayları: kontenjan kategorileri ' +
        've yerleşen sayıları, yerleşme koşulları, öğretim elemanı kadrosu, ücret, akreditasyon ve ' +
        'yerleşen son kişinin netleri. Alan anlamları YÖK Atlas arayüzünün kendi gösterimiyle doğrulanmıştır.',
      en:
        'Official program details from the public YÖK Atlas API: quota categories with placed counts, ' +
        'placement conditions, academic staff counts, tuition, accreditation, and the last-placed ' +
        "candidate's nets. Field semantics are verified against the YÖK Atlas UI's own rendering.",
    },
    conditions: Object.fromEntries(
      [...conditions.entries()].sort(([a], [b]) => Number(a) - Number(b)),
    ),
    programs,
  });

  return {
    fixture,
    statistics: {
      receivedRows: input.rawRows.length,
      detailRecords: programs.length,
      conditionCount: conditions.size,
      conditionCodesWithoutText,
      netRowsReceived: input.netsRows.length,
      netRowsAttached,
      netRowsDropped,
      tuitionPrograms: programs.filter((program) => program.tuition !== null).length,
      accreditedPrograms: programs.filter((program) => program.accreditation !== null).length,
    },
  };
}

/** Byte-stable rewrite guard: identical content except generatedAt reuses existing bytes. */
export function prepareStableDetailsFixture(
  candidate: ProgramsDetailsFixture,
  existingJson: string | null,
): { fixtureJson: string; reusedExistingBytes: boolean } {
  if (existingJson !== null) {
    try {
      const previous = programsDetailsFixtureSchema.parse(JSON.parse(existingJson) as unknown);
      const normalize = (fixture: ProgramsDetailsFixture) =>
        JSON.stringify({ ...fixture, generatedAt: '' });
      if (normalize(previous) === normalize(candidate)) {
        return { fixtureJson: existingJson, reusedExistingBytes: true };
      }
    } catch {
      // A malformed previous artifact is never reused.
    }
  }
  return { fixtureJson: `${JSON.stringify(candidate, null, 2)}\n`, reusedExistingBytes: false };
}

export type NetsFetchOptions = {
  pageSize?: number;
  requestDelayMs?: number;
  retries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onProgress?: (message: string) => void;
};

export type NetsFetchStatistics = {
  requestCount: number;
  rowsByYear: Record<string, number>;
  /** Byte-identical duplicate rows published by the source itself, safely skipped. */
  identicalDuplicatesSkipped: number;
  /**
   * Programs whose score type changed between years: the source lists one row per
   * score type, but only the row of the type placement actually ran under carries a
   * tabanPuan — that row is kept, the placement-less residue row is dropped.
   */
  crossScoreTypeDuplicatesResolved: number;
};

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchNetsPage(
  year: number,
  page: number,
  size: number,
  options: Required<Pick<NetsFetchOptions, 'retries' | 'timeoutMs' | 'fetchImpl'>>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const response = await fetchYokAtlas(
        YOK_ATLAS_NETS_API_URL,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent':
              'YKSHazirlikTakvimi/1.0 (+https://github.com/sinanmertsener/YKSHazirlikTakvimi; static-content-importer)',
          },
          body: JSON.stringify({ filters: { yil: year, kilavuzKodu: null }, page, size }),
          signal: AbortSignal.timeout(options.timeoutMs),
        },
        options.fetchImpl,
      );
      const retryable =
        response.status === 408 ||
        response.status === 418 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      if (!response.ok) {
        const error = new Error(
          `YÖK Atlas nets ${year} page ${page} returned HTTP ${response.status}`,
        );
        if (!retryable || attempt === options.retries) throw error;
        lastError = error;
        await wait(Math.min(500 * 2 ** attempt, 5_000));
        continue;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLocaleLowerCase('en-US').includes('application/json')) {
        throw new Error(
          `YÖK Atlas nets returned unexpected content type ${contentType || '<missing>'}`,
        );
      }
      const text = await response.text();
      if (text.length > 32 * 1024 * 1024) {
        throw new Error(`YÖK Atlas nets ${year} page ${page} exceeded the 32 MiB safety limit`);
      }
      return netsPageSchema.parse(JSON.parse(text) as unknown);
    } catch (error) {
      lastError = error;
      if (attempt === options.retries) break;
      await wait(Math.min(500 * 2 ** attempt, 5_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Sweeps /api/netler/search, ONE request per year. The endpoint silently ignores
 * sort parameters (live-verified), which makes multi-page reads unstable — the same
 * program landed on two pages in a real run. A whole year fits comfortably in a
 * single response (~21k rows ≈ 10 MB, server-accepted size 25000), and a single
 * response has no page boundaries to shear rows across, so pagination correctness
 * disappears as a problem class instead of being mitigated.
 *
 * Duplicate handling (all three patterns observed LIVE in the 2023/2024 archives):
 *   1. Byte-identical repeats — a source-side publishing quirk; lossless, skipped
 *      with a count.
 *   2. Two rows with DIFFERENT score types where exactly ONE carries a tabanPuan —
 *      programs whose score type changed between years. The panel is "Yerleşen Son
 *      Kişinin Netleri": a last-placed candidate exists only under the type placement
 *      actually ran, and that is the row carrying the tabanPuan. The placement-less
 *      residue row is dropped with a count. (Cross-checked downstream: validate-pack
 *      compares nets tabanPuan against the wizard's own per-year minPuan.)
 *   3. Anything else (two tabanPuan rows, or none) — real ambiguity, aborts.
 */
export async function fetchAllYokAtlasNets(
  years: number[],
  options: NetsFetchOptions = {},
): Promise<{ rows: unknown[]; statistics: NetsFetchStatistics }> {
  if (!years.length) throw new Error('Nets sweep requires at least one year');
  const pageSize = options.pageSize ?? 25_000;
  const requestDelayMs = options.requestDelayMs ?? 250;
  if (!Number.isSafeInteger(pageSize) || pageSize < 10 || pageSize > 25_000) {
    throw new Error('pageSize must be an integer from 10 through 25000');
  }
  if (!Number.isSafeInteger(requestDelayMs) || requestDelayMs < 0 || requestDelayMs > 10_000) {
    throw new Error('requestDelayMs must be an integer from 0 through 10000');
  }
  const fetchOptions = {
    retries: options.retries ?? 3,
    timeoutMs: options.timeoutMs ?? 60_000,
    fetchImpl: options.fetchImpl ?? fetch,
  };

  const rows: unknown[] = [];
  const rowsByYear: Record<string, number> = {};
  let requestCount = 0;
  let identicalDuplicatesSkipped = 0;
  let crossScoreTypeDuplicatesResolved = 0;

  for (const year of years) {
    if (!Number.isSafeInteger(year) || year < YOK_ATLAS_NETS_FIRST_YEAR || year > 2100) {
      throw new Error(`Nets year ${year} is outside the supported range`);
    }
    if (requestCount > 50) throw new Error('YÖK Atlas nets sweep exceeded the 50-request guard');
    if (requestCount && requestDelayMs) await wait(requestDelayMs);
    options.onProgress?.(`YÖK Atlas netler ${year}: fetching the full year in one request`);
    const result = await fetchNetsPage(year, 0, pageSize, fetchOptions);
    requestCount += 1;

    if (result.totalElements > pageSize || result.totalPages > 1) {
      throw new Error(
        `YÖK Atlas nets ${year} no longer fits one response (${result.totalElements} rows) — ` +
          'single-request integrity cannot be guaranteed',
      );
    }
    if (result.number !== 0 || result.numberOfElements !== result.content.length) {
      throw new Error(`YÖK Atlas nets ${year} response metadata is inconsistent`);
    }

    // Group by program code first; duplicate resolution needs the full candidate set.
    const rowsByProgram = new Map<
      string,
      { raw: unknown; payload: string; hasMinScore: boolean }[]
    >();
    let receivedRowCount = 0;
    for (const raw of result.content) {
      const normalized = normalizeNetsRow(raw);
      if (normalized.net.year !== year) {
        throw new Error(`YÖK Atlas nets ${year} returned a row for year ${normalized.net.year}`);
      }
      receivedRowCount += 1;
      const candidates = rowsByProgram.get(normalized.id) ?? [];
      candidates.push({
        raw,
        payload: JSON.stringify(raw),
        hasMinScore: normalized.net.minScore !== null,
      });
      rowsByProgram.set(normalized.id, candidates);
    }
    if (receivedRowCount !== result.totalElements) {
      throw new Error(
        `YÖK Atlas nets ${year} returned ${receivedRowCount} rows, expected ${result.totalElements}`,
      );
    }

    let yearRowCount = 0;
    for (const [id, candidates] of rowsByProgram) {
      const uniquePayloads = new Map<string, (typeof candidates)[number]>();
      for (const candidate of candidates) {
        if (uniquePayloads.has(candidate.payload)) {
          identicalDuplicatesSkipped += 1;
          continue;
        }
        uniquePayloads.set(candidate.payload, candidate);
      }
      const distinct = [...uniquePayloads.values()];
      let chosen: (typeof candidates)[number];
      if (distinct.length === 1) {
        chosen = distinct[0]!;
      } else {
        const withPlacement = distinct.filter((candidate) => candidate.hasMinScore);
        if (withPlacement.length !== 1) {
          throw new Error(
            `YÖK Atlas nets ${year} program ${id} has ${distinct.length} distinct rows and ` +
              `${withPlacement.length} carry a tabanPuan — cannot resolve which placement is real`,
          );
        }
        chosen = withPlacement[0]!;
        crossScoreTypeDuplicatesResolved += distinct.length - 1;
      }
      rows.push(chosen.raw);
      yearRowCount += 1;
    }
    rowsByYear[String(year)] = yearRowCount;
  }

  return {
    rows,
    statistics: {
      requestCount,
      rowsByYear,
      identicalDuplicatesSkipped,
      crossScoreTypeDuplicatesResolved,
    },
  };
}
