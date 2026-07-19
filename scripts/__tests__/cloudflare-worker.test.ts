import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLASSIFIER_MAX_BODY_BYTES,
  handleRequest,
  type Env,
} from '../../infra/cloudflare/src/index.ts';

const token = '0123456789abcdef0123456789abcdef';

function textPayload() {
  return {
    model: '@cf/qwen/qwen3-30b-a3b-fp8',
    mode: 'text',
    requestId: '2026-tyt-turkce-text-pass-1',
    messages: [
      { role: 'system', content: 'Return only the requested taxonomy IDs.' },
      { role: 'user', content: 'Evidence held only for this private inference request.' },
    ],
    responseJsonSchema: {
      type: 'object',
      properties: { topicId: { type: 'string' } },
      required: ['topicId'],
      additionalProperties: false,
    },
    maxCompletionTokens: 512,
    temperature: 0,
  };
}

function request(body: unknown, authorization = `Bearer ${token}`) {
  return new Request('https://classifier.example/v1/classify', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function environment(
  run: Env['AI']['run'],
  limit: NonNullable<Env['CLASSIFIER_RATE_LIMITER']>['limit'] = async () => ({ success: true }),
): Env {
  return { AI: { run }, CLASSIFIER_AUTH_TOKEN: token, CLASSIFIER_RATE_LIMITER: { limit } };
}

function dataImageUrlForBytes(byteLength: number): string {
  const encodedLength = Math.ceil(byteLength / 3) * 4;
  const padding = (3 - (byteLength % 3)) % 3;
  return `data:image/png;base64,${'A'.repeat(encodedLength - padding)}${'='.repeat(padding)}`;
}

test('Cloudflare classifier rejects unauthenticated requests before quota or inference', async () => {
  let called = false;
  let limited = false;
  const response = await handleRequest(
    request(textPayload(), 'Bearer incorrect-token-value-000000000000'),
    environment(
      async () => {
        called = true;
        return {};
      },
      async () => {
        limited = true;
        return { success: true };
      },
    ),
  );

  assert.equal(response.status, 401);
  assert.equal(limited, false);
  assert.equal(called, false);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
});

test('Cloudflare classifier fails closed when the rate limiter is absent or unavailable', async () => {
  let calls = 0;
  const run = async () => {
    calls += 1;
    return {};
  };
  const missing = await handleRequest(request(textPayload()), {
    AI: { run },
    CLASSIFIER_AUTH_TOKEN: token,
  });
  const failed = await handleRequest(
    request(textPayload()),
    environment(run, async () => {
      throw new Error('limiter unavailable');
    }),
  );

  assert.equal(missing.status, 503);
  assert.equal(failed.status, 503);
  assert.equal(calls, 0);
});

test('Cloudflare classifier returns a bounded 429 before body parsing or inference', async () => {
  let calls = 0;
  const response = await handleRequest(
    request(textPayload()),
    environment(
      async () => {
        calls += 1;
        return {};
      },
      async ({ key }) => {
        assert.equal(key, 'annual-classifier');
        return { success: false };
      },
    ),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.deepEqual(await response.json(), { error: 'rate-limited' });
  assert.equal(calls, 0);
});

test('Cloudflare classifier accepts only the pinned text model contract', async () => {
  let receivedModel = '';
  let receivedInput: Record<string, unknown> | undefined;
  let limits = 0;
  const response = await handleRequest(
    request(textPayload()),
    environment(
      async (model, input) => {
        receivedModel = model;
        receivedInput = input;
        return { response: '{"topicId":"paragraf"}' };
      },
      async () => {
        limits += 1;
        return { success: true };
      },
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(limits, 1);
  assert.equal(receivedModel, '@cf/qwen/qwen3-30b-a3b-fp8');
  assert.equal(receivedInput?.store, false);
  assert.equal(receivedInput?.stream, false);
  assert.equal(receivedInput?.temperature, 0);
  assert.deepEqual(await response.json(), {
    result: { response: '{"topicId":"paragraf"}' },
  });
});

test('Cloudflare classifier fails closed for model/mode drift and remote images', async () => {
  let calls = 0;
  const env = environment(async () => {
    calls += 1;
    return {};
  });
  const wrongMode = { ...textPayload(), mode: 'vision' };
  const remoteImage = {
    ...textPayload(),
    model: '@cf/google/gemma-4-26b-a4b-it',
    mode: 'vision',
    messages: [
      textPayload().messages[0],
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'https://example.com/question.png' } }],
      },
    ],
  };

  const wrongModeResponse = await handleRequest(request(wrongMode), env);
  const remoteImageResponse = await handleRequest(request(remoteImage), env);

  assert.equal(wrongModeResponse.status, 400);
  assert.equal(remoteImageResponse.status, 400);
  assert.equal(calls, 0);
});

test('Cloudflare classifier hides inference failures behind a bounded error response', async () => {
  const response = await handleRequest(
    request(textPayload()),
    environment(async () => {
      throw new Error('provider detail that must not escape');
    }),
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'inference-failed' });
});

test('Cloudflare classifier admits two exact 5 MiB images with maximum text', async () => {
  const fullImage = dataImageUrlForBytes(5 * 1024 * 1024);
  const maximumTextPart = 'a'.repeat(80_000);
  const visionPayload = {
    model: '@cf/google/gemma-4-26b-a4b-it',
    mode: 'vision',
    requestId: '2026-tyt-turkce-vision-boundary-1',
    messages: [
      { role: 'system', content: 'a'.repeat(450_000) },
      {
        role: 'user',
        content: [
          ...Array.from({ length: 5 }, () => ({ type: 'text', text: maximumTextPart })),
          { type: 'image_url', image_url: { url: fullImage } },
          { type: 'image_url', image_url: { url: fullImage } },
        ],
      },
    ],
    responseJsonSchema: {
      type: 'object',
      description: 'a'.repeat(5_000),
    },
    maxCompletionTokens: 512,
    temperature: 0,
  };

  let calls = 0;
  const response = await handleRequest(
    request(visionPayload),
    environment(async () => {
      calls += 1;
      return { response: '{"topicId":"paragraf"}' };
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test('Cloudflare classifier admits one image with six maximum text parts', async () => {
  const payload = {
    ...textPayload(),
    model: '@cf/google/gemma-4-26b-a4b-it',
    mode: 'vision',
    messages: [
      textPayload().messages[0],
      {
        role: 'user',
        content: [
          ...Array.from({ length: 6 }, () => ({ type: 'text', text: 'a'.repeat(80_000) })),
          { type: 'image_url', image_url: { url: dataImageUrlForBytes(5 * 1024 * 1024) } },
        ],
      },
    ],
  };
  let calls = 0;
  const response = await handleRequest(
    request(payload),
    environment(async () => {
      calls += 1;
      return { response: '{"topicId":"paragraf"}' };
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test('Cloudflare classifier admits two maximal plain-string messages', async () => {
  const payload = {
    ...textPayload(),
    messages: [
      { role: 'system', content: 'a'.repeat(450_000) },
      { role: 'user', content: 'a'.repeat(450_000) },
    ],
  };
  let calls = 0;
  const response = await handleRequest(
    request(payload),
    environment(async () => {
      calls += 1;
      return { response: '{"topicId":"paragraf"}' };
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test('Cloudflare classifier rejects control characters in message text', async () => {
  let calls = 0;
  const env = environment(async () => {
    calls += 1;
    return {};
  });
  const nulPayload = {
    ...textPayload(),
    messages: [
      textPayload().messages[0],
      { role: 'user', content: `Metin ${String.fromCharCode(0)} içeriyor.` },
    ],
  };
  const verticalTabPart = {
    ...textPayload(),
    model: '@cf/google/gemma-4-26b-a4b-it',
    mode: 'vision',
    messages: [
      textPayload().messages[0],
      {
        role: 'user',
        content: [
          { type: 'text', text: `Metin ${String.fromCharCode(11)} içeriyor.` },
          { type: 'image_url', image_url: { url: dataImageUrlForBytes(64) } },
        ],
      },
    ],
  };
  const allowedWhitespace = {
    ...textPayload(),
    messages: [
      textPayload().messages[0],
      { role: 'user', content: 'Sekme\tve\nyeni satır\rserbest.' },
    ],
  };

  assert.equal((await handleRequest(request(nulPayload), env)).status, 400);
  assert.equal((await handleRequest(request(verticalTabPart), env)).status, 400);
  assert.equal(calls, 0);
  assert.equal((await handleRequest(request(allowedWhitespace), env)).status, 200);
  assert.equal(calls, 1);
});

test('Cloudflare classifier admits a fully unicode-escaped non-ASCII schema on the wire', async () => {
  const payload = {
    ...textPayload(),
    responseJsonSchema: { type: 'object', description: 'ç'.repeat(31_000) },
  };
  // Python json.dumps(ensure_ascii=True) benzeri istemciyi taklit et: her non-ASCII
  // karakter telde 6 baytlık bir unicode kaçışı tutar; parse sonrası şema 32k sınırının altındadır.
  const wireBody = JSON.stringify(payload).split('ç').join('\\u00e7');
  const escapedRequest = new Request('https://classifier.example/v1/classify', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: wireBody,
  });
  let calls = 0;
  const response = await handleRequest(
    escapedRequest,
    environment(async () => {
      calls += 1;
      return { response: '{"topicId":"paragraf"}' };
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test('Cloudflare classifier rejects an image one byte above the decoded limit', async () => {
  const payload = {
    ...textPayload(),
    model: '@cf/google/gemma-4-26b-a4b-it',
    mode: 'vision',
    messages: [
      textPayload().messages[0],
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Classify this page.' },
          { type: 'image_url', image_url: { url: dataImageUrlForBytes(5 * 1024 * 1024 + 1) } },
        ],
      },
    ],
  };
  let calls = 0;
  const response = await handleRequest(
    request(payload),
    environment(async () => {
      calls += 1;
      return {};
    }),
  );

  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test('Cloudflare classifier stops reading a streamed body at the transport limit', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(CLASSIFIER_MAX_BODY_BYTES));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const oversizedRequest = new Request('https://classifier.example/v1/classify', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  let calls = 0;
  const response = await handleRequest(
    oversizedRequest,
    environment(async () => {
      calls += 1;
      return {};
    }),
  );

  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(calls, 0);
});
