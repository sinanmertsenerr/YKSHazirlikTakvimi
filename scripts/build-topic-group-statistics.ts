import { stat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import { topicGroupStatisticsSchema, type ExamId } from './lib/content-schemas.ts';
import {
  includedOgmTopicSources,
  ogmTopicSourceRegistrySchema,
} from './lib/ogm-topic-registry.ts';
import { writeTextFileAtomicallyIfChanged } from './lib/semantic-stability.ts';
import { validateTopicGroupStatisticsData } from './validate-pack.ts';

const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;
const MAX_CANDIDATE_BYTES = 5 * 1024 * 1024;
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const yearCountsSchema = z
  .object(Object.fromEntries(YEARS.map((year) => [String(year), z.int().nonnegative()])))
  .strict();

const distributionYearSchema = z
  .int()
  .refine((year): year is (typeof YEARS)[number] => YEARS.includes(year as (typeof YEARS)[number]));

const rawCellsSchema = z
  .object({
    ...Object.fromEntries(YEARS.map((year) => [String(year), z.string().min(1)])),
    TOPLAM: z.string().min(1),
  })
  .strict();

const candidateSourceSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    sourceId: z.int().positive(),
    titleTr: z.string().trim().min(1),
    resolverUrl: z.url(),
    resolvedPdfUrl: z.url(),
    bytes: z.int().positive(),
    sha256: sha256Schema,
    tableCount: z.int().positive(),
    verifiedRowCount: z.int().nonnegative(),
    failedRowCount: z.int().nonnegative(),
    apiBookId: z.string().regex(/^[0-9a-f]{24}$/).optional(),
  })
  .strict();

const candidateRowShape = {
  sourceGroup: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  subject: z.string().trim().min(1),
  topic: z.string().trim().min(1),
  physicalPage: z.int().positive(),
  yearCounts: yearCountsSchema,
  total: z.int().nonnegative(),
};

const directCandidateRowSchema = z
  .object({
    ...candidateRowShape,
    rawCells: rawCellsSchema,
  })
  .strict();

const derivedZeroSchema = z
  .object({
    year: distributionYearSchema,
    derivedZeroMethod: z.literal('official-row-residual-and-subject-year-completeness'),
    rowResidual: z.literal(0),
    explicitSubjectYearCount: z.int().nonnegative(),
    officialSubjectYearQuestionCount: z.int().nonnegative(),
    apiBookId: z.string().regex(/^[0-9a-f]{24}$/),
    apiQuestionIdSetSha256: sha256Schema,
    apiPdfPageOffset: z.int().min(-10).max(10),
  })
  .strict();

const dualProofCandidateRowSchema = z
  .object({
    ...candidateRowShape,
    derivedZeros: z.array(derivedZeroSchema).min(1).optional(),
  })
  .strict();

type CandidateRow =
  | z.infer<typeof directCandidateRowSchema>
  | z.infer<typeof dualProofCandidateRowSchema>;

const candidateFailureSchema = z
  .object({
    sourceGroup: z.string().min(1),
    physicalPage: z.int().positive(),
    tableIndex: z.int().nonnegative(),
    rowIndex: z.int().nonnegative(),
    reason: z.string().min(1),
    subject: z.string().trim().min(1).optional(),
    topic: z.string().trim().min(1).optional(),
    explicitYearCounts: z
      .object(Object.fromEntries(YEARS.map((year) => [String(year), z.int().nonnegative().optional()])))
      .strict()
      .optional(),
    missingYears: z.array(distributionYearSchema).min(1).optional(),
    rowTotal: z.int().nonnegative().optional(),
  })
  .strict();

const candidateBaseShape = {
  schemaVersion: z.literal(1),
  authority: z.literal('MEB OGM'),
  dryRun: z.literal(true),
  publicationAllowed: z.literal(false),
  coverage: z
    .object({
      firstYear: z.literal(2018),
      lastYear: z.literal(2025),
      includes2026: z.literal(false),
    })
    .strict(),
  summary: z
    .object({
      sources: z.int().positive(),
      tables: z.int().positive(),
      verifiedRows: z.int().nonnegative(),
      failedRows: z.int().nonnegative(),
    })
    .strict(),
  sources: z.array(candidateSourceSchema).min(1),
  failures: z.array(candidateFailureSchema),
};

const knownInconsistenciesShape = {
  missingPrinted2025CellRows: z.int().nonnegative(),
  missingPrintedOtherYearCellRows: z.int().nonnegative(),
  noteTr: z.string().min(1),
};

const directCandidateSchema = z
  .object({
    ...candidateBaseShape,
    rows: z.array(directCandidateRowSchema),
    knownInconsistencies: z.object(knownInconsistenciesShape).strict(),
  })
  .strict();

const subjectYearCompletenessEvidenceSchema = z
  .object({
    sourceGroup: z.literal('tyt'),
    subject: z.enum(['Matematik', 'Fizik']),
    year: distributionYearSchema,
    officialQuestionCount: z.int().nonnegative(),
    mappedQuestionCount: z.int().nonnegative(),
    apiBookId: z.string().regex(/^[0-9a-f]{24}$/),
    apiQuestionIdSetSha256: sha256Schema,
    apiPdfPageOffset: z.int().min(-10).max(10),
    mappingComplete: z.boolean(),
    bijectiveSubjectMapping: z.boolean(),
    duplicateQuestionCount: z.int().nonnegative(),
    alternativeAmbiguityCount: z.int().nonnegative(),
  })
  .strict();

const dualProofCandidateSchema = z
  .object({
    ...candidateBaseShape,
    rows: z.array(dualProofCandidateRowSchema),
    dualProof: z
      .object({
        method: z.literal('official-row-residual-and-subject-year-completeness'),
        resolvedRows: z.int().nonnegative(),
        evidence: z.array(subjectYearCompletenessEvidenceSchema).min(1),
      })
      .strict(),
    knownInconsistencies: z
      .object({
        ...knownInconsistenciesShape,
        resolvedByDualProof: z.int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const ogmTopicCandidateSchema = z.union([
  directCandidateSchema,
  dualProofCandidateSchema,
]);

export type OgmTopicCandidate = z.infer<typeof ogmTopicCandidateSchema>;

type IncludedMapping = {
  action: 'include';
  exam: ExamId;
  displaySubjectId: string;
  questionSet: 'canonical' | 'alternative-included' | 'cross-check';
  countingPolicy: 'canonical' | 'alternative-included' | 'cross-check-only';
};
type Mapping = IncludedMapping | { action: 'exclude-duplicate'; canonicalSourceKey: string };

const mapping = (entries: Record<string, Mapping>): Readonly<Record<string, Mapping>> => entries;
const SOURCE_SUBJECT_MAPPING = mapping({
  'tyt\0Türkçe': {
    action: 'include',
    exam: 'tyt',
    displaySubjectId: 'tyt-turkce',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'tyt\0Tarih': {
    action: 'include',
    exam: 'tyt',
    displaySubjectId: 'tyt-tarih',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'tyt\0Coğrafya': {
    action: 'include',
    exam: 'tyt',
    displaySubjectId: 'tyt-cografya',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'tyt\0Felsefe': {
    action: 'include',
    exam: 'tyt',
    displaySubjectId: 'tyt-felsefe',
    questionSet: 'alternative-included',
    countingPolicy: 'alternative-included',
  },
  'tyt\0Matematik': {
    action: 'include',
    exam: 'tyt',
    displaySubjectId: 'tyt-matematik',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'tyt\0Fizik': {
    action: 'include',
    exam: 'tyt',
    displaySubjectId: 'tyt-fizik',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'tyt\0Kimya': {
    action: 'include',
    exam: 'tyt',
    displaySubjectId: 'tyt-kimya',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'tyt\0Biyoloji': {
    action: 'include',
    exam: 'tyt',
    displaySubjectId: 'tyt-biyoloji',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'tyt-dkab\0Din Kültürü ve Ahlak Bilgisi': {
    action: 'include',
    exam: 'tyt',
    displaySubjectId: 'tyt-din-kulturu',
    questionSet: 'alternative-included',
    countingPolicy: 'alternative-included',
  },
  'ayt-say\0Matematik': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-matematik',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'ayt-say\0Fizik': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-fizik',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'ayt-say\0Kimya': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-kimya',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'ayt-say\0Biyoloji': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-biyoloji',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'ayt-ea\0Türk Dili ve Edebiyatı': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-edebiyat',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'ayt-ea\0Tarih-1': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-tarih-1',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'ayt-ea\0Coğrafya-1': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-cografya-1',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'ayt-ea\0Matematik': { action: 'exclude-duplicate', canonicalSourceKey: 'ayt-say' },
  'ayt-soz\0Türk Dili ve Edebiyatı': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-edebiyat',
    questionSet: 'cross-check',
    countingPolicy: 'cross-check-only',
  },
  'ayt-soz\0Tarih-1': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-tarih-1',
    questionSet: 'cross-check',
    countingPolicy: 'cross-check-only',
  },
  'ayt-soz\0Coğrafya-1': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-cografya-1',
    questionSet: 'cross-check',
    countingPolicy: 'cross-check-only',
  },
  'ayt-soz\0Tarih-2': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-tarih-2',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'ayt-soz\0Coğrafya-2': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-cografya-2',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
  'ayt-soz\0Felsefe': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-felsefe-grubu',
    questionSet: 'alternative-included',
    countingPolicy: 'alternative-included',
  },
  'ayt-soz\0Psikoloji': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-felsefe-grubu',
    questionSet: 'alternative-included',
    countingPolicy: 'alternative-included',
  },
  'ayt-soz\0Sosyoloji': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-felsefe-grubu',
    questionSet: 'alternative-included',
    countingPolicy: 'alternative-included',
  },
  'ayt-soz\0Mantık': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-felsefe-grubu',
    questionSet: 'alternative-included',
    countingPolicy: 'alternative-included',
  },
  'ayt-dkab\0Din Kültürü ve Ahlak Bilgisi': {
    action: 'include',
    exam: 'ayt',
    displaySubjectId: 'ayt-din-kulturu',
    questionSet: 'alternative-included',
    countingPolicy: 'alternative-included',
  },
  'ydt\0İngilizce': {
    action: 'include',
    exam: 'ydt',
    displaySubjectId: 'ydt-ingilizce',
    questionSet: 'canonical',
    countingPolicy: 'canonical',
  },
});

// The official AYT-SOZ table prints two "Çıkarım" rows for Mantık, distinguished only by the
// ÜNİTE column (physical page 215: KLASİK MANTIK 2024=1, SEMBOLİK MANTIK all zeros). The unit
// labels below are those official ÜNİTE values; a row must match one pinned fingerprint exactly.
type UnitDisambiguation = {
  unitTr: string;
  total: number;
  yearCounts: Readonly<Record<string, number>>;
};
const OFFICIAL_UNIT_DISAMBIGUATIONS: Readonly<Record<string, readonly UnitDisambiguation[]>> = {
  'ayt-soz\0Mantık\0Çıkarım': [
    {
      unitTr: 'Klasik Mantık',
      total: 1,
      yearCounts: {
        2018: 0, 2019: 0, 2020: 0, 2021: 0, 2022: 0, 2023: 0, 2024: 1, 2025: 0,
      },
    },
    {
      unitTr: 'Sembolik Mantık',
      total: 0,
      yearCounts: {
        2018: 0, 2019: 0, 2020: 0, 2021: 0, 2022: 0, 2023: 0, 2024: 0, 2025: 0,
      },
    },
  ],
};

function disambiguatedSourceLabel(row: CandidateRow): string {
  const disambiguations = OFFICIAL_UNIT_DISAMBIGUATIONS[candidateIdentity(row)];
  if (!disambiguations) return row.topic;
  const matches = disambiguations.filter(
    (candidate) =>
      candidate.total === row.total &&
      YEARS.every((year) => candidate.yearCounts[String(year)] === candidateYearCount(row, year)),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Official unit disambiguation fingerprint mismatch for ${candidateIdentity(row)}.`,
    );
  }
  return `${row.topic} (${matches[0]!.unitTr})`;
}

// Pinned from the audited registry (content/ogm-yks-topic-sources.json, api.bookObjectId);
// main() fails closed if these drift from the registry evidence.
const SOURCE_API_BOOK_IDS: Readonly<Record<number, string>> = {
  176299: '68b4f30ceb079be0e77092c8',
  176295: '68b1f111eb079be0e76eac8a',
  176296: '68b232a7eb079be0e76eea43',
  176297: '68b4ebc4eb079be0e770922c',
  176294: '68d3a8a1dbcaa9db10a16aa1',
  176293: '68d39ef3dbcaa9db10a159b4',
  176298: '68b4cc3beb079be0e7708108',
};

function slug(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function candidateIdentity(row: CandidateRow): string {
  return `${row.sourceGroup}\0${row.subject}\0${row.topic}`;
}

function candidateYearCount(row: CandidateRow, year: (typeof YEARS)[number]): number {
  const count = row.yearCounts[String(year)];
  if (count === undefined) {
    throw new Error(`Missing ${year} count for ${candidateIdentity(row)}.`);
  }
  return count;
}

function assertExactDuplicate(
  rows: readonly CandidateRow[],
  duplicateSourceKey: string,
  canonicalSourceKey: string,
): void {
  const canonical = new Map(
    rows
      .filter((row) => row.sourceGroup === canonicalSourceKey)
      .map((row) => [`${row.subject}\0${row.topic}`, row] as const),
  );
  for (const row of rows.filter((candidate) => candidate.sourceGroup === duplicateSourceKey)) {
    const configured = SOURCE_SUBJECT_MAPPING[`${row.sourceGroup}\0${row.subject}`];
    if (
      configured?.action !== 'exclude-duplicate' &&
      configured?.countingPolicy !== 'cross-check-only'
    ) {
      continue;
    }
    const expected = canonical.get(`${row.subject}\0${row.topic}`);
    if (
      !expected ||
      expected.total !== row.total ||
      YEARS.some((year) => candidateYearCount(expected, year) !== candidateYearCount(row, year))
    ) {
      throw new Error(
        `Cross-source row is not an exact match: ${row.sourceGroup}/${row.subject}/${row.topic}`,
      );
    }
  }
}

function assertCandidateIntegrity(candidate: OgmTopicCandidate): void {
  if (candidate.failures.length || candidate.summary.failedRows !== 0) {
    throw new Error(
      `Refusing publication: candidate contains ${candidate.failures.length} unresolved PDF row failure(s).`,
    );
  }
  if (
    candidate.summary.sources !== candidate.sources.length ||
    candidate.summary.verifiedRows !== candidate.rows.length ||
    candidate.sources.some((source) => source.failedRowCount !== 0) ||
    candidate.sources.reduce((sum, source) => sum + source.verifiedRowCount, 0) !==
      candidate.rows.length
  ) {
    throw new Error('Candidate summary does not match its source and row evidence.');
  }
  const sourceKeys = candidate.sources.map((source) => source.key);
  if (new Set(sourceKeys).size !== sourceKeys.length) throw new Error('Duplicate candidate source.');
  for (const row of candidate.rows) {
    if (!sourceKeys.includes(row.sourceGroup)) throw new Error(`Unknown source ${row.sourceGroup}.`);
    const total = YEARS.reduce((sum, year) => sum + candidateYearCount(row, year), 0);
    if (total !== row.total) throw new Error(`Invalid yearly total for ${candidateIdentity(row)}.`);
    if (!SOURCE_SUBJECT_MAPPING[`${row.sourceGroup}\0${row.subject}`]) {
      throw new Error(`No exact source/subject mapping for ${row.sourceGroup}/${row.subject}.`);
    }
  }
  assertExactDuplicate(candidate.rows, 'ayt-ea', 'ayt-say');
  assertExactDuplicate(candidate.rows, 'ayt-soz', 'ayt-ea');
}

export function buildTopicGroupStatistics(
  input: unknown,
  options: { observedAt: string; verifiedAt: string },
): z.infer<typeof topicGroupStatisticsSchema> {
  const candidate = ogmTopicCandidateSchema.parse(input);
  assertCandidateIntegrity(candidate);

  const orderBySubject = new Map<string, number>();
  const seenPublishedIdentity = new Set<string>();
  const groups = candidate.rows.flatMap((row) => {
    const configured = SOURCE_SUBJECT_MAPPING[`${row.sourceGroup}\0${row.subject}`]!;
    if (configured.action === 'exclude-duplicate') return [];
    const sourceLabelTr = disambiguatedSourceLabel(row);
    const identity = `${configured.displaySubjectId}\0${sourceLabelTr.toLocaleLowerCase('tr-TR')}`;
    if (configured.countingPolicy !== 'cross-check-only') {
      if (seenPublishedIdentity.has(identity)) {
        throw new Error(
          `Duplicate visible official label requires source correction: ${row.subject}/${row.topic}`,
        );
      }
      seenPublishedIdentity.add(identity);
    }
    const orderKey = `${configured.displaySubjectId}\0${configured.countingPolicy}`;
    const displayOrder = orderBySubject.get(orderKey) ?? 0;
    orderBySubject.set(orderKey, displayOrder + 1);
    return [
      {
        id: `${row.sourceGroup}-${slug(row.subject)}-${slug(sourceLabelTr)}`,
        exam: configured.exam,
        displaySubjectId: configured.displaySubjectId,
        sourceKey: row.sourceGroup,
        evidenceMethod: 'official-pdf-table' as const,
        questionSet: configured.questionSet,
        countingPolicy: configured.countingPolicy,
        sourceLabelTr,
        translationStatus: 'source-only' as const,
        physicalPage: row.physicalPage,
        displayOrder,
        yearlyCounts: YEARS.map((year) => ({ year, count: candidateYearCount(row, year) })),
        total: row.total,
      },
    ];
  });

  const usedSourceKeys = new Set(groups.map((group) => group.sourceKey));
  const document = {
    schemaVersion: 1 as const,
    authority: 'MEB OGM' as const,
    granularity: 'official-topic-group' as const,
    availability: 'available' as const,
    coverage: { firstYear: 2018 as const, lastYear: 2025 },
    landingPageUrl: 'https://ogmmateryal.eba.gov.tr/yks-cikmis-soru-kitaplari',
    observedAt: options.observedAt,
    verificationMethod: 'official-direct' as const,
    verifiedAt: options.verifiedAt,
    note: {
      tr: 'MEB OGM tablolarındaki geniş konu gruplarıdır; çalışma konularına dağıtılmaz.',
      en: 'These are broad topic groups from MEB OGM tables and are not distributed across study topics.',
    },
    sources: candidate.sources
      .filter((source) => usedSourceKeys.has(source.key))
      .map((source) => {
        const apiBookId = SOURCE_API_BOOK_IDS[source.sourceId];
        if (!apiBookId) throw new Error(`Missing exact API book provenance for ${source.sourceId}.`);
        return {
          key: source.key,
          sourceId: source.sourceId,
          apiBookId,
          titleTr: source.titleTr,
          resolverUrl: source.resolverUrl,
          bytes: source.bytes,
          sha256: source.sha256,
        };
      }),
    groups,
  };
  return topicGroupStatisticsSchema.parse(document);
}

type CliOptions = {
  candidatePath: string;
  outputPath: string;
  registryPath: string;
  topicsPath: string;
  verifiedAt: string;
};

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    candidatePath: resolve('tmp/ogm-topic-extraction/official-2018-2025.dual-proof.candidate.json'),
    outputPath: resolve('content/topic-group-statistics.json'),
    registryPath: resolve('content/ogm-yks-topic-sources.json'),
    topicsPath: resolve('content/topics.json'),
    verifiedAt: new Date().toISOString(),
  };
  const flags = new Map<string, keyof CliOptions>([
    ['--candidate', 'candidatePath'],
    ['--output', 'outputPath'],
    ['--registry', 'registryPath'],
    ['--topics', 'topicsPath'],
    ['--verified-at', 'verifiedAt'],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const key = flag ? flags.get(flag) : undefined;
    const value = args[index + 1];
    if (!key || !value) throw new Error(`Unknown or incomplete argument: ${flag ?? '<empty>'}`);
    options[key] = key === 'verifiedAt' ? value : resolve(value);
    index += 1;
  }
  return options;
}

async function readLimitedJson(path: string): Promise<unknown> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_CANDIDATE_BYTES) {
    throw new Error(`Unsafe JSON input size: ${path}`);
  }
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const [candidate, registryInput, topicsInput] = await Promise.all([
    readLimitedJson(options.candidatePath),
    readLimitedJson(options.registryPath),
    readLimitedJson(options.topicsPath),
  ]);
  const registry = ogmTopicSourceRegistrySchema.parse(registryInput);
  for (const source of includedOgmTopicSources(registry)) {
    if (SOURCE_API_BOOK_IDS[source.sourceId] !== source.api.bookObjectId) {
      throw new Error(
        `API book provenance drift for source ${source.sourceId}: registry says ${source.api.bookObjectId}.`,
      );
    }
  }
  const document = buildTopicGroupStatistics(candidate, {
    observedAt: registry.observedAt,
    verifiedAt: options.verifiedAt,
  });
  const validation = validateTopicGroupStatisticsData(document, topicsInput, registry);
  if (validation.errors.length) {
    throw new Error(`Publication validation failed:\n${validation.errors.join('\n')}`);
  }
  await writeTextFileAtomicallyIfChanged(
    options.outputPath,
    `${JSON.stringify(document, null, 2)}\n`,
  );
  console.log(`Published ${document.groups.length} verified MEB OGM topic groups.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
