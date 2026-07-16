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
/**
 * Total landing-page fetch attempts before giving up. A transient network blip is retried with
 * backoff (0.5s, 1.5s, 3s); a real HTTP status, layout drift, or edition change is not, so it can
 * never be masked by the retry loop.
 */
export const MAX_LANDING_PAGE_ATTEMPTS = 4;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ScanOgmEditionsOptions = {
  /** Injectable delay so tests assert the backoff without waiting on real timers. */
  retryDelayImpl?: (milliseconds: number) => Promise<void>;
};

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

async function fetchLandingPageContentIdsOnce(fetchImpl: FetchLike): Promise<number[]> {
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
  return observedIds;
}

/**
 * A transient network failure a retry can plausibly recover from: a request timeout, or undici's
 * connection-level `TypeError: fetch failed` (DNS, ECONNRESET/REFUSED, EAI_AGAIN, TLS, socket
 * hangup) — the exact class that flaked this job in CI. Anything else (a real HTTP status, layout
 * drift, an added/removed edition) is a plain Error and is never retried, so a real change to the
 * official page can never be hidden by the retry loop.
 */
function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'TimeoutError' || error.name === 'AbortError';
  }
  return error instanceof TypeError && /fetch failed/iu.test(error.message);
}

async function defaultRetryDelay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Fetches the landing-page content ids, retrying ONLY a transient network failure up to
 * {@link MAX_LANDING_PAGE_ATTEMPTS} times with backoff. Any real error (HTTP status, layout drift)
 * propagates on the first attempt and is never retried.
 */
async function fetchLandingPageContentIdsWithRetry(
  fetchImpl: FetchLike,
  retryDelay: (milliseconds: number) => Promise<void>,
): Promise<number[]> {
  for (let attempt = 1; attempt <= MAX_LANDING_PAGE_ATTEMPTS; attempt += 1) {
    try {
      return await fetchLandingPageContentIdsOnce(fetchImpl);
    } catch (error) {
      if (!isTransientNetworkError(error) || attempt === MAX_LANDING_PAGE_ATTEMPTS) throw error;
      await retryDelay(attempt === 1 ? 500 : attempt === 2 ? 1_500 : 3_000);
    }
  }
  throw new Error('official OGM edition scan retry loop ended unexpectedly');
}

export async function scanOgmEditions(
  registryPath: string,
  fetchImpl: FetchLike = fetch,
  options: ScanOgmEditionsOptions = {},
): Promise<OgmEditionScan> {
  const registry = await loadOgmTopicSourceRegistry(registryPath);
  const pinnedIds = registry.sources.map((source) => source.sourceId).sort((a, b) => a - b);
  const observedIds = await fetchLandingPageContentIdsWithRetry(
    fetchImpl,
    options.retryDelayImpl ?? defaultRetryDelay,
  );
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
