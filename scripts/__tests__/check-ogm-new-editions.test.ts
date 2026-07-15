import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  MAX_LANDING_PAGE_ATTEMPTS,
  extractLandingPageContentIds,
  scanOgmEditions,
} from '../check-ogm-new-editions.ts';

const REGISTRY_PATH = resolve(process.cwd(), 'content/ogm-yks-topic-sources.json');
const PINNED_IDS = [176293, 176294, 176295, 176296, 176297, 176298, 176299];

function landingPage(ids: number[]): string {
  return `<html><body><section class="books-detail-action py-5">${ids
    .map(
      (id) =>
        `<div class="books-detail-action-content"><a target="_blank" href="/icerik-goster/${id}"><img src="/x.png"/></a><a download href="/pdf-goster/${id}">PDF</a></div>`,
    )
    .join('')}</section></body></html>`;
}

function fetchReturning(html: string) {
  return async () =>
    new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
}

test('extracts each content id once across icerik and pdf resolver links', () => {
  assert.deepEqual(extractLandingPageContentIds(landingPage([176299, 176293])), [176293, 176299]);
});

test('a landing page matching the pinned registry reports no drift', async () => {
  const scan = await scanOgmEditions(REGISTRY_PATH, fetchReturning(landingPage(PINNED_IDS)));
  assert.deepEqual(scan.addedIds, []);
  assert.deepEqual(scan.removedIds, []);
  assert.deepEqual(scan.pinnedIds, PINNED_IDS);
});

test('a brand-new official edition id is reported as added', async () => {
  const scan = await scanOgmEditions(
    REGISTRY_PATH,
    fetchReturning(landingPage([...PINNED_IDS, 188888])),
  );
  assert.deepEqual(scan.addedIds, [188888]);
  assert.deepEqual(scan.removedIds, []);
});

test('a pinned source disappearing from the landing page is reported as removed', async () => {
  const scan = await scanOgmEditions(
    REGISTRY_PATH,
    fetchReturning(landingPage(PINNED_IDS.filter((id) => id !== 176295))),
  );
  assert.deepEqual(scan.addedIds, []);
  assert.deepEqual(scan.removedIds, [176295]);
});

test('an id-less landing page fails closed instead of reporting a clean scan', async () => {
  await assert.rejects(
    scanOgmEditions(REGISTRY_PATH, fetchReturning('<html><body>redesign</body></html>')),
    /layout drift/,
  );
});

test('a transient "fetch failed" connection error is retried until the scan succeeds', async () => {
  let attempts = 0;
  const delays: number[] = [];
  const scan = await scanOgmEditions(
    REGISTRY_PATH,
    async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError('fetch failed');
      return new Response(landingPage(PINNED_IDS), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
    {
      retryDelayImpl: async (ms) => {
        delays.push(ms);
      },
    },
  );
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [500, 1500]);
  assert.deepEqual(scan.addedIds, []);
  assert.deepEqual(scan.removedIds, []);
});

test('a transient request timeout is retried until the scan succeeds', async () => {
  let attempts = 0;
  const scan = await scanOgmEditions(
    REGISTRY_PATH,
    async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      return new Response(landingPage(PINNED_IDS), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
    {
      retryDelayImpl: async () => {
        // Tests skip the real backoff wait.
      },
    },
  );
  assert.equal(attempts, 2);
  assert.deepEqual(scan.addedIds, []);
});

test('a persistent connection failure gives up after the maximum attempts', async () => {
  let attempts = 0;
  await assert.rejects(
    scanOgmEditions(
      REGISTRY_PATH,
      async () => {
        attempts += 1;
        throw new TypeError('fetch failed');
      },
      {
        retryDelayImpl: async () => {
          // Tests skip the real backoff wait.
        },
      },
    ),
    /fetch failed/,
  );
  assert.equal(attempts, MAX_LANDING_PAGE_ATTEMPTS);
});

test('a real layout drift is never retried and fails on the first attempt', async () => {
  let attempts = 0;
  await assert.rejects(
    scanOgmEditions(
      REGISTRY_PATH,
      async () => {
        attempts += 1;
        return new Response('<html><body>redesign</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      },
      {
        retryDelayImpl: async () => {
          // Tests skip the real backoff wait.
        },
      },
    ),
    /layout drift/,
  );
  assert.equal(attempts, 1);
});
