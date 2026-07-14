import { z } from 'zod';

import {
  annualClassifierReportSchema,
  assertIdOnlyPayload,
  stableSha256,
  type AnnualClassifierReport,
  type AnnualClassifierResult,
} from './annual-classifier-contract.ts';
import { classifierPromptCatalogSchema } from './annual-classifier-orchestrator.ts';
import { extendTopicCoverage, topicsSchema, type TopicsDocument } from './content-schemas.ts';
import { isAllowedRelatedSubject } from './topic-discipline-families.ts';
import {
  BOOKLET_FIRST_YEAR,
  BOOKLET_MAX_YEAR,
  osymBookletRegistrySchema,
  type OfficialQuestionBlock,
  type OsymBookletRegistry,
} from './osym-booklet-registry.ts';
import {
  primaryTopicRefSchema,
  relatedTopicRefSchema,
  reviewerLabelSchema,
  reviewSlugSchema,
} from './topic-review-contract.ts';

export const ANNUAL_TOPIC_HUMAN_REVIEW_SCHEMA_VERSION = 1;
const MIN_CLASSIFIER_CONSENSUS_CONFIDENCE = 0.8;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const annualTopicReviewScopeSchema = z
  .object({
    year: z.int().min(BOOKLET_FIRST_YEAR).max(BOOKLET_MAX_YEAR),
    exam: z.enum(['tyt', 'ayt']),
    sectionId: reviewSlugSchema,
    bookletSectionId: reviewSlugSchema,
    questionBlockId: reviewSlugSchema,
    questionRange: z
      .object({ first: z.int().positive(), last: z.int().positive() })
      .strict()
      .refine((range) => range.last >= range.first, {
        path: ['last'],
        message: 'question range cannot be reversed',
      }),
    answerSetId: z.enum(['default', 'no-dkab']),
  })
  .strict();

const annualTopicReviewProvenanceSchema = z
  .object({
    bookletId: z.string().regex(/^\d{4}-(?:tyt|ayt)$/),
    pdfUrl: z.url(),
    bookletSha256: sha256Schema,
    taxonomySha256: sha256Schema,
    baseTopicsSha256: sha256Schema,
    classifierReportSha256: sha256Schema,
  })
  .strict();

const pendingQuestionDecisionSchema = z
  .object({
    officialQuestionNo: z.int().positive(),
    status: z.literal('pending'),
    primaryTopicRef: z.null(),
    relatedTopicRefs: z.tuple([]),
  })
  .strict();

const approvedQuestionDecisionSchema = z
  .object({
    officialQuestionNo: z.int().positive(),
    status: z.literal('approved'),
    primaryTopicRef: primaryTopicRefSchema,
    relatedTopicRefs: z.array(relatedTopicRefSchema).max(4),
  })
  .strict();

function validateExactReviewCoverage(
  review: {
    scope: z.infer<typeof annualTopicReviewScopeSchema>;
    records: { officialQuestionNo: number }[];
  },
  context: z.RefinementCtx,
): void {
  const expected = Array.from(
    { length: review.scope.questionRange.last - review.scope.questionRange.first + 1 },
    (_, index) => review.scope.questionRange.first + index,
  );
  const actual = review.records.map((record) => record.officialQuestionNo);
  if (
    actual.length !== expected.length ||
    actual.some((questionNo, index) => questionNo !== expected[index])
  ) {
    context.addIssue({
      code: 'custom',
      path: ['records'],
      message: 'human review records must cover the exact official range once and in order',
    });
  }
}

const pendingAnnualTopicHumanReviewSchema = z
  .object({
    schemaVersion: z.literal(ANNUAL_TOPIC_HUMAN_REVIEW_SCHEMA_VERSION),
    kind: z.literal('annual-topic-human-review'),
    decision: z.literal('pending'),
    scope: annualTopicReviewScopeSchema,
    provenance: annualTopicReviewProvenanceSchema,
    approvedBy: z.null(),
    reviewedAt: z.null(),
    records: z.array(pendingQuestionDecisionSchema).min(1),
  })
  .strict()
  .superRefine(validateExactReviewCoverage);

export const approvedAnnualTopicHumanReviewSchema = z
  .object({
    schemaVersion: z.literal(ANNUAL_TOPIC_HUMAN_REVIEW_SCHEMA_VERSION),
    kind: z.literal('annual-topic-human-review'),
    decision: z.literal('approved'),
    scope: annualTopicReviewScopeSchema,
    provenance: annualTopicReviewProvenanceSchema,
    approvedBy: reviewerLabelSchema,
    reviewedAt: z.iso.date(),
    records: z.array(approvedQuestionDecisionSchema).min(1),
  })
  .strict()
  .superRefine(validateExactReviewCoverage);

export const annualTopicHumanReviewSchema = z.discriminatedUnion('decision', [
  pendingAnnualTopicHumanReviewSchema,
  approvedAnnualTopicHumanReviewSchema,
]);

export type AnnualTopicHumanReview = z.infer<typeof annualTopicHumanReviewSchema>;
export type ApprovedAnnualTopicHumanReview = z.infer<typeof approvedAnnualTopicHumanReviewSchema>;

type CatalogExam = TopicsDocument['exams'][number];
type CatalogSection = CatalogExam['sections'][number];
type CatalogSubject = CatalogSection['subjects'][number];
type CatalogTopic = CatalogSubject['topics'][number];
type CatalogQuestion = CatalogTopic['questions'][number];

function uniqueMatch<T>(items: readonly T[], predicate: (item: T) => boolean, label: string): T {
  const matches = items.filter(predicate);
  if (matches.length !== 1)
    throw new Error(`Expected exactly one ${label}, found ${matches.length}`);
  return matches[0]!;
}

function findBooklet(
  registry: OsymBookletRegistry,
  year: number,
  exam: 'tyt' | 'ayt',
): OsymBookletRegistry['booklets'][number] {
  return uniqueMatch(
    registry.booklets,
    (booklet) => booklet.year === year && booklet.session === exam,
    `official booklet ${year}-${exam}`,
  );
}

function findBlock(
  registry: OsymBookletRegistry,
  exam: 'tyt' | 'ayt',
  questionBlockId: string,
): OfficialQuestionBlock {
  return uniqueMatch(
    registry.questionBlockProfiles[exam].questionBlocks,
    (block) => block.id === questionBlockId,
    `official question block ${questionBlockId}`,
  );
}

function findExam(catalog: TopicsDocument, examId: 'tyt' | 'ayt'): CatalogExam {
  return uniqueMatch(catalog.exams, (exam) => exam.id === examId, `taxonomy exam ${examId}`);
}

function findSection(
  catalog: TopicsDocument,
  examId: 'tyt' | 'ayt',
  sectionId: string,
): CatalogSection {
  return uniqueMatch(
    findExam(catalog, examId).sections,
    (section) => section.id === sectionId,
    `taxonomy section ${examId}/${sectionId}`,
  );
}

function findSubject(
  catalog: TopicsDocument,
  examId: 'tyt' | 'ayt',
  sectionId: string,
  subjectId: string,
): CatalogSubject {
  return uniqueMatch(
    findSection(catalog, examId, sectionId).subjects,
    (subject) => subject.id === subjectId,
    `taxonomy subject ${examId}/${sectionId}/${subjectId}`,
  );
}

function findTopic(
  catalog: TopicsDocument,
  examId: 'tyt' | 'ayt',
  sectionId: string,
  subjectId: string,
  topicId: string,
): CatalogTopic {
  return uniqueMatch(
    findSubject(catalog, examId, sectionId, subjectId).topics,
    (topic) => topic.id === topicId,
    `taxonomy topic ${examId}/${sectionId}/${subjectId}/${topicId}`,
  );
}

function baseTopicsSemanticSha256(catalog: TopicsDocument, scopeYear: number): string {
  const projection = structuredClone(catalog);
  for (const exam of projection.exams) {
    for (const section of exam.sections) {
      for (const subject of section.subjects) {
        for (const topic of subject.topics) {
          topic.questions = [];
          topic.yearlyStats = topic.yearlyStats
            .filter(({ year }) => year <= scopeYear)
            .map(({ year }) => ({
              year,
              count: null,
              verified: false,
              source: null,
              verificationMethod: null,
              verifiedAt: null,
            }));
        }
      }
    }
  }
  return stableSha256(projection);
}

function assertCatalogRegistryProvenance(
  catalog: TopicsDocument,
  registry: OsymBookletRegistry,
): void {
  for (const exam of catalog.exams) {
    for (const section of exam.sections) {
      for (const subject of section.subjects) {
        for (const topic of subject.topics) {
          for (const stat of topic.yearlyStats) {
            if (stat.count === null) continue;
            const booklet = findBooklet(registry, stat.year, exam.id);
            if (stat.source !== booklet.pdfUrl || stat.bookletSha256 !== booklet.sha256) {
              throw new Error(
                `Existing topic statistic ${exam.id}/${section.id}/${subject.id}/${topic.id}/${stat.year} does not match the official booklet registry`,
              );
            }
          }
          for (const question of topic.questions) {
            const booklet = findBooklet(registry, question.year, question.sourceExam);
            const block = findBlock(registry, question.sourceExam, question.questionBlockId);
            if (
              question.sourceUrl !== booklet.pdfUrl ||
              question.source !== booklet.pdfUrl ||
              question.bookletSha256 !== booklet.sha256 ||
              question.verifiedAt.slice(0, 10) < booklet.examDate ||
              block.sectionId !== question.sourceSectionId ||
              !block.subjectIds.includes(question.sourceSubjectId) ||
              question.officialQuestionNo < block.officialQuestionRange.first ||
              question.officialQuestionNo > block.officialQuestionRange.last
            ) {
              throw new Error(
                `Existing question mapping ${question.year}-${question.sourceExam}/${question.questionBlockId}/Q${question.officialQuestionNo} does not match the official booklet registry`,
              );
            }
          }
        }
      }
    }
  }
}

function relatedKey(ref: z.infer<typeof relatedTopicRefSchema>): string {
  return `${ref.exam}:${ref.sectionId}:${ref.subjectId}:${ref.topicId}`;
}

function classificationKey(result: AnnualClassifierResult): string {
  if (result.status !== 'classified') return 'needs-review';
  return stableSha256({
    primaryTopicRef: result.primaryTopicRef,
    relatedTopicRefs: [...result.relatedTopicRefs].sort((left, right) =>
      relatedKey(left).localeCompare(relatedKey(right), 'en'),
    ),
  });
}

function expectedConsensus(
  text: AnnualClassifierResult,
  vision: AnnualClassifierResult,
): { consensus: 'agreed' | 'needs-review' | 'disputed'; confidence: number } {
  const confidence = Math.min(text.confidence, vision.confidence);
  if (
    text.status !== 'classified' ||
    vision.status !== 'classified' ||
    classificationKey(text) !== classificationKey(vision)
  ) {
    return { consensus: 'disputed', confidence };
  }
  if (confidence < MIN_CLASSIFIER_CONSENSUS_CONFIDENCE) {
    return { consensus: 'needs-review', confidence };
  }
  return { consensus: 'agreed', confidence };
}

function validateClassifierResult(
  result: AnnualClassifierResult,
  catalog: TopicsDocument,
  block: OfficialQuestionBlock,
  exam: 'tyt' | 'ayt',
): void {
  if (result.status !== 'classified') return;
  if (!block.subjectIds.includes(result.primaryTopicRef.subjectId)) {
    throw new Error(
      `Classifier question ${result.officialQuestionNo} primary subject is outside its official block`,
    );
  }
  findTopic(
    catalog,
    exam,
    block.sectionId,
    result.primaryTopicRef.subjectId,
    result.primaryTopicRef.topicId,
  );
  const seen = new Set<string>();
  for (const related of result.relatedTopicRefs) {
    if (related.exam !== exam || related.sectionId !== block.sectionId || related.crossExam) {
      throw new Error(
        `Classifier question ${result.officialQuestionNo} related ref escaped its inference scope`,
      );
    }
    findTopic(catalog, related.exam, related.sectionId, related.subjectId, related.topicId);
    const key = relatedKey(related);
    if (seen.has(key)) {
      throw new Error(
        `Classifier question ${result.officialQuestionNo} repeats a related topic ref`,
      );
    }
    seen.add(key);
    if (
      related.subjectId === result.primaryTopicRef.subjectId &&
      related.topicId === result.primaryTopicRef.topicId
    ) {
      throw new Error(
        `Classifier question ${result.officialQuestionNo} repeats its primary topic as related`,
      );
    }
  }
}

export function validateAnnualClassifierReportForPublication({
  report: input,
  bookletRegistry: registryInput,
  topicCatalog: catalogInput,
}: {
  report: unknown;
  bookletRegistry: unknown;
  topicCatalog: unknown;
}): {
  report: AnnualClassifierReport;
  registry: OsymBookletRegistry;
  catalog: TopicsDocument;
  block: OfficialQuestionBlock;
} {
  assertIdOnlyPayload(input);
  const report = annualClassifierReportSchema.parse(input);
  const registry = osymBookletRegistrySchema.parse(registryInput);
  const catalog = topicsSchema.parse(catalogInput);
  const booklet = findBooklet(registry, report.scope.year, report.scope.exam);
  const block = findBlock(registry, report.scope.exam, report.scope.questionBlockId);

  if (
    block.sectionId !== report.scope.sectionId ||
    block.bookletSectionId !== report.scope.bookletSectionId ||
    block.officialQuestionRange.first !== report.scope.questionRange.first ||
    block.officialQuestionRange.last !== report.scope.questionRange.last
  ) {
    throw new Error('Classifier report scope does not exactly match its official question block');
  }
  const expectedTaxonomySha256 = stableSha256(classifierPromptCatalogSchema.parse(catalog));
  if (
    report.provenance.bookletId !== `${booklet.year}-${booklet.session}` ||
    report.provenance.bookletSha256 !== booklet.sha256 ||
    report.provenance.taxonomySha256 !== expectedTaxonomySha256
  ) {
    throw new Error('Classifier report provenance does not match the pinned booklet/taxonomy');
  }

  for (const question of report.questions) {
    validateClassifierResult(question.text, catalog, block, report.scope.exam);
    validateClassifierResult(question.vision, catalog, block, report.scope.exam);
    const expected = expectedConsensus(question.text, question.vision);
    if (
      question.consensus !== expected.consensus ||
      question.consensusConfidence !== expected.confidence
    ) {
      throw new Error(
        `Classifier report question ${question.officialQuestionNo} has inconsistent consensus metadata`,
      );
    }
  }
  return { report, registry, catalog, block };
}

export function prepareAnnualTopicHumanReview({
  report: reportInput,
  bookletRegistry,
  topicCatalog,
}: {
  report: unknown;
  bookletRegistry: unknown;
  topicCatalog: unknown;
}): AnnualTopicHumanReview {
  const { report, registry, catalog, block } = validateAnnualClassifierReportForPublication({
    report: reportInput,
    bookletRegistry,
    topicCatalog,
  });
  const booklet = findBooklet(registry, report.scope.year, report.scope.exam);
  const review = annualTopicHumanReviewSchema.parse({
    schemaVersion: ANNUAL_TOPIC_HUMAN_REVIEW_SCHEMA_VERSION,
    kind: 'annual-topic-human-review',
    decision: 'pending',
    scope: {
      ...report.scope,
      answerSetId: block.answerSetId,
    },
    provenance: {
      bookletId: report.provenance.bookletId,
      pdfUrl: booklet.pdfUrl,
      bookletSha256: booklet.sha256,
      taxonomySha256: stableSha256(classifierPromptCatalogSchema.parse(catalog)),
      baseTopicsSha256: baseTopicsSemanticSha256(catalog, report.scope.year),
      classifierReportSha256: stableSha256(report),
    },
    approvedBy: null,
    reviewedAt: null,
    records: report.questions.map(({ officialQuestionNo }) => ({
      officialQuestionNo,
      status: 'pending',
      primaryTopicRef: null,
      relatedTopicRefs: [],
    })),
  });
  assertIdOnlyPayload(review);
  return review;
}

export function validateAnnualTopicHumanReview({
  review: reviewInput,
  report: reportInput,
  bookletRegistry,
  topicCatalog,
  currentDate = new Date().toISOString().slice(0, 10),
  requireApproval = false,
}: {
  review: unknown;
  report: unknown;
  bookletRegistry: unknown;
  topicCatalog: unknown;
  currentDate?: string;
  requireApproval?: boolean;
}): {
  review: AnnualTopicHumanReview;
  report: AnnualClassifierReport;
  registry: OsymBookletRegistry;
  catalog: TopicsDocument;
  block: OfficialQuestionBlock;
} {
  assertIdOnlyPayload(reviewInput);
  const review = annualTopicHumanReviewSchema.parse(reviewInput);
  if (requireApproval && review.decision !== 'approved') {
    throw new Error('Annual topic review is still pending explicit human approval');
  }
  const { report, registry, catalog, block } = validateAnnualClassifierReportForPublication({
    report: reportInput,
    bookletRegistry,
    topicCatalog,
  });
  const booklet = findBooklet(registry, report.scope.year, report.scope.exam);
  const scopeMatches =
    review.scope.year === report.scope.year &&
    review.scope.exam === report.scope.exam &&
    review.scope.sectionId === block.sectionId &&
    review.scope.bookletSectionId === block.bookletSectionId &&
    review.scope.questionBlockId === block.id &&
    review.scope.questionRange.first === block.officialQuestionRange.first &&
    review.scope.questionRange.last === block.officialQuestionRange.last &&
    review.scope.answerSetId === block.answerSetId;
  if (!scopeMatches)
    throw new Error(
      'Human review scope does not exactly match the classifier report/official block',
    );

  const expectedTaxonomySha256 = stableSha256(classifierPromptCatalogSchema.parse(catalog));
  if (
    review.provenance.bookletId !== `${booklet.year}-${booklet.session}` ||
    review.provenance.pdfUrl !== booklet.pdfUrl ||
    review.provenance.bookletSha256 !== booklet.sha256 ||
    review.provenance.taxonomySha256 !== expectedTaxonomySha256 ||
    review.provenance.baseTopicsSha256 !== baseTopicsSemanticSha256(catalog, review.scope.year) ||
    review.provenance.classifierReportSha256 !== stableSha256(report)
  ) {
    throw new Error(
      'Human review provenance does not exactly match the report, registry, and taxonomy',
    );
  }

  if (review.decision === 'approved') {
    const today = z.iso.date().parse(currentDate);
    if (!review.approvedBy.startsWith('human-')) {
      throw new Error('Approval reviewer must use an explicit human- editor pseudonym');
    }
    if (review.reviewedAt < booklet.examDate || review.reviewedAt > today) {
      throw new Error(`Human approval date must be between ${booklet.examDate} and ${today}`);
    }
    for (const record of review.records) {
      if (!block.subjectIds.includes(record.primaryTopicRef.subjectId)) {
        throw new Error(
          `Approved question ${record.officialQuestionNo} primary subject is outside the official block`,
        );
      }
      findTopic(
        catalog,
        review.scope.exam,
        review.scope.sectionId,
        record.primaryTopicRef.subjectId,
        record.primaryTopicRef.topicId,
      );
      const primaryKey = `${review.scope.exam}:${review.scope.sectionId}:${record.primaryTopicRef.subjectId}:${record.primaryTopicRef.topicId}`;
      const seen = new Set<string>();
      for (const related of record.relatedTopicRefs) {
        if (related.crossExam !== (related.exam !== review.scope.exam)) {
          throw new Error(
            `Approved question ${record.officialQuestionNo} has inconsistent crossExam metadata`,
          );
        }
        findTopic(catalog, related.exam, related.sectionId, related.subjectId, related.topicId);
        const key = relatedKey(related);
        if (key === primaryKey) {
          throw new Error(
            `Approved question ${record.officialQuestionNo} repeats its primary topic as related`,
          );
        }
        if (seen.has(key)) {
          throw new Error(
            `Approved question ${record.officialQuestionNo} repeats a related topic ref`,
          );
        }
        seen.add(key);
        if (!isAllowedRelatedSubject(record.primaryTopicRef.subjectId, related.subjectId)) {
          throw new Error(
            `Approved question ${record.officialQuestionNo} related topic is outside the primary discipline family`,
          );
        }
      }
    }
  }
  return { review, report, registry, catalog, block };
}

export type ApprovedReviewWithReport = {
  review: unknown;
  report: unknown;
};

export type AnnualTopicReplacementAuthorization = {
  targetKey: string;
  expectedExistingSha256: string;
};

export type AnnualTopicApplySummary = {
  approvedQuestionCount: number;
  canonicalQuestionCount: number;
  evidenceOnlyQuestionCount: number;
  relatedQuestionCount: number;
  sectionsUpdated: number;
  sectionTotals: { year: number; exam: 'tyt' | 'ayt'; sectionId: string; count: number }[];
};

function verifiedAtTimestamp(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function questionSortKey(question: CatalogQuestion): string {
  return [
    String(question.year).padStart(4, '0'),
    question.sourceExam,
    question.questionBlockId,
    String(question.officialQuestionNo).padStart(3, '0'),
    question.role,
  ].join(':');
}

type ApplyTarget = {
  targetKey: string;
  year: number;
  exam: 'tyt' | 'ayt';
  sectionId: string;
  blockIds: string[];
  includeStats: boolean;
};

function publicationSlice(catalog: TopicsDocument, target: ApplyTarget) {
  const blockIds = new Set(target.blockIds);
  const questions = catalog.exams.flatMap((exam) =>
    exam.sections.flatMap((section) =>
      section.subjects.flatMap((subject) =>
        subject.topics.flatMap((topic) =>
          topic.questions
            .filter(
              (question) =>
                question.year === target.year &&
                question.sourceExam === target.exam &&
                blockIds.has(question.questionBlockId),
            )
            .map((question) => ({
              target: {
                examId: exam.id,
                sectionId: section.id,
                subjectId: subject.id,
                topicId: topic.id,
              },
              question,
            })),
        ),
      ),
    ),
  );
  questions.sort((left, right) => stableSha256(left).localeCompare(stableSha256(right), 'en'));
  const stats = target.includeStats
    ? findSection(catalog, target.exam, target.sectionId).subjects.flatMap((subject) =>
        subject.topics.map((topic) => ({
          subjectId: subject.id,
          topicId: topic.id,
          stat: topic.yearlyStats.find((candidate) => candidate.year === target.year) ?? null,
        })),
      )
    : [];
  return { questions, stats };
}

function sliceHasPublishedEvidence(slice: ReturnType<typeof publicationSlice>): boolean {
  return slice.questions.length > 0 || slice.stats.some(({ stat }) => stat?.count !== null);
}

function buildQuestionMetadata({
  review,
  record,
  role,
  crossExam,
}: {
  review: ApprovedAnnualTopicHumanReview;
  record: ApprovedAnnualTopicHumanReview['records'][number];
  role: 'primary' | 'related' | 'alternative';
  crossExam?: boolean;
}): CatalogQuestion {
  const common = {
    year: review.scope.year,
    sourceExam: review.scope.exam,
    sourceSectionId: review.scope.sectionId,
    sourceSubjectId: record.primaryTopicRef.subjectId,
    questionBlockId: review.scope.questionBlockId,
    officialQuestionNo: record.officialQuestionNo,
    descriptor: null,
    kazanim: null,
    difficulty: null,
    sourceUrl: review.provenance.pdfUrl,
    bookletSha256: review.provenance.bookletSha256,
    verified: true as const,
    source: review.provenance.pdfUrl,
    verificationMethod: 'editorial-consensus' as const,
    verifiedAt: verifiedAtTimestamp(review.reviewedAt),
  };
  return role === 'primary'
    ? { ...common, role: 'primary', countsTowardStats: true, crossExam: false }
    : role === 'alternative'
      ? { ...common, role: 'alternative', countsTowardStats: false, crossExam: false }
      : {
          ...common,
          role: 'related',
          countsTowardStats: false,
          crossExam: crossExam ?? false,
        };
}

type ValidatedApproval = {
  review: ApprovedAnnualTopicHumanReview;
  block: OfficialQuestionBlock;
};

export function applyApprovedAnnualTopics({
  approvals,
  bookletRegistry: registryInput,
  topicCatalog: catalogInput,
  currentDate = new Date().toISOString().slice(0, 10),
  replacementAuthorizations = [],
}: {
  approvals: ApprovedReviewWithReport[];
  bookletRegistry: unknown;
  topicCatalog: unknown;
  currentDate?: string;
  replacementAuthorizations?: AnnualTopicReplacementAuthorization[];
}): { catalog: TopicsDocument; summary: AnnualTopicApplySummary } {
  if (!approvals.length) throw new Error('At least one approved annual topic review is required');
  const registry = osymBookletRegistrySchema.parse(registryInput);
  let catalog = topicsSchema.parse(catalogInput);
  assertCatalogRegistryProvenance(catalog, registry);
  const originalCatalog = structuredClone(catalog);
  const replacementByTarget = new Map<string, string>();
  for (const authorization of replacementAuthorizations) {
    reviewSlugSchema.or(z.string().min(1)).parse(authorization.targetKey);
    sha256Schema.parse(authorization.expectedExistingSha256);
    if (replacementByTarget.has(authorization.targetKey)) {
      throw new Error(`Duplicate replacement authorization for ${authorization.targetKey}`);
    }
    replacementByTarget.set(authorization.targetKey, authorization.expectedExistingSha256);
  }
  const applyTargets: ApplyTarget[] = [];
  const validated: ValidatedApproval[] = approvals.map(({ review, report }) => {
    const result = validateAnnualTopicHumanReview({
      review,
      report,
      bookletRegistry: registry,
      topicCatalog: catalog,
      currentDate,
      requireApproval: true,
    });
    if (result.review.decision !== 'approved') {
      throw new Error('Annual topic review is still pending explicit human approval');
    }
    return { review: result.review, block: result.block };
  });

  const seenBlockKeys = new Set<string>();
  for (const { review } of validated) {
    const key = `${review.scope.year}:${review.scope.exam}:${review.scope.questionBlockId}`;
    if (seenBlockKeys.has(key)) throw new Error(`Duplicate approved question block ${key}`);
    seenBlockKeys.add(key);
  }

  const targetYear = Math.max(...validated.map(({ review }) => review.scope.year));
  let currentLastYear =
    catalog.exams[0]!.sections[0]!.subjects[0]!.topics[0]!.yearlyStats.at(-1)!.year;
  while (currentLastYear < targetYear) {
    catalog = extendTopicCoverage(catalog, currentLastYear + 1);
    currentLastYear += 1;
  }

  const canonical = validated.filter(({ block }) => block.countsTowardDefaultStats);
  const evidenceOnly = validated.filter(({ block }) => !block.countsTowardDefaultStats);
  const groups = new Map<string, ValidatedApproval[]>();
  for (const item of canonical) {
    const { review } = item;
    const key = `${review.scope.year}:${review.scope.exam}:${review.scope.sectionId}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const sectionTotals: AnnualTopicApplySummary['sectionTotals'] = [];
  let relatedQuestionCount = 0;
  for (const [groupKey, group] of [...groups].sort(([left], [right]) =>
    left.localeCompare(right, 'en'),
  )) {
    const first = group[0]!;
    const { year, exam, sectionId } = first.review.scope;
    const expectedBlocks = registry.questionBlockProfiles[exam].questionBlocks.filter(
      (block) => block.sectionId === sectionId && block.countsTowardDefaultStats,
    );
    const expectedIds = expectedBlocks.map((block) => block.id).sort();
    const receivedIds = group.map(({ block }) => block.id).sort();
    if (JSON.stringify(expectedIds) !== JSON.stringify(receivedIds)) {
      throw new Error(
        `Approved group ${groupKey} must include every canonical section block exactly once (expected ${expectedIds.join(', ')})`,
      );
    }
    const taxonomySection = findSection(catalog, exam, sectionId);
    const canonicalQuestionCount = group.reduce(
      (total, { review }) => total + review.records.length,
      0,
    );
    if (canonicalQuestionCount !== taxonomySection.questionCount) {
      throw new Error(
        `Approved group ${groupKey} has ${canonicalQuestionCount} canonical questions; section requires ${taxonomySection.questionCount}`,
      );
    }
    applyTargets.push({
      targetKey: `${year}:${exam}:${sectionId}:default`,
      year,
      exam,
      sectionId,
      blockIds: expectedIds,
      includeStats: true,
    });

    const sourceBlockIds = new Set(group.map(({ block }) => block.id));
    for (const targetExam of catalog.exams) {
      for (const targetSection of targetExam.sections) {
        for (const targetSubject of targetSection.subjects) {
          for (const targetTopic of targetSubject.topics) {
            targetTopic.questions = targetTopic.questions.filter(
              (question) =>
                !(
                  question.year === year &&
                  question.sourceExam === exam &&
                  question.sourceSectionId === sectionId &&
                  sourceBlockIds.has(question.questionBlockId)
                ),
            );
          }
        }
      }
    }

    const counts = new Map<string, number>();
    for (const { review } of group.sort(
      (left, right) =>
        left.block.officialQuestionRange.first - right.block.officialQuestionRange.first,
    )) {
      for (const record of review.records) {
        const primaryTopic = findTopic(
          catalog,
          exam,
          sectionId,
          record.primaryTopicRef.subjectId,
          record.primaryTopicRef.topicId,
        );
        primaryTopic.questions.push(buildQuestionMetadata({ review, record, role: 'primary' }));
        const countKey = `${record.primaryTopicRef.subjectId}:${record.primaryTopicRef.topicId}`;
        counts.set(countKey, (counts.get(countKey) ?? 0) + 1);

        for (const related of record.relatedTopicRefs) {
          const relatedTopic = findTopic(
            catalog,
            related.exam,
            related.sectionId,
            related.subjectId,
            related.topicId,
          );
          const metadata = buildQuestionMetadata({
            review,
            record,
            role: 'related',
            crossExam: related.crossExam,
          });
          relatedTopic.questions.push(metadata);
          relatedQuestionCount += 1;
        }
      }
    }

    const latestReviewDate = group
      .map(({ review }) => review.reviewedAt)
      .sort()
      .at(-1)!;
    const booklet = findBooklet(registry, year, exam);
    for (const subject of taxonomySection.subjects) {
      for (const topic of subject.topics) {
        const stat = uniqueMatch(
          topic.yearlyStats,
          (candidate) => candidate.year === year,
          `${year} yearly statistic for ${topic.id}`,
        );
        Object.assign(stat, {
          count: counts.get(`${subject.id}:${topic.id}`) ?? 0,
          verified: true,
          source: booklet.pdfUrl,
          bookletSha256: booklet.sha256,
          verificationMethod: 'editorial-consensus',
          verifiedAt: verifiedAtTimestamp(latestReviewDate),
        });
      }
    }
    sectionTotals.push({ year, exam, sectionId, count: canonicalQuestionCount });
  }

  for (const { review, block } of evidenceOnly.sort((left, right) => {
    const leftKey = `${left.review.scope.year}:${left.review.scope.exam}:${left.block.id}`;
    const rightKey = `${right.review.scope.year}:${right.review.scope.exam}:${right.block.id}`;
    return leftKey.localeCompare(rightKey, 'en');
  })) {
    applyTargets.push({
      targetKey: `${review.scope.year}:${review.scope.exam}:${block.id}:alternative`,
      year: review.scope.year,
      exam: review.scope.exam,
      sectionId: review.scope.sectionId,
      blockIds: [block.id],
      includeStats: false,
    });
    for (const exam of catalog.exams) {
      for (const section of exam.sections) {
        for (const subject of section.subjects) {
          for (const topic of subject.topics) {
            topic.questions = topic.questions.filter(
              (question) =>
                !(
                  question.year === review.scope.year &&
                  question.sourceExam === review.scope.exam &&
                  question.questionBlockId === block.id
                ),
            );
          }
        }
      }
    }
    for (const record of review.records) {
      const alternativeTopic = findTopic(
        catalog,
        review.scope.exam,
        review.scope.sectionId,
        record.primaryTopicRef.subjectId,
        record.primaryTopicRef.topicId,
      );
      alternativeTopic.questions.push(
        buildQuestionMetadata({ review, record, role: 'alternative' }),
      );
      for (const related of record.relatedTopicRefs) {
        const relatedTopic = findTopic(
          catalog,
          related.exam,
          related.sectionId,
          related.subjectId,
          related.topicId,
        );
        relatedTopic.questions.push(
          buildQuestionMetadata({
            review,
            record,
            role: 'related',
            crossExam: related.crossExam,
          }),
        );
        relatedQuestionCount += 1;
      }
    }
  }

  for (const exam of catalog.exams) {
    for (const section of exam.sections) {
      for (const subject of section.subjects) {
        for (const topic of subject.topics) {
          topic.questions.sort((left, right) =>
            questionSortKey(left).localeCompare(questionSortKey(right), 'en'),
          );
        }
      }
    }
  }

  catalog = topicsSchema.parse(catalog);
  const usedReplacementTargets = new Set<string>();
  for (const target of applyTargets) {
    const existingSlice = publicationSlice(originalCatalog, target);
    if (!sliceHasPublishedEvidence(existingSlice)) continue;
    const existingSha256 = stableSha256(existingSlice);
    const proposedSha256 = stableSha256(publicationSlice(catalog, target));
    if (existingSha256 === proposedSha256) continue;
    const expectedExistingSha256 = replacementByTarget.get(target.targetKey);
    if (!expectedExistingSha256) {
      throw new Error(
        `Existing published target ${target.targetKey} differs from the approved result; replacement requires its expected old digest ${existingSha256}`,
      );
    }
    if (expectedExistingSha256 !== existingSha256) {
      throw new Error(`Replacement authorization for ${target.targetKey} has a stale old digest`);
    }
    usedReplacementTargets.add(target.targetKey);
  }
  for (const targetKey of replacementByTarget.keys()) {
    if (!usedReplacementTargets.has(targetKey)) {
      throw new Error(`Unused replacement authorization for ${targetKey}`);
    }
  }
  const canonicalQuestionCount = canonical.reduce(
    (total, { review }) => total + review.records.length,
    0,
  );
  const evidenceOnlyQuestionCount = evidenceOnly.reduce(
    (total, { review }) => total + review.records.length,
    0,
  );
  return {
    catalog,
    summary: {
      approvedQuestionCount: canonicalQuestionCount + evidenceOnlyQuestionCount,
      canonicalQuestionCount,
      evidenceOnlyQuestionCount,
      relatedQuestionCount,
      sectionsUpdated: sectionTotals.length,
      sectionTotals,
    },
  };
}
