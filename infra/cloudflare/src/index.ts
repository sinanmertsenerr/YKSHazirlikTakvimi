const TEXT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8' as const;
const VISION_MODEL = '@cf/google/gemma-4-26b-a4b-it' as const;
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 450_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VISION_IMAGES = 2;
export const CLASSIFIER_AI_TIMEOUT_MS = 90_000;
export const CLASSIFIER_RATE_LIMIT_KEY = 'annual-classifier';
export const CLASSIFIER_RATE_LIMIT_RETRY_SECONDS = 60;

type AllowedModel = typeof TEXT_MODEL | typeof VISION_MODEL;

type MessagePart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

type Message = {
  role: 'system' | 'user';
  content: string | MessagePart[];
};

type ClassifierRequest = {
  model: AllowedModel;
  mode: 'text' | 'vision';
  requestId: string;
  messages: [Message, Message];
  responseJsonSchema: Record<string, unknown>;
  maxCompletionTokens: number;
  temperature: number;
};

interface AiBinding {
  run(model: AllowedModel, input: Record<string, unknown>): Promise<unknown>;
}

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  AI: AiBinding;
  CLASSIFIER_AUTH_TOKEN: string;
  CLASSIFIER_RATE_LIMITER?: RateLimitBinding;
}

const RESPONSE_HEADERS = {
  'cache-control': 'no-store, max-age=0',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
} as const;

function jsonResponse(
  status: number,
  body: unknown,
  additionalHeaders: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...RESPONSE_HEADERS, ...additionalHeaders },
  });
}

function timingSafeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function validDataImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  return Math.ceil((match[1]!.length * 3) / 4) <= MAX_IMAGE_BYTES;
}

function parseMessage(value: unknown): Message | undefined {
  if (!isPlainObject(value) || !hasExactKeys(value, ['role', 'content'])) return undefined;
  if (value.role !== 'system' && value.role !== 'user') return undefined;
  if (typeof value.content === 'string') {
    if (!value.content.length || value.content.length > MAX_TEXT_CHARACTERS) return undefined;
    return { role: value.role, content: value.content };
  }
  if (!Array.isArray(value.content) || !value.content.length || value.content.length > 7) {
    return undefined;
  }
  const parts: MessagePart[] = [];
  for (const candidate of value.content) {
    if (!isPlainObject(candidate) || typeof candidate.type !== 'string') return undefined;
    if (candidate.type === 'text') {
      if (
        !hasExactKeys(candidate, ['type', 'text']) ||
        typeof candidate.text !== 'string' ||
        !candidate.text.length ||
        candidate.text.length > 80_000
      ) {
        return undefined;
      }
      parts.push({ type: 'text', text: candidate.text });
    } else if (candidate.type === 'image_url') {
      if (
        !hasExactKeys(candidate, ['type', 'image_url']) ||
        !isPlainObject(candidate.image_url) ||
        !hasExactKeys(candidate.image_url, ['url']) ||
        !validDataImageUrl(candidate.image_url.url)
      ) {
        return undefined;
      }
      parts.push({ type: 'image_url', image_url: { url: candidate.image_url.url } });
    } else {
      return undefined;
    }
  }
  return { role: value.role, content: parts };
}

function parseClassifierRequest(value: unknown): ClassifierRequest | undefined {
  if (
    !isPlainObject(value) ||
    !hasExactKeys(value, [
      'model',
      'mode',
      'requestId',
      'messages',
      'responseJsonSchema',
      'maxCompletionTokens',
      'temperature',
    ]) ||
    (value.model !== TEXT_MODEL && value.model !== VISION_MODEL) ||
    (value.mode !== 'text' && value.mode !== 'vision') ||
    (value.mode === 'text' && value.model !== TEXT_MODEL) ||
    (value.mode === 'vision' && value.model !== VISION_MODEL) ||
    typeof value.requestId !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.requestId) ||
    value.requestId.length > 240 ||
    !Array.isArray(value.messages) ||
    value.messages.length !== 2 ||
    !isPlainObject(value.responseJsonSchema) ||
    JSON.stringify(value.responseJsonSchema).length > 32_000 ||
    !Number.isInteger(value.maxCompletionTokens) ||
    (value.maxCompletionTokens as number) < 1 ||
    (value.maxCompletionTokens as number) > 8_192 ||
    value.temperature !== 0
  ) {
    return undefined;
  }
  const system = parseMessage(value.messages[0]);
  const user = parseMessage(value.messages[1]);
  if (!system || !user || system.role !== 'system' || user.role !== 'user') return undefined;
  if (typeof system.content !== 'string') return undefined;

  if (value.mode === 'text' && typeof user.content !== 'string') return undefined;
  if (value.mode === 'vision') {
    if (!Array.isArray(user.content)) return undefined;
    const imageCount = user.content.filter((part) => part.type === 'image_url').length;
    if (imageCount < 1 || imageCount > MAX_VISION_IMAGES) return undefined;
  }
  return {
    model: value.model,
    mode: value.mode,
    requestId: value.requestId,
    messages: [system, user],
    responseJsonSchema: value.responseJsonSchema,
    maxCompletionTokens: value.maxCompletionTokens as number,
    temperature: 0,
  };
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    throw new RangeError('body-too-large');
  }
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_BODY_BYTES) {
    throw new RangeError('body-too-large');
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new SyntaxError('invalid-json');
  }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('ai-timeout')), milliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/v1/classify') {
    return jsonResponse(404, { error: 'not-found' });
  }
  if (!env.CLASSIFIER_AUTH_TOKEN || env.CLASSIFIER_AUTH_TOKEN.length < 32) {
    return jsonResponse(503, { error: 'service-unavailable' });
  }
  const authorization = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.CLASSIFIER_AUTH_TOKEN}`;
  if (!timingSafeEqual(authorization, expected)) {
    return jsonResponse(401, { error: 'unauthorized' });
  }
  if (!env.CLASSIFIER_RATE_LIMITER) {
    return jsonResponse(503, { error: 'service-unavailable' });
  }
  try {
    const limit = await env.CLASSIFIER_RATE_LIMITER.limit({ key: CLASSIFIER_RATE_LIMIT_KEY });
    if (!limit.success) {
      return jsonResponse(
        429,
        { error: 'rate-limited' },
        { 'retry-after': String(CLASSIFIER_RATE_LIMIT_RETRY_SECONDS) },
      );
    }
  } catch {
    return jsonResponse(503, { error: 'service-unavailable' });
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return error instanceof RangeError
      ? jsonResponse(413, { error: 'body-too-large' })
      : jsonResponse(400, { error: 'invalid-json' });
  }
  const parsed = parseClassifierRequest(body);
  if (!parsed) return jsonResponse(400, { error: 'invalid-request' });

  try {
    const result = await withTimeout(
      env.AI.run(parsed.model, {
        messages: parsed.messages,
        stream: false,
        store: false,
        temperature: parsed.temperature,
        max_completion_tokens: parsed.maxCompletionTokens,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'annual_topic_classification',
            strict: true,
            schema: parsed.responseJsonSchema,
          },
        },
      }),
      CLASSIFIER_AI_TIMEOUT_MS,
    );
    return jsonResponse(200, { result });
  } catch {
    return jsonResponse(502, { error: 'inference-failed' });
  }
}

const worker = { fetch: handleRequest };

export default worker;
