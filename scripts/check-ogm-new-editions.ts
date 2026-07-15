import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertAllowedOgmUrl,
  includedOgmTopicSources,
  loadOgmTopicSourceRegistry,
} from './lib/ogm-topic-registry.ts';

const LANDING_PAGE_URL = 'https://ogmmateryal.eba.gov.tr/yks-cikmis-soru-kitaplari';
const MAX_LANDING_PAGE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const USER_AGENT = 'YKS-OGM-Topic-API-Audit/1.0';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type OgmEditionScan = {
  observedIds: number[];
  pinnedIds: number[];
  addedIds: number[];
  removedIds: number[];
};

/**
 * The landing page lists one card per book with `/icerik-goster/{id}` and `/pdf-goster/{id}`
 * links. A brand-new edition (e.g. a 2018-2026 reprint) appears as a NEW content id here before
 * anything else in the pipeline can notice it, so this scan is alert-only detection: it never
 * proposes registry changes (registry edits require human review per project doctrine §9.1).
 */
export function extractLandingPageContentIds(html: string): number[] {
  const ids = new Set<number>();
  for (const match of html.matchAll(/\/(?:icerik|pdf)-goster\/(\d{1,10})\b/gu)) {
    ids.add(Number(match[1]));
  }
  return [...ids].sort((left, right) => left - right);
}

export async function scanOgmEditions(
  registryPath: string,
  fetchImpl: FetchLike = fetch,
): Promise<OgmEditionScan> {
  const registry = await loadOgmTopicSourceRegistry(registryPath);
  const pinnedIds = registry.sources.map((source) => source.sourceId).sort((a, b) => a - b);

  const response = await fetchImpl(assertAllowedOgmUrl(LANDING_PAGE_URL), {
    headers: { accept: 'text/html', 'user-agent': USER_AGENT },
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`official OGM landing page returned HTTP ${response.status}`);
  }
  const html = await response.text();
  if (html.length < 1 || html.length > MAX_LANDING_PAGE_BYTES) {
    throw new Error('official OGM landing page size is outside the safe range');
  }

  const observedIds = extractLandingPageContentIds(html);
  if (!observedIds.length) {
    throw new Error('official OGM landing page no longer exposes any content ids (layout drift)');
  }
  return {
    observedIds,
    pinnedIds,
    addedIds: observedIds.filter((id) => !pinnedIds.includes(id)),
    removedIds: pinnedIds.filter((id) => !observedIds.includes(id)),
  };
}

async function main(): Promise<void> {
  const scan = await scanOgmEditions(resolve(process.cwd(), 'content/ogm-yks-topic-sources.json'));
  console.log(`Observed ${scan.observedIds.length} content id(s) on the official landing page.`);
  if (!scan.addedIds.length && !scan.removedIds.length) {
    console.log('No new or removed MEB OGM editions; the pinned registry matches the live page.');
    return;
  }
  for (const id of scan.addedIds) {
    console.error(`NEW official content id ${id} is not in the pinned registry.`);
  }
  for (const id of scan.removedIds) {
    console.error(`Pinned source ${id} is no longer listed on the official landing page.`);
  }
  console.error(
    'Registry changes require manual review (§9.1); inspect the source and open a reviewed PR.',
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
