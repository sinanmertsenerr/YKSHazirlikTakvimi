import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
  OGM_DISTRIBUTION_YEARS,
  inspectOgmTopicDistributionRows,
  parsePdftotextBboxLayout,
  type BboxDocument,
  type OgmDistributionYear,
  type OgmTopicDistributionFailure,
  type OgmTopicDistributionRow,
} from './lib/ogm-topic-extraction.ts';
import {
  assertAllowedOgmUrl,
  includedOgmTopicSources,
  loadOgmTopicSourceRegistry,
  type IncludedOgmTopicSource,
} from './lib/ogm-topic-registry.ts';

const execFile = promisify(execFileCallback);
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_API_BYTES = 16 * 1024 * 1024;
const TYT_API_BOOK_ID = '68b4f30ceb079be0e77092c8';
const API_ORIGIN = 'https://ogmmateryal.eba.gov.tr';
const SUBJECTS_BY_SOURCE: Readonly<Record<string, readonly string[]>> = {
  tyt: [
    'Türkçe',
    'Tarih',
    'Tarih',
    'Coğrafya',
    'Felsefe',
    'Felsefe',
    'Matematik',
    'Fizik',
    'Fizik',
    'Kimya',
    'Biyoloji',
  ],
  'ayt-ea': [
    'Türk Dili ve Edebiyatı',
    'Tarih-1',
    'Tarih-1',
    'Coğrafya-1',
    'Matematik',
    'Matematik',
  ],
  'ayt-soz': [
    'Türk Dili ve Edebiyatı',
    'Tarih-1',
    'Tarih-1',
    'Coğrafya-1',
    'Tarih-2',
    'Tarih-2',
    'Tarih-2',
    'Coğrafya-2',
    'Felsefe',
    'Felsefe',
    'Psikoloji',
    'Sosyoloji',
    'Mantık',
  ],
  'ayt-say': ['Matematik', 'Matematik', 'Fizik', 'Fizik', 'Kimya', 'Kimya', 'Biyoloji'],
  'tyt-dkab': ['Din Kültürü ve Ahlak Bilgisi'],
  'ayt-dkab': ['Din Kültürü ve Ahlak Bilgisi'],
  ydt: ['İngilizce'],
};

export type SourceResult = {
  key: string;
  sourceId: number;
  titleTr: string;
  resolverUrl: string;
  resolvedPdfUrl: string;
  bytes: number;
  sha256: string;
  tableCount: number;
  verifiedRowCount: number;
  failedRowCount: number;
  apiBookId?: string;
};

export type OgmTopicCandidate = {
  schemaVersion: 1;
  authority: 'MEB OGM';
  dryRun: true;
  publicationAllowed: false;
  coverage: { firstYear: 2018; lastYear: 2025; includes2026: false };
  summary: { sources: number; tables: number; verifiedRows: number; failedRows: number };
  sources: SourceResult[];
  rows: OgmTopicDistributionRow[];
  failures: OgmTopicDistributionFailure[];
  knownInconsistencies: {
    missingPrinted2025CellRows: number;
    missingPrintedOtherYearCellRows: number;
    noteTr: string;
  };
};

export type SubjectYearCompletenessEvidence = {
  sourceGroup: 'tyt';
  subject: 'Matematik' | 'Fizik';
  year: OgmDistributionYear;
  officialQuestionCount: number;
  mappedQuestionCount: number;
  apiBookId: string;
  apiQuestionIdSetSha256: string;
  apiPdfPageOffset: number;
  mappingComplete: boolean;
  bijectiveSubjectMapping: boolean;
  duplicateQuestionCount: number;
  alternativeAmbiguityCount: number;
};

export type DerivedZeroProvenance = {
  year: OgmDistributionYear;
  derivedZeroMethod: 'official-row-residual-and-subject-year-completeness';
  rowResidual: 0;
  explicitSubjectYearCount: number;
  officialSubjectYearQuestionCount: number;
  apiBookId: string;
  apiQuestionIdSetSha256: string;
  apiPdfPageOffset: number;
};

export type CandidateDistributionRow = Omit<OgmTopicDistributionRow, 'rawCells'> & {
  derivedZeros?: DerivedZeroProvenance[];
};

export type DualProofResolution = {
  rows: CandidateDistributionRow[];
  failures: OgmTopicDistributionFailure[];
  resolvedRows: number;
};

export type OgmDualProofCandidate = Omit<OgmTopicCandidate, 'rows' | 'knownInconsistencies'> & {
  rows: CandidateDistributionRow[];
  dualProof: {
    method: 'official-row-residual-and-subject-year-completeness';
    resolvedRows: number;
    evidence: SubjectYearCompletenessEvidence[];
  };
  knownInconsistencies: OgmTopicCandidate['knownInconsistencies'] & {
    resolvedByDualProof: number;
  };
};

export function buildOgmTopicCandidate(
  sources: SourceResult[],
  rows: OgmTopicDistributionRow[],
  failures: OgmTopicDistributionFailure[],
): OgmTopicCandidate {
  const missingPrinted2025CellRows = failures.filter((failure) =>
    /found columns 0,1,2,3,4,5,6,8$/u.test(failure.reason),
  ).length;
  const missingPrintedOtherYearCellRows = failures.filter(
    (failure) => !/found columns 0,1,2,3,4,5,6,8$/u.test(failure.reason),
  ).length;
  return {
    schemaVersion: 1,
    authority: 'MEB OGM',
    dryRun: true,
    publicationAllowed: false,
    coverage: { firstYear: 2018, lastYear: 2025, includes2026: false },
    summary: {
      sources: sources.length,
      tables: sources.reduce((sum, source) => sum + source.tableCount, 0),
      verifiedRows: rows.length,
      failedRows: failures.length,
    },
    sources,
    rows,
    failures,
    knownInconsistencies: {
      missingPrinted2025CellRows,
      missingPrintedOtherYearCellRows,
      noteTr:
        'Boş hücre sıfır sayılmadı. Yalnız PDF üzerinde görünen tire veya 0 sıfır kabul edildi; başarısız satırlar yayımlanamaz.',
    },
  };
}

function withoutRawCells(row: OgmTopicDistributionRow): CandidateDistributionRow {
  const { rawCells: _rawCells, ...candidate } = row;
  return candidate;
}

export function resolveBlankCellsWithDualProof(
  rows: readonly OgmTopicDistributionRow[],
  failures: readonly OgmTopicDistributionFailure[],
  evidence: readonly SubjectYearCompletenessEvidence[],
): DualProofResolution {
  const candidateRows = rows.map(withoutRawCells);
  const remainingFailures: OgmTopicDistributionFailure[] = [];
  const topicKeys = [
    ...rows.map((row) => `${row.sourceGroup}\0${row.subject}\0${row.topic}`),
    ...failures.flatMap((failure) =>
      failure.subject && failure.topic
        ? [`${failure.sourceGroup}\0${failure.subject}\0${failure.topic}`]
        : [],
    ),
  ];
  const duplicateTopicKeys = new Set(
    topicKeys.filter((key, index) => topicKeys.indexOf(key) !== index),
  );
  const eligibleSubjectGroups = new Set<string>();
  const subjectYearTableCounts = new Map<string, number>();
  const subjectGroups = new Set(
    failures.flatMap((failure) =>
      failure.subject ? [`${failure.sourceGroup}\0${failure.subject}`] : [],
    ),
  );
  for (const subjectGroup of subjectGroups) {
    const [sourceGroup, subject] = subjectGroup.split('\0');
    if (!sourceGroup || !subject) continue;
    const subjectFailures = failures.filter(
      (failure) => failure.sourceGroup === sourceGroup && failure.subject === subject,
    );
    const everyMissingRowHasZeroResidual = subjectFailures.every((failure) => {
      const missingYear =
        failure.missingYears?.length === 1 ? failure.missingYears[0] : undefined;
      const explicitEntries = Object.entries(failure.explicitYearCounts ?? {});
      const topicKey = `${failure.sourceGroup}\0${failure.subject ?? ''}\0${failure.topic ?? ''}`;
      return (
        missingYear !== undefined &&
        failure.topic !== undefined &&
        failure.rowTotal !== undefined &&
        explicitEntries.length === 7 &&
        !duplicateTopicKeys.has(topicKey) &&
        explicitEntries.every(
          ([year, count]) =>
            OGM_DISTRIBUTION_YEARS.includes(Number(year) as OgmDistributionYear) &&
            Number(year) !== missingYear &&
            Number.isSafeInteger(count) &&
            count >= 0,
        ) &&
        failure.rowTotal - explicitEntries.reduce((sum, [, count]) => sum + count, 0) === 0
      );
    });
    if (!everyMissingRowHasZeroResidual) continue;

    const missingYears = [
      ...new Set(subjectFailures.flatMap((failure) => failure.missingYears ?? [])),
    ];
    const yearEvidence = missingYears.map((year) =>
      evidence.filter(
        (item) =>
          item.sourceGroup === sourceGroup && item.subject === subject && item.year === year,
      ),
    );
    if (
      missingYears.length === 0 ||
      yearEvidence.some((items) => items.length !== 1) ||
      new Set(yearEvidence.flat().map((item) => item.apiBookId)).size !== 1 ||
      new Set(yearEvidence.flat().map((item) => item.apiPdfPageOffset)).size !== 1 ||
      yearEvidence.flat().some(
        (item) =>
          !item.mappingComplete ||
          !item.bijectiveSubjectMapping ||
          item.mappedQuestionCount !== item.officialQuestionCount ||
          item.duplicateQuestionCount !== 0 ||
          item.alternativeAmbiguityCount !== 0,
      )
    ) {
      continue;
    }
    let completePartition = true;
    for (const [index, year] of missingYears.entries()) {
      const tableCount =
        rows
          .filter((row) => row.sourceGroup === sourceGroup && row.subject === subject)
          .reduce((sum, row) => sum + row.yearCounts[year], 0) +
        subjectFailures.reduce(
          (sum, failure) => sum + (failure.explicitYearCounts?.[year] ?? 0),
          0,
        );
      subjectYearTableCounts.set(`${subjectGroup}\0${year}`, tableCount);
      if (tableCount !== yearEvidence[index]![0]!.officialQuestionCount) {
        completePartition = false;
      }
    }
    if (completePartition) eligibleSubjectGroups.add(subjectGroup);
  }

  for (const failure of failures) {
    const subject = failure.subject;
    const topic = failure.topic;
    const rowTotal = failure.rowTotal;
    const missingYear = failure.missingYears?.length === 1 ? failure.missingYears[0] : undefined;
    const explicitEntries = Object.entries(failure.explicitYearCounts ?? {}).map(
      ([year, count]) => [Number(year) as OgmDistributionYear, count] as const,
    );
    const evidenceItem = evidence.find(
      (item) =>
        item.sourceGroup === failure.sourceGroup &&
        item.subject === subject &&
        item.year === missingYear,
    );
    const topicKey = `${failure.sourceGroup}\0${subject ?? ''}\0${topic ?? ''}`;
    const subjectGroup = `${failure.sourceGroup}\0${subject ?? ''}`;
    const explicitSum = explicitEntries.reduce((sum, [, count]) => sum + count, 0);
    const rowResidual = rowTotal === undefined ? undefined : rowTotal - explicitSum;
    const explicitSubjectYearCount =
      missingYear === undefined
        ? undefined
        : subjectYearTableCounts.get(`${subjectGroup}\0${missingYear}`);
    const proofHolds =
      missingYear !== undefined &&
      subject !== undefined &&
      topic !== undefined &&
      rowTotal !== undefined &&
      explicitEntries.length === 7 &&
      rowResidual === 0 &&
      !duplicateTopicKeys.has(topicKey) &&
      eligibleSubjectGroups.has(subjectGroup) &&
      evidenceItem !== undefined &&
      evidenceItem.mappingComplete &&
      evidenceItem.bijectiveSubjectMapping &&
      evidenceItem.mappedQuestionCount === evidenceItem.officialQuestionCount &&
      evidenceItem.duplicateQuestionCount === 0 &&
      evidenceItem.alternativeAmbiguityCount === 0 &&
      explicitSubjectYearCount === evidenceItem.officialQuestionCount;
    if (
      !proofHolds ||
      !evidenceItem ||
      explicitSubjectYearCount === undefined ||
      missingYear === undefined ||
      subject === undefined ||
      topic === undefined ||
      rowTotal === undefined
    ) {
      remainingFailures.push(failure);
      continue;
    }
    const yearCounts = Object.fromEntries([...explicitEntries, [missingYear, 0]]) as Record<
      OgmDistributionYear,
      number
    >;
    const years = Object.keys(yearCounts).map(Number);
    if (
      years.length !== 8 ||
      Object.values(yearCounts).reduce((sum, count) => sum + count, 0) !== rowTotal
    ) {
      remainingFailures.push(failure);
      continue;
    }
    candidateRows.push({
      sourceGroup: failure.sourceGroup,
      subject,
      topic,
      physicalPage: failure.physicalPage,
      yearCounts,
      total: rowTotal,
      derivedZeros: [
        {
          year: missingYear,
          derivedZeroMethod: 'official-row-residual-and-subject-year-completeness',
          rowResidual: 0,
          explicitSubjectYearCount,
          officialSubjectYearQuestionCount: evidenceItem.officialQuestionCount,
          apiBookId: evidenceItem.apiBookId,
          apiQuestionIdSetSha256: evidenceItem.apiQuestionIdSetSha256,
          apiPdfPageOffset: evidenceItem.apiPdfPageOffset,
        },
      ],
    });
  }
  candidateRows.sort(
    (left, right) =>
      left.sourceGroup.localeCompare(right.sourceGroup) ||
      left.physicalPage - right.physicalPage ||
      left.topic.localeCompare(right.topic, 'tr'),
  );
  return {
    rows: candidateRows,
    failures: remainingFailures,
    resolvedRows: failures.length - remainingFailures.length,
  };
}

export function buildOgmDualProofCandidate(
  sources: readonly SourceResult[],
  resolution: DualProofResolution,
  evidence: readonly SubjectYearCompletenessEvidence[],
  originalFailures: readonly OgmTopicDistributionFailure[],
): OgmDualProofCandidate {
  const adjustedSources = sources.map((source) => {
    const unresolved = resolution.failures.filter(
      (failure) => failure.sourceGroup === source.key,
    ).length;
    const resolved = resolution.rows.filter(
      (row) => row.sourceGroup === source.key && row.derivedZeros?.length,
    ).length;
    return {
      ...source,
      verifiedRowCount: source.verifiedRowCount + resolved,
      failedRowCount: unresolved,
    };
  });
  const originalCandidate = buildOgmTopicCandidate([...sources], [], [...originalFailures]);
  return {
    schemaVersion: 1,
    authority: 'MEB OGM',
    dryRun: true,
    publicationAllowed: false,
    coverage: { firstYear: 2018, lastYear: 2025, includes2026: false },
    summary: {
      sources: adjustedSources.length,
      tables: adjustedSources.reduce((sum, source) => sum + source.tableCount, 0),
      verifiedRows: resolution.rows.length,
      failedRows: resolution.failures.length,
    },
    sources: adjustedSources,
    rows: resolution.rows,
    failures: resolution.failures,
    dualProof: {
      method: 'official-row-residual-and-subject-year-completeness',
      resolvedRows: resolution.resolvedRows,
      evidence: [...evidence],
    },
    knownInconsistencies: {
      ...originalCandidate.knownInconsistencies,
      resolvedByDualProof: resolution.resolvedRows,
      noteTr:
        'Basılı boş hücre doğrudan sıfır sayılmadı. Yalnız row residual ve resmi API/PDF subject-year tamlığı birlikte kanıtlanan hücrelere türetilmiş 0 verildi.',
    },
  };
}

export type OfficialApiQuestion = {
  id: string;
  bookId: string;
  testId: string;
  questionNumber: number;
  pageNumber: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type OfficialApiTestBundle = {
  subject: 'Matematik' | 'Fizik';
  testId: string;
  questions: OfficialApiQuestion[];
  alternativeAmbiguityCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value) throw new Error(`official API is missing ${key}`);
  return value;
}

function requiredInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value)) throw new Error(`official API has invalid ${key}`);
  return value as number;
}

function requiredPercentage(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`official API has invalid ${key}`);
  }
  return value;
}

export function mapOfficialApiQuestionsToPdfYears(
  document: BboxDocument,
  bundles: readonly OfficialApiTestBundle[],
): SubjectYearCompletenessEvidence[] {
  const questions = bundles.flatMap((bundle) =>
    bundle.questions.map((question) => ({ ...question, subject: bundle.subject })),
  );
  if (!questions.length) return [];
  const duplicateQuestionCount =
    questions.length - new Set(questions.map((question) => question.id)).size;
  const duplicateGeometryCount =
    questions.length -
    new Set(
      questions.map(
        (question) =>
          `${question.pageNumber}\0${question.left}\0${question.top}\0${question.width}\0${question.height}`,
      ),
    ).size;
  const alternativeAmbiguityCount =
    bundles.reduce((sum, bundle) => sum + bundle.alternativeAmbiguityCount, 0) +
    duplicateGeometryCount;
  const bijectiveSubjectMapping =
    new Set(bundles.map((bundle) => bundle.subject)).size === 2 &&
    new Set(bundles.map((bundle) => bundle.testId)).size === bundles.length &&
    bundles.every((bundle) =>
      bundle.questions.every((question) => question.testId === bundle.testId),
    );
  if (duplicateQuestionCount || alternativeAmbiguityCount || !bijectiveSubjectMapping) return [];

  type Mapped = (typeof questions)[number] & { year: OgmDistributionYear };
  const mappings: { offset: number; questions: Mapped[] }[] = [];
  for (let offset = -10; offset <= 10; offset += 1) {
    const mapped: Mapped[] = [];
    let valid = true;
    for (const question of questions) {
      const page = document.pages[question.pageNumber + offset - 1];
      if (!page) {
        valid = false;
        break;
      }
      const xMin = (page.width * question.left) / 100;
      const xMax = (page.width * (question.left + question.width)) / 100;
      const yMin = (page.height * question.top) / 100;
      const yMax = (page.height * (question.top + question.height)) / 100;
      const years = new Set(
        page.words.flatMap((word) => {
          const match = /^(2018|2019|2020|2021|2022|2023|2024|2025)-TYT$/u.exec(word.text);
          const x = (word.xMin + word.xMax) / 2;
          const y = (word.yMin + word.yMax) / 2;
          return match && x >= xMin && x <= xMax && y >= yMin && y <= yMax
            ? [Number(match[1]) as OgmDistributionYear]
            : [];
        }),
      );
      if (years.size !== 1) {
        valid = false;
        break;
      }
      mapped.push({ ...question, year: [...years][0]! });
    }
    if (valid) mappings.push({ offset, questions: mapped });
  }
  if (mappings.length !== 1) return [];
  const mapping = mappings[0]!;
  return (['Matematik', 'Fizik'] as const).flatMap((subject) =>
    ([2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const).map((year) => {
      const matched = mapping.questions.filter(
        (question) => question.subject === subject && question.year === year,
      );
      return {
        sourceGroup: 'tyt' as const,
        subject,
        year,
        officialQuestionCount: matched.length,
        mappedQuestionCount: matched.length,
        apiBookId: TYT_API_BOOK_ID,
        apiQuestionIdSetSha256: createHash('sha256')
          .update(
            matched
              .map((question) => question.id)
              .sort()
              .join('\n'),
          )
          .digest('hex'),
        apiPdfPageOffset: mapping.offset,
        mappingComplete: mapping.questions.length === questions.length,
        bijectiveSubjectMapping,
        duplicateQuestionCount,
        alternativeAmbiguityCount,
      };
    }),
  );
}

async function readOfficialApiJson(path: string): Promise<unknown> {
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN || !url.pathname.startsWith('/ogm-test-api/v1/general/')) {
    throw new Error('refused non-official OGM API URL');
  }
  const response = await fetch(url, {
    redirect: 'error',
    headers: { accept: 'application/json', 'user-agent': 'YKS-OGM-Topic-Extraction/1.0' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body)
    throw new Error(`official OGM API returned HTTP ${response.status}`);
  if (response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
    throw new Error('official OGM API response is not JSON');
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_API_BYTES) throw new Error('official OGM API response exceeded size limit');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

async function fetchTytSubjectYearEvidence(
  document: BboxDocument,
  resolvedPdfUrl: string,
): Promise<SubjectYearCompletenessEvidence[]> {
  const bookPayload = await readOfficialApiJson(
    `/ogm-test-api/v1/general/books/${TYT_API_BOOK_ID}`,
  );
  if (!isRecord(bookPayload) || !isRecord(bookPayload.book) || !Array.isArray(bookPayload.tests)) {
    throw new Error('official OGM book API contract changed');
  }
  if (requiredString(bookPayload.book, 'pdfPublicUrl') !== resolvedPdfUrl) {
    throw new Error('official OGM API/PDF URL provenance mismatch');
  }
  const metadata = bookPayload.tests.flatMap((value) => {
    if (!isRecord(value)) throw new Error('official OGM test metadata is invalid');
    const title = requiredString(value, 'testTitle');
    const subject = title.startsWith('Matematik - ')
      ? ('Matematik' as const)
      : title.startsWith('Fizik - ')
        ? ('Fizik' as const)
        : undefined;
    return subject
      ? [
          {
            subject,
            id: requiredString(value, 'id'),
            title,
            questionCount: requiredInteger(value, 'questionCount'),
          },
        ]
      : [];
  });
  if (
    metadata.length !== 20 ||
    new Set(metadata.map((test) => test.id)).size !== metadata.length ||
    metadata.filter((test) => test.subject === 'Matematik').length !== 10 ||
    metadata.filter((test) => test.subject === 'Fizik').length !== 10
  ) {
    throw new Error('official OGM subject/test mapping is not bijective');
  }
  const bundles: OfficialApiTestBundle[] = [];
  for (const testMetadata of metadata) {
    const payload = await readOfficialApiJson(`/ogm-test-api/v1/general/tests/${testMetadata.id}`);
    if (
      !isRecord(payload) ||
      !isRecord(payload.test) ||
      !Array.isArray(payload.questions) ||
      !Array.isArray(payload.pageSharingTestsSharedRoots)
    ) {
      throw new Error('official OGM test API contract changed');
    }
    if (
      requiredString(payload.test, 'id') !== testMetadata.id ||
      requiredString(payload.test, 'testTitle') !== testMetadata.title ||
      requiredInteger(payload.test, 'questionCount') !== testMetadata.questionCount ||
      payload.questions.length !== testMetadata.questionCount ||
      payload.pageSharingTestsSharedRoots.length !== 0
    ) {
      throw new Error(`official OGM test metadata drifted for ${testMetadata.id}`);
    }
    const questions = payload.questions.map((value): OfficialApiQuestion => {
      if (!isRecord(value)) throw new Error('official OGM question metadata is invalid');
      const question: OfficialApiQuestion = {
        id: requiredString(value, 'id'),
        bookId: requiredString(value, 'bookId'),
        testId: requiredString(value, 'testId'),
        questionNumber: requiredInteger(value, 'questionNumber'),
        pageNumber: requiredInteger(value, 'pageNumber'),
        left: requiredPercentage(value, 'left'),
        top: requiredPercentage(value, 'top'),
        width: requiredPercentage(value, 'width'),
        height: requiredPercentage(value, 'height'),
      };
      if (
        question.bookId !== TYT_API_BOOK_ID ||
        question.testId !== testMetadata.id ||
        question.questionNumber < 1 ||
        question.pageNumber < 1 ||
        question.width <= 0 ||
        question.height <= 0 ||
        question.left + question.width > 100.001 ||
        question.top + question.height > 100.001
      ) {
        throw new Error('official OGM question provenance/geometry is invalid');
      }
      return question;
    });
    const duplicateLocalNumbers =
      questions.length - new Set(questions.map((question) => question.questionNumber)).size;
    bundles.push({
      subject: testMetadata.subject,
      testId: testMetadata.id,
      questions,
      alternativeAmbiguityCount: duplicateLocalNumbers,
    });
  }
  return mapOfficialApiQuestionsToPdfYears(document, bundles);
}

async function downloadVerifiedPdf(
  source: IncludedOgmTopicSource,
  destination: string,
): Promise<{ resolvedPdfUrl: string; bytes: number; sha256: string }> {
  let currentUrl = assertAllowedOgmUrl(source.resolverUrl);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    response = await fetch(currentUrl, {
      redirect: 'manual',
      headers: { accept: 'application/pdf', 'user-agent': 'YKS-OGM-Topic-Extraction/1.0' },
      signal: AbortSignal.timeout(120_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects === MAX_REDIRECTS) throw new Error(`${source.key}: unsafe redirect`);
    currentUrl = assertAllowedOgmUrl(new URL(location, currentUrl).href);
    response = undefined;
  }
  if (!response?.ok || !response.body) throw new Error(`${source.key}: official PDF unavailable`);
  if (response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/pdf') {
    throw new Error(`${source.key}: response is not application/pdf`);
  }
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  if (encoding && encoding !== 'identity') throw new Error(`${source.key}: encoded PDF refused`);
  const declared = Number(response.headers.get('content-length'));
  if (
    !Number.isSafeInteger(declared) ||
    declared !== source.expected.bytes ||
    declared > MAX_BYTES
  ) {
    throw new Error(`${source.key}: Content-Length does not match pinned bytes`);
  }
  const file = await open(destination, 'wx', 0o600);
  const hash = createHash('sha256');
  let bytes = 0;
  let prefix = Buffer.alloc(0);
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > declared || bytes > MAX_BYTES) throw new Error(`${source.key}: PDF too large`);
      if (prefix.length < 5) prefix = Buffer.concat([prefix, buffer]).subarray(0, 5);
      hash.update(buffer);
      await file.write(buffer);
    }
  } finally {
    await file.close();
    await response.body.cancel().catch(() => undefined);
  }
  const sha256 = hash.digest('hex');
  if (
    prefix.toString('ascii') !== '%PDF-' ||
    bytes !== declared ||
    sha256 !== source.expected.sha256
  ) {
    throw new Error(`${source.key}: downloaded bytes or SHA-256 do not match the pin`);
  }
  return { resolvedPdfUrl: currentUrl, bytes, sha256 };
}

export function resolveSafeCandidateOutputPath(
  argument: string | undefined,
  cwd = process.cwd(),
): string {
  const outputRoot = resolve(cwd, 'tmp/ogm-topic-extraction');
  const outputPath = resolve(cwd, argument ?? 'tmp/ogm-topic-extraction/candidate.json');
  const filename = basename(outputPath);
  if (dirname(outputPath) !== outputRoot || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/u.test(filename)) {
    throw new Error('output must be a direct JSON child of tmp/ogm-topic-extraction');
  }
  return outputPath;
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export async function atomicWriteCandidate(
  outputPath: string,
  value: unknown,
  cwd = process.cwd(),
): Promise<void> {
  const root = dirname(outputPath);
  if (root !== resolve(cwd, 'tmp/ogm-topic-extraction')) {
    throw new Error('atomic output path is outside the candidate root');
  }
  const tmpRoot = resolve(cwd, 'tmp');
  try {
    const tmpStat = await lstat(tmpRoot);
    if (tmpStat.isSymbolicLink() || !tmpStat.isDirectory()) {
      throw new Error('workspace tmp root cannot be a symlink');
    }
  } catch (error) {
    if (!isEnoent(error)) throw error;
    await mkdir(tmpRoot);
  }
  try {
    const candidateRootStat = await lstat(root);
    if (candidateRootStat.isSymbolicLink() || !candidateRootStat.isDirectory()) {
      throw new Error('candidate output root cannot be a symlink');
    }
  } catch (error) {
    if (!isEnoent(error)) throw error;
    await mkdir(root);
  }
  const [realCwd, realRoot, rootStat] = await Promise.all([
    realpath(cwd),
    realpath(root),
    lstat(root),
  ]);
  const relativeRoot = relative(realCwd, realRoot);
  if (
    rootStat.isSymbolicLink() ||
    !rootStat.isDirectory() ||
    relativeRoot === '..' ||
    relativeRoot.startsWith(`..${sep}`) ||
    relativeRoot !== join('tmp', 'ogm-topic-extraction')
  ) {
    throw new Error('output root escaped the workspace or is a symlink');
  }
  try {
    if ((await lstat(outputPath)).isSymbolicLink())
      throw new Error('output file cannot be a symlink');
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }
  const temporaryPath = join(root, `.${basename(outputPath)}.${randomUUID()}.tmp`);
  const file = await open(temporaryPath, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function main(): Promise<void> {
  const cliArguments = process.argv.slice(2);
  if (
    cliArguments.length !== 0 &&
    (cliArguments.length !== 2 || cliArguments[0] !== '--output' || !cliArguments[1])
  ) {
    throw new Error('only --output <tmp candidate filename> is supported');
  }
  const outputPath = resolveSafeCandidateOutputPath(cliArguments[1]);
  const registry = await loadOgmTopicSourceRegistry(
    resolve(process.cwd(), 'content/ogm-yks-topic-sources.json'),
  );
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ogm-topic-extraction-'));
  const sourceResults: SourceResult[] = [];
  const rows: OgmTopicDistributionRow[] = [];
  const failures: OgmTopicDistributionFailure[] = [];
  let dualProofEvidence: SubjectYearCompletenessEvidence[] = [];
  try {
    for (const source of includedOgmTopicSources(registry)) {
      const subjects = SUBJECTS_BY_SOURCE[source.key];
      if (!subjects) throw new Error(`missing controlled subject sequence for ${source.key}`);
      const pdfPath = join(temporaryDirectory, `${source.key}.pdf`);
      const bboxPath = join(temporaryDirectory, `${source.key}.bbox.xhtml`);
      const observation = await downloadVerifiedPdf(source, pdfPath);
      await execFile('pdftotext', ['-bbox-layout', '-enc', 'UTF-8', pdfPath, bboxPath], {
        timeout: 120_000,
      });
      const document = parsePdftotextBboxLayout(await readFile(bboxPath, 'utf8'));
      const report = inspectOgmTopicDistributionRows(document, {
        sourceGroup: source.key,
        subjectByTable: subjects,
      });
      if (source.key === 'tyt') {
        dualProofEvidence = await fetchTytSubjectYearEvidence(document, observation.resolvedPdfUrl);
      }
      rows.push(...report.rows);
      failures.push(...report.failures);
      sourceResults.push({
        key: source.key,
        sourceId: source.sourceId,
        titleTr: source.titleTr,
        resolverUrl: source.resolverUrl,
        ...observation,
        tableCount: report.tableCount,
        verifiedRowCount: report.rows.length,
        failedRowCount: report.failures.length,
        ...(source.key === 'tyt' ? { apiBookId: TYT_API_BOOK_ID } : {}),
      });
      console.log(
        `${source.key}: ${report.tableCount} table, ${report.rows.length} verified row, ${report.failures.length} failed row`,
      );
    }
    const resolution = resolveBlankCellsWithDualProof(rows, failures, dualProofEvidence);
    const candidate = buildOgmDualProofCandidate(
      sourceResults,
      resolution,
      dualProofEvidence,
      failures,
    );
    await atomicWriteCandidate(outputPath, candidate);
    console.log(`Dry-run candidate: ${outputPath}`);
    console.log(JSON.stringify(candidate.summary));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
