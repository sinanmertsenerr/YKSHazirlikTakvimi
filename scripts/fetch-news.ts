import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { CURRENT_SCHEMA_VERSION, newsItemSchema, newsSchema } from './lib/content-schemas.ts';
import { isRelevantNewsTitle } from './lib/news-relevance.ts';
import {
  preserveStableRecordVerificationTimes,
  readTextFileIfExists,
  writeTextFileAtomicallyIfChanged,
} from './lib/semantic-stability.ts';

export { isRelevantNewsTitle } from './lib/news-relevance.ts';

export const OSYM_YKS_LIST_URL = 'https://www.osym.gov.tr/TR,13493/yks.html';
export const YOK_LIST_URLS = [
  'https://www.yok.gov.tr/tr/news',
  'https://www.yok.gov.tr/tr/announcements',
] as const;
export const MAX_RESPONSE_BYTES = 2_000_000;

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const MAX_FETCH_ATTEMPTS = 2;
const MAX_ITEMS = 50;
const MAX_YOK_DETAIL_CANDIDATES = 12;
const USER_AGENT = 'YKS-News-Pipeline/2.0 (+https://github.com/)';

type Authority = 'osym' | 'yok';
type Source = 'ÖSYM' | 'YÖK';
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type NewsItem = {
  id: string;
  publishedAt: string;
  source: Source;
  title: { tr: string; en: string };
  summary: { tr: string; en: string };
  url: string;
  verified: true;
  verifiedAt: string;
  provenance: {
    listUrl: string;
    detailUrl: string;
    publishedAtEvidence: 'osym-list-title-date' | 'yok-detail-update-date';
  };
  approximate: false;
  sample: false;
  translationStatus: 'source-only';
};

export type YokCandidate = {
  title: string;
  url: string;
  listUrl: string;
};

export type FetchNewsOptions = {
  outputPath?: string;
  dryRun?: boolean;
  fetchImpl?: FetchLike;
  now?: Date;
};

type FetchedHtml = {
  finalUrl: string;
  html: string;
};

type NewsDocument = ReturnType<typeof newsSchema.parse>;

class PageFetchError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'PageFetchError';
    this.retryable = retryable;
  }
}

function isAllowedAuthorityHost(hostname: string, authority: Authority): boolean {
  const host = hostname.toLocaleLowerCase('en-US');
  const root = `${authority}.gov.tr`;
  return host === root || host.endsWith(`.${root}`);
}

function assertAllowedOfficialUrl(rawUrl: string, authority: Authority): URL {
  const url = new URL(rawUrl);
  if (
    url.protocol !== 'https:' ||
    !isAllowedAuthorityHost(url.hostname, authority) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(`Refusing non-${authority.toUpperCase()} official URL: ${rawUrl}`);
  }
  return url;
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    acirc: 'â',
    Acirc: 'Â',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    ccedil: 'ç',
    Ccedil: 'Ç',
    gbreve: 'ğ',
    Gbreve: 'Ğ',
    Idot: 'İ',
    inodot: 'ı',
    icirc: 'î',
    Icirc: 'Î',
    ldquo: '“',
    lsquo: '‘',
    mdash: '—',
    ndash: '–',
    odot: 'ö',
    Odot: 'Ö',
    ouml: 'ö',
    Ouml: 'Ö',
    rdquo: '”',
    rsquo: '’',
    scedil: 'ş',
    Scedil: 'Ş',
    udot: 'ü',
    Udot: 'Ü',
    uuml: 'ü',
    Uuml: 'Ü',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.toLowerCase().startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return named[code] ?? entity;
  });
}

function plainText(html: string): string {
  return decodeHtml(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function attributeValue(openingTag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = openingTag.match(pattern);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value ? decodeHtml(value).trim() : undefined;
}

function hasClass(openingTag: string, expectedClass: string): boolean {
  return (attributeValue(openingTag, 'class') ?? '').split(/\s+/).includes(expectedClass);
}

function dateOnlyToPublishedAt(day: string, month: string, year: string): string | undefined {
  const dayNumber = Number(day);
  const monthNumber = Number(month);
  const yearNumber = Number(year);
  const value = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (
    value.getUTCFullYear() !== yearNumber ||
    value.getUTCMonth() !== monthNumber - 1 ||
    value.getUTCDate() !== dayNumber
  ) {
    return undefined;
  }
  const isoDate = `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return `${isoDate}T00:00:00+03:00`;
}

function dottedDateToPublishedAt(value: string): string | undefined {
  const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(20\d{2})$/);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  return dateOnlyToPublishedAt(match[1], match[2], match[3]);
}

function deterministicId(source: Source, url: string): string {
  const prefix = source === 'ÖSYM' ? 'osym' : 'yok';
  const digest = createHash('sha256').update(`${source}\0${url}`).digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
}

function makeNewsItem(
  source: Source,
  title: string,
  url: string,
  publishedAt: string,
  verifiedAt: string,
  listUrl: string,
  publishedAtEvidence: NewsItem['provenance']['publishedAtEvidence'],
): NewsItem {
  return newsItemSchema.parse({
    id: deterministicId(source, url),
    publishedAt,
    source,
    title: { tr: title, en: title },
    summary: { tr: title, en: title },
    url,
    verified: true,
    verifiedAt,
    provenance: {
      listUrl,
      detailUrl: url,
      publishedAtEvidence,
    },
    approximate: false,
    sample: false,
    translationStatus: 'source-only',
  });
}

function isExpectedDetailUrl(url: URL, source: Source): boolean {
  if (url.search) return false;
  if (source === 'ÖSYM') {
    return (
      url.hostname === 'www.osym.gov.tr' &&
      /^\/TR(?:,|%2c)\d+\/[a-z0-9-]+\.html$/i.test(url.pathname)
    );
  }
  return (
    url.hostname === 'www.yok.gov.tr' &&
    /^\/tr\/(?:news|announcements)\/[A-Za-z0-9_-]+$/i.test(url.pathname)
  );
}

function findTableByExactId(html: string, id: string): string {
  const openingPattern = /<table\b[^>]*>/gi;
  const matches = [...html.matchAll(openingPattern)].filter(
    (match) => attributeValue(match[0], 'id') === id,
  );
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one table#${id}, found ${matches.length}`);
  }
  const match = matches[0]!;
  const start = (match.index ?? 0) + match[0].length;
  const closingMatch = html.slice(start).match(/<\/table\s*>/i);
  if (closingMatch?.index === undefined) throw new Error(`table#${id} has no closing tag`);
  return html.slice(start, start + closingMatch.index);
}

export function parseOsymYksList(html: string, pageUrl: string, verifiedAt: string): NewsItem[] {
  const listUrl = assertAllowedOfficialUrl(pageUrl, 'osym');
  const table = findTableByExactId(html, 'list');
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const items: NewsItem[] = [];

  for (const rowMatch of table.matchAll(rowPattern)) {
    const row = rowMatch[1] ?? '';
    const anchorPattern = /(<a\b[^>]*>)([\s\S]*?)<\/a>/gi;
    for (const anchorMatch of row.matchAll(anchorPattern)) {
      const innerHtml = anchorMatch[2] ?? '';
      const headingMatch = innerHtml.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
      if (!headingMatch) continue;
      const href = attributeValue(anchorMatch[1] ?? '', 'href');
      const title = plainText(headingMatch[1] ?? '');
      const dateMatch = title.match(/\((\d{1,2}\.\d{1,2}\.20\d{2})\)\s*$/);
      if (!href || !dateMatch?.[1] || !isRelevantNewsTitle(title)) continue;

      let detailUrl: URL;
      try {
        detailUrl = assertAllowedOfficialUrl(new URL(href, pageUrl).href, 'osym');
      } catch {
        continue;
      }
      if (!isExpectedDetailUrl(detailUrl, 'ÖSYM')) continue;
      const publishedAt = dottedDateToPublishedAt(dateMatch[1]);
      if (!publishedAt) continue;
      items.push(
        makeNewsItem(
          'ÖSYM',
          title,
          detailUrl.href,
          publishedAt,
          verifiedAt,
          listUrl.href,
          'osym-list-title-date',
        ),
      );
    }
  }

  const deduplicated = new Map(items.map((item) => [item.url, item]));
  if (!deduplicated.size) {
    throw new Error('table#list contained no strictly dated YKS announcements');
  }
  return [...deduplicated.values()];
}

export function parseYokListCandidates(html: string, pageUrl: string): YokCandidate[] {
  const listUrl = assertAllowedOfficialUrl(pageUrl, 'yok');
  if (!/^\/tr\/(?:news|announcements)\/?$/i.test(listUrl.pathname)) {
    throw new Error(`Unsupported YÖK list path: ${listUrl.pathname}`);
  }
  if (
    !/<div\b[^>]*class\s*=\s*(?:"[^"]*\bblog-listing\b[^"]*"|'[^']*\bblog-listing\b[^']*')[^>]*>/i.test(
      html,
    )
  ) {
    throw new Error('YÖK list page has no blog-listing container');
  }

  const category = listUrl.pathname.toLocaleLowerCase('en-US').includes('/announcements')
    ? 'announcements'
    : 'news';
  const headingPattern = /(<h3\b[^>]*>)([\s\S]*?)<\/h3>/gi;
  const candidates: YokCandidate[] = [];

  for (const headingMatch of html.matchAll(headingPattern)) {
    if (!hasClass(headingMatch[1] ?? '', 'title')) continue;
    const heading = headingMatch[2] ?? '';
    const anchorMatch = heading.match(/(<a\b[^>]*>)([\s\S]*?)<\/a>/i);
    if (!anchorMatch) continue;
    const href = attributeValue(anchorMatch[1] ?? '', 'href');
    const title = plainText(anchorMatch[2] ?? '');
    if (!href || !isRelevantNewsTitle(title)) continue;

    let detailUrl: URL;
    try {
      detailUrl = assertAllowedOfficialUrl(new URL(href, listUrl).href, 'yok');
    } catch {
      continue;
    }
    if (
      detailUrl.hostname !== 'www.yok.gov.tr' ||
      !new RegExp(`^/tr/${category}/[A-Za-z0-9_-]+$`, 'i').test(detailUrl.pathname)
    ) {
      continue;
    }
    candidates.push({ title, url: detailUrl.href, listUrl: listUrl.href });
  }

  return [...new Map(candidates.map((candidate) => [candidate.url, candidate])).values()];
}

export function parseYokDetail(
  html: string,
  pageUrl: string,
  expectedTitle: string,
  listUrl: string,
  verifiedAt: string,
): NewsItem {
  const detailUrl = assertAllowedOfficialUrl(pageUrl, 'yok');
  assertAllowedOfficialUrl(listUrl, 'yok');
  if (!isExpectedDetailUrl(detailUrl, 'YÖK')) throw new Error('Unexpected YÖK detail URL');

  const titleMatches = [...html.matchAll(/(<h2\b[^>]*>)([\s\S]*?)<\/h2>/gi)]
    .filter((match) => hasClass(match[1] ?? '', 'title'))
    .map((match) => plainText(match[2] ?? ''));
  if (!titleMatches.includes(expectedTitle)) {
    throw new Error('YÖK detail title does not match the list title');
  }

  const text = plainText(html);
  const dateValues = [...text.matchAll(/Güncelleme Tarihi:\s*(\d{1,2}\.\d{1,2}\.20\d{2})\b/giu)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  const uniqueDates = [...new Set(dateValues)];
  if (uniqueDates.length !== 1) {
    throw new Error(`Expected one unambiguous YÖK update date, found ${uniqueDates.length}`);
  }
  const publishedAt = dottedDateToPublishedAt(uniqueDates[0]!);
  if (!publishedAt) throw new Error(`Invalid YÖK update date: ${uniqueDates[0]}`);
  return makeNewsItem(
    'YÖK',
    expectedTitle,
    detailUrl.href,
    publishedAt,
    verifiedAt,
    listUrl,
    'yok-detail-update-date',
  );
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The stream may already be closed or aborted.
  }
}

async function readLimitedHtml(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type')?.toLocaleLowerCase('en-US') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new PageFetchError(`unsupported content type ${contentType || '<missing>'}`, false);
  }

  const lengthHeader = response.headers.get('content-length');
  if (lengthHeader) {
    if (!/^\d+$/.test(lengthHeader)) {
      throw new PageFetchError(`invalid Content-Length ${lengthHeader}`, false);
    }
    const declaredLength = Number(lengthHeader);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_RESPONSE_BYTES) {
      throw new PageFetchError(`response exceeds ${MAX_RESPONSE_BYTES} bytes`, false);
    }
  }
  if (!response.body) throw new PageFetchError('empty response body', true);

  const decoder = new TextDecoder('utf-8', { fatal: false });
  let bytes = 0;
  let html = '';
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new PageFetchError(`response exceeds ${MAX_RESPONSE_BYTES} bytes`, false);
      }
      html += decoder.decode(chunk, { stream: true });
    }
    html += decoder.decode();
    return html;
  } catch (error) {
    await cancelBody(response);
    throw error;
  }
}

async function fetchOfficialHtmlOnce(
  rawUrl: string,
  authority: Authority,
  fetchImpl: FetchLike,
): Promise<FetchedHtml> {
  let currentUrl = assertAllowedOfficialUrl(rawUrl, authority);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchImpl(currentUrl, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': USER_AGENT,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await cancelBody(response);
      if (!location) throw new PageFetchError('redirect has no Location header', false);
      if (redirects === MAX_REDIRECTS) {
        throw new PageFetchError(`more than ${MAX_REDIRECTS} redirects`, false);
      }
      const redirectedUrl = new URL(location, currentUrl);
      try {
        currentUrl = assertAllowedOfficialUrl(redirectedUrl.href, authority);
      } catch (error) {
        throw new PageFetchError(
          `refused redirect to ${redirectedUrl.href}: ${error instanceof Error ? error.message : String(error)}`,
          false,
        );
      }
      continue;
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      await cancelBody(response);
      throw new PageFetchError(`HTTP ${response.status}`, retryable);
    }

    try {
      const html = await readLimitedHtml(response);
      return { finalUrl: currentUrl.href, html };
    } catch (error) {
      await cancelBody(response);
      throw error;
    }
  }

  throw new PageFetchError('redirect loop ended unexpectedly', false);
}

export async function fetchOfficialHtml(
  rawUrl: string,
  authority: Authority,
  fetchImpl: FetchLike = fetch,
): Promise<FetchedHtml> {
  let lastError: unknown;
  let performedAttempts = 0;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    performedAttempts = attempt;
    try {
      return await fetchOfficialHtmlOnce(rawUrl, authority, fetchImpl);
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof PageFetchError) || error.retryable;
      if (!retryable || attempt === MAX_FETCH_ATTEMPTS) break;
      await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, 250 * attempt));
    }
  }
  throw new Error(
    `Could not fetch ${rawUrl} after ${performedAttempts} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    { cause: lastError },
  );
}

async function fetchOsymItems(fetchImpl: FetchLike, verifiedAt: string): Promise<NewsItem[]> {
  const page = await fetchOfficialHtml(OSYM_YKS_LIST_URL, 'osym', fetchImpl);
  return parseOsymYksList(page.html, page.finalUrl, verifiedAt);
}

async function fetchYokItems(
  fetchImpl: FetchLike,
  verifiedAt: string,
): Promise<{ complete: boolean; failures: string[]; items: NewsItem[] }> {
  const failures: string[] = [];
  const candidates = new Map<string, YokCandidate>();
  let complete = true;

  for (const listUrl of YOK_LIST_URLS) {
    try {
      const page = await fetchOfficialHtml(listUrl, 'yok', fetchImpl);
      for (const candidate of parseYokListCandidates(page.html, page.finalUrl)) {
        candidates.set(candidate.url, candidate);
      }
    } catch (error) {
      complete = false;
      failures.push(`YÖK ${listUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (candidates.size > MAX_YOK_DETAIL_CANDIDATES) {
    return {
      complete: false,
      failures: [
        ...failures,
        `YÖK: refusing ${candidates.size} detail candidates (limit ${MAX_YOK_DETAIL_CANDIDATES})`,
      ],
      items: [],
    };
  }

  const items: NewsItem[] = [];
  for (const candidate of candidates.values()) {
    try {
      const detail = await fetchOfficialHtml(candidate.url, 'yok', fetchImpl);
      items.push(
        parseYokDetail(
          detail.html,
          detail.finalUrl,
          candidate.title,
          candidate.listUrl,
          verifiedAt,
        ),
      );
    } catch (error) {
      complete = false;
      failures.push(
        `YÖK ${candidate.url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { complete, failures, items };
}

function parsePreviousNewsDocument(raw: string | null): NewsDocument | undefined {
  if (raw === null) return undefined;
  try {
    const parsed = newsSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function stabilizeNewsDocument(
  candidateDocument: unknown,
  previousDocument: unknown,
): NewsDocument {
  const candidate = newsSchema.parse(candidateDocument);
  const previous = newsSchema.safeParse(previousDocument);
  if (!previous.success) return candidate;
  return newsSchema.parse({
    ...candidate,
    items: preserveStableRecordVerificationTimes(
      candidate.items,
      previous.data.items,
      (item) => item.id,
    ),
  });
}

export async function fetchNews(options: FetchNewsOptions = {}): Promise<{
  outputPath: string;
  count: number;
  failures: string[];
  items: NewsItem[];
  changed: boolean;
}> {
  const outputPath = resolve(options.outputPath ?? resolve(process.cwd(), 'content/news.json'));
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.valueOf())) throw new Error('Invalid news verification time');
  const verifiedAt = now.toISOString();
  const previousRaw = await readTextFileIfExists(outputPath);
  const previousDocument = parsePreviousNewsDocument(previousRaw);

  // ÖSYM is the required canonical feed. Any failure leaves the last-good file untouched.
  const osymItems = await fetchOsymItems(fetchImpl, verifiedAt);
  const yokResult = await fetchYokItems(fetchImpl, verifiedAt);
  const previousYokItems = yokResult.complete
    ? []
    : (previousDocument?.items.filter((item) => item.source === 'YÖK') ?? []);

  const byUrl = new Map<string, NewsItem>();
  for (const item of [...osymItems, ...previousYokItems, ...yokResult.items]) {
    byUrl.set(item.url, item);
  }
  const items = [...byUrl.values()]
    .sort(
      (left, right) =>
        right.publishedAt.localeCompare(left.publishedAt) || left.url.localeCompare(right.url),
    )
    .slice(0, MAX_ITEMS);
  if (!items.length) throw new Error('No strictly verified YKS announcements were produced');

  const document = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    dataStatus: {
      verified: true,
      approximate: false,
      sample: false,
      source: osymItems[0]!.provenance.listUrl,
      note: {
        tr: 'Kayıtlar yalnızca resmî ÖSYM YKS listesi ile detay tarihi doğrulanan YÖK sayfalarından alınır; kaynak dil korunur.',
        en: 'Items come only from the official ÖSYM YKS list and YÖK pages with a verified detail date; source-language text is retained.',
      },
    },
    items,
  };
  const candidate = newsSchema.safeParse(document);
  if (!candidate.success) {
    throw new Error(`Normalized news failed schema validation: ${candidate.error.message}`);
  }
  const parsed = stabilizeNewsDocument(candidate.data, previousDocument);
  const serialized =
    previousRaw !== null &&
    previousDocument !== undefined &&
    isDeepStrictEqual(parsed, previousDocument)
      ? previousRaw
      : `${JSON.stringify(parsed, null, 2)}\n`;
  const changed = previousRaw !== serialized;

  if (!options.dryRun) await writeTextFileAtomicallyIfChanged(outputPath, serialized);
  return {
    outputPath,
    count: parsed.items.length,
    failures: yokResult.failures,
    items: parsed.items,
    changed,
  };
}

function parseOptions(args: string[]): FetchNewsOptions {
  const options: FetchNewsOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--output' && value) {
      options.outputPath = value;
      index += 1;
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options: FetchNewsOptions;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    options = { dryRun: true };
  }

  if (process.exitCode !== 1) {
    fetchNews(options)
      .then(({ outputPath, count, failures, items, changed }) => {
        const osymCount = items.filter((item) => item.source === 'ÖSYM').length;
        const yokCount = items.filter((item) => item.source === 'YÖK').length;
        console.log(
          `${options.dryRun ? 'Normalized' : changed ? 'Wrote' : 'Kept'} ${count} official news item(s) (ÖSYM ${osymCount}, YÖK ${yokCount})${options.dryRun ? ' (dry run)' : ` at ${outputPath}`}.`,
        );
        for (const failure of failures) console.warn(`WARN ${failure}`);
      })
      .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
