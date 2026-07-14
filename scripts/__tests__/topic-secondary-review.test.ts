import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  DEFAULT_SECONDARY_REVIEWER,
  secondaryTopicReviewSchema,
  validateSecondaryTopicReview,
} from '../lib/topic-secondary-review.ts';

type JsonRecord = Record<string, unknown>;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8')) as unknown;
}

async function inputs() {
  return {
    review: await readJson('content/topic-annotations/reviews/2026-tyt-turkce.secondary.json'),
    bookletRegistry: await readJson('content/osym-booklets.json'),
    topicCatalog: await readJson('content/topics.json'),
    currentDate: '2026-07-14',
    expectedReviewer: DEFAULT_SECONDARY_REVIEWER,
  };
}

function records(review: unknown): JsonRecord[] {
  return (review as JsonRecord).records as JsonRecord[];
}

test('the legacy secondary review migrates to strict official numbering', async () => {
  const review = validateSecondaryTopicReview(await inputs());
  assert.equal(review.schemaVersion, 2);
  assert.equal(review.records.length, 40);
  assert.deepEqual(
    review.records.map((record) => record.officialQuestionNo),
    Array.from({ length: 40 }, (_, index) => index + 1),
  );
  assert.ok(review.records.every((record) => record.primaryTopicRef?.countsTowardStats));
  assert.ok(review.records.every((record) => record.relatedTopicRefs.length === 0));
  assert.equal(review.reviewer, DEFAULT_SECONDARY_REVIEWER);
});

test('duplicate and missing official numbers fail closed during migration', async () => {
  const input = await inputs();
  const duplicate = structuredClone(input.review);
  records(duplicate)[1]!.questionNo = 1;
  assert.throws(
    () => validateSecondaryTopicReview({ ...input, review: duplicate }),
    /cannot be migrated without guessing/,
  );

  const incomplete = structuredClone(input.review);
  records(incomplete).pop();
  assert.throws(
    () => validateSecondaryTopicReview({ ...input, review: incomplete }),
    /cannot be migrated without guessing/,
  );
});

test('unknown primary topics, wrong hashes, and reviewer identities fail closed', async () => {
  const input = await inputs();
  const invalidTopic = structuredClone(input.review);
  records(invalidTopic)[0]!.topicId = 'not-a-turkish-topic';
  assert.throws(
    () => validateSecondaryTopicReview({ ...input, review: invalidTopic }),
    /primary topic .*must exist exactly once/,
  );

  const wrongHash = structuredClone(input.review) as JsonRecord;
  wrongHash.bookletSha256 = 'a'.repeat(64);
  assert.throws(
    () => validateSecondaryTopicReview({ ...input, review: wrongHash }),
    /booklet SHA-256 does not match the registry/,
  );

  const wrongReviewer = structuredClone(input.review) as JsonRecord;
  wrongReviewer.reviewer = 'another-reviewer';
  assert.throws(
    () => validateSecondaryTopicReview({ ...input, review: wrongReviewer }),
    /reviewer must be codex-secondary-b/,
  );
});

test('needs-review is explicit and cannot carry related discovery refs', async () => {
  const input = await inputs();
  const pending = validateSecondaryTopicReview(input);
  pending.records[0] = {
    officialQuestionNo: 1,
    primaryTopicRef: null,
    relatedTopicRefs: [],
    status: 'needs-review',
  };
  assert.equal(
    validateSecondaryTopicReview({ ...input, review: pending }).records[0]!.primaryTopicRef,
    null,
  );

  const invalid = structuredClone(pending) as unknown as JsonRecord;
  const first = (invalid.records as JsonRecord[])[0]!;
  first.relatedTopicRefs = [
    {
      exam: 'tyt',
      sectionId: 'tyt-turkce',
      subjectId: 'tyt-turkce',
      topicId: 'sozcukte-anlam',
      crossExam: false,
      countsTowardStats: false,
    },
  ];
  assert.equal(secondaryTopicReviewSchema.safeParse(invalid).success, false);
});

test('the strict secondary format rejects copyrighted and derived fields', async () => {
  const canonical = validateSecondaryTopicReview(await inputs()) as unknown as JsonRecord;
  for (const field of ['questionText', 'quote', 'options', 'difficulty', 'kazanim']) {
    const invalid = structuredClone(canonical);
    ((invalid.records as JsonRecord[])[0] as JsonRecord)[field] = 'forbidden';
    assert.equal(secondaryTopicReviewSchema.safeParse(invalid).success, false, field);
  }
});
