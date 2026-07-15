import { z } from 'zod';

import { EXAM_IDS } from './content-schemas.ts';
import {
  BOOKLET_FIRST_YEAR,
  BOOKLET_MAX_YEAR,
  findExactQuestionBlock,
  osymBookletRegistrySchema,
  type OfficialQuestionBlock,
} from './osym-booklet-registry.ts';
import { isAllowedRelatedSubject } from './topic-discipline-families.ts';

export const TOPIC_REVIEW_SCHEMA_VERSION = 2;

export const reviewSlugSchema = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const reviewerLabelSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

export const primaryTopicRefSchema = z
  .object({
    subjectId: reviewSlugSchema,
    topicId: reviewSlugSchema,
    countsTowardStats: z.literal(true),
  })
  .strict();

export const relatedTopicRefSchema = z
  .object({
    exam: z.enum(['tyt', 'ayt']),
    sectionId: reviewSlugSchema,
    subjectId: reviewSlugSchema,
    topicId: reviewSlugSchema,
    crossExam: z.boolean(),
    countsTowardStats: z.literal(false),
  })
  .strict();

const classifiedRecordSchema = z
  .object({
    officialQuestionNo: z.int().positive(),
    primaryTopicRef: primaryTopicRefSchema,
    relatedTopicRefs: z.array(relatedTopicRefSchema),
    status: z.literal('classified'),
    page: z.int().positive().optional(),
  })
  .strict();

const needsReviewRecordSchema = z
  .object({
    officialQuestionNo: z.int().positive(),
    primaryTopicRef: z.null(),
    relatedTopicRefs: z.tuple([]),
    status: z.literal('needs-review'),
    page: z.int().positive().optional(),
  })
  .strict();

export const canonicalTopicReviewSchema = z
  .object({
    schemaVersion: z.literal(TOPIC_REVIEW_SCHEMA_VERSION),
    year: z.int().min(BOOKLET_FIRST_YEAR).max(BOOKLET_MAX_YEAR),
    exam: z.enum(['tyt', 'ayt']),
    sectionId: reviewSlugSchema,
    bookletSectionId: reviewSlugSchema,
    questionRange: z
      .object({ first: z.int().positive(), last: z.int().positive() })
      .strict()
      .refine((range) => range.last >= range.first, {
        path: ['last'],
        message: 'question range cannot be reversed',
      }),
    answerSetId: z.enum(['default', 'no-dkab']),
    bookletId: z.string().regex(/^\d{4}-(?:tyt|ayt)$/),
    bookletSha256: z.string().regex(/^[0-9a-f]{64}$/),
    reviewer: reviewerLabelSchema,
    reviewedAt: z.iso.date(),
    records: z
      .array(z.discriminatedUnion('status', [classifiedRecordSchema, needsReviewRecordSchema]))
      .min(1),
  })
  .strict();

export const topicReviewCatalogSchema = z.object({
  exams: z.array(
    z.object({
      id: z.enum(EXAM_IDS),
      sections: z.array(
        z.object({
          id: reviewSlugSchema,
          subjects: z.array(
            z.object({
              id: reviewSlugSchema,
              questionCount: z.int().positive(),
              countApproximate: z.boolean().optional(),
              topics: z.array(z.object({ id: reviewSlugSchema })).min(1),
            }),
          ),
        }),
      ),
    }),
  ),
});

export type CanonicalTopicReview = z.infer<typeof canonicalTopicReviewSchema>;
export type PrimaryTopicRef = z.infer<typeof primaryTopicRefSchema>;
export type RelatedTopicRef = z.infer<typeof relatedTopicRefSchema>;

export type ValidateCanonicalTopicReviewInput = {
  review: unknown;
  bookletRegistry: unknown;
  topicCatalog: unknown;
  currentDate?: string;
  expectedReviewer?: string;
  reviewLabel: 'Primary' | 'Secondary';
};

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value: JsonObject, allowed: readonly string[], label: string): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length)
    throw new Error(`${label} contains unsupported field(s): ${extras.join(', ')}`);
}

function assertExactArray(value: unknown, expected: readonly string[], label: string): void {
  const parsed = z.array(reviewSlugSchema).min(1).parse(value);
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
    throw new Error(`${label} must exactly match the official question block`);
  }
}

function normalizeDraftRecords(
  records: unknown[],
  exam: 'tyt' | 'ayt',
  sectionId: string,
): unknown[] {
  return records.map((record, index) => {
    if (!isJsonObject(record)) throw new Error(`draft record ${index} must be an object`);
    assertExactKeys(
      record,
      ['officialQuestionNo', 'primaryTopicRef', 'relatedTopicRefs', 'status', 'page'],
      `draft record ${index}`,
    );
    const primary = record.primaryTopicRef;
    if (primary !== null) {
      if (!isJsonObject(primary)) throw new Error(`draft record ${index} primaryTopicRef invalid`);
      assertExactKeys(
        primary,
        ['subjectId', 'topicId', 'countsTowardStats'],
        `draft record ${index} primaryTopicRef`,
      );
      if (primary.countsTowardStats !== undefined && primary.countsTowardStats !== true) {
        throw new Error(
          `draft record ${index} primaryTopicRef countsTowardStats must be true when provided`,
        );
      }
    }
    if (!Array.isArray(record.relatedTopicRefs)) {
      throw new Error(`draft record ${index} relatedTopicRefs must be an array`);
    }
    return {
      ...record,
      status: record.status === 'mapped' ? 'classified' : record.status,
      primaryTopicRef:
        primary === null
          ? null
          : {
              ...primary,
              countsTowardStats: true,
            },
      relatedTopicRefs: record.relatedTopicRefs.map((related, relatedIndex) => {
        if (!isJsonObject(related)) {
          throw new Error(`draft record ${index} related ref ${relatedIndex} must be an object`);
        }
        const short = related.exam === undefined && related.sectionId === undefined;
        assertExactKeys(
          related,
          short
            ? ['subjectId', 'topicId', 'countsTowardStats']
            : ['exam', 'sectionId', 'subjectId', 'topicId', 'crossExam', 'countsTowardStats'],
          `draft record ${index} related ref ${relatedIndex}`,
        );
        if (!short && (related.exam === undefined || related.sectionId === undefined)) {
          throw new Error(
            `draft record ${index} related ref ${relatedIndex} has ambiguous cross-taxonomy scope`,
          );
        }
        if (related.countsTowardStats !== undefined && related.countsTowardStats !== false) {
          throw new Error(
            `draft record ${index} related ref ${relatedIndex} countsTowardStats must be false when provided`,
          );
        }
        return short
          ? {
              exam,
              sectionId,
              subjectId: related.subjectId,
              topicId: related.topicId,
              crossExam: false,
              countsTowardStats: false,
            }
          : { ...related, countsTowardStats: false };
      }),
    };
  });
}

function registryBooklet(
  registry: z.infer<typeof osymBookletRegistrySchema>,
  year: number,
  exam: 'tyt' | 'ayt',
) {
  const matches = registry.booklets.filter(
    (candidate) => candidate.year === year && candidate.session === exam,
  );
  if (matches.length !== 1) {
    throw new Error(`draft must resolve to exactly one official booklet, found ${matches.length}`);
  }
  return matches[0]!;
}

function normalizeRegistryMetadataDraft(
  review: JsonObject,
  registry: z.infer<typeof osymBookletRegistrySchema>,
): unknown {
  assertExactKeys(
    review,
    [
      'schemaVersion',
      'kind',
      'reviewRole',
      'waveId',
      'year',
      'exam',
      'sectionId',
      'bookletSectionId',
      'questionBlockId',
      'allowedSubjectIds',
      'answerSetId',
      'alternativeForSubjectId',
      'countsTowardDefaultStats',
      'questionRange',
      'bookletRegistryId',
      'bookletSource',
      'bookletSha256',
      'reviewer',
      'reviewedAt',
      'records',
    ],
    'registry-metadata topic review v2 draft',
  );
  if (review.kind !== 'topic-review-v2-draft' || review.reviewRole !== 'primary') {
    throw new Error('registry-metadata topic review v2 draft has an unsupported kind or role');
  }
  reviewSlugSchema.parse(review.waveId);
  const year = z.int().min(BOOKLET_FIRST_YEAR).max(BOOKLET_MAX_YEAR).parse(review.year);
  const exam = z.enum(['tyt', 'ayt']).parse(review.exam);
  const sectionId = reviewSlugSchema.parse(review.sectionId);
  const bookletSectionId = reviewSlugSchema.parse(review.bookletSectionId);
  const answerSetId = z.enum(['default', 'no-dkab']).parse(review.answerSetId);
  const questionRange = canonicalTopicReviewSchema.shape.questionRange.parse(review.questionRange);
  const block = findExactQuestionBlock(registry, exam, {
    sectionId,
    bookletSectionId,
    answerSetId,
    questionRange,
  });
  if (review.questionBlockId !== block.id) {
    throw new Error('draft questionBlockId must exactly match the official question block');
  }
  assertExactArray(review.allowedSubjectIds, block.subjectIds, 'draft allowedSubjectIds');
  if (
    review.alternativeForSubjectId !== block.alternativeForSubjectId ||
    review.countsTowardDefaultStats !== block.countsTowardDefaultStats
  ) {
    throw new Error('draft answer-set aggregation metadata must match the official question block');
  }
  const booklet = registryBooklet(registry, year, exam);
  if (
    review.bookletRegistryId !== `${year}-${exam}` ||
    review.bookletSource !== booklet.pdfUrl ||
    review.bookletSha256 !== booklet.sha256
  ) {
    throw new Error('draft booklet provenance must exactly match the official registry');
  }

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
    reviewer: review.reviewer,
    reviewedAt: review.reviewedAt,
    records: normalizeDraftRecords(review.records as unknown[], exam, block.sectionId),
  };
}

function normalizeLegacyEnvelopeDraft(
  review: JsonObject,
  registry: z.infer<typeof osymBookletRegistrySchema>,
): unknown {
  assertExactKeys(
    review,
    [
      'schemaVersion',
      'kind',
      'examYear',
      'examId',
      'sectionId',
      'allowedSubjectIds',
      'answerSet',
      'alternativeFor',
      'evidenceOnly',
      'officialSource',
      'reviewer',
      'reviewedAt',
      'records',
    ],
    'legacy-envelope topic review v2 draft',
  );
  if (review.kind !== 'topic-review-v2-draft') {
    throw new Error('legacy-envelope topic review v2 draft has an unsupported kind');
  }
  const year = z.int().min(BOOKLET_FIRST_YEAR).max(BOOKLET_MAX_YEAR).parse(review.examYear);
  const exam = z.enum(['tyt', 'ayt']).parse(review.examId);
  const draftSectionId = reviewSlugSchema.parse(review.sectionId);
  const answerSet = z.enum(['standard', 'no-dkab']).parse(review.answerSet);
  const answerSetId = answerSet === 'standard' ? 'default' : 'no-dkab';
  if (!isJsonObject(review.officialSource)) {
    throw new Error('legacy-envelope draft officialSource must be an object');
  }
  assertExactKeys(
    review.officialSource,
    ['registryId', 'sha256', 'questionRange'],
    'legacy-envelope draft officialSource',
  );
  const questionRange = canonicalTopicReviewSchema.shape.questionRange.parse(
    review.officialSource.questionRange,
  );
  const allowedSubjectIds = z.array(reviewSlugSchema).min(1).parse(review.allowedSubjectIds);
  const candidates = registry.questionBlockProfiles[exam].questionBlocks.filter(
    (block) =>
      block.answerSetId === answerSetId &&
      block.officialQuestionRange.first === questionRange.first &&
      block.officialQuestionRange.last === questionRange.last &&
      JSON.stringify(block.subjectIds) === JSON.stringify(allowedSubjectIds),
  );
  if (candidates.length !== 1) {
    throw new Error(
      `legacy-envelope draft cannot resolve an exact official question block; found ${candidates.length}`,
    );
  }
  const block = candidates[0]!;
  const subjectSuffix =
    block.subjectIds.length === 1
      ? block.subjectIds[0]!.replace(new RegExp(`^${exam}-`), '')
      : null;
  const derivedDraftSectionId = subjectSuffix
    ? `${block.bookletSectionId}-${subjectSuffix}${block.answerSetId === 'no-dkab' ? '-alt' : ''}`
    : block.bookletSectionId;
  if (![block.sectionId, block.bookletSectionId, derivedDraftSectionId].includes(draftSectionId)) {
    throw new Error('legacy-envelope draft section label does not match its official block');
  }
  if (
    review.alternativeFor !== block.alternativeForSubjectId ||
    review.evidenceOnly !== !block.countsTowardDefaultStats
  ) {
    throw new Error('legacy-envelope answer-set metadata must match the official question block');
  }
  const booklet = registryBooklet(registry, year, exam);
  if (
    review.officialSource.registryId !== `${year}-${exam}` ||
    review.officialSource.sha256 !== booklet.sha256
  ) {
    throw new Error('legacy-envelope booklet provenance must exactly match the official registry');
  }

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
    reviewer: review.reviewer,
    reviewedAt: review.reviewedAt,
    records: normalizeDraftRecords(review.records as unknown[], exam, block.sectionId),
  };
}

/**
 * Deterministically upgrades the checked-in v1 single-topic shape and the
 * review-v2 draft shorthand. Offset ranges are never guessed: legacy input is
 * accepted only when its question numbers already equal one exact registry block.
 */
export function normalizeTopicReviewInput(
  review: unknown,
  registry: z.infer<typeof osymBookletRegistrySchema>,
): unknown {
  if (canonicalTopicReviewSchema.safeParse(review).success) return review;
  if (!isJsonObject(review) || !Array.isArray(review.records)) return review;

  const legacy = review.schemaVersion === undefined && typeof review.subjectId === 'string';
  if (legacy) {
    assertExactKeys(
      review,
      [
        'year',
        'exam',
        'sectionId',
        'subjectId',
        'bookletId',
        'bookletSha256',
        'reviewer',
        'reviewedAt',
        'records',
      ],
      'legacy topic review',
    );
    const year = z.int().min(BOOKLET_FIRST_YEAR).max(BOOKLET_MAX_YEAR).parse(review.year);
    const exam = z.enum(['tyt', 'ayt']).parse(review.exam);
    const sectionId = reviewSlugSchema.parse(review.sectionId);
    const subjectId = reviewSlugSchema.parse(review.subjectId);
    const questionNumbers = review.records.map((record, index) => {
      if (!isJsonObject(record)) throw new Error(`legacy record ${index} must be an object`);
      assertExactKeys(
        record,
        ['questionNo', 'topicId', 'page', 'status'],
        `legacy record ${index}`,
      );
      return z.int().positive().parse(record.questionNo);
    });
    const candidates = registry.questionBlockProfiles[exam].questionBlocks.filter((block) => {
      const expectedNumbers = Array.from(
        { length: block.officialQuestionRange.last - block.officialQuestionRange.first + 1 },
        (_, index) => block.officialQuestionRange.first + index,
      );
      return (
        block.sectionId === sectionId &&
        block.subjectIds.length === 1 &&
        block.subjectIds[0] === subjectId &&
        expectedNumbers.length === questionNumbers.length &&
        expectedNumbers.every((questionNo, index) => questionNo === questionNumbers[index])
      );
    });
    if (candidates.length !== 1) {
      throw new Error(
        `legacy review cannot be migrated without guessing an official range; found ${candidates.length} exact registry blocks`,
      );
    }
    const block = candidates[0]!;
    return {
      schemaVersion: TOPIC_REVIEW_SCHEMA_VERSION,
      year,
      exam,
      sectionId,
      bookletSectionId: block.bookletSectionId,
      questionRange: block.officialQuestionRange,
      answerSetId: block.answerSetId,
      bookletId: review.bookletId,
      bookletSha256: review.bookletSha256,
      reviewer: review.reviewer,
      reviewedAt: review.reviewedAt,
      records: review.records.map((record) => {
        const raw = record as JsonObject;
        const topicId = raw.topicId;
        return {
          officialQuestionNo: raw.questionNo,
          primaryTopicRef:
            topicId === null
              ? null
              : {
                  subjectId,
                  topicId,
                  countsTowardStats: true,
                },
          relatedTopicRefs: [],
          status: topicId === null ? 'needs-review' : 'classified',
          ...(raw.page === undefined ? {} : { page: raw.page }),
        };
      }),
    };
  }

  if (review.schemaVersion !== TOPIC_REVIEW_SCHEMA_VERSION) return review;
  if (review.kind === 'topic-review-v2-draft' && review.reviewRole !== undefined) {
    return normalizeRegistryMetadataDraft(review, registry);
  }
  if (review.kind === 'topic-review-v2-draft' && review.officialSource !== undefined) {
    return normalizeLegacyEnvelopeDraft(review, registry);
  }
  assertExactKeys(
    review,
    [
      'schemaVersion',
      'year',
      'exam',
      'sectionId',
      'bookletSectionId',
      'questionRange',
      'answerSetId',
      'bookletId',
      'bookletSha256',
      'reviewer',
      'reviewedAt',
      'records',
    ],
    'topic review v2 draft',
  );
  const exam = z.enum(['tyt', 'ayt']).parse(review.exam);
  const sectionId = reviewSlugSchema.parse(review.sectionId);
  return {
    ...review,
    records: normalizeDraftRecords(review.records, exam, sectionId),
  };
}

function uniqueMatch<T>(items: readonly T[], predicate: (item: T) => boolean, label: string): T {
  const matches = items.filter(predicate);
  if (matches.length !== 1) throw new Error(`Expected one ${label}, found ${matches.length}`);
  return matches[0]!;
}

function relatedRefKey(ref: RelatedTopicRef): string {
  return `${ref.exam}:${ref.sectionId}:${ref.subjectId}:${ref.topicId}`;
}

export function primaryRefKey(
  ref: PrimaryTopicRef,
  exam: 'tyt' | 'ayt',
  sectionId: string,
): string {
  return `${exam}:${sectionId}:${ref.subjectId}:${ref.topicId}`;
}

export function validateCanonicalTopicReview({
  review,
  bookletRegistry,
  topicCatalog,
  currentDate = new Date().toISOString().slice(0, 10),
  expectedReviewer,
  reviewLabel,
}: ValidateCanonicalTopicReviewInput): {
  review: CanonicalTopicReview;
  questionBlock: OfficialQuestionBlock;
} {
  const registry = osymBookletRegistrySchema.parse(bookletRegistry);
  const parsed = canonicalTopicReviewSchema.parse(normalizeTopicReviewInput(review, registry));
  const catalog = topicReviewCatalogSchema.parse(topicCatalog);
  const today = z.iso.date().parse(currentDate);
  const fail = (message: string): never => {
    throw new Error(
      `${reviewLabel} topic review ${parsed.bookletId}/${parsed.sectionId}: ${message}`,
    );
  };

  if (expectedReviewer && parsed.reviewer !== reviewerLabelSchema.parse(expectedReviewer)) {
    fail(`reviewer must be ${expectedReviewer}`);
  }
  if (parsed.bookletId !== `${parsed.year}-${parsed.exam}`) {
    fail(`bookletId must be ${parsed.year}-${parsed.exam}`);
  }
  const booklet =
    registry.booklets.find(
      (candidate) => candidate.year === parsed.year && candidate.session === parsed.exam,
    ) ?? fail('booklet is absent from the official registry');
  if (parsed.bookletSha256 !== booklet.sha256) fail('booklet SHA-256 does not match the registry');
  if (parsed.reviewedAt < booklet.examDate || parsed.reviewedAt > today) {
    fail(`reviewedAt must be between ${booklet.examDate} and ${today}`);
  }

  const questionBlock: OfficialQuestionBlock = (() => {
    try {
      return findExactQuestionBlock(registry, parsed.exam, parsed);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  })();

  const waveExam = uniqueMatch(
    catalog.exams,
    (candidate) => candidate.id === parsed.exam,
    `exam ${parsed.exam}`,
  );
  const waveSection = uniqueMatch(
    waveExam.sections,
    (candidate) => candidate.id === parsed.sectionId,
    `section ${parsed.sectionId}`,
  );
  const waveSubjects = new Map(
    waveSection.subjects.map((subject) => {
      if (new Set(subject.topics.map((topic) => topic.id)).size !== subject.topics.length) {
        fail(`subject ${subject.id} taxonomy contains duplicate topic IDs`);
      }
      return [subject.id, subject] as const;
    }),
  );
  if (waveSubjects.size !== waveSection.subjects.length)
    fail('wave contains duplicate subject IDs');
  for (const subjectId of questionBlock.subjectIds) {
    if (!waveSubjects.has(subjectId)) fail(`question block uses unknown wave subject ${subjectId}`);
  }

  const resolveGlobalRelatedRef = (ref: RelatedTopicRef, questionNo: number): void => {
    if (ref.crossExam !== (ref.exam !== parsed.exam)) {
      fail(
        `question ${questionNo} related ref ${relatedRefKey(ref)} must set crossExam exactly when its exam differs from the wave`,
      );
    }
    const exam = uniqueMatch(
      catalog.exams,
      (candidate) => candidate.id === ref.exam,
      `exam ${ref.exam}`,
    );
    const section = uniqueMatch(
      exam.sections,
      (candidate) => candidate.id === ref.sectionId,
      `section ${ref.sectionId}`,
    );
    const subject = uniqueMatch(
      section.subjects,
      (candidate) => candidate.id === ref.subjectId,
      `subject ${ref.subjectId}`,
    );
    if (subject.topics.filter((topic) => topic.id === ref.topicId).length !== 1) {
      fail(`question ${questionNo} related topic ${relatedRefKey(ref)} must exist exactly once`);
    }
  };

  const recordsByQuestion = new Map<number, (typeof parsed.records)[number]>();
  for (const record of parsed.records) {
    const questionNo = record.officialQuestionNo;
    if (questionNo < parsed.questionRange.first || questionNo > parsed.questionRange.last) {
      fail(
        `official question ${questionNo} is outside exact block range ${parsed.questionRange.first}-${parsed.questionRange.last}`,
      );
    }
    if (recordsByQuestion.has(questionNo)) fail(`duplicate official question ${questionNo}`);
    recordsByQuestion.set(questionNo, record);
    if (record.primaryTopicRef === null) continue;

    const primarySubject = waveSubjects.get(record.primaryTopicRef.subjectId);
    if (!questionBlock.subjectIds.includes(record.primaryTopicRef.subjectId)) {
      fail(
        `question ${questionNo} primary subject ${record.primaryTopicRef.subjectId} is outside the official block taxonomy union`,
      );
    }
    if (
      !primarySubject ||
      primarySubject.topics.filter((topic) => topic.id === record.primaryTopicRef.topicId)
        .length !== 1
    ) {
      fail(
        `question ${questionNo} primary topic ${record.primaryTopicRef.subjectId}/${record.primaryTopicRef.topicId} must exist exactly once in the wave taxonomy`,
      );
    }

    const primaryKey = primaryRefKey(record.primaryTopicRef, parsed.exam, parsed.sectionId);
    const relatedKeys = new Set<string>();
    for (const relatedRef of record.relatedTopicRefs) {
      resolveGlobalRelatedRef(relatedRef, questionNo);
      const key = relatedRefKey(relatedRef);
      if (key === primaryKey)
        fail(`question ${questionNo} related refs cannot repeat the primary topic`);
      if (relatedKeys.has(key))
        fail(`question ${questionNo} contains duplicate related topic ${key}`);
      if (!isAllowedRelatedSubject(record.primaryTopicRef.subjectId, relatedRef.subjectId)) {
        fail(
          `question ${questionNo} related subject ${relatedRef.subjectId} is outside the explicit discipline family of primary subject ${record.primaryTopicRef.subjectId}`,
        );
      }
      relatedKeys.add(key);
    }
  }

  const expectedQuestionCount = parsed.questionRange.last - parsed.questionRange.first + 1;
  for (
    let questionNo = parsed.questionRange.first;
    questionNo <= parsed.questionRange.last;
    questionNo += 1
  ) {
    if (!recordsByQuestion.has(questionNo)) fail(`missing official question ${questionNo}`);
  }
  if (recordsByQuestion.size !== expectedQuestionCount) {
    fail(`expected ${expectedQuestionCount} unique records, received ${recordsByQuestion.size}`);
  }

  return { review: parsed, questionBlock };
}
