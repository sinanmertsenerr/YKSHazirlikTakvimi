import { z } from 'zod';

import {
  BOOKLET_FIRST_YEAR,
  BOOKLET_MAX_YEAR,
  findExactQuestionBlock,
  osymBookletRegistrySchema,
} from './osym-booklet-registry.ts';
import {
  primaryRefKey,
  primaryTopicRefSchema,
  relatedTopicRefSchema,
  reviewSlugSchema,
  reviewerLabelSchema,
  topicReviewCatalogSchema,
  type PrimaryTopicRef,
  type RelatedTopicRef,
} from './topic-review-contract.ts';
import { isAllowedRelatedSubject } from './topic-discipline-families.ts';

export const TOPIC_ANNOTATION_SCHEMA_VERSION = 2;
export const TOPIC_STATISTICS_REPORT_SCHEMA_VERSION = 2;
export const TOPIC_VERIFICATION_METHOD = 'editorial-consensus' as const;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const examSchema = z.enum(['tyt', 'ayt']);
const relatedConsensusPolicySchema = z.enum(['intersection', 'union']);

const classificationSchema = z
  .object({
    primaryTopicRef: z.union([primaryTopicRefSchema, z.null()]),
    relatedTopicRefs: z.array(relatedTopicRefSchema),
    reviewer: reviewerLabelSchema,
    reviewedAt: z.iso.date().optional(),
    bookletPage: z.int().positive().optional(),
  })
  .strict();

const annotationScopeSchema = z
  .object({
    year: z.int().min(BOOKLET_FIRST_YEAR).max(BOOKLET_MAX_YEAR),
    exam: examSchema,
    sectionId: reviewSlugSchema,
    bookletSectionId: reviewSlugSchema,
    questionBlockId: reviewSlugSchema,
    subjectIds: z.array(reviewSlugSchema).min(1),
    questionRange: z
      .object({ first: z.int().positive(), last: z.int().positive() })
      .strict()
      .refine((range) => range.last >= range.first, {
        path: ['last'],
        message: 'last question number cannot precede first',
      }),
    answerSetId: z.enum(['default', 'no-dkab']),
    alternativeForSubjectId: z.union([reviewSlugSchema, z.null()]),
    countsTowardDefaultStats: z.boolean(),
  })
  .strict();

const annotationBaseShape = {
  year: z.int().min(BOOKLET_FIRST_YEAR).max(BOOKLET_MAX_YEAR),
  exam: examSchema,
  sectionId: reviewSlugSchema,
  bookletSectionId: reviewSlugSchema,
  questionBlockId: reviewSlugSchema,
  answerSetId: z.enum(['default', 'no-dkab']),
  officialQuestionNo: z.int().positive(),
  bookletRegistryId: z.string().regex(/^\d{4}-(?:tyt|ayt)$/),
  bookletSource: z.url(),
  bookletSha256: sha256Schema,
  bookletPage: z.int().positive().optional(),
  primaryClassification: classificationSchema,
  secondaryClassification: classificationSchema,
  relatedTopicRefs: z.array(relatedTopicRefSchema),
  reviewedAt: z.iso.date(),
};

function samePrimaryRef(left: PrimaryTopicRef | null, right: PrimaryTopicRef | null): boolean {
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

function sortedRelated(refs: readonly RelatedTopicRef[]): RelatedTopicRef[] {
  return [...refs].sort((left, right) => relatedKey(left).localeCompare(relatedKey(right), 'en'));
}

function validateAnnotationCommon(
  annotation: {
    primaryClassification: z.infer<typeof classificationSchema>;
    secondaryClassification: z.infer<typeof classificationSchema>;
    relatedTopicRefs: RelatedTopicRef[];
    reviewedAt: string;
  },
  context: z.RefinementCtx,
): void {
  if (annotation.primaryClassification.reviewer === annotation.secondaryClassification.reviewer) {
    context.addIssue({
      code: 'custom',
      path: ['secondaryClassification', 'reviewer'],
      message: 'primary and secondary reviewers must be independent',
    });
  }
  for (const [key, classification] of [
    ['primaryClassification', annotation.primaryClassification],
    ['secondaryClassification', annotation.secondaryClassification],
  ] as const) {
    if (classification.reviewedAt && classification.reviewedAt > annotation.reviewedAt) {
      context.addIssue({
        code: 'custom',
        path: [key, 'reviewedAt'],
        message: 'classification review date cannot follow the merged annotation review date',
      });
    }
  }
  const relatedKeys = annotation.relatedTopicRefs.map(relatedKey);
  if (new Set(relatedKeys).size !== relatedKeys.length) {
    context.addIssue({
      code: 'custom',
      path: ['relatedTopicRefs'],
      message: 'consensus related topic refs must be unique',
    });
  }
}

const agreedAnnotationSchema = z
  .object({
    ...annotationBaseShape,
    primaryTopicRef: primaryTopicRefSchema,
    consensusStatus: z.literal('agreed'),
  })
  .strict()
  .superRefine((annotation, context) => {
    validateAnnotationCommon(annotation, context);
    if (
      !samePrimaryRef(
        annotation.primaryClassification.primaryTopicRef,
        annotation.primaryTopicRef,
      ) ||
      !samePrimaryRef(
        annotation.secondaryClassification.primaryTopicRef,
        annotation.primaryTopicRef,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['primaryTopicRef'],
        message: 'agreed primary consensus requires both classifications to match exactly',
      });
    }
    const key = primaryRefKey(annotation.primaryTopicRef, annotation.exam, annotation.sectionId);
    if (annotation.relatedTopicRefs.some((ref) => relatedKey(ref) === key)) {
      context.addIssue({
        code: 'custom',
        path: ['relatedTopicRefs'],
        message: 'related consensus cannot repeat the primary topic ref',
      });
    }
  });

const disputedAnnotationSchema = z
  .object({
    ...annotationBaseShape,
    primaryTopicRef: z.null(),
    consensusStatus: z.literal('disputed'),
  })
  .strict()
  .superRefine((annotation, context) => {
    validateAnnotationCommon(annotation, context);
    if (
      samePrimaryRef(
        annotation.primaryClassification.primaryTopicRef,
        annotation.secondaryClassification.primaryTopicRef,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['consensusStatus'],
        message: 'matching non-null primary refs must be recorded as agreed',
      });
    }
  });

export const topicAnnotationRecordSchema = z.union([
  agreedAnnotationSchema,
  disputedAnnotationSchema,
]);

function expectedRelatedConsensus(
  primaryRefs: readonly RelatedTopicRef[],
  secondaryRefs: readonly RelatedTopicRef[],
  policy: 'intersection' | 'union',
): RelatedTopicRef[] {
  const primary = new Map(primaryRefs.map((ref) => [relatedKey(ref), ref]));
  const secondary = new Map(secondaryRefs.map((ref) => [relatedKey(ref), ref]));
  const keys =
    policy === 'intersection'
      ? [...primary.keys()].filter((key) => secondary.has(key))
      : [...new Set([...primary.keys(), ...secondary.keys()])];
  return sortedRelated(keys.map((key) => primary.get(key) ?? secondary.get(key)!));
}

export const topicAnnotationBatchSchema = z
  .object({
    schemaVersion: z.literal(TOPIC_ANNOTATION_SCHEMA_VERSION),
    waveId: reviewSlugSchema,
    verificationMethod: z.literal(TOPIC_VERIFICATION_METHOD),
    relatedConsensusPolicy: relatedConsensusPolicySchema,
    scope: annotationScopeSchema,
    annotations: z.array(topicAnnotationRecordSchema).min(1),
  })
  .strict()
  .superRefine((batch, context) => {
    if (new Set(batch.scope.subjectIds).size !== batch.scope.subjectIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['scope', 'subjectIds'],
        message: 'scope subject IDs must be unique',
      });
    }
    batch.annotations.forEach((annotation, index) => {
      for (const field of [
        'year',
        'exam',
        'sectionId',
        'bookletSectionId',
        'questionBlockId',
        'answerSetId',
      ] as const) {
        if (annotation[field] !== batch.scope[field]) {
          context.addIssue({
            code: 'custom',
            path: ['annotations', index, field],
            message: `${field} must match the batch scope`,
          });
        }
      }
      const expected = expectedRelatedConsensus(
        annotation.primaryClassification.relatedTopicRefs,
        annotation.secondaryClassification.relatedTopicRefs,
        batch.relatedConsensusPolicy,
      );
      if (JSON.stringify(sortedRelated(annotation.relatedTopicRefs)) !== JSON.stringify(expected)) {
        context.addIssue({
          code: 'custom',
          path: ['annotations', index, 'relatedTopicRefs'],
          message: `related refs must equal the explicit ${batch.relatedConsensusPolicy} consensus`,
        });
      }
      if (
        annotation.consensusStatus === 'agreed' &&
        annotation.relatedTopicRefs.some(
          (related) =>
            !isAllowedRelatedSubject(annotation.primaryTopicRef.subjectId, related.subjectId),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['annotations', index, 'relatedTopicRefs'],
          message: 'related consensus must stay inside the primary subject discipline family',
        });
      }
    });
  });

const questionMappingSchema = z
  .object({
    officialQuestionNo: z.int().positive(),
    primaryTopicRef: primaryTopicRefSchema,
    bookletPage: z.int().positive().optional(),
    reviewedAt: z.iso.date(),
    primaryClassification: classificationSchema,
    secondaryClassification: classificationSchema,
  })
  .strict();

const relatedQuestionMappingSchema = z
  .object({
    officialQuestionNo: z.int().positive(),
    relatedTopicRefs: z.array(relatedTopicRefSchema).min(1),
  })
  .strict();

const topicStatPatchSchema = z
  .object({
    locator: z
      .object({
        examId: examSchema,
        sectionId: reviewSlugSchema,
        subjectId: reviewSlugSchema,
        topicId: reviewSlugSchema,
      })
      .strict(),
    year: z.int().min(BOOKLET_FIRST_YEAR).max(BOOKLET_MAX_YEAR),
    count: z.int().nonnegative(),
    verified: z.literal(true),
    approximate: z.literal(false),
    sample: z.literal(false),
    source: z.url(),
    bookletSha256: sha256Schema,
    verificationMethod: z.literal(TOPIC_VERIFICATION_METHOD),
    reviewedAt: z.iso.date(),
    evidenceQuestionNos: z.array(z.int().positive()),
  })
  .strict();

export const topicStatisticsReportSchema = z
  .object({
    schemaVersion: z.literal(TOPIC_STATISTICS_REPORT_SCHEMA_VERSION),
    kind: z.literal('topic-statistics-dry-run'),
    dryRun: z.literal(true),
    waveId: reviewSlugSchema,
    generatedAt: z.iso.datetime(),
    verificationMethod: z.literal(TOPIC_VERIFICATION_METHOD),
    relatedConsensusPolicy: relatedConsensusPolicySchema,
    scope: annotationScopeSchema,
    source: z
      .object({
        authority: z.literal('ÖSYM'),
        bookletRegistryId: z.string().regex(/^\d{4}-(?:tyt|ayt)$/),
        pdfUrl: z.url(),
        sha256: sha256Schema,
        registryVerifiedAt: z.iso.date(),
        questionBlocksVerifiedAt: z.iso.date(),
      })
      .strict(),
    aggregation: z
      .object({
        answerSetId: z.enum(['default', 'no-dkab']),
        countsTowardDefaultStats: z.boolean(),
        evidenceOnly: z.boolean(),
        alternativeForSubjectId: z.union([reviewSlugSchema, z.null()]),
        canonicalQuestionCountContribution: z.int().nonnegative(),
      })
      .strict(),
    coverage: z
      .object({
        expectedQuestionCount: z.int().positive(),
        annotatedQuestionCount: z.int().positive(),
        consensusQuestionCount: z.int().positive(),
        subjectQuestionCounts: z.array(
          z.object({ subjectId: reviewSlugSchema, count: z.int().nonnegative() }).strict(),
        ),
        complete: z.literal(true),
      })
      .strict(),
    review: z
      .object({
        latestReviewedAt: z.iso.date(),
        primaryReviewers: z.array(reviewerLabelSchema).min(1),
        secondaryReviewers: z.array(reviewerLabelSchema).min(1),
      })
      .strict(),
    questionMappings: z.array(questionMappingSchema).min(1),
    relatedQuestionMappings: z.array(relatedQuestionMappingSchema),
    topicStatPatches: z.array(topicStatPatchSchema),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.aggregation.evidenceOnly === report.aggregation.countsTowardDefaultStats) {
      context.addIssue({
        code: 'custom',
        path: ['aggregation', 'evidenceOnly'],
        message: 'evidenceOnly must be the inverse of countsTowardDefaultStats',
      });
    }
    if (report.aggregation.evidenceOnly && report.topicStatPatches.length) {
      context.addIssue({
        code: 'custom',
        path: ['topicStatPatches'],
        message: 'alternative answer-set evidence cannot produce canonical topic patches',
      });
    }
    const patchTotal = report.topicStatPatches.reduce((total, patch) => total + patch.count, 0);
    if (
      patchTotal !== report.aggregation.canonicalQuestionCountContribution ||
      (report.aggregation.countsTowardDefaultStats &&
        patchTotal !== report.coverage.expectedQuestionCount)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['topicStatPatches'],
        message: 'canonical patches must count each primary mapping exactly once',
      });
    }
  });

export type TopicAnnotationBatch = z.infer<typeof topicAnnotationBatchSchema>;
export type TopicStatisticsReport = z.infer<typeof topicStatisticsReportSchema>;

type BuildTopicStatisticsInput = {
  annotationBatch: unknown;
  bookletRegistry: unknown;
  topicCatalog: unknown;
  generatedAt?: string;
};

function uniqueMatch<T>(items: readonly T[], predicate: (item: T) => boolean, label: string): T {
  const matches = items.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${label}, found ${matches.length}`);
  }
  return matches[0]!;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
}

export function buildTopicStatisticsReport({
  annotationBatch,
  bookletRegistry,
  topicCatalog,
  generatedAt = new Date().toISOString(),
}: BuildTopicStatisticsInput): TopicStatisticsReport {
  const batch = topicAnnotationBatchSchema.parse(annotationBatch);
  const registry = osymBookletRegistrySchema.parse(bookletRegistry);
  const catalog = topicReviewCatalogSchema.parse(topicCatalog);
  const normalizedGeneratedAt = z.iso.datetime().parse(generatedAt);
  const generatedDate = normalizedGeneratedAt.slice(0, 10);
  const fail = (message: string): never => {
    throw new Error(`Topic annotation wave ${batch.waveId}: ${message}`);
  };

  const booklet =
    registry.booklets.find(
      (candidate) => candidate.year === batch.scope.year && candidate.session === batch.scope.exam,
    ) ?? fail(`no registry booklet for ${batch.scope.year}-${batch.scope.exam}`);
  const expectedRegistryId = `${booklet.year}-${booklet.session}`;
  const block = (() => {
    try {
      return findExactQuestionBlock(registry, batch.scope.exam, batch.scope);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  })();
  if (
    batch.scope.questionBlockId !== block.id ||
    JSON.stringify(batch.scope.subjectIds) !== JSON.stringify(block.subjectIds) ||
    batch.scope.alternativeForSubjectId !== block.alternativeForSubjectId ||
    batch.scope.countsTowardDefaultStats !== block.countsTowardDefaultStats
  ) {
    fail('scope block metadata does not exactly match the official registry block');
  }

  const exam = uniqueMatch(
    catalog.exams,
    (candidate) => candidate.id === batch.scope.exam,
    `topic catalog exam ${batch.scope.exam}`,
  );
  const section = uniqueMatch(
    exam.sections,
    (candidate) => candidate.id === batch.scope.sectionId,
    `topic catalog section ${batch.scope.sectionId}`,
  );
  const subjects = new Map(section.subjects.map((subject) => [subject.id, subject] as const));
  if (subjects.size !== section.subjects.length)
    fail('topic catalog section has duplicate subjects');
  for (const subjectId of block.subjectIds) {
    if (!subjects.has(subjectId))
      fail(`official block subject ${subjectId} is absent from taxonomy`);
  }

  const resolveRelated = (ref: RelatedTopicRef, questionNo: number): void => {
    if (ref.crossExam !== (ref.exam !== batch.scope.exam)) {
      fail(`question ${questionNo} related ref has inconsistent crossExam metadata`);
    }
    const relatedExam = uniqueMatch(
      catalog.exams,
      (candidate) => candidate.id === ref.exam,
      `related exam ${ref.exam}`,
    );
    const relatedSection = uniqueMatch(
      relatedExam.sections,
      (candidate) => candidate.id === ref.sectionId,
      `related section ${ref.sectionId}`,
    );
    const relatedSubject = uniqueMatch(
      relatedSection.subjects,
      (candidate) => candidate.id === ref.subjectId,
      `related subject ${ref.subjectId}`,
    );
    if (relatedSubject.topics.filter((topic) => topic.id === ref.topicId).length !== 1) {
      fail(`question ${questionNo} has an unknown related topic ref ${relatedKey(ref)}`);
    }
  };

  const { first, last } = batch.scope.questionRange;
  const expectedQuestionCount = last - first + 1;
  const byQuestionNo = new Map<number, (typeof batch.annotations)[number]>();
  for (const annotation of batch.annotations) {
    const questionNo = annotation.officialQuestionNo;
    if (questionNo < first || questionNo > last) {
      fail(`official question number ${questionNo} is outside declared range ${first}-${last}`);
    }
    if (byQuestionNo.has(questionNo)) fail(`duplicate official question number ${questionNo}`);
    byQuestionNo.set(questionNo, annotation);
    if (annotation.bookletRegistryId !== expectedRegistryId) {
      fail(`question ${questionNo} registry ID does not match ${expectedRegistryId}`);
    }
    if (annotation.bookletSource !== booklet.pdfUrl) {
      fail(`question ${questionNo} booklet source does not match the registry`);
    }
    if (annotation.bookletSha256 !== booklet.sha256) {
      fail(`question ${questionNo} booklet hash does not match the registry`);
    }
    if (annotation.reviewedAt < booklet.examDate || annotation.reviewedAt > generatedDate) {
      fail(`question ${questionNo} reviewedAt is outside the booklet/build window`);
    }
    if (annotation.consensusStatus !== 'agreed') {
      fail(`question ${questionNo} has no publishable editorial consensus`);
    }
    const primaryTopicRef =
      annotation.primaryTopicRef ?? fail(`question ${questionNo} has no primary topic ref`);
    const subject = subjects.get(primaryTopicRef.subjectId);
    if (
      !block.subjectIds.includes(primaryTopicRef.subjectId) ||
      !subject ||
      subject.topics.filter((topic) => topic.id === primaryTopicRef.topicId).length !== 1
    ) {
      fail(
        `question ${questionNo} has an unknown primary topic ${primaryTopicRef.subjectId}/${primaryTopicRef.topicId}`,
      );
    }
    for (const relatedRef of annotation.relatedTopicRefs) {
      resolveRelated(relatedRef, questionNo);
      if (!isAllowedRelatedSubject(primaryTopicRef.subjectId, relatedRef.subjectId)) {
        fail(
          `question ${questionNo} related subject ${relatedRef.subjectId} is outside the explicit discipline family of primary subject ${primaryTopicRef.subjectId}`,
        );
      }
    }
  }

  const expectedQuestionNumbers = Array.from(
    { length: expectedQuestionCount },
    (_, index) => first + index,
  );
  for (const questionNo of expectedQuestionNumbers) {
    if (!byQuestionNo.has(questionNo)) fail(`missing official question number ${questionNo}`);
  }
  if (byQuestionNo.size !== expectedQuestionCount) {
    fail(`expected ${expectedQuestionCount} unique annotations, received ${byQuestionNo.size}`);
  }

  const annotations = expectedQuestionNumbers.map((questionNo) => byQuestionNo.get(questionNo)!);
  const latestReviewedAt = annotations
    .map((item) => item.reviewedAt)
    .sort()
    .at(-1)!;
  const evidence = new Map<string, number[]>();
  for (const subjectId of block.subjectIds) {
    const subject = subjects.get(subjectId)!;
    for (const topic of subject.topics) evidence.set(`${subjectId}:${topic.id}`, []);
  }
  for (const annotation of annotations) {
    if (annotation.consensusStatus !== 'agreed') continue;
    if (!annotation.primaryTopicRef) continue;
    evidence
      .get(`${annotation.primaryTopicRef.subjectId}:${annotation.primaryTopicRef.topicId}`)!
      .push(annotation.officialQuestionNo);
  }
  const subjectQuestionCounts = block.subjectIds.map((subjectId) => ({
    subjectId,
    count: annotations.filter(
      (annotation) =>
        annotation.consensusStatus === 'agreed' &&
        annotation.primaryTopicRef?.subjectId === subjectId,
    ).length,
  }));
  const countsTowardDefaultStats = block.countsTowardDefaultStats;

  return topicStatisticsReportSchema.parse({
    schemaVersion: TOPIC_STATISTICS_REPORT_SCHEMA_VERSION,
    kind: 'topic-statistics-dry-run',
    dryRun: true,
    waveId: batch.waveId,
    generatedAt: normalizedGeneratedAt,
    verificationMethod: TOPIC_VERIFICATION_METHOD,
    relatedConsensusPolicy: batch.relatedConsensusPolicy,
    scope: batch.scope,
    source: {
      authority: 'ÖSYM',
      bookletRegistryId: expectedRegistryId,
      pdfUrl: booklet.pdfUrl,
      sha256: booklet.sha256,
      registryVerifiedAt: booklet.verifiedAt,
      questionBlocksVerifiedAt: registry.questionBlockProfiles[batch.scope.exam].verifiedAt,
    },
    aggregation: {
      answerSetId: block.answerSetId,
      countsTowardDefaultStats,
      evidenceOnly: !countsTowardDefaultStats,
      alternativeForSubjectId: block.alternativeForSubjectId,
      canonicalQuestionCountContribution: countsTowardDefaultStats ? expectedQuestionCount : 0,
    },
    coverage: {
      expectedQuestionCount,
      annotatedQuestionCount: annotations.length,
      consensusQuestionCount: annotations.length,
      subjectQuestionCounts,
      complete: true,
    },
    review: {
      latestReviewedAt,
      primaryReviewers: sortedUnique(
        annotations.map((annotation) => annotation.primaryClassification.reviewer),
      ),
      secondaryReviewers: sortedUnique(
        annotations.map((annotation) => annotation.secondaryClassification.reviewer),
      ),
    },
    questionMappings: annotations.map((annotation) => ({
      officialQuestionNo: annotation.officialQuestionNo,
      primaryTopicRef: annotation.primaryTopicRef!,
      ...(annotation.bookletPage === undefined ? {} : { bookletPage: annotation.bookletPage }),
      reviewedAt: annotation.reviewedAt,
      primaryClassification: annotation.primaryClassification,
      secondaryClassification: annotation.secondaryClassification,
    })),
    relatedQuestionMappings: annotations
      .filter((annotation) => annotation.relatedTopicRefs.length)
      .map((annotation) => ({
        officialQuestionNo: annotation.officialQuestionNo,
        relatedTopicRefs: annotation.relatedTopicRefs,
      })),
    topicStatPatches: countsTowardDefaultStats
      ? block.subjectIds.flatMap((subjectId) =>
          subjects.get(subjectId)!.topics.map((topic) => ({
            locator: {
              examId: batch.scope.exam,
              sectionId: batch.scope.sectionId,
              subjectId,
              topicId: topic.id,
            },
            year: batch.scope.year,
            count: evidence.get(`${subjectId}:${topic.id}`)!.length,
            verified: true,
            approximate: false,
            sample: false,
            source: booklet.pdfUrl,
            bookletSha256: booklet.sha256,
            verificationMethod: TOPIC_VERIFICATION_METHOD,
            reviewedAt: latestReviewedAt,
            evidenceQuestionNos: evidence.get(`${subjectId}:${topic.id}`)!,
          })),
        )
      : [],
  });
}
