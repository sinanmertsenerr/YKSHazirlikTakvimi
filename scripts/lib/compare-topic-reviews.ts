import { z } from 'zod';

import {
  TOPIC_ANNOTATION_SCHEMA_VERSION,
  TOPIC_VERIFICATION_METHOD,
  topicAnnotationBatchSchema,
  type TopicAnnotationBatch,
} from './topic-annotations.ts';
import { findExactQuestionBlock, osymBookletRegistrySchema } from './osym-booklet-registry.ts';
import { primaryTopicReviewSchema, validatePrimaryTopicReview } from './topic-primary-review.ts';
import {
  normalizeTopicReviewInput,
  type PrimaryTopicRef,
  type RelatedTopicRef,
} from './topic-review-contract.ts';
import {
  secondaryTopicReviewSchema,
  validateSecondaryTopicReview,
} from './topic-secondary-review.ts';

export const topicReviewComparisonSummarySchema = z
  .object({
    totalQuestionCount: z.int().positive(),
    agreedQuestionCount: z.int().nonnegative(),
    disputedQuestionCount: z.int().nonnegative(),
    agreementRate: z.number().min(0).max(1),
    disputedQuestionNumbers: z.array(z.int().positive()),
  })
  .strict()
  .superRefine((summary, context) => {
    if (
      summary.agreedQuestionCount + summary.disputedQuestionCount !==
      summary.totalQuestionCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['totalQuestionCount'],
        message: 'agreed and disputed counts must equal the total question count',
      });
    }
    if (summary.disputedQuestionNumbers.length !== summary.disputedQuestionCount) {
      context.addIssue({
        code: 'custom',
        path: ['disputedQuestionNumbers'],
        message: 'disputed question number count must match disputedQuestionCount',
      });
    }
    if (summary.agreementRate !== summary.agreedQuestionCount / summary.totalQuestionCount) {
      context.addIssue({
        code: 'custom',
        path: ['agreementRate'],
        message: 'agreementRate must exactly equal agreedQuestionCount / totalQuestionCount',
      });
    }
  });

export type TopicReviewComparisonSummary = z.infer<typeof topicReviewComparisonSummarySchema>;

export type CompareTopicReviewsInput = {
  primaryReview: unknown;
  secondaryReview: unknown;
  bookletRegistry: unknown;
  topicCatalog: unknown;
  waveId: string;
  relatedConsensusPolicy?: 'intersection' | 'union';
  currentDate?: string;
};

export type TopicReviewComparisonResult = {
  batch: TopicAnnotationBatch;
  summary: TopicReviewComparisonSummary;
};

function fail(message: string): never {
  throw new Error(`Topic review comparison: ${message}`);
}

function samePrimary(left: PrimaryTopicRef | null, right: PrimaryTopicRef | null): boolean {
  return (
    left !== null &&
    right !== null &&
    left.subjectId === right.subjectId &&
    left.topicId === right.topicId
  );
}

function relatedKey(ref: RelatedTopicRef): string {
  return `${ref.exam}:${ref.sectionId}:${ref.subjectId}:${ref.topicId}`;
}

function mergeRelated(
  primary: readonly RelatedTopicRef[],
  secondary: readonly RelatedTopicRef[],
  policy: 'intersection' | 'union',
): RelatedTopicRef[] {
  const primaryByKey = new Map(primary.map((ref) => [relatedKey(ref), ref]));
  const secondaryByKey = new Map(secondary.map((ref) => [relatedKey(ref), ref]));
  const keys =
    policy === 'intersection'
      ? [...primaryByKey.keys()].filter((key) => secondaryByKey.has(key))
      : [...new Set([...primaryByKey.keys(), ...secondaryByKey.keys()])];
  return keys
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((key) => primaryByKey.get(key) ?? secondaryByKey.get(key)!);
}

export function compareTopicReviews({
  primaryReview,
  secondaryReview,
  bookletRegistry,
  topicCatalog,
  waveId,
  relatedConsensusPolicy = 'intersection',
  currentDate,
}: CompareTopicReviewsInput): TopicReviewComparisonResult {
  const registry = osymBookletRegistrySchema.parse(bookletRegistry);
  const rawPrimary = primaryTopicReviewSchema.parse(
    normalizeTopicReviewInput(primaryReview, registry),
  );
  const rawSecondary = secondaryTopicReviewSchema.parse(
    normalizeTopicReviewInput(secondaryReview, registry),
  );
  const validationDate = currentDate ?? new Date().toISOString().slice(0, 10);
  const primary = validatePrimaryTopicReview({
    review: rawPrimary,
    bookletRegistry: registry,
    topicCatalog,
    currentDate: validationDate,
  });
  const secondary = validateSecondaryTopicReview({
    review: rawSecondary,
    bookletRegistry: registry,
    topicCatalog,
    currentDate: validationDate,
    expectedReviewer: rawSecondary.reviewer,
  });

  if (primary.reviewer === secondary.reviewer) {
    fail('primary and secondary reviewer identities must be independent');
  }
  for (const field of [
    'year',
    'exam',
    'sectionId',
    'bookletSectionId',
    'answerSetId',
    'bookletId',
    'bookletSha256',
  ] as const) {
    if (primary[field] !== secondary[field]) {
      fail(
        `${field} mismatch (${String(primary[field])} primary, ${String(secondary[field])} secondary)`,
      );
    }
  }
  if (JSON.stringify(primary.questionRange) !== JSON.stringify(secondary.questionRange)) {
    fail('questionRange mismatch between primary and secondary reviews');
  }

  const booklet = registry.booklets.find(
    (candidate) => candidate.year === primary.year && candidate.session === primary.exam,
  );
  if (!booklet) fail(`official booklet ${primary.bookletId} is missing from the registry`);
  if (booklet.sha256 !== primary.bookletSha256) {
    fail('aligned review hash does not match the official booklet registry');
  }
  let block;
  try {
    block = findExactQuestionBlock(registry, primary.exam, primary);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const primaryByQuestion = new Map(
    primary.records.map((record) => [record.officialQuestionNo, record] as const),
  );
  const secondaryByQuestion = new Map(
    secondary.records.map((record) => [record.officialQuestionNo, record] as const),
  );
  const questionNumbers = [...primaryByQuestion.keys()].sort((left, right) => left - right);
  if (
    questionNumbers.length !== secondaryByQuestion.size ||
    questionNumbers.some((questionNo) => !secondaryByQuestion.has(questionNo))
  ) {
    fail('primary and secondary official question-number sets do not align');
  }

  const mergedReviewedAt = [primary.reviewedAt, secondary.reviewedAt].sort().at(-1)!;
  const annotations: TopicAnnotationBatch['annotations'] = questionNumbers.map((questionNo) => {
    const primaryRecord = primaryByQuestion.get(questionNo)!;
    const secondaryRecord = secondaryByQuestion.get(questionNo)!;
    const agreed = samePrimary(primaryRecord.primaryTopicRef, secondaryRecord.primaryTopicRef);
    const relatedTopicRefs = mergeRelated(
      primaryRecord.relatedTopicRefs,
      secondaryRecord.relatedTopicRefs,
      relatedConsensusPolicy,
    );
    const base = {
      year: primary.year,
      exam: primary.exam,
      sectionId: primary.sectionId,
      bookletSectionId: primary.bookletSectionId,
      questionBlockId: block.id,
      answerSetId: block.answerSetId,
      officialQuestionNo: questionNo,
      bookletRegistryId: primary.bookletId,
      bookletSource: booklet.pdfUrl,
      bookletSha256: booklet.sha256,
      primaryClassification: {
        primaryTopicRef: primaryRecord.primaryTopicRef,
        relatedTopicRefs: primaryRecord.relatedTopicRefs,
        reviewer: primary.reviewer,
        reviewedAt: primary.reviewedAt,
        ...(primaryRecord.page === undefined ? {} : { bookletPage: primaryRecord.page }),
      },
      secondaryClassification: {
        primaryTopicRef: secondaryRecord.primaryTopicRef,
        relatedTopicRefs: secondaryRecord.relatedTopicRefs,
        reviewer: secondary.reviewer,
        reviewedAt: secondary.reviewedAt,
        ...(secondaryRecord.page === undefined ? {} : { bookletPage: secondaryRecord.page }),
      },
      relatedTopicRefs,
      reviewedAt: mergedReviewedAt,
    };
    return agreed
      ? {
          ...base,
          primaryTopicRef: primaryRecord.primaryTopicRef!,
          consensusStatus: 'agreed' as const,
        }
      : { ...base, primaryTopicRef: null, consensusStatus: 'disputed' as const };
  });

  const batch = topicAnnotationBatchSchema.parse({
    schemaVersion: TOPIC_ANNOTATION_SCHEMA_VERSION,
    waveId,
    verificationMethod: TOPIC_VERIFICATION_METHOD,
    relatedConsensusPolicy,
    scope: {
      year: primary.year,
      exam: primary.exam,
      sectionId: block.sectionId,
      bookletSectionId: block.bookletSectionId,
      questionBlockId: block.id,
      subjectIds: block.subjectIds,
      questionRange: block.officialQuestionRange,
      answerSetId: block.answerSetId,
      alternativeForSubjectId: block.alternativeForSubjectId,
      countsTowardDefaultStats: block.countsTowardDefaultStats,
    },
    annotations,
  });
  const disputedQuestionNumbers = batch.annotations
    .filter((annotation) => annotation.consensusStatus === 'disputed')
    .map((annotation) => annotation.officialQuestionNo);
  const disputedQuestionCount = disputedQuestionNumbers.length;
  const totalQuestionCount = batch.annotations.length;
  const agreedQuestionCount = totalQuestionCount - disputedQuestionCount;
  const summary = topicReviewComparisonSummarySchema.parse({
    totalQuestionCount,
    agreedQuestionCount,
    disputedQuestionCount,
    agreementRate: agreedQuestionCount / totalQuestionCount,
    disputedQuestionNumbers,
  });

  return { batch, summary };
}
