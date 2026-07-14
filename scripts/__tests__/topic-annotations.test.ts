import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { makeCanonicalReview, type TopicCatalog } from './helpers/topic-review-fixtures.ts';
import { compareTopicReviews } from '../lib/compare-topic-reviews.ts';
import {
  buildTopicStatisticsReport,
  topicAnnotationBatchSchema,
} from '../lib/topic-annotations.ts';
import { osymBookletRegistrySchema } from '../lib/osym-booklet-registry.ts';

type JsonRecord = Record<string, unknown>;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8')) as unknown;
}

async function base() {
  const bookletRegistry = await readJson('content/osym-booklets.json');
  const topicCatalog = (await readJson('content/topics.json')) as TopicCatalog;
  return {
    bookletRegistry,
    registry: osymBookletRegistrySchema.parse(bookletRegistry),
    topicCatalog,
    generatedAt: '2026-07-14T20:30:00.000Z',
  };
}

async function agreedBatch(blockId = 'tyt-sosyal-cografya-default') {
  const input = await base();
  const primaryReview = makeCanonicalReview({
    registry: input.registry,
    catalog: input.topicCatalog,
    exam: 'tyt',
    blockId,
    reviewer: 'fixture-primary',
  });
  const secondaryReview = makeCanonicalReview({
    registry: input.registry,
    catalog: input.topicCatalog,
    exam: 'tyt',
    blockId,
    reviewer: 'fixture-secondary',
  });
  const comparison = compareTopicReviews({
    primaryReview,
    secondaryReview,
    bookletRegistry: input.registry,
    topicCatalog: input.topicCatalog,
    waveId: `fixture-${blockId}`,
    currentDate: '2026-07-14',
  });
  return { ...input, annotationBatch: comparison.batch };
}

function records(batch: unknown): JsonRecord[] {
  return (batch as JsonRecord).annotations as JsonRecord[];
}

test('a complete positive-offset block produces exact primary-only dry-run patches', async () => {
  const input = await agreedBatch();
  const report = buildTopicStatisticsReport(input);
  assert.deepEqual(report.scope.questionRange, { first: 6, last: 10 });
  assert.deepEqual(report.coverage.subjectQuestionCounts, [
    { subjectId: 'tyt-cografya', count: 5 },
  ]);
  assert.equal(report.aggregation.canonicalQuestionCountContribution, 5);
  assert.equal(
    report.topicStatPatches.reduce((sum, patch) => sum + patch.count, 0),
    5,
  );
  assert.deepEqual(report.relatedQuestionMappings, []);
  assert.equal(JSON.stringify(report).includes('questionText'), false);
});

test('duplicate, missing, disputed, and out-of-range annotations fail closed', async () => {
  const input = await agreedBatch();
  const duplicate = structuredClone(input.annotationBatch);
  records(duplicate).push(structuredClone(records(duplicate)[0]!));
  assert.throws(
    () => buildTopicStatisticsReport({ ...input, annotationBatch: duplicate }),
    /duplicate official question number 6/,
  );

  const missing = structuredClone(input.annotationBatch);
  records(missing).pop();
  assert.throws(
    () => buildTopicStatisticsReport({ ...input, annotationBatch: missing }),
    /missing official question number 10/,
  );

  const disputed = structuredClone(input.annotationBatch);
  const disputedRecord = records(disputed)[0]!;
  disputedRecord.primaryTopicRef = null;
  disputedRecord.consensusStatus = 'disputed';
  const secondary = disputedRecord.secondaryClassification as JsonRecord;
  secondary.primaryTopicRef = null;
  assert.throws(
    () => buildTopicStatisticsReport({ ...input, annotationBatch: disputed }),
    /question 6 has no publishable editorial consensus/,
  );

  const outside = structuredClone(input.annotationBatch);
  records(outside)[0]!.officialQuestionNo = 5;
  assert.throws(
    () => buildTopicStatisticsReport({ ...input, annotationBatch: outside }),
    /outside declared range 6-10/,
  );
});

test('unknown primary topics and mismatched booklet hashes fail closed', async () => {
  const input = await agreedBatch();
  const invalidTopic = structuredClone(input.annotationBatch);
  const record = records(invalidTopic)[0]!;
  const ref = record.primaryTopicRef as JsonRecord;
  ref.topicId = 'topic-not-in-catalog';
  for (const classificationKey of ['primaryClassification', 'secondaryClassification']) {
    const classification = record[classificationKey] as JsonRecord;
    (classification.primaryTopicRef as JsonRecord).topicId = 'topic-not-in-catalog';
  }
  assert.throws(
    () => buildTopicStatisticsReport({ ...input, annotationBatch: invalidTopic }),
    /unknown primary topic/,
  );

  const wrongHash = structuredClone(input.annotationBatch);
  records(wrongHash)[0]!.bookletSha256 = 'f'.repeat(64);
  assert.throws(
    () => buildTopicStatisticsReport({ ...input, annotationBatch: wrongHash }),
    /booklet hash does not match the registry/,
  );
});

test('alternative no-DKAB blocks are evidence-only and cannot double-count canonical stats', async () => {
  const canonical = await agreedBatch('tyt-sosyal-din-default');
  const alternative = await agreedBatch('tyt-sosyal-felsefe-no-dkab');
  const canonicalReport = buildTopicStatisticsReport(canonical);
  const alternativeReport = buildTopicStatisticsReport(alternative);

  assert.deepEqual(canonicalReport.aggregation, {
    answerSetId: 'default',
    countsTowardDefaultStats: true,
    evidenceOnly: false,
    alternativeForSubjectId: null,
    canonicalQuestionCountContribution: 5,
  });
  assert.deepEqual(alternativeReport.aggregation, {
    answerSetId: 'no-dkab',
    countsTowardDefaultStats: false,
    evidenceOnly: true,
    alternativeForSubjectId: 'tyt-din-kulturu',
    canonicalQuestionCountContribution: 0,
  });
  assert.equal(alternativeReport.questionMappings.length, 5);
  assert.deepEqual(alternativeReport.topicStatPatches, []);
  assert.equal(
    canonicalReport.aggregation.canonicalQuestionCountContribution +
      alternativeReport.aggregation.canonicalQuestionCountContribution,
    5,
  );
});

test('the strict annotation contract rejects copyrighted and derived fields', async () => {
  const input = await agreedBatch();
  for (const field of ['questionText', 'answerChoice', 'difficulty', 'summary']) {
    const invalid = structuredClone(input.annotationBatch);
    records(invalid)[0]![field] = 'forbidden';
    assert.equal(topicAnnotationBatchSchema.safeParse(invalid).success, false, field);
  }
});
