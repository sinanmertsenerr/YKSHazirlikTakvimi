import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDeclaredContentLength,
  cancelBody,
  TRANSIENT_RETRY_DELAYS_MS,
  withTransientRetries,
} from '../lib/fetch-safety.ts';

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

test('withTransientRetries returns immediately on first success without sleeping', async () => {
  const sleeps: number[] = [];
  const result = await withTransientRetries(async () => 'tamam', {
    sleep: async (ms) => void sleeps.push(ms),
  });
  assert.equal(result, 'tamam');
  assert.deepEqual(sleeps, []);
});

test('withTransientRetries retries with the documented backoff and then succeeds', async () => {
  const sleeps: number[] = [];
  let attempts = 0;
  const result = await withTransientRetries(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError('fetch failed');
      return attempts;
    },
    { sleep: async (ms) => void sleeps.push(ms) },
  );
  assert.equal(result, 3);
  assert.deepEqual(sleeps, [...TRANSIENT_RETRY_DELAYS_MS]);
});

test('withTransientRetries surfaces the last error once every attempt is spent', async () => {
  let attempts = 0;
  await assert.rejects(
    withTransientRetries(
      async () => {
        attempts += 1;
        throw new Error(`deneme ${attempts}`);
      },
      { sleep: async () => {} },
    ),
    /deneme 3/,
  );
  assert.equal(attempts, TRANSIENT_RETRY_DELAYS_MS.length + 1);
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
