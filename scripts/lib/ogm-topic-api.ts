import { z } from 'zod';

import { assertAllowedOgmUrl, type IncludedOgmTopicSource } from './ogm-topic-registry.ts';

export const OGM_TOPIC_API_BASE_URL = 'https://ogmmateryal.eba.gov.tr/ogm-test-api/v1/general';
export const MAX_OGM_API_JSON_BYTES = 4 * 1024 * 1024;
export const DEFAULT_OGM_API_TIMEOUT_MS = 20_000;
export const MAX_OGM_API_REDIRECTS = 2;

const USER_AGENT = 'YKS-OGM-Topic-API-Audit/1.0';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_OGM_API_ATTEMPTS = 3;
const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/);
const optionalObjectIdSchema = z.union([objectIdSchema, z.literal('')]);
const timestampSchema = z.string().min(1).max(64);

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const testMetadataSchema = z
  .object({
    testTitle: z.string().min(1),
    unitName: z.string().nullable(),
    bookId: objectIdSchema,
    startPage: z.int().positive(),
    pageCount: z.int().positive(),
    branchId: objectIdSchema,
    questionCount: z.int().positive(),
    firstQuestionNumber: z.int().positive(),
    questionsSaved: z.boolean(),
    extraDataCopied: z.boolean(),
    sharedRoots: z.array(z.unknown()),
    createdBy: z.string().min(1),
    updatedBy: z.string().min(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    id: objectIdSchema,
  })
  .strict();

export const ogmApiBookSchema = z
  .object({
    lockActiveAt: z.string().nullable(),
    bookTitle: z.string().min(1),
    pdfPublicUrl: z.string().min(1),
    pageCount: z.int().positive(),
    publicImageFolderRootUrl: z.string().min(1),
    imageExtension: z.string().min(1),
    leftMarginPercentage: z.number(),
    rightMarginPercentage: z.number(),
    topMarginPercentage: z.number(),
    bottomMarginPercentage: z.number(),
    firstPageTopMarginPercentage: z.number(),
    originalImageWidth: z.int().positive(),
    originalImageHeight: z.int().positive(),
    defaultBranchId: optionalObjectIdSchema,
    includesMultiTests: z.boolean(),
    testCount: z.int().nonnegative(),
    linkPages: z.array(z.unknown()),
    hasCover: z.boolean(),
    choiceCanvases: z.array(z.unknown()),
    archive: z.boolean(),
    authorizedUsers: z.array(z.unknown()),
    createdBy: z.string().min(1),
    updatedBy: z.string().min(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    choiceCanvasesQuestion: z.unknown(),
    choiceCanvasesQuestionCanvas: z.unknown(),
    imagesChangedNotified: z.boolean().optional(),
    imagesLastModified: z.string().optional(),
    imagesLastModifiedDateNotMatching: z.boolean().optional(),
    id: objectIdSchema,
  })
  .strict();

export const ogmBookApiResponseSchema = z
  .object({ book: ogmApiBookSchema, tests: z.array(testMetadataSchema) })
  .strict();

const questionIdentitySchema = z
  .object({
    questionNumber: z.int().positive(),
    choiceCount: z.unknown(),
    testId: objectIdSchema,
    bookId: objectIdSchema,
    pageNumber: z.unknown(),
    left: z.unknown(),
    top: z.unknown(),
    width: z.unknown(),
    height: z.unknown(),
    column: z.unknown(),
    correctChoiceIndex: z.unknown(),
    saved: z.unknown(),
    unsavedChanges: z.unknown(),
    choices: z.unknown(),
    visuallyChecked: z.unknown(),
    choicePattern: z.unknown(),
    outcomeIds: z.unknown(),
    createdBy: z.unknown(),
    updatedBy: z.unknown(),
    createdAt: z.unknown(),
    updatedAt: z.unknown(),
    videoData: z.unknown().optional(),
    id: objectIdSchema,
  })
  .strict()
  .transform(({ id, testId, bookId, questionNumber }) => ({
    id,
    testId,
    bookId,
    questionNumber,
  }));

export const ogmTestApiResponseSchema = z
  .object({
    test: testMetadataSchema,
    questions: z.array(questionIdentitySchema),
    book: ogmApiBookSchema,
    stats: z.unknown(),
    pageSharingQuestions: z.unknown(),
    pageSharingTestsSharedRoots: z.unknown(),
  })
  .strict();

export type OgmApiAuditObservation = {
  sourceId: number;
  bookObjectId: string;
  testCount: number;
  questionCount: number;
  questionIdCount?: number;
};

export function assertOgmQuestionNumberCoverage(
  questions: readonly { id: string; questionNumber: number }[],
  expectedCount: number,
  label: string,
): void {
  const numbers = new Set(questions.map(({ questionNumber }) => questionNumber));
  if (questions.length < expectedCount || numbers.size !== expectedCount) {
    throw new Error(`${label} question number coverage drift`);
  }
  for (let number = 1; number <= expectedCount; number += 1) {
    if (!numbers.has(number)) throw new Error(`${label} is missing question number ${number}`);
  }
  if ([...numbers].some((number) => number < 1 || number > expectedCount)) {
    throw new Error(`${label} has an out-of-range question number`);
  }
}

type RequestOptions = {
  etag?: string;
  fetchImpl?: FetchLike;
  maxBytes?: number;
  retryDelayImpl?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
};

export type OgmJsonFetchResult =
  { status: 'ok'; value: unknown; etag?: string } | { status: 'not-modified'; etag?: string };

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The stream may already be closed.
  }
}

async function retryDelay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelayMilliseconds(response: Response, attempt: number): number {
  const fallback = attempt === 1 ? 250 : 750;
  const retryAfter = response.headers.get('retry-after')?.trim();
  if (!retryAfter) return fallback;
  const milliseconds = /^\d+$/.test(retryAfter)
    ? Number(retryAfter) * 1_000
    : Date.parse(retryAfter) - Date.now();
  return Number.isFinite(milliseconds) ? Math.max(0, Math.min(milliseconds, 5_000)) : fallback;
}

async function getWithRetry(
  fetchImpl: FetchLike,
  input: string,
  init: RequestInit,
  timeoutMs: number,
  delayImpl: (milliseconds: number) => Promise<void>,
): Promise<Response> {
  for (let attempt = 1; attempt <= MAX_OGM_API_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(input, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error('official OGM GET failed before receiving an HTTP response', {
        cause: error,
      });
    }
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_OGM_API_ATTEMPTS) {
      return response;
    }
    const milliseconds = retryDelayMilliseconds(response, attempt);
    await cancelBody(response);
    await delayImpl(milliseconds);
  }
  throw new Error('official OGM request retry loop ended unexpectedly');
}

function requestLimits(options: RequestOptions): { maxBytes: number; timeoutMs: number } {
  const maxBytes = options.maxBytes ?? MAX_OGM_API_JSON_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_OGM_API_TIMEOUT_MS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 2 || maxBytes > MAX_OGM_API_JSON_BYTES) {
    throw new Error(`maxBytes must be an integer from 2 through ${MAX_OGM_API_JSON_BYTES}`);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('timeoutMs must be an integer from 1 through 120000');
  }
  return { maxBytes, timeoutMs };
}

export async function fetchOgmJson(
  input: string,
  options: RequestOptions = {},
): Promise<OgmJsonFetchResult> {
  const { maxBytes, timeoutMs } = requestLimits(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  let currentUrl = assertAllowedOgmUrl(input);
  for (let redirects = 0; redirects <= MAX_OGM_API_REDIRECTS; redirects += 1) {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': USER_AGENT,
    };
    if (options.etag) headers['if-none-match'] = options.etag;
    const response = await getWithRetry(
      fetchImpl,
      currentUrl,
      {
        headers,
        redirect: 'manual',
      },
      timeoutMs,
      options.retryDelayImpl ?? retryDelay,
    );
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      await cancelBody(response);
      if (!location) throw new Error(`HTTP ${response.status} redirect has no Location header`);
      if (redirects === MAX_OGM_API_REDIRECTS) throw new Error('OGM API redirect limit exceeded');
      currentUrl = assertAllowedOgmUrl(new URL(location, currentUrl).href);
      continue;
    }
    const etag = response.headers.get('etag') ?? undefined;
    if (response.status === 304) {
      await cancelBody(response);
      return { status: 'not-modified', ...(etag ? { etag } : {}) };
    }
    if (!response.ok) {
      await cancelBody(response);
      throw new Error(`official OGM API returned HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('application/json')) {
      await cancelBody(response);
      throw new Error(`expected OGM API JSON, received ${contentType || '<missing>'}`);
    }
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
      await cancelBody(response);
      throw new Error('OGM API JSON exceeds the response size limit');
    }
    if (!response.body) throw new Error('official OGM API returned an empty body');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw new Error('OGM API JSON exceeds the response size limit');
      chunks.push(chunk);
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'));
    } catch (error) {
      throw new Error(`official OGM API returned invalid JSON: ${String(error)}`);
    }
    return { status: 'ok', value, ...(etag ? { etag } : {}) };
  }
  throw new Error('OGM API redirect loop ended unexpectedly');
}

export async function discoverOgmBookObjectId(
  source: IncludedOgmTopicSource,
  options: RequestOptions = {},
): Promise<string> {
  const { timeoutMs } = requestLimits(options);
  let currentUrl = assertAllowedOgmUrl(source.api.discoveryUrl);
  for (let redirects = 0; redirects <= MAX_OGM_API_REDIRECTS; redirects += 1) {
    const response = await getWithRetry(
      options.fetchImpl ?? fetch,
      currentUrl,
      {
        headers: { accept: 'text/html', 'user-agent': USER_AGENT },
        redirect: 'manual',
      },
      timeoutMs,
      options.retryDelayImpl ?? retryDelay,
    );
    if (!REDIRECT_STATUSES.has(response.status)) {
      await cancelBody(response);
      throw new Error(`content discovery expected a redirect, received HTTP ${response.status}`);
    }
    const location = response.headers.get('location');
    await cancelBody(response);
    if (!location) throw new Error(`HTTP ${response.status} redirect has no Location header`);
    const target = new URL(assertAllowedOgmUrl(new URL(location, currentUrl).href));
    const match = target.pathname.match(/^\/ogm-test\/book\/([0-9a-f]{24})$/);
    if (target.hostname === 'ogmmateryal.eba.gov.tr' && match && !target.search) {
      return match[1]!;
    }
    if (redirects === MAX_OGM_API_REDIRECTS)
      throw new Error('content discovery redirect limit exceeded');
    currentUrl = target.href;
  }
  throw new Error('content discovery redirect loop ended unexpectedly');
}

function normalizedTitle(title: string): string {
  return title.normalize('NFC').trim().replace(/\s+/g, ' ');
}

async function requireJson(input: string, options: RequestOptions): Promise<unknown> {
  const result = await fetchOgmJson(input, options);
  if (result.status === 'not-modified') {
    throw new Error('conditional response cannot be audited without its validated cached body');
  }
  return result.value;
}

export async function auditOgmTopicApi(
  source: IncludedOgmTopicSource,
  options: RequestOptions & { concurrency?: number; deep?: boolean; pacingMs?: number } = {},
): Promise<OgmApiAuditObservation> {
  const discovered = await discoverOgmBookObjectId(source, options);
  if (discovered !== source.api.bookObjectId) {
    throw new Error(
      `source ${source.key} ObjectId drift: expected ${source.api.bookObjectId}, observed ${discovered}`,
    );
  }
  const parsed = ogmBookApiResponseSchema.parse(
    await requireJson(`${OGM_TOPIC_API_BASE_URL}/books/${discovered}`, options),
  );
  if (parsed.book.id !== discovered) throw new Error(`source ${source.key} API book ID mismatch`);
  if (normalizedTitle(parsed.book.bookTitle) !== normalizedTitle(source.api.bookTitle)) {
    throw new Error(`source ${source.key} API book title drift`);
  }
  assertAllowedOgmUrl(parsed.book.pdfPublicUrl);
  if (source.api.pdfPublicUrl && parsed.book.pdfPublicUrl !== source.api.pdfPublicUrl) {
    throw new Error(`source ${source.key} API PDF association drift`);
  }
  const testIds = parsed.tests.map((test) => test.id);
  if (new Set(testIds).size !== testIds.length)
    throw new Error(`source ${source.key} has duplicate test IDs`);
  const questionCount = parsed.tests.reduce((sum, test) => sum + test.questionCount, 0);
  if (
    parsed.book.testCount !== parsed.tests.length ||
    parsed.tests.length !== source.api.expectedTestCount ||
    questionCount !== source.api.expectedQuestionCount
  ) {
    throw new Error(`source ${source.key} API test/question count drift`);
  }
  for (const test of parsed.tests) {
    if (test.bookId !== discovered)
      throw new Error(`source ${source.key} has a foreign test bookId`);
  }

  const summary = {
    sourceId: source.sourceId,
    bookObjectId: discovered,
    testCount: parsed.tests.length,
    questionCount,
  };
  if (!options.deep) return summary;

  const concurrency = options.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) {
    throw new Error('API concurrency must be an integer from 1 through 12');
  }
  const pacingMs = options.pacingMs ?? 100;
  if (!Number.isInteger(pacingMs) || pacingMs < 0 || pacingMs > 1_000) {
    throw new Error('API pacingMs must be an integer from 0 through 1000');
  }
  const questionIds = new Set<string>();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, parsed.tests.length) }, async () => {
      while (true) {
        const test = parsed.tests[cursor++];
        if (!test) return;
        if (pacingMs) await retryDelay(pacingMs);
        const response = ogmTestApiResponseSchema.parse(
          await requireJson(`${OGM_TOPIC_API_BASE_URL}/tests/${test.id}`, options),
        );
        if (response.test.id !== test.id || response.test.bookId !== discovered) {
          throw new Error(`source ${source.key} test ${test.id} identity drift`);
        }
        if (response.test.questionCount !== test.questionCount) {
          throw new Error(`source ${source.key} test ${test.id} declared question count drift`);
        }
        assertOgmQuestionNumberCoverage(
          response.questions,
          test.questionCount,
          `source ${source.key} test ${test.id}`,
        );
        for (const question of response.questions) {
          if (question.testId !== test.id || question.bookId !== discovered) {
            throw new Error(`source ${source.key} test ${test.id} contains a foreign question`);
          }
          if (questionIds.has(question.id))
            throw new Error(`source ${source.key} has duplicate question IDs`);
          questionIds.add(question.id);
        }
      }
    }),
  );
  return {
    ...summary,
    questionIdCount: questionIds.size,
  };
}
