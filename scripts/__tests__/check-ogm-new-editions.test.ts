import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
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
