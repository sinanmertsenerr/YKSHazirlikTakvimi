import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  ANNUAL_CLASSIFIER_PROMPT_VERSION,
  ANNUAL_CLASSIFIER_SCHEMA_VERSION,
  ANNUAL_CLASSIFIER_TEXT_MODEL,
  ANNUAL_CLASSIFIER_VISION_MODEL,
  annualClassifierReportSchema,
} from '../lib/annual-classifier-contract.ts';
import { extendTopicCoverage, topicsSchema } from '../lib/content-schemas.ts';
import { topicAnnotationBatchSchema } from '../lib/topic-annotations.ts';
import {
  TOPIC_REVIEW_SCHEMA_VERSION,
  canonicalTopicReviewSchema,
} from '../lib/topic-review-contract.ts';
import { parseAnnualClassifierArtifactFileName } from '../validate-annual-classifier-artifacts.ts';

const HASH = 'a'.repeat(64);
const NEEDS_REVIEW = {
  officialQuestionNo: 1,
  primaryTopicRef: null,
  relatedTopicRefs: [],
  status: 'needs-review' as const,
};

test('topic pack coverage can extend contiguously through 2027 without changing existing rows', async () => {
  const topics = JSON.parse(
    await readFile(path.resolve(process.cwd(), 'content/topics.json'), 'utf8'),
  ) as Record<string, unknown>;
  const parsed = extendTopicCoverage(topics, 2027);
  assert.ok(
    parsed.exams.every((exam) =>
      exam.sections.every((section) =>
        section.subjects.every((subject) =>
          subject.topics.every((topic) => topic.yearlyStats.at(-1)?.year === 2027),
        ),
      ),
    ),
  );

  assert.throws(() => extendTopicCoverage(parsed, 2029), /only extend by one contiguous year/);

  const beyondLimit = structuredClone(parsed);
  beyondLimit.exams[0]!.sections[0]!.subjects[0]!.topics[0]!.yearlyStats.at(-1)!.year = 2101;
  assert.equal(topicsSchema.safeParse(beyondLimit).success, false);
});

test('review, annotation, report, and artifact contracts accept 2027 and reject 2101', () => {
  const review = {
    schemaVersion: TOPIC_REVIEW_SCHEMA_VERSION,
    year: 2027,
    exam: 'tyt',
    sectionId: 'tyt-turkce',
    bookletSectionId: 'turkce',
    questionRange: { first: 1, last: 1 },
    answerSetId: 'default',
    bookletId: '2027-tyt',
    bookletSha256: HASH,
    reviewer: 'reviewer.one',
    reviewedAt: '2027-06-20',
    records: [NEEDS_REVIEW],
  };
  assert.equal(canonicalTopicReviewSchema.safeParse(review).success, true);
  assert.equal(
    canonicalTopicReviewSchema.safeParse({ ...review, year: 2101, bookletId: '2101-tyt' }).success,
    false,
  );

  const classification = {
    primaryTopicRef: null,
    relatedTopicRefs: [],
    reviewer: 'reviewer.one',
    reviewedAt: '2027-06-20',
  };
  const annotation = {
    year: 2027,
    exam: 'tyt',
    sectionId: 'tyt-turkce',
    bookletSectionId: 'turkce',
    questionBlockId: 'tyt-turkce-default',
    answerSetId: 'default',
    officialQuestionNo: 1,
    bookletRegistryId: '2027-tyt',
    bookletSource: 'https://dokuman.osym.gov.tr/pdfdokuman/2027/YKS/TSK/yks_tyt_2027_kitapcik.pdf',
    bookletSha256: HASH,
    primaryClassification: classification,
    secondaryClassification: { ...classification, reviewer: 'reviewer.two' },
    relatedTopicRefs: [],
    reviewedAt: '2027-06-20',
    primaryTopicRef: null,
    consensusStatus: 'disputed',
  };
  const batch = {
    schemaVersion: 2,
    waveId: '2027-tyt-turkce',
    verificationMethod: 'editorial-consensus',
    relatedConsensusPolicy: 'intersection',
    scope: {
      year: 2027,
      exam: 'tyt',
      sectionId: 'tyt-turkce',
      bookletSectionId: 'turkce',
      questionBlockId: 'tyt-turkce-default',
      subjectIds: ['tyt-turkce'],
      questionRange: { first: 1, last: 1 },
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    annotations: [annotation],
  };
  assert.equal(topicAnnotationBatchSchema.safeParse(batch).success, true);
  assert.equal(
    topicAnnotationBatchSchema.safeParse({
      ...batch,
      scope: { ...batch.scope, year: 2101 },
      annotations: [{ ...annotation, year: 2101, bookletRegistryId: '2101-tyt' }],
    }).success,
    false,
  );

  const report = {
    schemaVersion: ANNUAL_CLASSIFIER_SCHEMA_VERSION,
    kind: 'annual-topic-classification-dry-run',
    dryRun: true,
    scope: {
      year: 2027,
      exam: 'tyt',
      questionBlockId: 'tyt-turkce-default',
      sectionId: 'tyt-turkce',
      bookletSectionId: 'turkce',
      questionRange: { first: 1, last: 1 },
    },
    provenance: {
      bookletId: '2027-tyt',
      bookletSha256: HASH,
      taxonomySha256: 'b'.repeat(64),
      promptVersion: ANNUAL_CLASSIFIER_PROMPT_VERSION,
      textModel: ANNUAL_CLASSIFIER_TEXT_MODEL,
      visionModel: ANNUAL_CLASSIFIER_VISION_MODEL,
    },
    execution: {
      textProviderCalls: 0,
      textCacheHits: 1,
      textRetryUsed: false,
      visionProviderCalls: 0,
      visionCacheHits: 1,
      visionRetryUsed: false,
    },
    questions: [
      {
        officialQuestionNo: 1,
        text: { ...NEEDS_REVIEW, confidence: 0 },
        vision: { ...NEEDS_REVIEW, confidence: 0 },
        consensus: 'needs-review',
        consensusConfidence: 0,
      },
    ],
    summary: { total: 1, agreed: 0, needsReview: 1, disputed: 0 },
    publication: { automatic: false, reason: 'human-adjudication-required' },
  };
  assert.equal(annualClassifierReportSchema.safeParse(report).success, true);
  assert.equal(
    annualClassifierReportSchema.safeParse({
      ...report,
      scope: { ...report.scope, year: 2101 },
      provenance: { ...report.provenance, bookletId: '2101-tyt' },
    }).success,
    false,
  );

  assert.deepEqual(parseAnnualClassifierArtifactFileName('2027-tyt-turkce.report.json'), {
    group: '2027-tyt-turkce',
    kind: 'report',
    year: 2027,
  });
  assert.throws(
    () => parseAnnualClassifierArtifactFileName('2101-tyt-turkce.report.json'),
    /2018 through 2100/,
  );
});
