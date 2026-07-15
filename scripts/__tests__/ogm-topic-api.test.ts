import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  assertOgmQuestionNumberCoverage,
  discoverOgmBookObjectId,
  fetchOgmJson,
  ogmApiBookSchema,
  ogmBookApiResponseSchema,
} from '../lib/ogm-topic-api.ts';
import {
  includedOgmTopicSources,
  ogmTopicSourceRegistrySchema,
} from '../lib/ogm-topic-registry.ts';

async function firstSource() {
  const registry = ogmTopicSourceRegistrySchema.parse(
    JSON.parse(
      await readFile(resolve(process.cwd(), 'content/ogm-yks-topic-sources.json'), 'utf8'),
    ) as unknown,
  );
  return includedOgmTopicSources(registry)[0]!;
}

test('content discovery obtains the current ObjectId only from the official redirect', async () => {
  const source = await firstSource();
  const calls: string[] = [];
  const objectId = await discoverOgmBookObjectId(source, {
    fetchImpl: async (input, init) => {
      calls.push(String(input));
      assert.equal(init?.redirect, 'manual');
      return new Response(null, {
        status: 302,
        headers: {
          location: 'https://ogmmateryal.eba.gov.tr/ogm-test/book/68b4f30ceb079be0e77092c8',
        },
      });
    },
  });
  assert.equal(objectId, source.api.bookObjectId);
  assert.deepEqual(calls, [source.api.discoveryUrl]);
});

test('content discovery refuses a redirect outside the official allowlist', async () => {
  await assert.rejects(
    discoverOgmBookObjectId(await firstSource(), {
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example/ogm-test/book/68b4f30ceb079be0e77092c8' },
        }),
    }),
    /not allowlisted/,
  );
});

test('JSON transport supports ETags, bounded bodies, and official redirects', async () => {
  const calls: Array<{ headers: Headers; url: string }> = [];
  const result = await fetchOgmJson(
    'https://ogmmateryal.eba.gov.tr/ogm-test-api/v1/general/books/68b4f30ceb079be0e77092c8',
    {
      etag: '"pinned"',
      fetchImpl: async (input, init) => {
        calls.push({ headers: new Headers(init?.headers), url: String(input) });
        if (calls.length === 1) {
          return new Response(null, {
            status: 302,
            headers: {
              location: '/ogm-test-api/v1/general/books/68b4f30ceb079be0e77092c8?mirror=1',
            },
          });
        }
        return new Response('{"ok":true}', {
          headers: { 'content-type': 'application/json; charset=utf-8', etag: '"fresh"' },
        });
      },
    },
  );
  assert.deepEqual(result, { status: 'ok', value: { ok: true }, etag: '"fresh"' });
  assert.equal(calls[0]!.headers.get('if-none-match'), '"pinned"');
  assert.equal(calls[1]!.headers.get('if-none-match'), '"pinned"');

  await assert.rejects(
    fetchOgmJson('https://ogmmateryal.eba.gov.tr/api', {
      maxBytes: 8,
      fetchImpl: async () =>
        new Response('{"too":"large"}', { headers: { 'content-type': 'application/json' } }),
    }),
    /size limit/,
  );
});

test('JSON transport returns 304 without inventing cached data', async () => {
  assert.deepEqual(
    await fetchOgmJson('https://ogmmateryal.eba.gov.tr/api', {
      etag: '"same"',
      fetchImpl: async () => new Response(null, { status: 304, headers: { etag: '"same"' } }),
    }),
    { status: 'not-modified', etag: '"same"' },
  );
});

test('JSON GET retries only bounded transient statuses and honors bounded Retry-After', async () => {
  let calls = 0;
  const delays: number[] = [];
  const recovered = await fetchOgmJson('https://ogmmateryal.eba.gov.tr/api', {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, { status: 502, headers: { 'retry-after': '99' } });
      }
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    },
    retryDelayImpl: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });
  assert.deepEqual(recovered, { status: 'ok', value: { ok: true } });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [5_000]);

  calls = 0;
  delays.length = 0;
  await assert.rejects(
    fetchOgmJson('https://ogmmateryal.eba.gov.tr/api', {
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 503 });
      },
      retryDelayImpl: async (milliseconds) => {
        delays.push(milliseconds);
      },
    }),
    /HTTP 503/,
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 750]);

  calls = 0;
  await assert.rejects(
    fetchOgmJson('https://ogmmateryal.eba.gov.tr/api', {
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 500 });
      },
      retryDelayImpl: async () => undefined,
    }),
    /HTTP 500/,
  );
  assert.equal(calls, 1);
});

test('book API schema is strict at its publication boundary', () => {
  assert.equal(
    ogmBookApiResponseSchema.safeParse({ book: {}, tests: [], rawQuestion: 'x' }).success,
    false,
  );
});

test('book API accepts only an empty or ObjectId-shaped defaultBranchId', () => {
  const book = {
    lockActiveAt: null,
    bookTitle: 'YKS Çıkmış Sorular - 2018-2025 - TYT',
    pdfPublicUrl: 'https://ogm-small-cdn.eba.gov.tr/book.pdf',
    pageCount: 1,
    publicImageFolderRootUrl: 'https://ogm-small-cdn.eba.gov.tr/images',
    imageExtension: 'webp',
    leftMarginPercentage: 0,
    rightMarginPercentage: 0,
    topMarginPercentage: 0,
    bottomMarginPercentage: 0,
    firstPageTopMarginPercentage: 0,
    originalImageWidth: 1,
    originalImageHeight: 1,
    defaultBranchId: '',
    includesMultiTests: false,
    testCount: 0,
    linkPages: [],
    hasCover: false,
    choiceCanvases: [],
    archive: false,
    authorizedUsers: [],
    createdBy: 'official',
    updatedBy: 'official',
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    choiceCanvasesQuestion: null,
    choiceCanvasesQuestionCanvas: null,
    id: '68b4f30ceb079be0e77092c8',
  };
  assert.equal(ogmApiBookSchema.safeParse(book).success, true);
  assert.equal(
    ogmApiBookSchema.safeParse({ ...book, defaultBranchId: '66aaa1eacde079ce4e358a2b' }).success,
    true,
  );
  assert.equal(
    ogmApiBookSchema.safeParse({ ...book, defaultBranchId: 'not-an-id' }).success,
    false,
  );
  assert.equal(ogmApiBookSchema.safeParse({ ...book, defaultBranchId: null }).success, false);
});

test('question coverage tolerates stale duplicate IDs but rejects missing or out-of-range numbers', () => {
  assert.doesNotThrow(() =>
    assertOgmQuestionNumberCoverage(
      [
        { id: 'a', questionNumber: 1 },
        { id: 'stale-a', questionNumber: 1 },
        { id: 'b', questionNumber: 2 },
      ],
      2,
      'fixture',
    ),
  );
  assert.throws(
    () => assertOgmQuestionNumberCoverage([{ id: 'a', questionNumber: 1 }], 2, 'fixture'),
    /coverage drift/,
  );
  assert.throws(
    () =>
      assertOgmQuestionNumberCoverage(
        [
          { id: 'a', questionNumber: 1 },
          { id: 'c', questionNumber: 3 },
        ],
        2,
        'fixture',
      ),
    /out-of-range|missing/,
  );
});
