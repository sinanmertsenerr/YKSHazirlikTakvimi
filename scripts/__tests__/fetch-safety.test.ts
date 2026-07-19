import assert from 'node:assert/strict';
import test from 'node:test';

import { assertDeclaredContentLength, cancelBody } from '../lib/fetch-safety.ts';

function fakeResponse(options: { contentLength?: string | null; onCancel?: () => void }): Response {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-length' ? (options.contentLength ?? null) : null,
    },
    body: {
      cancel: async () => {
        options.onCancel?.();
      },
    },
  } as unknown as Response;
}

test('assertDeclaredContentLength passes silently without a header', async () => {
  await assertDeclaredContentLength(fakeResponse({ contentLength: null }), 1024, 'kaynak');
});

test('assertDeclaredContentLength accepts a well-formed in-bound header', async () => {
  await assertDeclaredContentLength(fakeResponse({ contentLength: '1024' }), 1024, 'kaynak');
});

test('assertDeclaredContentLength cancels and rejects a malformed header', async () => {
  let cancelled = false;
  await assert.rejects(
    assertDeclaredContentLength(
      fakeResponse({ contentLength: '12, 12', onCancel: () => (cancelled = true) }),
      1024,
      'kaynak',
    ),
    /invalid Content-Length/,
  );
  assert.equal(cancelled, true);
});

test('assertDeclaredContentLength cancels and rejects an oversized header', async () => {
  let cancelled = false;
  await assert.rejects(
    assertDeclaredContentLength(
      fakeResponse({ contentLength: '2048', onCancel: () => (cancelled = true) }),
      1024,
      'kaynak',
    ),
    /advertised length/,
  );
  assert.equal(cancelled, true);
});

test('cancelBody swallows an already-locked or closed body', async () => {
  const throwing = {
    body: {
      cancel: async () => {
        throw new TypeError('Invalid state: ReadableStream is locked');
      },
    },
  } as unknown as Response;
  await cancelBody(throwing);
  await cancelBody({ body: null } as unknown as Response);
});
