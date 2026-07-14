import { z } from 'zod';

import { isRelevantNewsTitle } from './news-relevance.ts';
import {
  BOOKLET_FIRST_YEAR,
  BOOKLET_MAX_YEAR,
  OFFICIAL_QUESTION_BLOCKS,
} from './osym-booklet-registry.ts';
import { isAllowedRelatedSubject } from './topic-discipline-families.ts';

export const CURRENT_SCHEMA_VERSION = 2;

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
    id: z.enum(['tyt', 'ayt']),
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
    exams: z.array(examSchema).length(2),
  })
  .strict()
  .superRefine((pack, context) => {
    const examIds = pack.exams.map((exam) => exam.id);
    if (new Set(examIds).size !== 2 || !examIds.includes('tyt') || !examIds.includes('ayt')) {
      context.addIssue({
        code: 'custom',
        path: ['exams'],
        message: 'exactly one TYT and one AYT exam are required',
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
    city: localizedTextSchema,
    type: z.enum(['devlet', 'vakif', 'kibris']),
    scoreType: z.enum(['say', 'ea', 'soz', 'tyt']),
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
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
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
      })
      .strict(),
  })
  .strict();

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
