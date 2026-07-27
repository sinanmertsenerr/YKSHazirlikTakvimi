import { assertDeclaredContentLength, cancelBody } from './fetch-safety.ts';
import { attributeValue, htmlToText } from './html-text.ts';

const OSYM_HOST = 'www.osym.gov.tr';

export const OSYM_YKS_LIST_URL = 'https://www.osym.gov.tr/TR,13493/yks.html';
export const OSYM_YKS_ANNOUNCEMENTS_URL = 'https://www.osym.gov.tr/TR,13494/duyurular.html';
export const PREFERENCE_TIME_ZONE = 'Europe/Istanbul';

const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type PreferenceAnnouncementCandidate = {
  year: number;
  title: string;
  publishedDate: string;
  listUrl: string;
  detailUrl: string;
  documentId: string;
};

export type PreferenceCalendarEvent = {
  id: string;
  start: string;
  end: string;
  startTime: string | null;
  endTime: string | null;
  type: 'tercih';
  title: { tr: string; en: string };
  verified: true;
  verifiedAt: string;
  approximate: false;
  sample: false;
  source: string;
};

type DiscoverPreferenceOptions = {
  targetYear: number;
  verifiedAt: string;
  fetchImpl?: FetchLike;
};

type DateTimeParts = {
  date: string;
  time: string | null;
};

function assertTargetYear(targetYear: number): void {
  if (!Number.isInteger(targetYear) || targetYear < 2018 || targetYear > 2100) {
    throw new Error(`Invalid YKS preference year: ${targetYear}`);
  }
}

const TURKISH_MONTHS = new Map<string, number>([
  ['ocak', 1],
  ['şubat', 2],
  ['mart', 3],
  ['nisan', 4],
  ['mayıs', 5],
  ['haziran', 6],
  ['temmuz', 7],
  ['ağustos', 8],
  ['eylül', 9],
  ['ekim', 10],
  ['kasım', 11],
  ['aralık', 12],
]);

const MONTH_PATTERN = 'Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık';
const DATE_PATTERN = `(\\d{1,2})\\s+(${MONTH_PATTERN})\\s+(20\\d{2})`;
const TIME_PATTERN =
  `(?:\\s+saat\\s+((?:[01]?\\d|2[0-3]))[.:]([0-5]\\d)` + `(?:\\s*['’]?(?:de|da|te|ta))?)?`;

function plainText(html: string): string {
  return htmlToText(html);
}

function exactTable(html: string, id: string): string {
  const matches = [...html.matchAll(/<table\b[^>]*>/gi)].filter(
    (match) => attributeValue(match[0], 'id') === id,
  );
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one table#${id} on the canonical ÖSYM YKS list.`);
  }
  const match = matches[0]!;
  const start = (match.index ?? 0) + match[0].length;
  const closing = html.slice(start).match(/<\/table\s*>/i);
  if (closing?.index === undefined) throw new Error(`table#${id} has no closing tag.`);
  return html.slice(start, start + closing.index);
}

function assertBaseOfficialUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLocaleLowerCase('en-US') !== OSYM_HOST ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Refusing non-official ÖSYM preference URL: ${rawUrl}`);
  }
  return url;
}

function decodedPathname(url: URL): string {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    throw new Error(`Invalid percent encoding in ÖSYM URL: ${url.href}`);
  }
}

function assertOfficialYearListUrl(rawUrl: string, targetYear: number): URL {
  const url = assertBaseOfficialUrl(rawUrl);
  const pathname = decodedPathname(url);
  if (!new RegExp(`^/TR,\\d+/${targetYear}\\.html$`).test(pathname)) {
    throw new Error(`Unexpected canonical ÖSYM YKS list URL for ${targetYear}: ${rawUrl}`);
  }
  return url;
}

function assertOfficialListFetchUrl(rawUrl: string, targetYear: number): URL {
  const url = assertBaseOfficialUrl(rawUrl);
  const pathname = decodedPathname(url);
  if (
    pathname !== '/TR,13493/yks.html' &&
    pathname !== '/TR,13494/duyurular.html' &&
    !new RegExp(`^/TR,\\d+/${targetYear}\\.html$`).test(pathname)
  ) {
    throw new Error(`Unexpected ÖSYM YKS list redirect for ${targetYear}: ${rawUrl}`);
  }
  return url;
}

function expectedPreferenceTitles(year: number): readonly string[] {
  return [
    `${year}-YKS: Tercihlerin Alınması`,
    `${year} Yükseköğretim Kurumları Sınavı (YKS): Tercihlerin Alınması`,
  ];
}

function parseDottedDate(value: string, expectedYear: number): string {
  const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(20\d{2})$/);
  if (!match?.[1] || !match[2] || !match[3] || Number(match[3]) !== expectedYear) {
    throw new Error(`ÖSYM preference publication date does not match ${expectedYear}: ${value}`);
  }
  return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]), 'publication date');
}

function toIsoDate(day: number, month: number, year: number, context: string): string {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ÖSYM preference ${context}.`);
  }
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function expectedSlug(title: string, publishedDate: string, year: number): string {
  const suffix = publishedDate.split('-').reverse().join('');
  if (title === `${year}-YKS: Tercihlerin Alınması`) {
    return `${year}-yks-tercihlerin-alinmasi-${suffix}.html`;
  }
  if (title === `${year} Yükseköğretim Kurumları Sınavı (YKS): Tercihlerin Alınması`) {
    return `${year}-yuksekogretim-kurumlari-sinavi-yks-tercihlerin-alinmasi-${suffix}.html`;
  }
  throw new Error(`Unsupported ÖSYM preference title: ${title}`);
}

function assertOfficialDetailUrl(
  rawUrl: string,
  title: string,
  publishedDate: string,
  year: number,
): { url: URL; documentId: string } {
  const url = assertBaseOfficialUrl(rawUrl);
  const pathMatch = decodedPathname(url).match(/^\/TR,(\d+)\/([^/]+)$/);
  if (
    !pathMatch?.[1] ||
    !pathMatch[2] ||
    pathMatch[2] !== expectedSlug(title, publishedDate, year)
  ) {
    throw new Error(`Unexpected ÖSYM YKS preference detail URL: ${rawUrl}`);
  }
  return { url, documentId: pathMatch[1] };
}

export function parsePreferenceCandidateFromList(
  html: string,
  pageUrl: string,
  targetYear: number,
): PreferenceAnnouncementCandidate | null {
  assertTargetYear(targetYear);
  const listUrl = assertOfficialYearListUrl(pageUrl, targetYear);
  const table = exactTable(html, 'list');
  const titlePattern =
    /^(20\d{2})(?:-YKS| Yükseköğretim Kurumları Sınavı \(YKS\)): Tercihlerin Alınması \((\d{1,2}\.\d{1,2}\.20\d{2})\)$/u;
  const candidates: PreferenceAnnouncementCandidate[] = [];

  for (const anchor of table.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)) {
    const heading = (anchor[2] ?? '').match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
    if (!heading?.[1]) continue;
    const listTitle = plainText(heading[1]);
    const titleMatch = listTitle.match(titlePattern);
    if (!titleMatch?.[1] || !titleMatch[2]) continue;

    const year = Number(titleMatch[1]);
    if (year !== targetYear) {
      throw new Error(
        `Canonical ÖSYM YKS list exposed a ${year} preference announcement while ${targetYear} was required.`,
      );
    }
    const publishedDate = parseDottedDate(titleMatch[2], targetYear);
    const title = listTitle.slice(0, listTitle.length - ` (${titleMatch[2]})`.length);
    if (!expectedPreferenceTitles(targetYear).includes(title)) {
      throw new Error(`Unexpected ÖSYM YKS preference announcement title: ${title}`);
    }
    const href = attributeValue(anchor[1] ?? '', 'href');
    if (!href) throw new Error('ÖSYM preference announcement is missing its detail URL.');
    const detail = assertOfficialDetailUrl(
      new URL(href, listUrl).href,
      title,
      publishedDate,
      targetYear,
    );
    candidates.push({
      year,
      title,
      publishedDate,
      listUrl: listUrl.href,
      detailUrl: detail.url.href,
      documentId: detail.documentId,
    });
  }

  if (candidates.length > 1) {
    throw new Error(
      `Expected at most one exact ${targetYear}-YKS “Tercihlerin Alınması” announcement, found ${candidates.length}.`,
    );
  }
  return candidates[0] ?? null;
}

function extractOfficialDocumentBody(html: string, documentId: string): string {
  const starts = [
    ...html.matchAll(
      new RegExp(
        `<!--\\s*#${documentId}\\s+anahlı\\s+dal\\s+içerik\\s+başlıyor:[\\s\\S]*?-->`,
        'giu',
      ),
    ),
  ];
  const ends = [
    ...html.matchAll(
      new RegExp(
        `<!--\\s*#+\\s*${documentId}\\s+anahlı\\s+dal\\s+içerik\\s+bitti\\s*#+\\s*-->`,
        'giu',
      ),
    ),
  ];
  if (starts.length !== 1 || ends.length !== 1) {
    throw new Error('ÖSYM preference detail has an ambiguous or missing official document body.');
  }
  const start = (starts[0]!.index ?? 0) + starts[0]![0].length;
  const end = ends[0]!.index ?? -1;
  if (end <= start) throw new Error('ÖSYM preference detail document markers are out of order.');
  return html.slice(start, end);
}

function parseTurkishDateTimeMatch(
  match: RegExpMatchArray,
  expectedYear: number,
  context: string,
): DateTimeParts {
  const day = Number(match[1]);
  const monthName = match[2]?.toLocaleLowerCase('tr-TR');
  const year = Number(match[3]);
  const month = monthName ? TURKISH_MONTHS.get(monthName) : undefined;
  if (!month || year !== expectedYear) {
    throw new Error(`ÖSYM preference ${context} does not belong to ${expectedYear}.`);
  }
  const hour = match[4];
  const minute = match[5];
  return {
    date: toIsoDate(day, month, year, context),
    time:
      hour !== undefined && minute !== undefined
        ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
        : null,
  };
}

function uniqueDateTime(
  text: string,
  pattern: RegExp,
  expectedYear: number,
  context: string,
): DateTimeParts {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `ÖSYM preference ${context} must resolve to exactly one explicit date/time; found ${matches.length}.`,
    );
  }
  return parseTurkishDateTimeMatch(matches[0]!, expectedYear, context);
}

export function parsePreferenceDetail(
  html: string,
  candidate: PreferenceAnnouncementCandidate,
  verifiedAt: string,
): PreferenceCalendarEvent {
  assertTargetYear(candidate.year);
  if (!verifiedAt || Number.isNaN(new Date(verifiedAt).valueOf())) {
    throw new Error(`Invalid preference verification time: ${verifiedAt}`);
  }
  assertOfficialYearListUrl(candidate.listUrl, candidate.year);
  const detail = assertOfficialDetailUrl(
    candidate.detailUrl,
    candidate.title,
    candidate.publishedDate,
    candidate.year,
  );
  if (detail.documentId !== candidate.documentId) {
    throw new Error('ÖSYM preference detail document ID changed after list discovery.');
  }
  const body = plainText(extractOfficialDocumentBody(html, candidate.documentId));
  const titleOccurrences = body.split(candidate.title).length - 1;
  if (titleOccurrences !== 1) {
    throw new Error('ÖSYM preference detail title is missing or ambiguous.');
  }

  const startPattern = new RegExp(
    `tercih\\s+işlemleri,\\s*${DATE_PATTERN}\\s+tarihinde${TIME_PATTERN}\\s+başlayacaktır`,
    'giu',
  );
  const endPattern = new RegExp(
    `tercih\\s+işlemleri,\\s*${DATE_PATTERN}\\s+tarihinde${TIME_PATTERN}\\s+sona\\s+erecektir`,
    'giu',
  );
  const start = uniqueDateTime(body, startPattern, candidate.year, 'start');
  const end = uniqueDateTime(body, endPattern, candidate.year, 'end');
  if (
    end.date < start.date ||
    (end.date === start.date && end.time && start.time && end.time < start.time)
  ) {
    throw new Error('ÖSYM preference end precedes its start.');
  }

  // These are civil dates and times in Türkiye. They stay unshifted so the app can
  // interpret them consistently in its Europe/Istanbul calendar contract.
  return {
    id: `yks-${candidate.year}-tercih`,
    start: start.date,
    end: end.date,
    startTime: start.time,
    endTime: end.time,
    type: 'tercih',
    title: {
      tr: `${candidate.year}-YKS tercih dönemi`,
      en: `${candidate.year} YKS preference period`,
    },
    verified: true,
    verifiedAt,
    approximate: false,
    sample: false,
    source: candidate.detailUrl,
  };
}

async function readLimitedHtml(response: Response): Promise<string> {
  await assertDeclaredContentLength(response, MAX_RESPONSE_BYTES, 'ÖSYM preference response');
  if (!response.body) throw new Error('ÖSYM preference response has no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`ÖSYM preference response exceeds ${MAX_RESPONSE_BYTES} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

async function fetchOfficialHtml(
  rawUrl: string,
  fetchImpl: FetchLike,
  validateUrl: (url: string) => URL,
): Promise<{ html: string; finalUrl: string }> {
  let url = validateUrl(rawUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'cache-control': 'no-cache',
        'user-agent': 'YKS-Hazirlik-Preference-Calendar/1.0 (+offline content pack)',
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await cancelBody(response);
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error('ÖSYM preference source returned an invalid or excessive redirect.');
      }
      url = validateUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) {
      await cancelBody(response);
      throw new Error(`ÖSYM preference source returned HTTP ${response.status}.`);
    }
    const finalUrl = validateUrl(response.url || url.href);
    const contentType = response.headers.get('content-type')?.toLocaleLowerCase('en-US') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      await cancelBody(response);
      throw new Error(
        `ÖSYM preference source returned unsupported content type ${contentType || '<missing>'}.`,
      );
    }
    return { html: await readLimitedHtml(response), finalUrl: finalUrl.href };
  }
  throw new Error('ÖSYM preference source redirect limit exceeded.');
}

export async function discoverOfficialPreferenceEvent(
  options: DiscoverPreferenceOptions,
): Promise<PreferenceCalendarEvent | null> {
  assertTargetYear(options.targetYear);
  if (!options.verifiedAt || Number.isNaN(new Date(options.verifiedAt).valueOf())) {
    throw new Error(`Invalid preference verification time: ${options.verifiedAt}`);
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  // Tercih duyurusu takvimin zorunlu değil, ek bir kaydıdır. ÖSYM 2026-07'de site
  // yapısını yenileyip bu listenin eski yolunu kaldırdı; kaynak bulunamadığında
  // takvimin tamamını düşürmek yerine tercih kaydı atlanır ve koşu özetine uyarı
  // düşer. Sentetik tarih üretilmez (§9.1); yeni yola taşıma ayrı iş kalemidir.
  let list: { html: string; finalUrl: string };
  try {
    list = await fetchOfficialHtml(OSYM_YKS_LIST_URL, fetchImpl, (url) =>
      assertOfficialListFetchUrl(url, options.targetYear),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(
      `::warning title=ÖSYM tercih duyurusu kaynağı okunamadı::${detail} — takvim tercih kaydı olmadan üretiliyor.`,
    );
    return null;
  }
  const candidate = parsePreferenceCandidateFromList(list.html, list.finalUrl, options.targetYear);
  if (!candidate) return null;

  const detail = await fetchOfficialHtml(
    candidate.detailUrl,
    fetchImpl,
    (url) =>
      assertOfficialDetailUrl(url, candidate.title, candidate.publishedDate, candidate.year).url,
  );
  if (detail.finalUrl !== candidate.detailUrl) {
    throw new Error('ÖSYM preference detail redirected away from the list-selected document.');
  }
  return parsePreferenceDetail(detail.html, candidate, options.verifiedAt);
}
