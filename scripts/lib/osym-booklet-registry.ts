import { z } from 'zod';

export const BOOKLET_REGISTRY_SCHEMA_VERSION = 2;
export const BOOKLET_FIRST_YEAR = 2018;
export const BOOKLET_MAX_YEAR = 2100;
export const OFFICIAL_PDF_HOSTS = ['dokuman.osym.gov.tr', 'cdn.osym.gov.tr'] as const;

export function bookletCoverageYears(lastYear: number): number[] {
  if (!Number.isInteger(lastYear) || lastYear < BOOKLET_FIRST_YEAR || lastYear > BOOKLET_MAX_YEAR) {
    throw new Error(
      `booklet coverage lastYear must be an integer from ${BOOKLET_FIRST_YEAR} through ${BOOKLET_MAX_YEAR}`,
    );
  }
  return Array.from(
    { length: lastYear - BOOKLET_FIRST_YEAR + 1 },
    (_, index) => BOOKLET_FIRST_YEAR + index,
  );
}

export const OFFICIAL_QUESTION_BLOCKS = {
  tyt: [
    {
      id: 'tyt-turkce-default',
      sectionId: 'tyt-turkce',
      bookletSectionId: 'turkce',
      officialQuestionRange: { first: 1, last: 40 },
      subjectIds: ['tyt-turkce'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'tyt-sosyal-tarih-default',
      sectionId: 'tyt-sosyal',
      bookletSectionId: 'sosyal-bilimler',
      officialQuestionRange: { first: 1, last: 5 },
      subjectIds: ['tyt-tarih'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'tyt-sosyal-cografya-default',
      sectionId: 'tyt-sosyal',
      bookletSectionId: 'sosyal-bilimler',
      officialQuestionRange: { first: 6, last: 10 },
      subjectIds: ['tyt-cografya'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'tyt-sosyal-felsefe-default',
      sectionId: 'tyt-sosyal',
      bookletSectionId: 'sosyal-bilimler',
      officialQuestionRange: { first: 11, last: 15 },
      subjectIds: ['tyt-felsefe'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'tyt-sosyal-din-default',
      sectionId: 'tyt-sosyal',
      bookletSectionId: 'sosyal-bilimler',
      officialQuestionRange: { first: 16, last: 20 },
      subjectIds: ['tyt-din-kulturu'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'tyt-sosyal-felsefe-no-dkab',
      sectionId: 'tyt-sosyal',
      bookletSectionId: 'sosyal-bilimler',
      officialQuestionRange: { first: 21, last: 25 },
      subjectIds: ['tyt-felsefe'],
      answerSetId: 'no-dkab',
      alternativeForSubjectId: 'tyt-din-kulturu',
      countsTowardDefaultStats: false,
    },
    {
      id: 'tyt-temel-matematik-default',
      sectionId: 'tyt-matematik',
      bookletSectionId: 'temel-matematik',
      officialQuestionRange: { first: 1, last: 40 },
      subjectIds: ['tyt-matematik', 'tyt-geometri'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'tyt-fen-fizik-default',
      sectionId: 'tyt-fen',
      bookletSectionId: 'fen-bilimleri',
      officialQuestionRange: { first: 1, last: 7 },
      subjectIds: ['tyt-fizik'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'tyt-fen-kimya-default',
      sectionId: 'tyt-fen',
      bookletSectionId: 'fen-bilimleri',
      officialQuestionRange: { first: 8, last: 14 },
      subjectIds: ['tyt-kimya'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'tyt-fen-biyoloji-default',
      sectionId: 'tyt-fen',
      bookletSectionId: 'fen-bilimleri',
      officialQuestionRange: { first: 15, last: 20 },
      subjectIds: ['tyt-biyoloji'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
  ],
  ayt: [
    {
      id: 'ayt-edebiyat-default',
      sectionId: 'ayt-edebiyat-sosyal-1',
      bookletSectionId: 'turk-dili-ve-edebiyati-sosyal-bilimler-1',
      officialQuestionRange: { first: 1, last: 24 },
      subjectIds: ['ayt-edebiyat'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'ayt-tarih-1-default',
      sectionId: 'ayt-edebiyat-sosyal-1',
      bookletSectionId: 'turk-dili-ve-edebiyati-sosyal-bilimler-1',
      officialQuestionRange: { first: 25, last: 34 },
      subjectIds: ['ayt-tarih-1'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'ayt-cografya-1-default',
      sectionId: 'ayt-edebiyat-sosyal-1',
      bookletSectionId: 'turk-dili-ve-edebiyati-sosyal-bilimler-1',
      officialQuestionRange: { first: 35, last: 40 },
      subjectIds: ['ayt-cografya-1'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'ayt-sosyal-2-tarih-default',
      sectionId: 'ayt-sosyal-2',
      bookletSectionId: 'sosyal-bilimler-2',
      officialQuestionRange: { first: 1, last: 11 },
      subjectIds: ['ayt-tarih-2'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'ayt-sosyal-2-cografya-default',
      sectionId: 'ayt-sosyal-2',
      bookletSectionId: 'sosyal-bilimler-2',
      officialQuestionRange: { first: 12, last: 22 },
      subjectIds: ['ayt-cografya-2'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'ayt-sosyal-2-felsefe-default',
      sectionId: 'ayt-sosyal-2',
      bookletSectionId: 'sosyal-bilimler-2',
      officialQuestionRange: { first: 23, last: 34 },
      subjectIds: ['ayt-felsefe-grubu'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'ayt-sosyal-2-din-default',
      sectionId: 'ayt-sosyal-2',
      bookletSectionId: 'sosyal-bilimler-2',
      officialQuestionRange: { first: 35, last: 40 },
      subjectIds: ['ayt-din-kulturu'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'ayt-sosyal-2-felsefe-no-dkab',
      sectionId: 'ayt-sosyal-2',
      bookletSectionId: 'sosyal-bilimler-2',
      officialQuestionRange: { first: 41, last: 46 },
      subjectIds: ['ayt-felsefe-grubu'],
      answerSetId: 'no-dkab',
      alternativeForSubjectId: 'ayt-din-kulturu',
      countsTowardDefaultStats: false,
    },
    {
      id: 'ayt-matematik-default',
      sectionId: 'ayt-matematik',
      bookletSectionId: 'matematik',
      officialQuestionRange: { first: 1, last: 40 },
      subjectIds: ['ayt-matematik', 'ayt-geometri'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'ayt-fen-fizik-default',
      sectionId: 'ayt-fen',
      bookletSectionId: 'fen-bilimleri',
      officialQuestionRange: { first: 1, last: 14 },
      subjectIds: ['ayt-fizik'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'ayt-fen-kimya-default',
      sectionId: 'ayt-fen',
      bookletSectionId: 'fen-bilimleri',
      officialQuestionRange: { first: 15, last: 27 },
      subjectIds: ['ayt-kimya'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
    {
      id: 'ayt-fen-biyoloji-default',
      sectionId: 'ayt-fen',
      bookletSectionId: 'fen-bilimleri',
      officialQuestionRange: { first: 28, last: 40 },
      subjectIds: ['ayt-biyoloji'],
      answerSetId: 'default',
      alternativeForSubjectId: null,
      countsTowardDefaultStats: true,
    },
  ],
} as const;

const officialReleasePageUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.osym.gov.tr' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    context.addIssue({
      code: 'custom',
      message: 'releasePageUrl must be a clean HTTPS URL on www.osym.gov.tr',
    });
  }
});

const officialPdfUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !OFFICIAL_PDF_HOSTS.includes(url.hostname as (typeof OFFICIAL_PDF_HOSTS)[number]) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.toLocaleLowerCase('en-US').startsWith('/pdfdokuman/') ||
    !url.pathname.toLocaleLowerCase('en-US').endsWith('.pdf')
  ) {
    context.addIssue({
      code: 'custom',
      message: `pdfUrl must be a clean HTTPS PDF URL on ${OFFICIAL_PDF_HOSTS.join(' or ')}`,
    });
  }
});

const section = <
  Id extends string,
  QuestionsToAnswer extends number,
  QuestionsPrinted extends number,
>(
  id: Id,
  questionsToAnswer: QuestionsToAnswer,
  questionsPrinted: QuestionsPrinted,
) =>
  z
    .object({
      id: z.literal(id),
      questionsToAnswer: z.literal(questionsToAnswer),
      questionsPrinted: z.literal(questionsPrinted),
    })
    .strict();

const sessionStructuresSchema = z
  .object({
    tyt: z
      .object({
        questionsToAnswer: z.literal(120),
        questionsPrinted: z.literal(125),
        sections: z.tuple([
          section('turkce', 40, 40),
          section('sosyal-bilimler', 20, 25),
          section('temel-matematik', 40, 40),
          section('fen-bilimleri', 20, 20),
        ]),
      })
      .strict(),
    ayt: z
      .object({
        questionsToAnswer: z.literal(160),
        questionsPrinted: z.literal(166),
        sections: z.tuple([
          section('turk-dili-ve-edebiyati-sosyal-bilimler-1', 40, 40),
          section('sosyal-bilimler-2', 40, 46),
          section('matematik', 40, 40),
          section('fen-bilimleri', 40, 40),
        ]),
      })
      .strict(),
  })
  .strict();

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const officialQuestionRangeSchema = z
  .object({
    first: z.int().positive(),
    last: z.int().positive(),
  })
  .strict()
  .refine((range) => range.last >= range.first, {
    path: ['last'],
    message: 'official question range cannot be reversed',
  });

export const officialQuestionBlockSchema = z
  .object({
    id: slugSchema,
    sectionId: slugSchema,
    bookletSectionId: slugSchema,
    officialQuestionRange: officialQuestionRangeSchema,
    subjectIds: z.array(slugSchema).min(1),
    answerSetId: z.enum(['default', 'no-dkab']),
    alternativeForSubjectId: z.union([slugSchema, z.null()]),
    countsTowardDefaultStats: z.boolean(),
  })
  .strict()
  .superRefine((block, context) => {
    if (new Set(block.subjectIds).size !== block.subjectIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['subjectIds'],
        message: 'question-block subject IDs must be unique',
      });
    }
    const canonical = block.answerSetId === 'default';
    if (
      canonical !== block.countsTowardDefaultStats ||
      canonical !== (block.alternativeForSubjectId === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['answerSetId'],
        message:
          'default blocks must count toward canonical stats; alternative blocks must name the replaced subject and remain evidence-only',
      });
    }
  });

const questionBlockProfileSchema = z
  .object({
    verificationMethod: z.literal('official-booklet-headers'),
    verifiedAt: z.iso.date(),
    verifiedBookletIds: z
      .array(
        z.string().superRefine((value, context) => {
          const match = /^(\d{4})-(?:tyt|ayt)$/.exec(value);
          const year = match ? Number(match[1]) : Number.NaN;
          if (!match || year < BOOKLET_FIRST_YEAR || year > BOOKLET_MAX_YEAR) {
            context.addIssue({
              code: 'custom',
              message: `booklet ID must use YYYY-tyt/ayt with a year from ${BOOKLET_FIRST_YEAR} through ${BOOKLET_MAX_YEAR}`,
            });
          }
        }),
      )
      .min(1),
    questionBlocks: z.array(officialQuestionBlockSchema).min(1),
  })
  .strict();

const questionBlockProfilesSchema = z
  .object({
    tyt: questionBlockProfileSchema,
    ayt: questionBlockProfileSchema,
  })
  .strict();

const bookletSchema = z
  .object({
    year: z.int().min(BOOKLET_FIRST_YEAR).max(BOOKLET_MAX_YEAR),
    session: z.enum(['tyt', 'ayt']),
    examDate: z.iso.date(),
    releasePageUrl: officialReleasePageUrlSchema,
    pdfUrl: officialPdfUrlSchema,
    verifiedAt: z.iso.date(),
    bytes: z
      .int()
      .positive()
      .max(25 * 1024 * 1024),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .refine((value) => !/^0{64}$/.test(value), 'sha256 cannot be a placeholder'),
  })
  .strict();

export const osymBookletRegistrySchema = z
  .object({
    schemaVersion: z.literal(BOOKLET_REGISTRY_SCHEMA_VERSION),
    authority: z.literal('ÖSYM'),
    coverage: z
      .object({
        firstYear: z.literal(BOOKLET_FIRST_YEAR),
        lastYear: z.int().min(BOOKLET_FIRST_YEAR).max(BOOKLET_MAX_YEAR),
        sessions: z.tuple([z.literal('tyt'), z.literal('ayt')]),
      })
      .strict(),
    contentPolicy: z
      .object({
        questionTextStored: z.literal(false),
        questionImagesStored: z.literal(false),
        topicMappingsIncluded: z.literal(false),
      })
      .strict(),
    sessionStructures: sessionStructuresSchema,
    questionBlockProfiles: questionBlockProfilesSchema,
    booklets: z.array(bookletSchema).min(2),
  })
  .strict()
  .superRefine((registry, context) => {
    const seenPairs = new Set<string>();
    const seenPdfUrls = new Set<string>();
    const coverageYears = bookletCoverageYears(registry.coverage.lastYear);
    const expectedOrder = coverageYears.flatMap((year) => [`${year}-tyt`, `${year}-ayt`]);

    if (registry.booklets.length !== expectedOrder.length) {
      context.addIssue({
        code: 'custom',
        path: ['booklets'],
        message: `coverage requires exactly ${expectedOrder.length} TYT/AYT booklet records`,
      });
    }

    registry.booklets.forEach((booklet, index) => {
      const pair = `${booklet.year}-${booklet.session}`;
      if (seenPairs.has(pair)) {
        context.addIssue({
          code: 'custom',
          path: ['booklets', index],
          message: `duplicate year/session pair ${pair}`,
        });
      }
      seenPairs.add(pair);

      if (seenPdfUrls.has(booklet.pdfUrl)) {
        context.addIssue({
          code: 'custom',
          path: ['booklets', index, 'pdfUrl'],
          message: 'pdfUrl must be unique',
        });
      }
      seenPdfUrls.add(booklet.pdfUrl);

      if (expectedOrder[index] !== pair) {
        context.addIssue({
          code: 'custom',
          path: ['booklets', index],
          message: `expected ${expectedOrder[index] ?? 'no additional record'}, received ${pair}`,
        });
      }

      if (booklet.verifiedAt < booklet.examDate) {
        context.addIssue({
          code: 'custom',
          path: ['booklets', index, 'verifiedAt'],
          message: 'verifiedAt cannot precede examDate',
        });
      }

      const pdfPath = new URL(booklet.pdfUrl).pathname.toLocaleLowerCase('en-US');
      if (!pdfPath.includes(`/${booklet.year}/yks/`) || !pdfPath.includes(booklet.session)) {
        context.addIssue({
          code: 'custom',
          path: ['booklets', index, 'pdfUrl'],
          message: 'pdfUrl path must match the record year and session',
        });
      }

      const releasePath = new URL(booklet.releasePageUrl).pathname.toLocaleLowerCase('en-US');
      if (!releasePath.includes(String(booklet.year))) {
        context.addIssue({
          code: 'custom',
          path: ['booklets', index, 'releasePageUrl'],
          message: 'releasePageUrl path must match the record year',
        });
      }
    });

    for (const pair of expectedOrder) {
      if (!seenPairs.has(pair)) {
        context.addIssue({
          code: 'custom',
          path: ['booklets'],
          message: `missing required year/session pair ${pair}`,
        });
      }
    }

    for (const session of ['tyt', 'ayt'] as const) {
      const profile = registry.questionBlockProfiles[session];
      const expectedBookletIds = coverageYears.map((year) => `${year}-${session}`);
      if (
        profile.verifiedBookletIds.length !== expectedBookletIds.length ||
        profile.verifiedBookletIds.some((id, index) => id !== expectedBookletIds[index])
      ) {
        context.addIssue({
          code: 'custom',
          path: ['questionBlockProfiles', session, 'verifiedBookletIds'],
          message: `must attest every official ${session.toUpperCase()} booklet from ${BOOKLET_FIRST_YEAR} through ${registry.coverage.lastYear} in order`,
        });
      }

      const expectedBlocks = OFFICIAL_QUESTION_BLOCKS[session];
      if (JSON.stringify(profile.questionBlocks) !== JSON.stringify(expectedBlocks)) {
        context.addIssue({
          code: 'custom',
          path: ['questionBlockProfiles', session, 'questionBlocks'],
          message: `question blocks must exactly match the official ${session.toUpperCase()} booklet headers`,
        });
      }

      const latestExamDate = registry.booklets
        .filter((booklet) => booklet.session === session)
        .map((booklet) => booklet.examDate)
        .sort()
        .at(-1);
      if (latestExamDate && profile.verifiedAt < latestExamDate) {
        context.addIssue({
          code: 'custom',
          path: ['questionBlockProfiles', session, 'verifiedAt'],
          message: 'question-block verification cannot precede the latest attested booklet',
        });
      }

      const blockIds = profile.questionBlocks.map((block) => block.id);
      if (new Set(blockIds).size !== blockIds.length) {
        context.addIssue({
          code: 'custom',
          path: ['questionBlockProfiles', session, 'questionBlocks'],
          message: 'question-block IDs must be unique within a session profile',
        });
      }

      for (const officialSection of registry.sessionStructures[session].sections) {
        const sectionBlocks = profile.questionBlocks.filter(
          (block) => block.bookletSectionId === officialSection.id,
        );
        if (!sectionBlocks.length) {
          context.addIssue({
            code: 'custom',
            path: ['questionBlockProfiles', session, 'questionBlocks'],
            message: `missing question blocks for booklet section ${officialSection.id}`,
          });
          continue;
        }
        if (new Set(sectionBlocks.map((block) => block.sectionId)).size !== 1) {
          context.addIssue({
            code: 'custom',
            path: ['questionBlockProfiles', session, 'questionBlocks'],
            message: `${officialSection.id} blocks must map to exactly one taxonomy section`,
          });
        }

        const numbersFor = (blocks: typeof sectionBlocks) =>
          blocks.flatMap((block) =>
            Array.from(
              {
                length: block.officialQuestionRange.last - block.officialQuestionRange.first + 1,
              },
              (_, index) => block.officialQuestionRange.first + index,
            ),
          );
        const hasExactCoverage = (numbers: number[], expectedCount: number) =>
          numbers.length === expectedCount &&
          new Set(numbers).size === expectedCount &&
          Array.from({ length: expectedCount }, (_, index) => index + 1).every((questionNo) =>
            numbers.includes(questionNo),
          );

        const printedNumbers = numbersFor(sectionBlocks);
        if (!hasExactCoverage(printedNumbers, officialSection.questionsPrinted)) {
          context.addIssue({
            code: 'custom',
            path: ['questionBlockProfiles', session, 'questionBlocks'],
            message: `${officialSection.id} blocks must partition every printed question exactly once`,
          });
        }

        const defaultBlocks = sectionBlocks.filter((block) => block.answerSetId === 'default');
        if (!hasExactCoverage(numbersFor(defaultBlocks), officialSection.questionsToAnswer)) {
          context.addIssue({
            code: 'custom',
            path: ['questionBlockProfiles', session, 'questionBlocks'],
            message: `${officialSection.id} default answer set must contain exactly ${officialSection.questionsToAnswer} questions`,
          });
        }

        const alternativeBlocks = sectionBlocks.filter((block) => block.answerSetId === 'no-dkab');
        if (alternativeBlocks.length) {
          const replacedSubjects = new Set(
            alternativeBlocks.map((block) => block.alternativeForSubjectId!),
          );
          for (const replacedSubject of replacedSubjects) {
            if (
              defaultBlocks.filter((block) => block.subjectIds.includes(replacedSubject)).length !==
              1
            ) {
              context.addIssue({
                code: 'custom',
                path: ['questionBlockProfiles', session, 'questionBlocks'],
                message: `${officialSection.id} alternative target ${replacedSubject} must replace exactly one default block`,
              });
            }
          }
          const exemptPathBlocks = [
            ...defaultBlocks.filter(
              (block) => !block.subjectIds.some((subjectId) => replacedSubjects.has(subjectId)),
            ),
            ...alternativeBlocks,
          ];
          if (numbersFor(exemptPathBlocks).length !== officialSection.questionsToAnswer) {
            context.addIssue({
              code: 'custom',
              path: ['questionBlockProfiles', session, 'questionBlocks'],
              message: `${officialSection.id} no-DKAB answer path must still contain exactly ${officialSection.questionsToAnswer} questions`,
            });
          }
        }
      }
    }
  });

export type OsymBookletRegistry = z.infer<typeof osymBookletRegistrySchema>;
export type OsymBooklet = OsymBookletRegistry['booklets'][number];
export type OfficialQuestionBlock = z.infer<typeof officialQuestionBlockSchema>;

export type ExactQuestionBlockScope = Pick<
  OfficialQuestionBlock,
  'sectionId' | 'bookletSectionId' | 'answerSetId'
> & {
  questionRange: OfficialQuestionBlock['officialQuestionRange'];
};

export function findExactQuestionBlock(
  registry: OsymBookletRegistry,
  session: 'tyt' | 'ayt',
  scope: ExactQuestionBlockScope,
): OfficialQuestionBlock {
  const matches = registry.questionBlockProfiles[session].questionBlocks.filter(
    (block) =>
      block.sectionId === scope.sectionId &&
      block.bookletSectionId === scope.bookletSectionId &&
      block.answerSetId === scope.answerSetId &&
      block.officialQuestionRange.first === scope.questionRange.first &&
      block.officialQuestionRange.last === scope.questionRange.last,
  );
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one official ${session.toUpperCase()} question block for ${scope.sectionId}/${scope.bookletSectionId}/${scope.questionRange.first}-${scope.questionRange.last}/${scope.answerSetId}, found ${matches.length}`,
    );
  }
  return matches[0]!;
}

export function assertAllowedOfficialPdfUrl(value: string): URL {
  const result = officialPdfUrlSchema.safeParse(value);
  if (!result.success) {
    throw new Error(result.error.issues.map((issue) => issue.message).join('; '));
  }
  return new URL(result.data);
}
