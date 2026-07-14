import { z } from 'zod';

import { topicAnnotationBatchSchema } from './topic-annotations.ts';
import { osymBookletRegistrySchema } from './osym-booklet-registry.ts';

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const reviewerSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

export const blindTopicAdjudicationSchema = z
  .object({
    year: z.int().min(2018),
    exam: z.enum(['tyt', 'ayt']),
    sectionId: slugSchema,
    subjectId: slugSchema,
    questionNo: z.int().positive(),
    bookletId: z.string().regex(/^\d{4}-(?:tyt|ayt)$/),
    bookletSha256: z.string().regex(/^[0-9a-f]{64}$/),
    reviewer: reviewerSchema,
    reviewedAt: z.iso.date(),
    topicId: slugSchema,
  })
  .strict();

const topicCatalogSchema = z.object({
  exams: z.array(
    z.object({
      id: z.enum(['tyt', 'ayt']),
      sections: z.array(
        z.object({
          id: slugSchema,
          subjects: z.array(
            z.object({
              id: slugSchema,
              questionCount: z.int().positive(),
              topics: z.array(z.object({ id: slugSchema })).min(1),
            }),
          ),
        }),
      ),
    }),
  ),
});

export type BlindTopicAdjudication = z.infer<typeof blindTopicAdjudicationSchema>;

function uniqueMatch<T>(items: readonly T[], predicate: (item: T) => boolean, label: string): T {
  const matches = items.filter(predicate);
  if (matches.length !== 1) throw new Error(`Expected one ${label}, found ${matches.length}`);
  return matches[0]!;
}

export function validateBlindTopicAdjudication({
  adjudication,
  bookletRegistry,
  topicCatalog,
  currentDate = new Date().toISOString().slice(0, 10),
}: {
  adjudication: unknown;
  bookletRegistry: unknown;
  topicCatalog: unknown;
  currentDate?: string;
}): BlindTopicAdjudication {
  const parsed = blindTopicAdjudicationSchema.parse(adjudication);
  const registry = osymBookletRegistrySchema.parse(bookletRegistry);
  const catalog = topicCatalogSchema.parse(topicCatalog);
  const today = z.iso.date().parse(currentDate);
  const fail = (message: string): never => {
    throw new Error(
      `Blind topic adjudication ${parsed.bookletId}/Q${parsed.questionNo}: ${message}`,
    );
  };

  if (parsed.bookletId !== `${parsed.year}-${parsed.exam}`) fail('bookletId does not match scope');
  const booklet =
    registry.booklets.find(
      (candidate) => candidate.year === parsed.year && candidate.session === parsed.exam,
    ) ?? fail('booklet is absent from the official registry');
  if (parsed.bookletSha256 !== booklet.sha256) fail('booklet SHA-256 does not match the registry');
  if (parsed.reviewedAt < booklet.examDate || parsed.reviewedAt > today) {
    fail(`reviewedAt must be between ${booklet.examDate} and ${today}`);
  }

  const exam = uniqueMatch(catalog.exams, (candidate) => candidate.id === parsed.exam, 'exam');
  const section = uniqueMatch(
    exam.sections,
    (candidate) => candidate.id === parsed.sectionId,
    'section',
  );
  const subject = uniqueMatch(
    section.subjects,
    (candidate) => candidate.id === parsed.subjectId,
    'subject',
  );
  const blocks = registry.questionBlockProfiles[parsed.exam].questionBlocks.filter(
    (block) =>
      block.sectionId === parsed.sectionId &&
      block.subjectIds.includes(parsed.subjectId) &&
      parsed.questionNo >= block.officialQuestionRange.first &&
      parsed.questionNo <= block.officialQuestionRange.last,
  );
  if (blocks.length !== 1) {
    fail(
      `official question number must resolve to exactly one registry block, found ${blocks.length}`,
    );
  }
  if (subject.topics.filter((topic) => topic.id === parsed.topicId).length !== 1) {
    fail('topicId must occur exactly once in the scoped taxonomy');
  }
  return parsed;
}

export function evaluateThreeReviewerConsensus({
  annotationBatch,
  adjudication,
}: {
  annotationBatch: unknown;
  adjudication: BlindTopicAdjudication;
}) {
  const batch = topicAnnotationBatchSchema.parse(annotationBatch);
  const annotation = batch.annotations.find(
    (candidate) => candidate.officialQuestionNo === adjudication.questionNo,
  );
  if (!annotation) throw new Error(`Consensus wave has no question ${adjudication.questionNo}`);
  if (
    annotation.year !== adjudication.year ||
    annotation.exam !== adjudication.exam ||
    annotation.sectionId !== adjudication.sectionId ||
    !batch.scope.subjectIds.includes(adjudication.subjectId) ||
    annotation.bookletRegistryId !== adjudication.bookletId ||
    annotation.bookletSha256 !== adjudication.bookletSha256
  ) {
    throw new Error('Adjudication scope or booklet provenance does not match the consensus wave');
  }
  for (const ref of [
    annotation.primaryClassification.primaryTopicRef,
    annotation.secondaryClassification.primaryTopicRef,
  ]) {
    if (ref && ref.subjectId !== adjudication.subjectId) {
      throw new Error('Adjudication subject does not match an existing primary classification');
    }
  }
  if (
    [
      annotation.primaryClassification.reviewer,
      annotation.secondaryClassification.reviewer,
    ].includes(adjudication.reviewer)
  ) {
    throw new Error('Adjudicator must be independent from primary and secondary reviewers');
  }

  const votes = [
    annotation.primaryClassification.primaryTopicRef?.topicId ?? null,
    annotation.secondaryClassification.primaryTopicRef?.topicId ?? null,
    adjudication.topicId,
  ];
  const counts = new Map<string, number>();
  for (const vote of votes) {
    if (vote !== null) counts.set(vote, (counts.get(vote) ?? 0) + 1);
  }
  const majorityTopicId = [...counts].find(([, count]) => count >= 2)?.[0] ?? null;
  return {
    questionNo: adjudication.questionNo,
    votes,
    majorityTopicId,
    hasMajority: majorityTopicId !== null,
  } as const;
}
