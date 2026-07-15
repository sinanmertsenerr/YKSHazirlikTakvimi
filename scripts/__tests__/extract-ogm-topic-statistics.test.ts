import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  atomicWriteCandidate,
  buildOgmTopicCandidate,
  mapOfficialApiQuestionsToPdfYears,
  resolveBlankCellsWithDualProof,
  resolveSafeCandidateOutputPath,
  type OfficialApiTestBundle,
  type SourceResult,
  type SubjectYearCompletenessEvidence,
} from '../extract-ogm-topic-statistics.ts';
import type {
  BboxDocument,
  OgmTopicDistributionFailure,
  OgmTopicDistributionRow,
} from '../lib/ogm-topic-extraction.ts';

const source: SourceResult = {
  key: 'tyt',
  sourceId: 176299,
  titleTr: 'TYT Çıkmış Sorular (2018-2025)',
  resolverUrl: 'https://ogmmateryal.eba.gov.tr/pdf-goster/176299',
  resolvedPdfUrl: 'https://ogm-small-cdn.eba.gov.tr/official.pdf',
  bytes: 10,
  sha256: 'a'.repeat(64),
  tableCount: 1,
  verifiedRowCount: 1,
  failedRowCount: 1,
};

const row: OgmTopicDistributionRow = {
  sourceGroup: 'tyt',
  subject: 'Matematik',
  topic: 'Sayı Kümeleri',
  physicalPage: 12,
  yearCounts: { 2018: 1, 2019: 1, 2020: 1, 2021: 1, 2022: 1, 2023: 1, 2024: 1, 2025: 1 },
  total: 8,
  rawCells: {
    2018: '1',
    2019: '1',
    2020: '1',
    2021: '1',
    2022: '1',
    2023: '1',
    2024: '1',
    2025: '1',
    TOPLAM: '8',
  },
};

test('candidate remains dry-run, excludes 2026, and reports blank printed cells as failures', () => {
  const failure: OgmTopicDistributionFailure = {
    sourceGroup: 'tyt',
    physicalPage: 306,
    tableIndex: 1,
    rowIndex: 1,
    reason:
      'OGM extraction failed closed: missing distribution cell for row 1 on physical page 306: found columns 0,1,2,3,4,5,6,8',
  };
  const candidate = buildOgmTopicCandidate([source], [row], [failure]);
  assert.deepEqual(candidate.coverage, { firstYear: 2018, lastYear: 2025, includes2026: false });
  assert.deepEqual(candidate.summary, { sources: 1, tables: 1, verifiedRows: 1, failedRows: 1 });
  assert.equal(candidate.publicationAllowed, false);
  assert.equal(candidate.knownInconsistencies.missingPrinted2025CellRows, 1);
  assert.doesNotMatch(JSON.stringify(candidate), /questionText|questionImage|\.pdf"\s*:/u);
});

function evidence(
  subject: 'Matematik' | 'Fizik',
  year: 2021 | 2025,
  officialQuestionCount: number,
): SubjectYearCompletenessEvidence {
  return {
    sourceGroup: 'tyt',
    subject,
    year,
    officialQuestionCount,
    mappedQuestionCount: officialQuestionCount,
    apiBookId: '68b4f30ceb079be0e77092c8',
    apiQuestionIdSetSha256: 'b'.repeat(64),
    apiPdfPageOffset: 3,
    mappingComplete: true,
    bijectiveSubjectMapping: true,
    duplicateQuestionCount: 0,
    alternativeAmbiguityCount: 0,
  };
}

const explicitZerosExcept = (missingYear: 2021 | 2025) =>
  Object.fromEntries(
    [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]
      .filter((year) => year !== missingYear)
      .map((year) => [year, 0]),
  );

test('dual proof fills only a zero supported by row residual and complete official subject-year count', () => {
  const physicsRow: OgmTopicDistributionRow = {
    ...row,
    subject: 'Fizik',
    topic: 'Verified Physics Topic',
    yearCounts: { ...row.yearCounts, 2025: 7 },
    total: 14,
  };
  const failures: OgmTopicDistributionFailure[] = [
    {
      sourceGroup: 'tyt',
      physicalPage: 200,
      tableIndex: 1,
      rowIndex: 1,
      reason: 'OGM extraction failed closed: missing distribution cell',
      subject: 'Matematik',
      topic: 'Dik Üçgen ve Trigonometri',
      explicitYearCounts: explicitZerosExcept(2021),
      missingYears: [2021],
      rowTotal: 0,
    },
    {
      sourceGroup: 'tyt',
      physicalPage: 306,
      tableIndex: 2,
      rowIndex: 1,
      reason: 'OGM extraction failed closed: missing distribution cell',
      subject: 'Fizik',
      topic: 'Fizik Biliminin Önemi',
      explicitYearCounts: explicitZerosExcept(2025),
      missingYears: [2025],
      rowTotal: 0,
    },
  ];
  const resolution = resolveBlankCellsWithDualProof(
    [
      { ...row, yearCounts: { ...row.yearCounts, 2021: 40 }, topic: 'Verified Math Topic' },
      physicsRow,
    ],
    failures,
    [evidence('Matematik', 2021, 40), evidence('Fizik', 2025, 7)],
  );
  assert.equal(resolution.resolvedRows, 2);
  assert.equal(resolution.failures.length, 0);
  assert.equal(resolution.rows.filter((candidate) => candidate.derivedZeros).length, 2);
  assert.match(
    JSON.stringify(resolution.rows),
    /official-row-residual-and-subject-year-completeness/u,
  );
  assert.doesNotMatch(JSON.stringify(resolution.rows), /rawCells/u);

  const incomplete = resolveBlankCellsWithDualProof(
    [{ ...row, yearCounts: { ...row.yearCounts, 2021: 40 }, topic: 'Verified Math Topic' }],
    [failures[0]!],
    [evidence('Matematik', 2021, 39)],
  );
  assert.equal(incomplete.resolvedRows, 0);
  assert.equal(incomplete.failures.length, 1);
});

test('official API question rectangles have one unique PDF page offset and year label', () => {
  const pages: BboxDocument['pages'] = Array.from({ length: 8 }, (_, index) => ({
    page: index + 1,
    width: 100,
    height: 100,
    words:
      index === 3
        ? [
            {
              page: 4,
              pageWidth: 100,
              pageHeight: 100,
              lineId: 1,
              xMin: 5,
              yMin: 5,
              xMax: 15,
              yMax: 15,
              text: '2021-TYT',
            },
            {
              page: 4,
              pageWidth: 100,
              pageHeight: 100,
              lineId: 2,
              xMin: 70,
              yMin: 70,
              xMax: 80,
              yMax: 80,
              text: '2025-TYT',
            },
          ]
        : [],
  }));
  const bundles: OfficialApiTestBundle[] = [
    {
      subject: 'Matematik',
      testId: 'math-test',
      alternativeAmbiguityCount: 0,
      questions: [
        {
          id: 'math-question',
          bookId: 'book',
          testId: 'math-test',
          questionNumber: 1,
          pageNumber: 1,
          left: 0,
          top: 0,
          width: 40,
          height: 40,
        },
      ],
    },
    {
      subject: 'Fizik',
      testId: 'physics-test',
      alternativeAmbiguityCount: 0,
      questions: [
        {
          id: 'physics-question',
          bookId: 'book',
          testId: 'physics-test',
          questionNumber: 1,
          pageNumber: 1,
          left: 60,
          top: 60,
          width: 40,
          height: 40,
        },
      ],
    },
  ];
  const mapped = mapOfficialApiQuestionsToPdfYears({ pages }, bundles);
  assert.equal(
    mapped.find((item) => item.subject === 'Matematik' && item.year === 2021)
      ?.officialQuestionCount,
    1,
  );
  assert.equal(
    mapped.find((item) => item.subject === 'Fizik' && item.year === 2025)?.officialQuestionCount,
    1,
  );
  assert.ok(mapped.every((item) => item.apiPdfPageOffset === 3));
  bundles[1]!.questions[0]!.id = 'math-question';
  assert.deepEqual(mapOfficialApiQuestionsToPdfYears({ pages }, bundles), []);
});

test('candidate output is restricted, atomic, and rejects a symlink escape', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ogm-output-test-'));
  const outside = await mkdtemp(join(tmpdir(), 'ogm-output-outside-'));
  try {
    const output = resolveSafeCandidateOutputPath(
      'tmp/ogm-topic-extraction/proof.candidate.json',
      cwd,
    );
    await atomicWriteCandidate(output, { safe: true }, cwd);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { safe: true });
    for (const forbidden of [
      'content/topics.json',
      'assets/pack/manifest.json',
      '.github/workflows/publish.json',
      'src/data/content.json',
      'scripts/generated.json',
    ]) {
      assert.throws(() => resolveSafeCandidateOutputPath(forbidden, cwd), /direct JSON child/u);
    }
    assert.throws(
      () => resolveSafeCandidateOutputPath('tmp/ogm-topic-extraction/nested/proof.json', cwd),
      /direct JSON child/u,
    );

    await rm(join(cwd, 'tmp'), { recursive: true, force: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(cwd, 'tmp'));
    await assert.rejects(
      atomicWriteCandidate(
        resolveSafeCandidateOutputPath('tmp/ogm-topic-extraction/escape.json', cwd),
        { unsafe: true },
        cwd,
      ),
      /symlink/u,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
