import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  firstTopicId,
  makeCanonicalReview,
  type TopicCatalog,
} from './helpers/topic-review-fixtures.ts';
import { osymBookletRegistrySchema } from '../lib/osym-booklet-registry.ts';
import {
  primaryTopicReviewSchema,
  validatePrimaryTopicReview,
} from '../lib/topic-primary-review.ts';

type JsonRecord = Record<string, unknown>;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8')) as unknown;
}

async function inputs() {
  return {
    review: await readJson('content/topic-annotations/reviews/2026-tyt-turkce.primary.json'),
    bookletRegistry: await readJson('content/osym-booklets.json'),
    topicCatalog: await readJson('content/topics.json'),
    currentDate: '2026-07-14',
  };
}

function records(review: unknown): JsonRecord[] {
  return (review as JsonRecord).records as JsonRecord[];
}

test('the legacy 2026 Turkish review deterministically migrates without losing classifications', async () => {
  const review = validatePrimaryTopicReview(await inputs());
  assert.equal(review.schemaVersion, 2);
  assert.deepEqual(review.questionRange, { first: 1, last: 40 });
  assert.equal(review.answerSetId, 'default');
  assert.deepEqual(
    review.records.map((record) => record.officialQuestionNo),
    Array.from({ length: 40 }, (_, index) => index + 1),
  );
  assert.ok(review.records.every((record) => record.primaryTopicRef?.countsTowardStats));
  assert.ok(review.records.every((record) => record.relatedTopicRefs.length === 0));
  assert.equal(review.reviewer, 'codex-primary-a');
});

test('positive-offset official ranges pass and equal-length wrong ranges fail closed', async () => {
  const input = await inputs();
  const registry = osymBookletRegistrySchema.parse(input.bookletRegistry);
  const review = makeCanonicalReview({
    registry,
    catalog: input.topicCatalog as Parameters<typeof makeCanonicalReview>[0]['catalog'],
    exam: 'tyt',
    blockId: 'tyt-sosyal-cografya-default',
    reviewer: 'offset-primary',
  });
  const valid = validatePrimaryTopicReview({ ...input, review });
  assert.deepEqual(valid.questionRange, { first: 6, last: 10 });
  assert.deepEqual(
    valid.records.map((record) => record.officialQuestionNo),
    [6, 7, 8, 9, 10],
  );

  const wrong = structuredClone(review);
  wrong.questionRange = { first: 7, last: 11 };
  wrong.records.forEach((record) => {
    record.officialQuestionNo += 1;
  });
  assert.throws(
    () => validatePrimaryTopicReview({ ...input, review: wrong }),
    /expected exactly one official TYT question block/,
  );
});

test('duplicate official numbers and unknown primary topics fail closed', async () => {
  const input = await inputs();
  const duplicate = structuredClone(input.review);
  records(duplicate)[1]!.questionNo = 1;
  assert.throws(
    () => validatePrimaryTopicReview({ ...input, review: duplicate }),
    /legacy review cannot be migrated|duplicate official question/,
  );

  const invalidTopic = structuredClone(input.review);
  records(invalidTopic)[0]!.topicId = 'not-a-turkish-topic';
  assert.throws(
    () => validatePrimaryTopicReview({ ...input, review: invalidTopic }),
    /primary topic .*must exist exactly once/,
  );
});

test('the canonical primary schema remains strict and copyright-free', async () => {
  const canonical = validatePrimaryTopicReview(await inputs()) as unknown as JsonRecord;
  const canonicalRecords = canonical.records as JsonRecord[];
  canonicalRecords[0]!.questionText = 'forbidden fixture field';
  canonicalRecords[1]!.difficulty = 'unknown';
  const result = primaryTopicReviewSchema.safeParse(canonical);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error.message, /questionText/);
    assert.match(result.error.message, /difficulty/);
  }
});

test('review-v2 draft shorthand normalizes deterministically and rejects ambiguous scope', async () => {
  const input = await inputs();
  const registry = osymBookletRegistrySchema.parse(input.bookletRegistry);
  const catalog = input.topicCatalog as TopicCatalog;
  const review = makeCanonicalReview({
    registry,
    catalog,
    exam: 'tyt',
    blockId: 'tyt-sosyal-cografya-default',
    reviewer: 'draft-primary',
  });
  const draft = structuredClone(review) as unknown as JsonRecord;
  const first = (draft.records as JsonRecord[])[0]!;
  delete (first.primaryTopicRef as JsonRecord).countsTowardStats;
  first.relatedTopicRefs = [
    {
      subjectId: 'tyt-cografya',
      topicId: catalog.exams
        .find((exam) => exam.id === 'tyt')!
        .sections.find((section) => section.id === 'tyt-sosyal')!
        .subjects.find((subject) => subject.id === 'tyt-cografya')!.topics[1]!.id,
    },
  ];

  const normalized = validatePrimaryTopicReview({ ...input, review: draft });
  assert.equal(normalized.records[0]!.primaryTopicRef?.countsTowardStats, true);
  assert.deepEqual(normalized.records[0]!.relatedTopicRefs, [
    {
      exam: 'tyt',
      sectionId: 'tyt-sosyal',
      subjectId: 'tyt-cografya',
      topicId: catalog.exams
        .find((exam) => exam.id === 'tyt')!
        .sections.find((section) => section.id === 'tyt-sosyal')!
        .subjects.find((subject) => subject.id === 'tyt-cografya')!.topics[1]!.id,
      crossExam: false,
      countsTowardStats: false,
    },
  ]);

  const ambiguous = structuredClone(draft);
  ((ambiguous.records as JsonRecord[])[0] as JsonRecord).relatedTopicRefs = [
    {
      exam: 'ayt',
      subjectId: 'ayt-matematik',
      topicId: firstTopicId(catalog, 'ayt', 'ayt-matematik', 'ayt-matematik'),
    },
  ];
  assert.throws(
    () => validatePrimaryTopicReview({ ...input, review: ambiguous }),
    /ambiguous cross-taxonomy scope/,
  );

  const contradictoryPrimary = structuredClone(draft);
  (
    ((contradictoryPrimary.records as JsonRecord[])[0] as JsonRecord).primaryTopicRef as JsonRecord
  ).countsTowardStats = false;
  assert.throws(
    () => validatePrimaryTopicReview({ ...input, review: contradictoryPrimary }),
    /primaryTopicRef countsTowardStats must be true/,
  );

  const contradictoryRelated = structuredClone(draft);
  (
    (
      ((contradictoryRelated.records as JsonRecord[])[0] as JsonRecord)
        .relatedTopicRefs as JsonRecord[]
    )[0] as JsonRecord
  ).countsTowardStats = true;
  assert.throws(
    () => validatePrimaryTopicReview({ ...input, review: contradictoryRelated }),
    /related ref 0 countsTowardStats must be false/,
  );
});

test('related topics are limited to explicit discipline families and never count', async () => {
  const input = await inputs();
  const registry = osymBookletRegistrySchema.parse(input.bookletRegistry);
  const catalog = input.topicCatalog as TopicCatalog;
  const felsefeToScience = makeCanonicalReview({
    registry,
    catalog,
    exam: 'tyt',
    blockId: 'tyt-sosyal-felsefe-default',
    reviewer: 'family-primary',
    relatedForQuestion: (_questionNo, index) =>
      index === 0
        ? [
            {
              exam: 'ayt',
              sectionId: 'ayt-fen',
              subjectId: 'ayt-kimya',
              topicId: firstTopicId(catalog, 'ayt', 'ayt-fen', 'ayt-kimya'),
              crossExam: true,
              countsTowardStats: false,
            },
            {
              exam: 'ayt',
              sectionId: 'ayt-fen',
              subjectId: 'ayt-biyoloji',
              topicId: firstTopicId(catalog, 'ayt', 'ayt-fen', 'ayt-biyoloji'),
              crossExam: true,
              countsTowardStats: false,
            },
          ]
        : [],
  });
  assert.throws(
    () => validatePrimaryTopicReview({ ...input, review: felsefeToScience }),
    /outside the explicit discipline family/,
  );

  const chemistryPair = makeCanonicalReview({
    registry,
    catalog,
    exam: 'tyt',
    blockId: 'tyt-fen-kimya-default',
    reviewer: 'family-primary',
    relatedForQuestion: (_questionNo, index) =>
      index === 0
        ? [
            {
              exam: 'ayt',
              sectionId: 'ayt-fen',
              subjectId: 'ayt-kimya',
              topicId: firstTopicId(catalog, 'ayt', 'ayt-fen', 'ayt-kimya'),
              crossExam: true,
              countsTowardStats: false,
            },
          ]
        : [],
  });
  const validated = validatePrimaryTopicReview({ ...input, review: chemistryPair });
  assert.equal(validated.records[0]!.relatedTopicRefs[0]!.subjectId, 'ayt-kimya');
  assert.equal(validated.records[0]!.relatedTopicRefs[0]!.countsTowardStats, false);
});
