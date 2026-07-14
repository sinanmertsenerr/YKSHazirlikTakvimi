import { createHash } from 'node:crypto';

import { z } from 'zod';

import { BOOKLET_FIRST_YEAR, BOOKLET_MAX_YEAR } from './osym-booklet-registry.ts';
import {
  primaryTopicRefSchema,
  relatedTopicRefSchema,
  reviewSlugSchema,
} from './topic-review-contract.ts';

export const ANNUAL_CLASSIFIER_SCHEMA_VERSION = 1;
export const ANNUAL_CLASSIFIER_PROMPT_VERSION = 'annual-topic-v1';
export const ANNUAL_CLASSIFIER_TEXT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
export const ANNUAL_CLASSIFIER_VISION_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const ANNUAL_CLASSIFIER_MODELS = [
  ANNUAL_CLASSIFIER_TEXT_MODEL,
  ANNUAL_CLASSIFIER_VISION_MODEL,
] as const;

export const annualClassifierModelSchema = z.enum(ANNUAL_CLASSIFIER_MODELS);

const annualBookletIdSchema = z
  .string()
  .regex(/^\d{4}-(?:tyt|ayt)$/)
  .superRefine((value, context) => {
    const year = Number(value.slice(0, 4));
    if (year < BOOKLET_FIRST_YEAR || year > BOOKLET_MAX_YEAR) {
      context.addIssue({
        code: 'custom',
        message: `booklet ID year must be from ${BOOKLET_FIRST_YEAR} through ${BOOKLET_MAX_YEAR}`,
      });
    }
  });

const classifiedResultSchema = z
  .object({
    officialQuestionNo: z.int().positive(),
    primaryTopicRef: primaryTopicRefSchema,
    relatedTopicRefs: z.array(relatedTopicRefSchema).max(4),
    status: z.literal('classified'),
    confidence: z.number().min(0).max(1),
    page: z.int().positive().optional(),
  })
  .strict();

const needsReviewResultSchema = z
  .object({
    officialQuestionNo: z.int().positive(),
    primaryTopicRef: z.null(),
    relatedTopicRefs: z.tuple([]),
    status: z.literal('needs-review'),
    confidence: z.number().min(0).max(1),
    page: z.int().positive().optional(),
  })
  .strict();

export const annualClassifierResultSchema = z.discriminatedUnion('status', [
  classifiedResultSchema,
  needsReviewResultSchema,
]);

export const annualClassifierResponseSchema = z
  .object({
    schemaVersion: z.literal(ANNUAL_CLASSIFIER_SCHEMA_VERSION),
    questionBlockId: reviewSlugSchema,
    classifications: z.array(annualClassifierResultSchema).max(50),
  })
  .strict();

export type AnnualClassifierResult = z.infer<typeof annualClassifierResultSchema>;
export type AnnualClassifierResponse = z.infer<typeof annualClassifierResponseSchema>;

/**
 * Kept alongside the Zod contract so providers can request structured output,
 * while every response is still validated locally with Zod before it is used.
 */
export const ANNUAL_CLASSIFIER_RESPONSE_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'questionBlockId', 'classifications'],
  properties: {
    schemaVersion: { const: ANNUAL_CLASSIFIER_SCHEMA_VERSION },
    questionBlockId: {
      type: 'string',
      pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
      minLength: 1,
      maxLength: 120,
    },
    classifications: {
      type: 'array',
      maxItems: 50,
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: [
              'officialQuestionNo',
              'primaryTopicRef',
              'relatedTopicRefs',
              'status',
              'confidence',
            ],
            properties: {
              officialQuestionNo: { type: 'integer', minimum: 1 },
              primaryTopicRef: {
                type: 'object',
                additionalProperties: false,
                required: ['subjectId', 'topicId', 'countsTowardStats'],
                properties: {
                  subjectId: { type: 'string' },
                  topicId: { type: 'string' },
                  countsTowardStats: { const: true },
                },
              },
              relatedTopicRefs: {
                type: 'array',
                maxItems: 4,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: [
                    'exam',
                    'sectionId',
                    'subjectId',
                    'topicId',
                    'crossExam',
                    'countsTowardStats',
                  ],
                  properties: {
                    exam: { enum: ['tyt', 'ayt'] },
                    sectionId: { type: 'string' },
                    subjectId: { type: 'string' },
                    topicId: { type: 'string' },
                    crossExam: { type: 'boolean' },
                    countsTowardStats: { const: false },
                  },
                },
              },
              status: { const: 'classified' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              page: { type: 'integer', minimum: 1 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: [
              'officialQuestionNo',
              'primaryTopicRef',
              'relatedTopicRefs',
              'status',
              'confidence',
            ],
            properties: {
              officialQuestionNo: { type: 'integer', minimum: 1 },
              primaryTopicRef: { type: 'null' },
              relatedTopicRefs: { type: 'array', maxItems: 0 },
              status: { const: 'needs-review' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              page: { type: 'integer', minimum: 1 },
            },
          },
        ],
      },
    },
  },
} as const;

const passIdSchema = z.enum(['text-primary', 'text-retry', 'vision-primary', 'vision-retry']);

export const annualClassifierCacheEntrySchema = z
  .object({
    schemaVersion: z.literal(ANNUAL_CLASSIFIER_SCHEMA_VERSION),
    key: z
      .object({
        bookletSha256: z.string().regex(/^[0-9a-f]{64}$/),
        taxonomySha256: z.string().regex(/^[0-9a-f]{64}$/),
        model: annualClassifierModelSchema,
        promptVersion: z.literal(ANNUAL_CLASSIFIER_PROMPT_VERSION),
        passId: passIdSchema,
        questionBlockId: reviewSlugSchema,
        unitId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      })
      .strict(),
    response: annualClassifierResponseSchema,
  })
  .strict();

export type AnnualClassifierCacheEntry = z.infer<typeof annualClassifierCacheEntrySchema>;
export type AnnualClassifierCacheKey = AnnualClassifierCacheEntry['key'];

const reportPassResultSchema = annualClassifierResultSchema;

export const annualClassifierReportSchema = z
  .object({
    schemaVersion: z.literal(ANNUAL_CLASSIFIER_SCHEMA_VERSION),
    kind: z.literal('annual-topic-classification-dry-run'),
    dryRun: z.literal(true),
    scope: z
      .object({
        year: z.int().min(BOOKLET_FIRST_YEAR).max(BOOKLET_MAX_YEAR),
        exam: z.enum(['tyt', 'ayt']),
        questionBlockId: reviewSlugSchema,
        sectionId: reviewSlugSchema,
        bookletSectionId: reviewSlugSchema,
        questionRange: z.object({ first: z.int().positive(), last: z.int().positive() }).strict(),
      })
      .strict(),
    provenance: z
      .object({
        bookletId: annualBookletIdSchema,
        bookletSha256: z.string().regex(/^[0-9a-f]{64}$/),
        taxonomySha256: z.string().regex(/^[0-9a-f]{64}$/),
        promptVersion: z.literal(ANNUAL_CLASSIFIER_PROMPT_VERSION),
        textModel: z.literal(ANNUAL_CLASSIFIER_TEXT_MODEL),
        visionModel: z.literal(ANNUAL_CLASSIFIER_VISION_MODEL),
      })
      .strict(),
    execution: z
      .object({
        textProviderCalls: z.int().nonnegative(),
        textCacheHits: z.int().nonnegative(),
        textRetryUsed: z.boolean(),
        visionProviderCalls: z.int().nonnegative(),
        visionCacheHits: z.int().nonnegative(),
        visionRetryUsed: z.boolean(),
      })
      .strict(),
    questions: z.array(
      z
        .object({
          officialQuestionNo: z.int().positive(),
          text: reportPassResultSchema,
          vision: reportPassResultSchema,
          consensus: z.enum(['agreed', 'needs-review', 'disputed']),
          consensusConfidence: z.number().min(0).max(1),
        })
        .strict(),
    ),
    summary: z
      .object({
        total: z.int().positive(),
        agreed: z.int().nonnegative(),
        needsReview: z.int().nonnegative(),
        disputed: z.int().nonnegative(),
      })
      .strict(),
    publication: z
      .object({
        automatic: z.literal(false),
        reason: z.literal('human-adjudication-required'),
      })
      .strict(),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.provenance.bookletId !== `${report.scope.year}-${report.scope.exam}`) {
      context.addIssue({
        code: 'custom',
        path: ['provenance', 'bookletId'],
        message: 'report bookletId must exactly match its year/exam scope',
      });
    }
    const expectedQuestionNumbers = Array.from(
      { length: report.scope.questionRange.last - report.scope.questionRange.first + 1 },
      (_, index) => report.scope.questionRange.first + index,
    );
    const questionNumbers = report.questions.map(({ officialQuestionNo }) => officialQuestionNo);
    if (
      questionNumbers.length !== expectedQuestionNumbers.length ||
      questionNumbers.some((questionNo, index) => questionNo !== expectedQuestionNumbers[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: 'report questions must cover the exact official range once and in order',
      });
    }
    report.questions.forEach((question, index) => {
      if (
        question.text.officialQuestionNo !== question.officialQuestionNo ||
        question.vision.officialQuestionNo !== question.officialQuestionNo
      ) {
        context.addIssue({
          code: 'custom',
          path: ['questions', index, 'officialQuestionNo'],
          message: 'outer, text-pass, and vision-pass official question numbers must match',
        });
      }
    });
    const observedSummary = {
      total: report.questions.length,
      agreed: report.questions.filter(({ consensus }) => consensus === 'agreed').length,
      needsReview: report.questions.filter(({ consensus }) => consensus === 'needs-review').length,
      disputed: report.questions.filter(({ consensus }) => consensus === 'disputed').length,
    };
    for (const key of ['total', 'agreed', 'needsReview', 'disputed'] as const) {
      if (report.summary[key] !== observedSummary[key]) {
        context.addIssue({
          code: 'custom',
          path: ['summary', key],
          message: `report summary ${key} must equal ${observedSummary[key]}`,
        });
      }
    }
  });

export type AnnualClassifierReport = z.infer<typeof annualClassifierReportSchema>;

const forbiddenContentKey =
  /(?:question(?:text|image)|raw|prompt|message|content|image(?:data|base64)|source(?:text|image|data)|dataurl)/i;

/** Defense in depth for caches and artifacts: only IDs, hashes and decisions may leave temp storage. */
export function assertIdOnlyPayload(value: unknown, path = '$'): void {
  if (typeof value === 'string' && /^data:(?:image|application)\//i.test(value)) {
    throw new Error(`${path} contains an embedded source payload`);
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertIdOnlyPayload(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key !== 'promptVersion' && forbiddenContentKey.test(key)) {
      throw new Error(`${path}.${key} is not permitted in an ID-only payload`);
    }
    assertIdOnlyPayload(nested, `${path}.${key}`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function stableSha256(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function annualClassifierCacheFileName(key: AnnualClassifierCacheKey): string {
  return `${stableSha256(key)}.json`;
}
