import type { OsymBookletRegistry } from '../../lib/osym-booklet-registry.ts';
import {
  TOPIC_REVIEW_SCHEMA_VERSION,
  type CanonicalTopicReview,
  type RelatedTopicRef,
} from '../../lib/topic-review-contract.ts';

export type TopicCatalog = {
  exams: Array<{
    id: 'tyt' | 'ayt';
    sections: Array<{
      id: string;
      subjects: Array<{ id: string; topics: Array<{ id: string }> }>;
    }>;
  }>;
};

export function firstTopicId(
  catalog: TopicCatalog,
  examId: 'tyt' | 'ayt',
  sectionId: string,
  subjectId: string,
): string {
  const topicId = catalog.exams
    .find((exam) => exam.id === examId)
    ?.sections.find((section) => section.id === sectionId)
    ?.subjects.find((subject) => subject.id === subjectId)?.topics[0]?.id;
  if (!topicId) throw new Error(`Missing test topic ${examId}/${sectionId}/${subjectId}`);
  return topicId;
}

export function makeCanonicalReview({
  registry,
  catalog,
  year = 2026,
  exam,
  blockId,
  reviewer,
  subjectForQuestion,
  relatedForQuestion = () => [],
}: {
  registry: OsymBookletRegistry;
  catalog: TopicCatalog;
  year?: number;
  exam: 'tyt' | 'ayt';
  blockId: string;
  reviewer: string;
  subjectForQuestion?: (officialQuestionNo: number, index: number) => string;
  relatedForQuestion?: (officialQuestionNo: number, index: number) => RelatedTopicRef[];
}): CanonicalTopicReview {
  const block = registry.questionBlockProfiles[exam].questionBlocks.find(
    (candidate) => candidate.id === blockId,
  );
  if (!block) throw new Error(`Missing test block ${blockId}`);
  const booklet = registry.booklets.find(
    (candidate) => candidate.year === year && candidate.session === exam,
  );
  if (!booklet) throw new Error(`Missing test booklet ${year}-${exam}`);
  const count = block.officialQuestionRange.last - block.officialQuestionRange.first + 1;
  return {
    schemaVersion: TOPIC_REVIEW_SCHEMA_VERSION,
    year,
    exam,
    sectionId: block.sectionId,
    bookletSectionId: block.bookletSectionId,
    questionRange: block.officialQuestionRange,
    answerSetId: block.answerSetId,
    bookletId: `${year}-${exam}`,
    bookletSha256: booklet.sha256,
    reviewer,
    reviewedAt: '2026-07-14',
    records: Array.from({ length: count }, (_, index) => {
      const officialQuestionNo = block.officialQuestionRange.first + index;
      const subjectId = subjectForQuestion?.(officialQuestionNo, index) ?? block.subjectIds[0]!;
      return {
        officialQuestionNo,
        primaryTopicRef: {
          subjectId,
          topicId: firstTopicId(catalog, exam, block.sectionId, subjectId),
          countsTowardStats: true as const,
        },
        relatedTopicRefs: relatedForQuestion(officialQuestionNo, index),
        status: 'classified' as const,
      };
    }),
  };
}
