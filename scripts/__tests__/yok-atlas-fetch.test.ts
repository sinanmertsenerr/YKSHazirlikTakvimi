import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchYokAtlas, readBoundedText, type YokAtlasFetch } from '../lib/yok-atlas-fetch.ts';

const surfaces = [
  {
    name: 'SPA document',
    url: 'https://yokatlas.yok.gov.tr/tercih-sihirbazi-t4.php',
    method: 'GET',
  },
  { name: 'SPA bundle', url: 'https://yokatlas.yok.gov.tr/static/js/main.abc.js', method: 'GET' },
  {
    name: 'program API',
    url: 'https://yokatlas.yok.gov.tr/api/tercih-kilavuz/search',
    method: 'POST',
  },
  { name: 'nets API', url: 'https://yokatlas.yok.gov.tr/api/netler/search', method: 'POST' },
] as const;

for (const surface of surfaces) {
  test(`${surface.name} rejects a redirect away from the official origin`, async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl: YokAtlasFetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(null, {
        status: surface.method === 'POST' ? 307 : 302,
        headers: { location: 'https://attacker.example/forged' },
      });
    };

    await assert.rejects(
      fetchYokAtlas(
        surface.url,
        {
          method: surface.method,
          ...(surface.method === 'POST' ? { body: '{"page":0}' } : {}),
        },
        fetchImpl,
      ),
      /exact official HTTPS origin/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.init?.redirect, 'manual');
  });
}

test('same-origin GET redirects are followed within a bounded chain', async () => {
  const calls: string[] = [];
  const fetchImpl: YokAtlasFetch = async (input) => {
    calls.push(String(input));
    if (calls.length === 1) {
      return new Response(null, { status: 302, headers: { location: '/static/js/main.next.js' } });
    }
    return new Response('bundle', { status: 200 });
  };
  const response = await fetchYokAtlas(
    'https://yokatlas.yok.gov.tr/static/js/main.old.js',
    {},
    fetchImpl,
  );
  assert.equal(await response.text(), 'bundle');
  assert.deepEqual(calls, [
    'https://yokatlas.yok.gov.tr/static/js/main.old.js',
    'https://yokatlas.yok.gov.tr/static/js/main.next.js',
  ]);
});

test('same-origin POST 307 preserves method and body while 302 is rejected', async () => {
  const calls: RequestInit[] = [];
  const fetchImpl: YokAtlasFetch = async (_input, init) => {
    calls.push(init ?? {});
    if (calls.length === 1) {
      return new Response(null, { status: 307, headers: { location: '/api/netler/search-v2' } });
    }
    return Response.json({ ok: true });
  };
  const response = await fetchYokAtlas(
    'https://yokatlas.yok.gov.tr/api/netler/search',
    { method: 'POST', body: '{"page":0}' },
    fetchImpl,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    calls.map((init) => ({ method: init.method, body: init.body, redirect: init.redirect })),
    [
      { method: 'POST', body: '{"page":0}', redirect: 'manual' },
      { method: 'POST', body: '{"page":0}', redirect: 'manual' },
    ],
  );

  await assert.rejects(
    fetchYokAtlas(
      'https://yokatlas.yok.gov.tr/api/netler/search',
      { method: 'POST', body: '{}' },
      async () => new Response(null, { status: 302, headers: { location: '/login' } }),
    ),
    /unsafe HTTP 302 redirect for POST/,
  );
});

test('redirects fail closed on missing locations and excessive chains', async () => {
  await assert.rejects(
    fetchYokAtlas(
      'https://yokatlas.yok.gov.tr/tercih-sihirbazi-t4.php',
      {},
      async () => new Response(null, { status: 302 }),
    ),
    /no Location/,
  );
  await assert.rejects(
    fetchYokAtlas(
      'https://yokatlas.yok.gov.tr/tercih-sihirbazi-t4.php',
      {},
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: '/tercih-sihirbazi-t4.php' },
        }),
    ),
    /exceeded 3 redirects/,
  );
});

function streamOfChunks(
  chunks: string[],
  options: { close?: boolean; onCancel?: () => void } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (options.close !== false) controller.close();
    },
    cancel() {
      options.onCancel?.();
    },
  });
}

function boundedResponse(options: {
  contentLength?: string;
  chunks?: string[];
  hasBody?: boolean;
  keepBodyOpen?: boolean;
  onCancel?: () => void;
  text?: string;
}): Response {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-length' ? (options.contentLength ?? null) : null,
    },
    body:
      options.hasBody === false
        ? null
        : streamOfChunks(options.chunks ?? [], {
            close: !options.keepBodyOpen,
            onCancel: options.onCancel,
          }),
    text: async () => options.text ?? '',
  } as unknown as Response;
}

test('readBoundedText cancels an oversized advertised response before reading', async () => {
  let cancelled = false;
  await assert.rejects(
    readBoundedText(
      boundedResponse({
        contentLength: '2048',
        chunks: ['x'.repeat(4096)],
        keepBodyOpen: true,
        onCancel: () => {
          cancelled = true;
        },
      }),
      1024,
      'YÖK payload',
    ),
    /advertised length/,
  );
  assert.equal(cancelled, true);
});

test('readBoundedText cancels and rejects a malformed Content-Length header', async () => {
  let cancelled = false;
  await assert.rejects(
    readBoundedText(
      boundedResponse({
        contentLength: '12, 12',
        keepBodyOpen: true,
        onCancel: () => {
          cancelled = true;
        },
      }),
      1024,
      'YÖK payload',
    ),
    /invalid Content-Length/,
  );
  assert.equal(cancelled, true);
});

test('readBoundedText aborts once the streamed body exceeds the limit', async () => {
  await assert.rejects(
    readBoundedText(
      boundedResponse({ chunks: ['A'.repeat(600), 'B'.repeat(600)] }),
      1000,
      'YÖK payload',
    ),
    /safety limit/,
  );
});

test('readBoundedText returns the decoded text when the body stays within the limit', async () => {
  assert.equal(
    await readBoundedText(boundedResponse({ chunks: ['hello ', 'world'] }), 1024, 'YÖK payload'),
    'hello world',
  );
});

test('readBoundedText falls back to a bounded text read when no stream body exists', async () => {
  assert.equal(
    await readBoundedText(boundedResponse({ hasBody: false, text: 'inline' }), 1024, 'YÖK payload'),
    'inline',
  );
  await assert.rejects(
    readBoundedText(
      boundedResponse({ hasBody: false, text: 'z'.repeat(2048) }),
      1024,
      'YÖK payload',
    ),
    /safety limit/,
  );
});
