import { z } from 'zod';

import { isRelevantNewsTitle } from './news-relevance.ts';
import { PACK_SIGNATURE_FILE_NAME } from './pack-signature-contract.ts';
import {
  BOOKLET_FIRST_YEAR,
  BOOKLET_MAX_YEAR,
  OFFICIAL_QUESTION_BLOCKS,
} from './osym-booklet-registry.ts';
import { isAllowedRelatedSubject } from './topic-discipline-families.ts';

export const CURRENT_SCHEMA_VERSION = 2;
export const CURRENT_PACK_SCHEMA_VERSION = 3;
export const TOPIC_GROUP_STATISTICS_SCHEMA_VERSION = 1;

/** Single source of truth for every exam id in the platform (schemas, UI, pipeline). */
export const EXAM_IDS = ['tyt', 'ayt', 'ydt'] as const;
export type ExamId = (typeof EXAM_IDS)[number];

export function topicCoverageYears(lastYear: number): number[] {
  if (!Number.isInteger(lastYear) || lastYear < BOOKLET_FIRST_YEAR || lastYear > BOOKLET_MAX_YEAR) {
    throw new Error(
      `topic coverage last year must be an integer from ${BOOKLET_FIRST_YEAR} through ${BOOKLET_MAX_YEAR}`,
    );
  }
  return Array.from(
    { length: lastYear - BOOKLET_FIRST_YEAR + 1 },
    (_, index) => BOOKLET_FIRST_YEAR + index,
  );
}

export const localizedTextSchema = z
  .object({
    tr: z.string().trim().min(1),
    en: z.string().trim().min(1),
  })
  .strict();

const ogmHttpsUrlSchema = z.url().refine(
  (value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'ogmmateryal.eba.gov.tr' || url.hostname === 'ogm-small-cdn.eba.gov.tr') &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  },
  { message: 'only clean HTTPS MEB OGM sources are allowed' },
);

const topicGroupCoverageSchema = z
  .object({
    firstYear: z.literal(2018),
    lastYear: z.int().min(2025).max(2100),
  })
  .strict();

const topicGroupSourceSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    sourceId: z.int().positive(),
    apiBookId: z.string().regex(/^[0-9a-f]{24}$/),
    titleTr: z.string().trim().min(1).max(180),
    resolverUrl: ogmHttpsUrlSchema.refine(
      (value) => /^\/pdf-goster\/\d+$/.test(new URL(value).pathname),
      'MEB OGM source must use an official pdf-goster resolver path',
    ),
    bytes: z
      .int()
      .positive()
      .max(64 * 1024 * 1024),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .refine((value) => !/^0{64}$/.test(value), 'SHA-256 cannot be a placeholder'),
  })
  .strict()
  .superRefine((source, context) => {
    if (new URL(source.resolverUrl).pathname !== `/pdf-goster/${source.sourceId}`) {
      context.addIssue({
        code: 'custom',
        path: ['resolverUrl'],
        message: 'resolver path must contain the declared numeric sourceId',
      });
    }
  });

const topicGroupYearCountSchema = z
  .object({
    year: z.int().min(2018).max(2100),
    count: z.int().nonnegative(),
  })
  .strict();

const officialTopicGroupSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    exam: z.enum(EXAM_IDS),
    displaySubjectId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    sourceKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    evidenceMethod: z.literal('official-pdf-table'),
    apiTestIds: z
      .array(z.string().regex(/^[0-9a-f]{24}$/))
      .min(1)
      .optional(),
    questionSet: z.enum(['canonical', 'alternative-included', 'cross-check']),
    countingPolicy: z.enum(['canonical', 'alternative-included', 'cross-check-only']),
    sourceLabelTr: z.string().trim().min(1).max(180),
    translationStatus: z.literal('source-only'),
    physicalPage: z.int().positive(),
    displayOrder: z.int().nonnegative(),
    yearlyCounts: z.array(topicGroupYearCountSchema).min(1),
    total: z.int().nonnegative(),
  })
  .strict()
  .superRefine((group, context) => {
    if (group.apiTestIds && new Set(group.apiTestIds).size !== group.apiTestIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['apiTestIds'],
        message: 'optional API test ids must be unique when exact evidence exists',
      });
    }
  });

const topicGroupStatisticsBaseShape = {
  schemaVersion: z.literal(TOPIC_GROUP_STATISTICS_SCHEMA_VERSION),
  authority: z.literal('MEB OGM'),
  granularity: z.literal('official-topic-group'),
  coverage: topicGroupCoverageSchema,
  landingPageUrl: ogmHttpsUrlSchema.refine(
    (value) => value === 'https://ogmmateryal.eba.gov.tr/yks-cikmis-soru-kitaplari',
    'landingPageUrl must be the official MEB OGM YKS collection',
  ),
  observedAt: z.iso.date(),
  note: localizedTextSchema,
};

const pendingTopicGroupStatisticsSchema = z
  .object({
    ...topicGroupStatisticsBaseShape,
    availability: z.literal('pending'),
    verificationMethod: z.null(),
    verifiedAt: z.null(),
    sources: z.array(topicGroupSourceSchema).length(0),
    groups: z.array(officialTopicGroupSchema).length(0),
  })
  .strict();

const availableTopicGroupStatisticsSchema = z
  .object({
    ...topicGroupStatisticsBaseShape,
    availability: z.literal('available'),
    verificationMethod: z.literal('official-direct'),
    verifiedAt: z.iso.datetime({ offset: true }),
    sources: z.array(topicGroupSourceSchema).min(1),
    groups: z.array(officialTopicGroupSchema).min(1),
  })
  .strict()
  .superRefine((document, context) => {
    const sourceKeys = document.sources.map((source) => source.key);
    if (new Set(sourceKeys).size !== sourceKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'MEB OGM source keys must be unique',
      });
    }
    const groupIds = document.groups.map((group) => group.id);
    if (new Set(groupIds).size !== groupIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['groups'],
        message: 'official topic-group ids must be unique',
      });
    }
    const groupLabels = document.groups
      .filter((group) => group.countingPolicy !== 'cross-check-only')
      .map(
        (group) => `${group.displaySubjectId}\0${group.sourceLabelTr.toLocaleLowerCase('tr-TR')}`,
      );
    if (new Set(groupLabels).size !== groupLabels.length) {
      context.addIssue({
        code: 'custom',
        path: ['groups'],
        message: 'a subject cannot contain duplicate official topic-group labels',
      });
    }

    const expectedYears = Array.from(
      { length: document.coverage.lastYear - document.coverage.firstYear + 1 },
      (_, index) => document.coverage.firstYear + index,
    );
    const usedSources = new Set<string>();
    document.groups.forEach((group, groupIndex) => {
      usedSources.add(group.sourceKey);
      if (!sourceKeys.includes(group.sourceKey)) {
        context.addIssue({
          code: 'custom',
          path: ['groups', groupIndex, 'sourceKey'],
          message: 'official topic group must reference a declared MEB OGM source',
        });
      }
      if (!group.displaySubjectId.startsWith(`${group.exam}-`)) {
        context.addIssue({
          code: 'custom',
          path: ['groups', groupIndex, 'displaySubjectId'],
          message: 'display subject must belong to the declared exam',
        });
      }
      const years = group.yearlyCounts.map((row) => row.year);
      if (
        years.length !== expectedYears.length ||
        years.some((year, index) => year !== expectedYears[index])
      ) {
        context.addIssue({
          code: 'custom',
          path: ['groups', groupIndex, 'yearlyCounts'],
          message: `yearly counts must contain every year from ${document.coverage.firstYear} through ${document.coverage.lastYear} exactly once and in order`,
        });
      }
      const total = group.yearlyCounts.reduce((sum, row) => sum + row.count, 0);
      if (total !== group.total) {
        context.addIssue({
          code: 'custom',
          path: ['groups', groupIndex, 'total'],
          message: `published total ${group.total} does not equal yearly sum ${total}`,
        });
      }
    });
    document.sources.forEach((source, sourceIndex) => {
      if (!usedSources.has(source.key)) {
        context.addIssue({
          code: 'custom',
          path: ['sources', sourceIndex],
          message: 'every published source must support at least one official topic group',
        });
      }
    });
  });

/** MEB's broad labels stay separate from the app's fine study-topic taxonomy. */
export const topicGroupStatisticsSchema = z.discriminatedUnion('availability', [
  pendingTopicGroupStatisticsSchema,
  availableTopicGroupStatisticsSchema,
]);

export const TOPIC_GROUP_MAPPINGS_SCHEMA_VERSION = 1;

const mappingSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * Normalization used to prove an `auto-exact` mapping: an official MEB label and a study-topic
 * name must be equal after Turkish-aware lowercasing, diacritic folding, and dash/space cleanup.
 */
export function normalizeOfficialLabel(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const topicGroupMappingEntrySchema = z
  .object({
    groupId: mappingSlugSchema,
    relation: z.enum(['exact', 'aggregate-into-topic', 'group-spans-topics']),
    /** Study subject holding topicIds when it differs from the group's display subject (e.g. geometry). */
    topicsSubjectId: mappingSlugSchema.optional(),
    topicIds: z.array(mappingSlugSchema).min(1),
    status: z.enum(['auto-exact', 'editorial']),
    noteTr: z.string().trim().min(1).max(300).optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (new Set(entry.topicIds).size !== entry.topicIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['topicIds'],
        message: 'mapped study-topic ids must be unique',
      });
    }
    if (entry.relation === 'group-spans-topics' && entry.topicIds.length < 2) {
      context.addIssue({
        code: 'custom',
        path: ['topicIds'],
        message: 'a spanning group must list at least two study topics',
      });
    }
    if (entry.relation !== 'group-spans-topics' && entry.topicIds.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['topicIds'],
        message: 'a non-spanning mapping must attribute exactly one study topic',
      });
    }
    if (entry.status === 'auto-exact' && entry.relation !== 'exact') {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'auto-exact evidence only applies to exact one-to-one mappings',
      });
    }
  });

const topicGroupMappingSubjectSchema = z
  .object({
    displaySubjectId: mappingSlugSchema,
    entries: z.array(topicGroupMappingEntrySchema).min(1),
  })
  .strict()
  .superRefine((subject, context) => {
    const groupIds = subject.entries.map((entry) => entry.groupId);
    if (new Set(groupIds).size !== groupIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'an official group can only be mapped once per subject',
      });
    }
  });

/**
 * Bridges official MEB OGM topic groups onto the app's study topics. Counts always stay the
 * official MEB numbers; only the group-to-topic assignment is editorial and is labelled as such.
 * Per-topic numbers may only be shown for subjects whose group coverage is complete.
 */
export const topicGroupMappingsSchema = z
  .object({
    schemaVersion: z.literal(TOPIC_GROUP_MAPPINGS_SCHEMA_VERSION),
    authority: z.literal('MEB OGM'),
    method: z.literal('official-group-to-study-topic-mapping'),
    noteTr: z.string().trim().min(1),
    subjects: z.array(topicGroupMappingSubjectSchema),
  })
  .strict()
  .superRefine((document, context) => {
    const subjectIds = document.subjects.map((subject) => subject.displaySubjectId);
    if (new Set(subjectIds).size !== subjectIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['subjects'],
        message: 'each subject can only be mapped once',
      });
    }
  });

export type TopicGroupMappings = z.infer<typeof topicGroupMappingsSchema>;

const nullableUrlSchema = z.union([z.url(), z.null()]);
const nullableTimestampSchema = z.union([z.iso.datetime({ offset: true }), z.null()]);

export const osymHttpsUrlSchema = z.url().refine(
  (value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'osym.gov.tr' || url.hostname.endsWith('.osym.gov.tr'))
    );
  },
  { message: 'only HTTPS ÖSYM sources are allowed' },
);

const nullableOsymUrlSchema = z.union([osymHttpsUrlSchema, z.null()]);

export const osymBookletPdfUrlSchema = osymHttpsUrlSchema.refine(
  (value) => {
    const url = new URL(value);
    const path = url.pathname.toLocaleLowerCase('en-US');
    return (
      (url.hostname === 'dokuman.osym.gov.tr' || url.hostname === 'cdn.osym.gov.tr') &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      path.startsWith('/pdfdokuman/') &&
      /^\/pdfdokuman\/\d{4}\/yks\//.test(path) &&
      path.endsWith('.pdf')
    );
  },
  { message: 'topic provenance must point to a clean official ÖSYM YKS booklet PDF URL' },
);

const nullableBookletUrlSchema = z.union([osymBookletPdfUrlSchema, z.null()]);

export const dataStatusSchema = z
  .object({
    verified: z.boolean(),
    approximate: z.boolean(),
    sample: z.boolean(),
    source: nullableUrlSchema,
    note: localizedTextSchema,
  })
  .strict()
  .superRefine((status, context) => {
    if (status.verified && !status.source) {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'verified data requires an official source URL',
      });
    }
  });

const programVerificationShape = {
  verified: z.boolean(),
  source: nullableUrlSchema,
  verifiedAt: nullableTimestampSchema,
};

const verificationMethodSchema = z.enum(['official-direct', 'editorial-consensus']);
const nullableVerificationMethodSchema = z.union([verificationMethodSchema, z.null()]);
const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .refine((value) => !/^0{64}$/.test(value), 'SHA-256 cannot be a placeholder');

const yearStatSchema = z
  .object({
    year: z.int().min(2018).max(2100),
    count: z.union([z.int().nonnegative(), z.null()]),
    verified: z.boolean(),
    source: nullableBookletUrlSchema,
    bookletSha256: z.union([sha256Schema, z.null()]).optional(),
    verificationMethod: nullableVerificationMethodSchema,
    verifiedAt: nullableTimestampSchema,
  })
  .strict()
  .superRefine((stat, context) => {
    if (stat.count === null) {
      if (
        stat.verified ||
        stat.source !== null ||
        (stat.bookletSha256 !== null && stat.bookletSha256 !== undefined) ||
        stat.verificationMethod !== null ||
        stat.verifiedAt !== null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['count'],
          message:
            'unknown yearly counts must be unverified with null source/hash, verification method, and verification time',
        });
      }
      return;
    }

    if (
      !stat.verified ||
      !stat.source ||
      !stat.bookletSha256 ||
      !stat.verificationMethod ||
      !stat.verifiedAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['verified'],
        message:
          'numeric yearly counts require verified=true, an official source/hash, a verification method, and a verification time',
      });
    }
    if (stat.verificationMethod !== 'editorial-consensus') {
      context.addIssue({
        code: 'custom',
        path: ['verificationMethod'],
        message:
          'topic-level booklet classification must use editorial-consensus because ÖSYM does not publish topic labels',
      });
    }
  });

const questionCommonShape = {
  year: z.int().min(2018).max(2100),
  sourceExam: z.enum(['tyt', 'ayt']),
  sourceSectionId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sourceSubjectId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  questionBlockId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  officialQuestionNo: z.int().positive(),
  crossExam: z.boolean(),
  descriptor: z.union([localizedTextSchema, z.null()]),
  kazanim: z.union([localizedTextSchema, z.null()]),
  difficulty: z.union([z.enum(['kolay', 'orta', 'zor']), z.null()]),
  sourceUrl: osymBookletPdfUrlSchema,
  bookletSha256: sha256Schema,
  verified: z.literal(true),
  source: osymBookletPdfUrlSchema,
  verificationMethod: z.literal('editorial-consensus'),
  verifiedAt: z.iso.datetime({ offset: true }),
};

const primaryQuestionSchema = z
  .object({
    ...questionCommonShape,
    role: z.literal('primary'),
    countsTowardStats: z.literal(true),
  })
  .strict();

const relatedQuestionSchema = z
  .object({
    ...questionCommonShape,
    role: z.literal('related'),
    countsTowardStats: z.literal(false),
  })
  .strict();

const alternativeQuestionSchema = z
  .object({
    ...questionCommonShape,
    role: z.literal('alternative'),
    countsTowardStats: z.literal(false),
    crossExam: z.literal(false),
  })
  .strict();

const questionSchema = z
  .discriminatedUnion('role', [
    primaryQuestionSchema,
    relatedQuestionSchema,
    alternativeQuestionSchema,
  ])
  .superRefine((question, context) => {
    if (question.source !== question.sourceUrl) {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'verified question source must match sourceUrl',
      });
    }
    const block = OFFICIAL_QUESTION_BLOCKS[question.sourceExam].find(
      (candidate) => candidate.id === question.questionBlockId,
    );
    if (
      !block ||
      block.sectionId !== question.sourceSectionId ||
      !(block.subjectIds as readonly string[]).includes(question.sourceSubjectId) ||
      question.officialQuestionNo < block.officialQuestionRange.first ||
      question.officialQuestionNo > block.officialQuestionRange.last
    ) {
      context.addIssue({
        code: 'custom',
        path: ['questionBlockId'],
        message: 'question provenance must match one exact official question block and range',
      });
      return;
    }
    if (question.role === 'primary' && !block.countsTowardDefaultStats) {
      context.addIssue({
        code: 'custom',
        path: ['role'],
        message: 'primary question metadata may only use a canonical default question block',
      });
    }
    if (question.role === 'alternative' && block.countsTowardDefaultStats) {
      context.addIssue({
        code: 'custom',
        path: ['role'],
        message: 'alternative question metadata may only use a non-counting alternative block',
      });
    }
    const nullableMetadata = [question.descriptor, question.kazanim, question.difficulty];
    const nullMetadataCount = nullableMetadata.filter((value) => value === null).length;
    if (nullMetadataCount !== 0 && nullMetadataCount !== nullableMetadata.length) {
      context.addIssue({
        code: 'custom',
        path: ['descriptor'],
        message: 'descriptor, kazanim, and difficulty must be either all null or all present',
      });
    }
  });

const topicSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: localizedTextSchema,
    grade: z.array(z.int().min(9).max(12)).max(4),
    gradeVerified: z.boolean(),
    gradeApproximate: z.literal(false),
    gradeSource: nullableUrlSchema,
    yearlyStats: z
      .array(yearStatSchema)
      .min(1)
      .max(BOOKLET_MAX_YEAR - BOOKLET_FIRST_YEAR + 1),
    questions: z.array(questionSchema),
    outcomes: z.array(localizedTextSchema).optional(),
  })
  .strict()
  .superRefine((topic, context) => {
    if (new Set(topic.grade).size !== topic.grade.length) {
      context.addIssue({
        code: 'custom',
        path: ['grade'],
        message: 'grade values must be unique',
      });
    }
    if (topic.grade.length === 0) {
      if (topic.gradeVerified || topic.gradeSource !== null) {
        context.addIssue({
          code: 'custom',
          path: ['grade'],
          message: 'unknown grade mappings must be an unverified empty array with no source',
        });
      }
    } else if (!topic.gradeVerified || !topic.gradeSource) {
      context.addIssue({
        code: 'custom',
        path: ['grade'],
        message: 'non-empty grade mappings require verification and a source',
      });
    }

    const years = topic.yearlyStats.map((stat) => stat.year);
    const lastYear = years.at(-1) ?? BOOKLET_FIRST_YEAR - 1;
    const expectedYears =
      lastYear >= BOOKLET_FIRST_YEAR && lastYear <= BOOKLET_MAX_YEAR
        ? topicCoverageYears(lastYear)
        : [];
    if (
      years.length !== expectedYears.length ||
      years.some((year, index) => year !== expectedYears[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['yearlyStats'],
        message: `yearlyStats must contain every year from ${BOOKLET_FIRST_YEAR} through one common last year (maximum ${BOOKLET_MAX_YEAR}) exactly once and in order`,
      });
    }

    const questionKeys = topic.questions.map(
      (question) =>
        `${question.year}:${question.sourceExam}:${question.questionBlockId}:${question.officialQuestionNo}:${question.role}`,
    );
    if (new Set(questionKeys).size !== questionKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: 'question mappings must be unique by official source identity and role',
      });
    }

    for (const question of topic.questions) {
      if (!topic.yearlyStats.some((stat) => stat.year === question.year)) {
        context.addIssue({
          code: 'custom',
          path: ['questions'],
          message: `question metadata for ${question.year} requires a yearlyStats coverage row`,
        });
      }
    }

    const primaryQuestions = topic.questions.filter((question) => question.role === 'primary');
    for (const stat of topic.yearlyStats.filter((candidate) => candidate.count !== null)) {
      const questionCount = primaryQuestions.filter(
        (question) => question.year === stat.year,
      ).length;
      if (questionCount !== stat.count) {
        context.addIssue({
          code: 'custom',
          path: ['questions'],
          message: `primary question metadata for ${stat.year} must exactly equal its verified yearly count`,
        });
      }
    }
    for (const question of primaryQuestions) {
      const stat = topic.yearlyStats.find((candidate) => candidate.year === question.year);
      if (!stat || stat.count === null) {
        context.addIssue({
          code: 'custom',
          path: ['questions'],
          message: `primary question metadata for ${question.year} requires a verified numeric yearly count`,
        });
      }
    }
  });

const subjectSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: localizedTextSchema,
    questionCount: z.int().positive(),
    countApproximate: z.boolean().optional(),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    icon: z.object({ sf: z.string().trim().min(1), md: z.string().trim().min(1) }).strict(),
    altSubjectId: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    topics: z.array(topicSchema).min(1),
  })
  .strict();

const sectionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: localizedTextSchema,
    questionCount: z.int().positive(),
    subjects: z.array(subjectSchema).min(1),
  })
  .strict();

const examSchema = z
  .object({
    id: z.enum(EXAM_IDS),
    name: localizedTextSchema,
    durationMin: z.int().positive(),
    totalQuestions: z.int().positive(),
    structureVerified: z.boolean(),
    structureSource: nullableOsymUrlSchema,
    structureVerifiedAt: nullableTimestampSchema,
    sections: z.array(sectionSchema).min(1),
  })
  .strict()
  .superRefine((exam, context) => {
    if (exam.structureVerified && (!exam.structureSource || !exam.structureVerifiedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['structureVerified'],
        message: 'verified exam structure requires an official ÖSYM source and verification time',
      });
    }
    if (
      !exam.structureVerified &&
      (exam.structureSource !== null || exam.structureVerifiedAt !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['structureVerified'],
        message: 'unverified exam structure cannot have a source or verification time',
      });
    }
  });

export const topicsSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    dataStatus: dataStatusSchema,
    // Expand-Contract: 2-exam packs stay valid so a bad third-exam dataset can be rolled
    // back with a content-only publish even after 3-exam binaries ship.
    exams: z.array(examSchema).min(2).max(EXAM_IDS.length),
  })
  .strict()
  .superRefine((pack, context) => {
    const examIds = pack.exams.map((exam) => exam.id);
    if (
      new Set(examIds).size !== examIds.length ||
      !examIds.includes('tyt') ||
      !examIds.includes('ayt')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['exams'],
        message: 'exactly one TYT and one AYT exam are required; other exams at most once each',
      });
    }

    const allTopics = pack.exams.flatMap((exam) =>
      exam.sections.flatMap((section) => section.subjects.flatMap((subject) => subject.topics)),
    );
    const coverageLastYears = allTopics.map((topic) => topic.yearlyStats.at(-1)?.year);
    const coverageLastYear = coverageLastYears[0];
    if (
      coverageLastYear === undefined ||
      coverageLastYears.some((lastYear) => lastYear !== coverageLastYear)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['exams'],
        message: 'every topic must use the same contiguous yearlyStats coverage',
      });
    }
    const coverageYears =
      coverageLastYear !== undefined &&
      coverageLastYear >= BOOKLET_FIRST_YEAR &&
      coverageLastYear <= BOOKLET_MAX_YEAR
        ? topicCoverageYears(coverageLastYear)
        : [];

    const subjectIds: string[] = [];
    const topicIds: string[] = [];
    const primaryQuestionIdentities: string[] = [];
    for (const [examIndex, exam] of pack.exams.entries()) {
      const sectionTotal = exam.sections.reduce((sum, section) => sum + section.questionCount, 0);
      if (sectionTotal !== exam.totalQuestions) {
        context.addIssue({
          code: 'custom',
          path: ['exams', examIndex, 'sections'],
          message: `section total must equal ${exam.totalQuestions}`,
        });
      }

      for (const [sectionIndex, section] of exam.sections.entries()) {
        const subjectTotal = section.subjects.reduce(
          (sum, subject) => sum + subject.questionCount,
          0,
        );
        if (subjectTotal !== section.questionCount) {
          context.addIssue({
            code: 'custom',
            path: ['exams', examIndex, 'sections', sectionIndex, 'subjects'],
            message: `subject total must equal ${section.questionCount}`,
          });
        }

        for (const subject of section.subjects) {
          subjectIds.push(subject.id);
          topicIds.push(...subject.topics.map((topic) => topic.id));
          if (
            subject.altSubjectId &&
            !section.subjects.some((candidate) => candidate.id === subject.altSubjectId)
          ) {
            context.addIssue({
              code: 'custom',
              path: ['exams', examIndex, 'sections', sectionIndex, 'subjects'],
              message: `${subject.id}.altSubjectId must identify a subject in the same section`,
            });
          }
          for (const topic of subject.topics) {
            for (const stat of topic.yearlyStats) {
              if (!stat.source) continue;
              const path = new URL(stat.source).pathname.toLocaleLowerCase('en-US');
              if (!path.includes(`/${stat.year}/yks/`) || !path.includes(exam.id)) {
                context.addIssue({
                  code: 'custom',
                  path: ['exams', examIndex, 'sections', sectionIndex],
                  message: `${topic.id}.${stat.year} source must match its year and ${exam.id.toUpperCase()} session`,
                });
              }
            }
            for (const question of topic.questions) {
              if (question.role === 'primary') {
                primaryQuestionIdentities.push(
                  `${question.year}:${question.sourceExam}:${question.questionBlockId}:${question.officialQuestionNo}`,
                );
              }
              const path = new URL(question.sourceUrl).pathname.toLocaleLowerCase('en-US');
              if (!path.includes(`/${question.year}/yks/`) || !path.includes(question.sourceExam)) {
                context.addIssue({
                  code: 'custom',
                  path: ['exams', examIndex, 'sections', sectionIndex],
                  message: `${topic.id}.${question.year} question source must match its year and ${question.sourceExam.toUpperCase()} source session`,
                });
              }
              if (question.crossExam !== (question.sourceExam !== exam.id)) {
                context.addIssue({
                  code: 'custom',
                  path: ['exams', examIndex, 'sections', sectionIndex],
                  message: `${topic.id}.${question.year} crossExam must exactly reflect the source and target exams`,
                });
              }
              if (question.role === 'primary') {
                if (
                  question.sourceExam !== exam.id ||
                  question.sourceSectionId !== section.id ||
                  question.sourceSubjectId !== subject.id ||
                  question.crossExam
                ) {
                  context.addIssue({
                    code: 'custom',
                    path: ['exams', examIndex, 'sections', sectionIndex],
                    message: `${topic.id}.${question.year} primary mapping must stay in its exact source exam, section, and subject`,
                  });
                }
              } else if (
                question.role === 'alternative' &&
                (question.sourceExam !== exam.id ||
                  question.sourceSectionId !== section.id ||
                  question.sourceSubjectId !== subject.id ||
                  question.crossExam)
              ) {
                context.addIssue({
                  code: 'custom',
                  path: ['exams', examIndex, 'sections', sectionIndex],
                  message: `${topic.id}.${question.year} alternative mapping must stay in its exact source exam, section, and subject`,
                });
              } else if (
                question.role === 'related' &&
                !isAllowedRelatedSubject(question.sourceSubjectId, subject.id)
              ) {
                context.addIssue({
                  code: 'custom',
                  path: ['exams', examIndex, 'sections', sectionIndex],
                  message: `${topic.id}.${question.year} related mapping is outside the explicit discipline family`,
                });
              }
            }
          }
        }

        const sectionTopics = section.subjects.flatMap((subject) => subject.topics);
        for (const year of coverageYears) {
          const stats = sectionTopics.map((topic) =>
            topic.yearlyStats.find((stat) => stat.year === year),
          );
          if (stats.some((stat) => !stat)) continue;
          const completeStats = stats.filter(
            (stat): stat is NonNullable<typeof stat> => stat !== undefined,
          );
          const nullCount = completeStats.filter((stat) => stat.count === null).length;
          if (nullCount === completeStats.length) continue;
          if (nullCount > 0) {
            context.addIssue({
              code: 'custom',
              path: ['exams', examIndex, 'sections', sectionIndex],
              message: `${year} must be wholly unknown or wholly verified numeric; mixed rows are forbidden`,
            });
            continue;
          }
          const total = completeStats.reduce((sum, stat) => sum + (stat.count ?? 0), 0);
          if (total !== section.questionCount) {
            context.addIssue({
              code: 'custom',
              path: ['exams', examIndex, 'sections', sectionIndex],
              message: `${year} verified topic total must equal ${section.questionCount}`,
            });
          }
        }
      }
    }

    if (new Set(subjectIds).size !== subjectIds.length) {
      context.addIssue({ code: 'custom', path: ['exams'], message: 'subject ids must be unique' });
    }
    if (new Set(topicIds).size !== topicIds.length) {
      context.addIssue({ code: 'custom', path: ['exams'], message: 'topic ids must be unique' });
    }
    if (new Set(primaryQuestionIdentities).size !== primaryQuestionIdentities.length) {
      context.addIssue({
        code: 'custom',
        path: ['exams'],
        message: 'each canonical official question identity must have exactly one primary mapping',
      });
    }
  });

const tytWeightsSchema = z
  .object({
    'tyt-turkce': z.literal(33),
    'tyt-sosyal': z.literal(17),
    'tyt-matematik': z.literal(33),
    'tyt-fen': z.literal(17),
  })
  .strict();

const sayWeightsSchema = z
  .object({
    tyt: z.literal(40),
    'ayt-matematik': z.literal(30),
    'ayt-fizik': z.literal(10),
    'ayt-kimya': z.literal(10),
    'ayt-biyoloji': z.literal(10),
  })
  .strict();

const eaWeightsSchema = z
  .object({
    tyt: z.literal(40),
    'ayt-matematik': z.literal(30),
    'ayt-edebiyat': z.literal(18),
    'ayt-tarih-1': z.literal(7),
    'ayt-cografya-1': z.literal(5),
  })
  .strict();

const sozWeightsSchema = z
  .object({
    tyt: z.literal(40),
    'ayt-edebiyat': z.literal(18),
    'ayt-tarih-1': z.literal(7),
    'ayt-cografya-1': z.literal(5),
    'ayt-tarih-2': z.literal(8),
    'ayt-cografya-2': z.literal(8),
    'ayt-felsefe-grubu': z.literal(9),
    'ayt-din-kulturu': z.literal(5),
  })
  .strict();

/** Guide Tablo 1E: DİL score = TYT 40% + YDT (Yabancı Dil Testi) 60%. */
const dilWeightsSchema = z
  .object({
    tyt: z.literal(40),
    'ydt-yabanci-dil': z.literal(60),
  })
  .strict();

export const coefficientsSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    examYear: z.int().min(2018).max(2100),
    calculation: z
      .object({
        status: z.literal('unavailable'),
        estimation: z.null(),
        reason: localizedTextSchema,
      })
      .strict(),
    officialRules: z
      .object({
        source: osymHttpsUrlSchema,
        verifiedAt: z.iso.datetime({ offset: true }),
        net: z
          .object({
            formula: z.literal('correct-minus-wrong-divided-by-four'),
            wrongAnswerDivisor: z.literal(4),
          })
          .strict(),
        standardScore: z
          .object({
            mean: z.literal(50),
            standardDeviation: z.literal(10),
            referencePopulation: z.literal('final-year-candidates'),
          })
          .strict(),
        scoreScale: z.object({ minimum: z.literal(100), maximum: z.literal(500) }).strict(),
        obp: z
          .object({
            diplomaGradeMultiplier: z.literal(5),
            minimum: z.literal(250),
            maximum: z.literal(500),
            normalPlacementMultiplier: z.literal(0.12),
            previousYearPlacedMultiplier: z.literal(0.06),
          })
          .strict(),
        eligibility: z
          .object({
            tyt: z
              .object({
                anyOf: z.tuple([z.literal('tyt-turkce'), z.literal('tyt-matematik')]),
                minimumRawScore: z.literal(0.5),
              })
              .strict(),
            field: z
              .object({
                requiresCalculableTyt: z.literal(true),
                anyRelevantAytTestMinimumRawScore: z.literal(0.5),
              })
              .strict(),
          })
          .strict(),
        weightsPercent: z
          .object({
            tyt: tytWeightsSchema,
            say: sayWeightsSchema,
            ea: eaWeightsSchema,
            soz: sozWeightsSchema,
            dil: dilWeightsSchema,
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((document, context) => {
    for (const [scoreType, weights] of Object.entries(document.officialRules.weightsPercent)) {
      const components = Object.values(weights);
      if (components.some((component) => component <= 0)) {
        context.addIssue({
          code: 'custom',
          path: ['officialRules', 'weightsPercent', scoreType],
          message: 'every weight component must be positive',
        });
      }
      const total = components.reduce((sum, component) => sum + component, 0);
      if (total !== 100) {
        context.addIssue({
          code: 'custom',
          path: ['officialRules', 'weightsPercent', scoreType],
          message: 'weight percentages must sum to 100',
        });
      }
    }
  });

export const rankTablesSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    examYear: z.int().min(2018).max(2100),
    availability: z.literal('unavailable'),
    officialResultsDate: z.iso.date(),
    tables: z.array(z.never()).length(0),
    source: osymHttpsUrlSchema,
    verifiedAt: z.iso.datetime({ offset: true }),
    reason: localizedTextSchema,
  })
  .strict();

export const calendarSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    dataStatus: dataStatusSchema,
    events: z.array(
      z
        .object({
          id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
          start: z.iso.date(),
          end: z.union([z.iso.date(), z.null()]),
          startTime: z
            .string()
            .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
            .nullable(),
          endTime: z
            .string()
            .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
            .nullable(),
          type: z.enum(['basvuru', 'sinav', 'sonuc', 'tercih', 'diger']),
          title: localizedTextSchema,
          verified: z.boolean(),
          verifiedAt: nullableTimestampSchema,
          approximate: z.boolean(),
          sample: z.boolean(),
          source: nullableUrlSchema,
        })
        .strict()
        .superRefine((event, context) => {
          if (event.verified && !event.source) {
            context.addIssue({
              code: 'custom',
              path: ['source'],
              message: 'verified event requires an official source URL',
            });
          }
          if (event.verified && !event.verifiedAt) {
            context.addIssue({
              code: 'custom',
              path: ['verifiedAt'],
              message: 'verified event requires a verification timestamp',
            });
          }
          if (event.end && event.end < event.start) {
            context.addIssue({
              code: 'custom',
              path: ['end'],
              message: 'event end cannot precede start',
            });
          }
          if (
            event.end === event.start &&
            event.startTime &&
            event.endTime &&
            event.endTime < event.startTime
          ) {
            context.addIssue({
              code: 'custom',
              path: ['endTime'],
              message: 'event end time cannot precede start time',
            });
          }
        }),
    ),
  })
  .strict();

const officialNewsUrlSchema = z.url().refine(
  (value) => {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase('en-US');
    const officialHost =
      host === 'osym.gov.tr' ||
      host.endsWith('.osym.gov.tr') ||
      host === 'yok.gov.tr' ||
      host.endsWith('.yok.gov.tr');
    return (
      url.protocol === 'https:' &&
      officialHost &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  },
  { message: 'news provenance must use a clean HTTPS ÖSYM or YÖK URL' },
);

const newsProvenanceSchema = z
  .object({
    listUrl: officialNewsUrlSchema,
    detailUrl: officialNewsUrlSchema,
    publishedAtEvidence: z.enum(['osym-list-title-date', 'yok-detail-update-date']),
  })
  .strict();

function isOsymNewsListUrl(value: string): boolean {
  const url = new URL(value);
  return (
    url.hostname === 'www.osym.gov.tr' &&
    /^\/TR(?:,|%2c)\d+\/(?:yks|20\d{2})\.html$/i.test(url.pathname)
  );
}

function isOsymNewsDetailUrl(value: string): boolean {
  const url = new URL(value);
  return (
    url.hostname === 'www.osym.gov.tr' && /^\/TR(?:,|%2c)\d+\/[a-z0-9-]+\.html$/i.test(url.pathname)
  );
}

function isYokNewsListUrl(value: string): boolean {
  const url = new URL(value);
  return (
    url.hostname === 'www.yok.gov.tr' && /^\/tr\/(?:news|announcements)\/?$/i.test(url.pathname)
  );
}

function isYokNewsDetailUrl(value: string): boolean {
  const url = new URL(value);
  return (
    url.hostname === 'www.yok.gov.tr' &&
    /^\/tr\/(?:news|announcements)\/[A-Za-z0-9_-]+$/i.test(url.pathname)
  );
}

export const newsItemSchema = z
  .object({
    id: z.string().regex(/^(?:osym|yok)-[a-f0-9]{24}$/),
    publishedAt: z.iso.datetime({ offset: true }),
    source: z.enum(['ÖSYM', 'YÖK']),
    title: localizedTextSchema,
    summary: localizedTextSchema,
    url: officialNewsUrlSchema,
    verified: z.literal(true),
    verifiedAt: z.iso.datetime({ offset: true }),
    provenance: newsProvenanceSchema,
    approximate: z.literal(false),
    sample: z.literal(false),
    translationStatus: z.literal('source-only'),
  })
  .strict()
  .superRefine((item, context) => {
    if (!isRelevantNewsTitle(item.title.tr)) {
      context.addIssue({
        code: 'custom',
        path: ['title', 'tr'],
        message: 'generic or non-YKS announcement is forbidden',
      });
    }
    if (item.url !== item.provenance.detailUrl) {
      context.addIssue({
        code: 'custom',
        path: ['provenance', 'detailUrl'],
        message: 'news provenance detailUrl must exactly match url',
      });
    }
    if (item.title.en !== item.title.tr || item.summary.en !== item.summary.tr) {
      context.addIssue({
        code: 'custom',
        path: ['translationStatus'],
        message: 'source-only news text must be identical in both locales',
      });
    }
    if (new Date(item.verifiedAt).valueOf() < new Date(item.publishedAt).valueOf()) {
      context.addIssue({
        code: 'custom',
        path: ['verifiedAt'],
        message: 'news verification time cannot precede its published time',
      });
    }

    const expectedPrefix = item.source === 'ÖSYM' ? 'osym-' : 'yok-';
    if (!item.id.startsWith(expectedPrefix)) {
      context.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'news id prefix must match its source authority',
      });
    }

    const validAuthorityProvenance =
      item.source === 'ÖSYM'
        ? isOsymNewsListUrl(item.provenance.listUrl) &&
          isOsymNewsDetailUrl(item.provenance.detailUrl) &&
          item.provenance.publishedAtEvidence === 'osym-list-title-date'
        : isYokNewsListUrl(item.provenance.listUrl) &&
          isYokNewsDetailUrl(item.provenance.detailUrl) &&
          item.provenance.publishedAtEvidence === 'yok-detail-update-date';
    if (!validAuthorityProvenance) {
      context.addIssue({
        code: 'custom',
        path: ['provenance'],
        message: 'news provenance paths and date evidence must match the source authority',
      });
    }
  });

export const newsSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    dataStatus: dataStatusSchema,
    items: z.array(newsItemSchema).min(1).max(50),
  })
  .strict()
  .superRefine((document, context) => {
    if (
      !document.dataStatus.verified ||
      document.dataStatus.approximate ||
      document.dataStatus.sample
    ) {
      context.addIssue({
        code: 'custom',
        path: ['dataStatus'],
        message: 'the production news document must be verified, exact, and non-sample',
      });
    }
    if (
      document.dataStatus.source &&
      !document.items.some((item) => item.provenance.listUrl === document.dataStatus.source)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['dataStatus', 'source'],
        message: 'news dataStatus source must match an item list provenance URL',
      });
    }

    const ids = document.items.map((item) => item.id);
    const urls = document.items.map((item) => item.url);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'news item ids must be unique',
      });
    }
    if (new Set(urls).size !== urls.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'news item URLs must be unique',
      });
    }
  });

const programYearSchema = z
  .object({
    year: z.int().min(2018).max(2100),
    quota: z.int().nonnegative().nullable(),
    placed: z.int().nonnegative().nullable(),
    minScore: z.number().positive().nullable(),
    minRank: z.int().positive().nullable(),
    ...programVerificationShape,
    approximate: z.boolean(),
    sample: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.verified && (!value.source || !value.verifiedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['verifiedAt'],
        message: 'verified program data requires an official source URL and verification time',
      });
    }
    if (!value.verified && value.verifiedAt) {
      context.addIssue({
        code: 'custom',
        path: ['verifiedAt'],
        message: 'unverified program data cannot have a verification time',
      });
    }
  });

const programSchema = z
  .object({
    id: z.string().trim().min(1),
    university: localizedTextSchema,
    name: localizedTextSchema,
    // Foreign (YURTDISI) programs publish no il in YÖK Atlas — the official UI renders
    // "--" — so city is honestly null for them, never derived from the university name.
    city: localizedTextSchema.nullable(),
    // All five live YÖK Atlas universiteTuru values plus KKTC→kibris. Older app binaries
    // reject the three new values at runtime validation and simply never show such rows
    // — the same intended forward-compat behavior as 'yetenek' below.
    type: z.enum(['devlet', 'vakif', 'kibris', 'vakif-myo', 'yurtdisi-vakif', 'yurtdisi-kamu']),
    // 'yetenek' = özel yetenek (talent-exam) admission from YÖK Atlas TABLO 5: these
    // programs have no central cutoff (minScore/minRank stay null); older app binaries
    // reject the value at runtime validation and simply never show such rows — the
    // intended forward-compat behavior, so the shared CURRENT_SCHEMA_VERSION never bumps.
    scoreType: z.enum(['say', 'ea', 'soz', 'tyt', 'dil', 'yetenek']),
    scholarship: z.enum(['burslu', '%25', '%50', 'ucretli']).nullable(),
    language: localizedTextSchema.nullable(),
    ...programVerificationShape,
    approximate: z.boolean(),
    sample: z.boolean(),
    years: z.array(programYearSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.verified && (!value.source || !value.verifiedAt)) {
      context.addIssue({
        code: 'custom',
        path: ['verifiedAt'],
        message: 'verified program data requires an official source URL and verification time',
      });
    }
    if (!value.verified && value.verifiedAt) {
      context.addIssue({
        code: 'custom',
        path: ['verifiedAt'],
        message: 'unverified program data cannot have a verification time',
      });
    }
  });

export const programsFixtureSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    dataStatus: dataStatusSchema,
    programs: z.array(programSchema).min(1),
  })
  .strict();

// ---------------------------------------------------------------------------
// Program EXTRAS: the official YÖK Atlas detail data (quota categories, kosul
// texts, staff counts, tuition, accreditation, last-placed candidate's nets).
// Produced by scripts/lib/yok-atlas-details.ts into programs-details.fixture.json,
// packed into programs.db by build-programs, and read back by the app's
// programRepository — this schema is the single shared contract for all three.
// ---------------------------------------------------------------------------

/** Quota-category slugs mirroring the official "Kontenjan ve Yerleşme" table rows. */
export const PROGRAM_QUOTA_CATEGORIES = [
  'genel',
  'okul-birincisi',
  'deprem',
  'sehit-gazi',
  'kadin-34',
] as const;
export type ProgramQuotaCategory = (typeof PROGRAM_QUOTA_CATEGORIES)[number];

/** Net-subject keys of the official "Yerleşen Son Kişinin Netleri" panel. */
export const PROGRAM_NET_SUBJECTS = [
  'tytTurkce',
  'tytSosyal',
  'tytMatematik',
  'tytFen',
  'aytMatematik',
  'aytFizik',
  'aytKimya',
  'aytBiyoloji',
  'aytEdebiyat',
  'aytTarih1',
  'aytCografya1',
  'aytTarih2',
  'aytCografya2',
  'aytFelsefe',
  'aytDin',
  'ydtDil',
] as const;
export type ProgramNetSubject = (typeof PROGRAM_NET_SUBJECTS)[number];

export const programStaffSchema = z
  .object({
    professor: z.int().nonnegative().nullable(),
    docent: z.int().nonnegative().nullable(),
    doctorFaculty: z.int().nonnegative().nullable(),
    lecturer: z.int().nonnegative().nullable(),
    researchAssistant: z.int().nonnegative().nullable(),
  })
  .strict();

export const programQuotaCategoryRowSchema = z
  .object({
    category: z.enum(PROGRAM_QUOTA_CATEGORIES),
    year: z.int().min(2018).max(2100),
    quota: z.int().nonnegative().nullable(),
    placed: z.int().nonnegative().nullable(),
  })
  .strict();

export const programNetsRowSchema = z
  .object({
    year: z.int().min(2018).max(2100),
    scoreType: z.enum(['say', 'ea', 'soz', 'dil', 'tyt']),
    coefficient: z.number().positive().max(1).nullable(),
    minScore: z.number().positive().max(700).nullable(),
    obp: z.number().positive().max(600).nullable(),
    // partialRecord: only the subjects of the program's own score type are published.
    nets: z.partialRecord(z.enum(PROGRAM_NET_SUBJECTS), z.number().min(-120).max(120)),
  })
  .strict();

export const programExtrasSchema = z
  .object({
    faculty: z.string().min(1).nullable(),
    district: z.string().min(1).nullable(),
    educationType: z.string().min(1).nullable(),
    durationYears: z.int().positive().max(10).nullable(),
    programGroup: z.string().min(1).nullable(),
    tuition: z.int().positive().nullable(),
    accreditation: z.string().min(1).nullable(),
    accreditationNote: z.string().min(1).nullable(),
    tyc: z.boolean(),
    appliedEducationModel: z.string().min(1).nullable(),
    minRankRequirement: z.int().positive().nullable(),
    minRankRequirementNote: z.string().min(1).nullable(),
    staff: programStaffSchema.nullable(),
    // text is null for codes the source lists without publishing a text (rendered
    // code-only in the UI, never with invented wording).
    conditions: z.array(
      z
        .object({ code: z.string().regex(/^\d{1,4}$/), text: z.string().min(1).nullable() })
        .strict(),
    ),
    quotaCategories: z.array(programQuotaCategoryRowSchema),
    nets: z.array(programNetsRowSchema),
  })
  .strict();
export type ProgramExtras = z.infer<typeof programExtrasSchema>;

const manifestFileSchema = z
  .object({
    path: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
    buildFrom: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]*$/)
      .optional(),
  })
  .strict();

export const manifestSourceSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_PACK_SCHEMA_VERSION),
    packVersion: z.string().regex(/^\d{4}\.\d{2}\.\d+$/),
    minAppVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    examYear: z.int().min(2026).max(2100),
    files: z
      .object({
        topics: manifestFileSchema,
        coefficients: manifestFileSchema,
        rankTables: manifestFileSchema,
        programs: manifestFileSchema,
        calendar: manifestFileSchema,
        news: manifestFileSchema,
        topicGroupStatistics: manifestFileSchema,
        topicGroupMappings: manifestFileSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const paths = Object.values(manifest.files).map((descriptor) => descriptor.path);
    for (const [index, path] of paths.entries()) {
      if (path === 'manifest.json' || path === PACK_SIGNATURE_FILE_NAME) {
        context.addIssue({
          code: 'custom',
          path: ['files'],
          message: `${path} is reserved.`,
        });
      }
      if (paths.indexOf(path) !== index) {
        context.addIssue({
          code: 'custom',
          path: ['files'],
          message: `Duplicate file path: ${path}`,
        });
      }
    }
  });

export type TopicsDocument = z.infer<typeof topicsSchema>;

/** Appends one unknown year without regenerating or altering any existing topic evidence. */
export function extendTopicCoverage(document: unknown, targetYear: number): TopicsDocument {
  const current = topicsSchema.parse(document);
  const firstTopic = current.exams[0]?.sections[0]?.subjects[0]?.topics[0];
  const currentLastYear = firstTopic?.yearlyStats.at(-1)?.year;
  if (currentLastYear === undefined || targetYear !== currentLastYear + 1) {
    throw new Error(
      `Topic coverage can only extend by one contiguous year after ${currentLastYear ?? '<missing>'}.`,
    );
  }
  topicCoverageYears(targetYear);
  const proposed = structuredClone(current);
  for (const exam of proposed.exams) {
    for (const section of exam.sections) {
      for (const subject of section.subjects) {
        for (const topic of subject.topics) {
          topic.yearlyStats.push({
            year: targetYear,
            count: null,
            verified: false,
            source: null,
            verificationMethod: null,
            verifiedAt: null,
          });
        }
      }
    }
  }
  return topicsSchema.parse(proposed);
}

export type CoefficientsDocument = z.infer<typeof coefficientsSchema>;
export type RankTablesDocument = z.infer<typeof rankTablesSchema>;
export type ProgramsFixture = z.infer<typeof programsFixtureSchema>;
export type ManifestSource = z.infer<typeof manifestSourceSchema>;
