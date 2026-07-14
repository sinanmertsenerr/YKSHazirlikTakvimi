import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  firstTopicId,
  makeCanonicalReview,
  type TopicCatalog,
} from './helpers/topic-review-fixtures.ts';
import { buildTopicStatisticsFromFiles } from '../build-topic-statistics.ts';
import { compareTopicReviews } from '../lib/compare-topic-reviews.ts';
import {
  blindTopicAdjudicationSchema,
  evaluateThreeReviewerConsensus,
  validateBlindTopicAdjudication,
} from '../lib/topic-adjudication.ts';
import {
  buildTopicStatisticsReport,
  topicAnnotationBatchSchema,
} from '../lib/topic-annotations.ts';
import { osymBookletRegistrySchema } from '../lib/osym-booklet-registry.ts';

type JsonRecord = Record<string, unknown>;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8')) as unknown;
}

async function inputs() {
  return {
    primaryReview: await readJson('content/topic-annotations/reviews/2026-tyt-turkce.primary.json'),
    secondaryReview: await readJson(
      'content/topic-annotations/reviews/2026-tyt-turkce.secondary.json',
    ),
    bookletRegistry: await readJson('content/osym-booklets.json'),
    topicCatalog: await readJson('content/topics.json'),
    waveId: '2026-tyt-turkce',
    currentDate: '2026-07-14',
  };
}

function legacyQuestion(review: unknown, questionNo: number): JsonRecord {
  const records = (review as JsonRecord).records as JsonRecord[];
  const record = records.find((candidate) => candidate.questionNo === questionNo);
  assert.ok(record, `missing test question ${questionNo}`);
  return record;
}

test('neutral comparison preserves the checked-in 39/40 Turkish v2 consensus', async () => {
  const comparison = compareTopicReviews(await inputs());
  const checkedIn = topicAnnotationBatchSchema.parse(
    await readJson('content/topic-annotations/2026-tyt-turkce.json'),
  );
  assert.deepEqual(comparison.summary, {
    totalQuestionCount: 40,
    agreedQuestionCount: 39,
    disputedQuestionCount: 1,
    agreementRate: 0.975,
    disputedQuestionNumbers: [20],
  });
  assert.deepEqual(comparison.batch, checkedIn);
  assert.deepEqual(comparison.batch.scope, {
    year: 2026,
    exam: 'tyt',
    sectionId: 'tyt-turkce',
    bookletSectionId: 'turkce',
    questionBlockId: 'tyt-turkce-default',
    subjectIds: ['tyt-turkce'],
    questionRange: { first: 1, last: 40 },
    answerSetId: 'default',
    alternativeForSubjectId: null,
    countsTowardDefaultStats: true,
  });
  const disputed = comparison.batch.annotations.find(
    (annotation) => annotation.officialQuestionNo === 20,
  )!;
  assert.equal(disputed.consensusStatus, 'disputed');
  assert.equal(disputed.primaryTopicRef, null);
  assert.equal(disputed.primaryClassification.primaryTopicRef?.topicId, 'paragraf-yapi');
  assert.equal(
    disputed.secondaryClassification.primaryTopicRef?.topicId,
    'paragraf-anlatim-teknikleri',
  );
});

test('the disputed real wave fails closed and never writes a report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yks-topic-comparison-'));
  const outputPath = join(directory, 'must-not-exist.json');
  try {
    await assert.rejects(
      buildTopicStatisticsFromFiles({
        annotationsPath: resolve(process.cwd(), 'content/topic-annotations/2026-tyt-turkce.json'),
        outputPath,
        generatedAt: '2026-07-14T20:30:00.000Z',
      }),
      /question 20 has no publishable editorial consensus/,
    );
    await assert.rejects(access(outputPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a mixed TYT math wave derives its real subject split without a 31/9 gate', async () => {
  const input = await inputs();
  const registry = osymBookletRegistrySchema.parse(input.bookletRegistry);
  const catalog = input.topicCatalog as TopicCatalog;
  const subjectForQuestion = (_questionNo: number, index: number) =>
    index < 20 ? 'tyt-matematik' : 'tyt-geometri';
  const related = {
    exam: 'ayt' as const,
    sectionId: 'ayt-matematik',
    subjectId: 'ayt-matematik',
    topicId: firstTopicId(catalog, 'ayt', 'ayt-matematik', 'ayt-matematik'),
    crossExam: true,
    countsTowardStats: false as const,
  };
  const primaryReview = makeCanonicalReview({
    registry,
    catalog,
    exam: 'tyt',
    blockId: 'tyt-temel-matematik-default',
    reviewer: 'math-primary',
    subjectForQuestion,
    relatedForQuestion: (_questionNo, index) => (index === 0 ? [related] : []),
  });
  const secondaryReview = makeCanonicalReview({
    registry,
    catalog,
    exam: 'tyt',
    blockId: 'tyt-temel-matematik-default',
    reviewer: 'math-secondary',
    subjectForQuestion,
    relatedForQuestion: (_questionNo, index) => (index === 0 ? [related] : []),
  });
  const comparison = compareTopicReviews({
    ...input,
    primaryReview,
    secondaryReview,
    waveId: 'mixed-tyt-math',
  });
  assert.equal(comparison.summary.agreedQuestionCount, 40);

  const report = buildTopicStatisticsReport({
    annotationBatch: comparison.batch,
    bookletRegistry: registry,
    topicCatalog: catalog,
    generatedAt: '2026-07-14T20:30:00.000Z',
  });
  assert.deepEqual(report.coverage.subjectQuestionCounts, [
    { subjectId: 'tyt-matematik', count: 20 },
    { subjectId: 'tyt-geometri', count: 20 },
  ]);
  assert.equal(
    report.topicStatPatches.reduce((sum, patch) => sum + patch.count, 0),
    40,
  );
  assert.equal(report.relatedQuestionMappings.length, 1);
  assert.equal(
    report.relatedQuestionMappings.flatMap((mapping) => mapping.relatedTopicRefs).length,
    1,
  );
});

test('invalid cross-subject primary refs fail while related union/intersection stays explicit', async () => {
  const input = await inputs();
  const registry = osymBookletRegistrySchema.parse(input.bookletRegistry);
  const catalog = input.topicCatalog as TopicCatalog;
  const primaryReview = makeCanonicalReview({
    registry,
    catalog,
    exam: 'tyt',
    blockId: 'tyt-temel-matematik-default',
    reviewer: 'related-primary',
  });
  const secondaryReview = structuredClone(primaryReview);
  secondaryReview.reviewer = 'related-secondary';
  const mathTopic = primaryReview.records[0]!.primaryTopicRef!.topicId;
  primaryReview.records[0]!.primaryTopicRef = {
    subjectId: 'tyt-geometri',
    topicId: mathTopic,
    countsTowardStats: true,
  };
  assert.throws(
    () =>
      compareTopicReviews({
        ...input,
        primaryReview,
        secondaryReview,
        waveId: 'invalid-cross-subject',
      }),
    /primary topic .*must exist exactly once/,
  );

  primaryReview.records[0]!.primaryTopicRef = secondaryReview.records[0]!.primaryTopicRef;
  const related = {
    exam: 'tyt' as const,
    sectionId: 'tyt-matematik',
    subjectId: 'tyt-geometri',
    topicId: firstTopicId(catalog, 'tyt', 'tyt-matematik', 'tyt-geometri'),
    crossExam: false,
    countsTowardStats: false as const,
  };
  primaryReview.records[0]!.relatedTopicRefs = [related];
  const intersection = compareTopicReviews({
    ...input,
    primaryReview,
    secondaryReview,
    waveId: 'related-intersection',
    relatedConsensusPolicy: 'intersection',
  });
  const union = compareTopicReviews({
    ...input,
    primaryReview,
    secondaryReview,
    waveId: 'related-union',
    relatedConsensusPolicy: 'union',
  });
  assert.deepEqual(intersection.batch.annotations[0]!.relatedTopicRefs, []);
  assert.deepEqual(union.batch.annotations[0]!.relatedTopicRefs, [related]);
});

test('null primary remains disputed and scope/hash/reviewer mismatches fail', async () => {
  const input = await inputs();
  const primaryQuestion = legacyQuestion(input.primaryReview, 20);
  primaryQuestion.topicId = null;
  primaryQuestion.status = 'needs-review';
  const comparison = compareTopicReviews(input);
  assert.equal(comparison.batch.annotations[19]!.consensusStatus, 'disputed');

  const hashMismatch = await inputs();
  (hashMismatch.secondaryReview as JsonRecord).bookletSha256 = 'f'.repeat(64);
  assert.throws(() => compareTopicReviews(hashMismatch), /SHA-256 does not match the registry/);

  const sameReviewer = await inputs();
  (sameReviewer.secondaryReview as JsonRecord).reviewer = (
    sameReviewer.primaryReview as JsonRecord
  ).reviewer;
  assert.throws(() => compareTopicReviews(sameReviewer), /reviewer identities must be independent/);
});

test('the blind third review remains valid without changing the disputed consensus', async () => {
  const input = await inputs();
  const adjudicationRaw = await readJson(
    'content/topic-annotations/reviews/2026-tyt-turkce.q20.adjudication.json',
  );
  const adjudication = validateBlindTopicAdjudication({
    adjudication: adjudicationRaw,
    bookletRegistry: input.bookletRegistry,
    topicCatalog: input.topicCatalog,
    currentDate: '2026-07-14',
  });
  const result = evaluateThreeReviewerConsensus({
    annotationBatch: await readJson('content/topic-annotations/2026-tyt-turkce.json'),
    adjudication,
  });
  assert.equal(result.hasMajority, false);
  assert.equal(result.majorityTopicId, null);
  const forbidden = { ...(adjudicationRaw as JsonRecord), questionText: 'forbidden' };
  assert.equal(blindTopicAdjudicationSchema.safeParse(forbidden).success, false);
});

test('both staging draft envelopes normalize against exact registry blocks without guessing', async () => {
  const input = await inputs();
  const directory = resolve(process.cwd(), 'content/topic-annotations/reviews-v2-draft');
  const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  assert.equal(files.length, 14);

  let comparedQuestionCount = 0;
  for (const primaryName of files.filter((name) => name.endsWith('.primary.json'))) {
    const stem = primaryName.slice(0, -'.primary.json'.length);
    const primaryReview = await readJson(
      `content/topic-annotations/reviews-v2-draft/${primaryName}`,
    );
    const secondaryReview = await readJson(
      `content/topic-annotations/reviews-v2-draft/${stem}.secondary.json`,
    );
    const comparison = compareTopicReviews({
      ...input,
      primaryReview,
      secondaryReview,
      waveId: stem,
    });
    comparedQuestionCount += comparison.summary.totalQuestionCount;
    assert.equal(
      comparison.batch.annotations[0]!.officialQuestionNo,
      comparison.batch.scope.questionRange.first,
    );
    assert.equal(
      comparison.batch.annotations.at(-1)!.officialQuestionNo,
      comparison.batch.scope.questionRange.last,
    );
  }
  assert.equal(comparedQuestionCount, 73);
});
