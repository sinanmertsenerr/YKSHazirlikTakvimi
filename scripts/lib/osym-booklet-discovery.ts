import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import { calendarSchema } from './content-schemas.ts';
import { htmlToText } from './html-text.ts';
import {
  assertPopplerAvailable,
  locateBookletSectionPages,
  splitPdfText,
} from './annual-classifier-extraction.ts';
import {
  assertAllowedOfficialPdfUrl,
  BOOKLET_FIRST_YEAR,
  BOOKLET_MAX_YEAR,
  osymBookletRegistrySchema,
  type OsymBooklet,
  type OsymBookletRegistry,
} from './osym-booklet-registry.ts';
import { OFFICIAL_CALENDAR_URL, parseOfficialCalendarHtml } from '../sync-calendar.ts';

export const OFFICIAL_YKS_LIST_URL = 'https://www.osym.gov.tr/TR,13493/yks.html';
export const BOOKLET_DISCOVERY_SCHEMA_VERSION = 1;

const MAX_HTML_BYTES = 2_000_000;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PDF_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 45_000;
const COMMAND_TIMEOUT_MS = 60_000;
const USER_AGENT = 'YKS-Hazirlik-Official-Booklet-Discovery/1.0';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type Session = 'tyt' | 'ayt';
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type InspectedOfficialPdf = {
  pdfUrl: string;
  bytes: number;
  sha256: string;
  sectionIds: string[];
};

export type InspectOfficialPdf = (input: {
  pdfUrl: string;
  year: number;
  session: Session;
  expectedSectionIds: string[];
  fetchImpl: FetchLike;
}) => Promise<InspectedOfficialPdf>;

const candidateSchema = z
  .object({
    schemaVersion: z.literal(BOOKLET_DISCOVERY_SCHEMA_VERSION),
    kind: z.literal('osym-booklet-registry-candidate'),
    generatedAt: z.iso.datetime({ offset: true }),
    targetYear: z.int().min(BOOKLET_FIRST_YEAR).max(BOOKLET_MAX_YEAR),
    sources: z
      .object({
        listUrl: z.url(),
        announcementUrl: z.url(),
        detailUrl: z.url(),
        calendarUrl: z.url(),
      })
      .strict(),
    structuralVerification: z.array(
      z
        .object({
          bookletId: z.string(),
          method: z.literal('poppler-official-section-headers'),
          sectionIds: z.array(z.string()).min(1),
        })
        .strict(),
    ),
    registry: osymBookletRegistrySchema,
    publication: z
      .object({
        automatic: z.literal(false),
        reason: z.literal('human-review-required'),
      })
      .strict(),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.sources.listUrl !== OFFICIAL_YKS_LIST_URL) {
      context.addIssue({
        code: 'custom',
        path: ['sources', 'listUrl'],
        message: 'candidate must originate from the canonical ÖSYM YKS list',
      });
    }
    if (candidate.sources.calendarUrl !== OFFICIAL_CALENDAR_URL) {
      context.addIssue({
        code: 'custom',
        path: ['sources', 'calendarUrl'],
        message: 'candidate must originate from the canonical ÖSYM calendar',
      });
    }
    for (const key of ['announcementUrl', 'detailUrl'] as const) {
      try {
        assertCleanOfficialPageUrl(candidate.sources[key]);
      } catch (error) {
        context.addIssue({
          code: 'custom',
          path: ['sources', key],
          message: error instanceof Error ? error.message : 'invalid official source URL',
        });
      }
    }
    if (candidate.registry.coverage.lastYear !== candidate.targetYear) {
      context.addIssue({
        code: 'custom',
        path: ['registry', 'coverage', 'lastYear'],
        message: 'candidate registry coverage must end at targetYear',
      });
    }
    const expectedIds = (['tyt', 'ayt'] as const).map(
      (session) => `${candidate.targetYear}-${session}`,
    );
    const verificationIds = candidate.structuralVerification.map(({ bookletId }) => bookletId);
    if (
      verificationIds.length !== expectedIds.length ||
      verificationIds.some((id, index) => id !== expectedIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['structuralVerification'],
        message: 'candidate must verify exactly the target TYT and AYT booklets in order',
      });
    }
    const targetBooklets = candidate.registry.booklets.filter(
      ({ year }) => year === candidate.targetYear,
    );
    if (
      targetBooklets.length !== 2 ||
      targetBooklets.some(
        (booklet, index) =>
          booklet.session !== (['tyt', 'ayt'] as const)[index] ||
          booklet.releasePageUrl !== candidate.sources.detailUrl,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['registry', 'booklets'],
        message: 'target booklets must be the exact TYT/AYT pair from the discovered detail page',
      });
    }
    for (const [index, session] of (['tyt', 'ayt'] as const).entries()) {
      const expectedSections = candidate.registry.sessionStructures[session].sections.map(
        ({ id }) => id,
      );
      const observed = candidate.structuralVerification[index]?.sectionIds;
      if (
        !observed ||
        observed.length !== expectedSections.length ||
        observed.some((id, sectionIndex) => id !== expectedSections[sectionIndex])
      ) {
        context.addIssue({
          code: 'custom',
          path: ['structuralVerification', index, 'sectionIds'],
          message: `${session.toUpperCase()} structural headers drifted from the official registry contract`,
        });
      }
    }
  });

export type OsymBookletDiscoveryCandidate = z.infer<typeof candidateSchema>;

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
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
    odot: 'ö',
    Odot: 'Ö',
    scedil: 'ş',
    Scedil: 'Ş',
    udot: 'ü',
    Udot: 'Ü',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code.toLocaleLowerCase('en-US').startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return named[code] ?? named[code.toLocaleLowerCase('en-US')] ?? entity;
  });
}

function normalizedText(html: string): string {
  return htmlToText(html)
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('tr-TR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/İ/g, 'I');
}

function attributeValue(attributes: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\u0060]+))`,
    'i',
  ).exec(attributes);
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? '') || null;
}

type HtmlAnchor = { href: string; text: string };

function anchorsFrom(html: string): HtmlAnchor[] {
  const anchors: HtmlAnchor[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attributeValue(match[1] ?? '', 'href');
    if (href) anchors.push({ href, text: normalizedText(match[2] ?? '') });
  }
  return anchors;
}

function exactSingle<T>(values: T[], label: string): T {
  if (values.length !== 1) {
    throw new Error(`Expected exactly one ${label}; found ${values.length}.`);
  }
  return values[0]!;
}

function unique<T>(values: T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value] as const)).values()];
}

function assertCleanOfficialPageUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.osym.gov.tr' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/TR(?:,|%2C)\d+\/[a-z0-9-]+\.html$/i.test(url.pathname)
  ) {
    throw new Error(`Refusing non-canonical ÖSYM page URL: ${rawUrl}`);
  }
  return url;
}

function assertOfficialHtmlUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'www.osym.gov.tr' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(`Refusing non-official ÖSYM HTML URL: ${rawUrl}`);
  }
  return url;
}

function officialPageHref(href: string, baseUrl: string): string {
  return assertCleanOfficialPageUrl(new URL(href, baseUrl).href).href;
}

export function discoverAnnouncementUrl(html: string, year: number): string {
  const tableMatch = [...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)].filter(
    (match) => attributeValue(match[1] ?? '', 'id') === 'list',
  );
  const table = exactSingle(tableMatch, 'table#list on the canonical ÖSYM YKS page');
  const candidates = unique(
    anchorsFrom(table[2] ?? '').flatMap((anchor) => {
      if (
        !anchor.text.includes(String(year)) ||
        !anchor.text.includes('YKS') ||
        !anchor.text.includes('TEMEL SORU KITAPCIKLARI') ||
        !anchor.text.includes('CEVAP ANAHTARLARI') ||
        !anchor.text.includes('YAYIMLANDI')
      ) {
        return [];
      }
      return [{ ...anchor, href: officialPageHref(anchor.href, OFFICIAL_YKS_LIST_URL) }];
    }),
    ({ href }) => href,
  );
  return exactSingle(candidates, `${year}-YKS booklet publication announcement`).href;
}

export function discoverDetailUrl(html: string, announcementUrl: string, year: number): string {
  assertCleanOfficialPageUrl(announcementUrl);
  const candidates = unique(
    anchorsFrom(html).flatMap((anchor) => {
      if (
        !anchor.text.includes(String(year)) ||
        !anchor.text.includes('YKS') ||
        !anchor.text.includes('TYT') ||
        !anchor.text.includes('AYT') ||
        !anchor.text.includes('TEMEL SORU KITAPCIKLARI') ||
        !anchor.text.includes('CEVAP ANAHTARLARI')
      ) {
        return [];
      }
      return [{ ...anchor, href: officialPageHref(anchor.href, announcementUrl) }];
    }),
    ({ href }) => href,
  );
  return exactSingle(candidates, `${year}-YKS official booklet detail page`).href;
}

function expectedPdfPath(url: URL, year: number, session: Session): boolean {
  const pathName = decodeURIComponent(url.pathname).toLocaleLowerCase('en-US');
  const fileName = pathName.split('/').at(-1) ?? '';
  return (
    pathName.startsWith(`/pdfdokuman/${year}/yks/`) &&
    new RegExp(`(?:^|[_-])${session}(?:[_-]|\\.|$)`, 'i').test(fileName)
  );
}

export function discoverSessionPdfUrls(
  html: string,
  detailUrl: string,
  year: number,
): Record<Session, string> {
  assertCleanOfficialPageUrl(detailUrl);
  const anchors = anchorsFrom(html);
  return Object.fromEntries(
    (['tyt', 'ayt'] as const).map((session) => {
      const officialLabel =
        session === 'tyt' ? 'TEMEL YETERLILIK TESTI' : 'ALAN YETERLILIK TESTLERI';
      const candidates = unique(
        anchors.flatMap((anchor) => {
          if (
            !anchor.text.includes(officialLabel) ||
            !anchor.text.includes(session.toUpperCase())
          ) {
            return [];
          }
          const url = assertAllowedOfficialPdfUrl(new URL(anchor.href, detailUrl).href);
          if (!expectedPdfPath(url, year, session)) {
            throw new Error(
              `${session.toUpperCase()} PDF URL does not match target year/session: ${url.href}`,
            );
          }
          return [url.href];
        }),
        (value) => value,
      );
      return [
        session,
        exactSingle(candidates, `${year}-YKS ${session.toUpperCase()} PDF`),
      ] as const;
    }),
  ) as Record<Session, string>;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The connection can already be closed after a redirect or validation failure.
  }
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new Error(`Official response has an invalid or oversized Content-Length: ${length}`);
  }
  if (!response.body) throw new Error('Official response has no body.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      await cancelBody(response);
      throw new Error(`Official response exceeds the ${maxBytes}-byte safety limit.`);
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchOfficialHtml(
  initialUrl: string,
  fetchImpl: FetchLike,
): Promise<{ html: string; finalUrl: string }> {
  let currentUrl = assertOfficialHtmlUrl(initialUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'cache-control': 'no-cache',
        'user-agent': USER_AGENT,
      },
    });
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      await cancelBody(response);
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error('ÖSYM HTML source returned an invalid or excessive redirect.');
      }
      currentUrl = assertOfficialHtmlUrl(new URL(location, currentUrl).href);
      continue;
    }
    if (!response.ok) {
      await cancelBody(response);
      throw new Error(`ÖSYM HTML source returned HTTP ${response.status}.`);
    }
    const contentType = response.headers.get('content-type')?.toLocaleLowerCase('en-US') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      await cancelBody(response);
      throw new Error(`ÖSYM HTML source returned unsupported Content-Type ${contentType}.`);
    }
    return {
      html: new TextDecoder('utf-8').decode(await readLimitedBody(response, MAX_HTML_BYTES)),
      finalUrl: currentUrl.href,
    };
  }
  throw new Error('ÖSYM HTML redirect limit exceeded.');
}

async function openOfficialPdf(
  initialUrl: string,
  fetchImpl: FetchLike,
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = assertAllowedOfficialPdfUrl(initialUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/pdf', 'user-agent': USER_AGENT },
    });
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      await cancelBody(response);
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error('Official PDF returned an invalid or excessive redirect.');
      }
      currentUrl = assertAllowedOfficialPdfUrl(new URL(location, currentUrl).href);
      continue;
    }
    if (!response.ok) {
      await cancelBody(response);
      throw new Error(`Official PDF returned HTTP ${response.status}.`);
    }
    return { response, finalUrl: currentUrl.href };
  }
  throw new Error('Official PDF redirect limit exceeded.');
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false,
      env: { ...process.env, LC_ALL: 'C' },
    });
    let stderr = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), COMMAND_TIMEOUT_MS);
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Required command ${command} is unavailable: ${error.message}`));
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `${command} failed (${signal ? `signal ${signal}` : `exit ${code}`}): ${stderr.trim()}`,
          ),
        );
      }
    });
  });
}

export const inspectOfficialPdfWithPoppler: InspectOfficialPdf = async ({
  pdfUrl,
  year,
  session,
  expectedSectionIds,
  fetchImpl,
}) => {
  const initial = assertAllowedOfficialPdfUrl(pdfUrl);
  if (!expectedPdfPath(initial, year, session)) {
    throw new Error(`Initial PDF URL does not match ${year}-${session}.`);
  }
  const directory = await mkdtemp(path.join(tmpdir(), `yks-${year}-${session}-`));
  const pdfPath = path.join(directory, 'booklet.pdf');
  const textPath = path.join(directory, 'booklet.txt');
  try {
    const { response, finalUrl } = await openOfficialPdf(initial.href, fetchImpl);
    try {
      const final = assertAllowedOfficialPdfUrl(finalUrl);
      if (!expectedPdfPath(final, year, session)) {
        throw new Error(`Final PDF URL does not match ${year}-${session}.`);
      }
      const contentType =
        response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLocaleLowerCase('en-US') ??
        '';
      if (contentType !== 'application/pdf') {
        throw new Error(`Expected application/pdf, received ${contentType || '<missing>'}.`);
      }
      const declaredLength = response.headers.get('content-length');
      const verifyDeclaredLength =
        !response.headers.get('content-encoding') ||
        response.headers.get('content-encoding')?.toLocaleLowerCase('en-US') === 'identity';
      if (
        declaredLength &&
        (!/^\d+$/.test(declaredLength) ||
          Number(declaredLength) <= 0 ||
          Number(declaredLength) > MAX_PDF_BYTES)
      ) {
        throw new Error(`PDF has an invalid or oversized Content-Length: ${declaredLength}.`);
      }
      if (!response.body) throw new Error('Official PDF has no body.');

      const file = await open(pdfPath, 'wx', 0o600);
      const hash = createHash('sha256');
      let bytes = 0;
      let prefix = Buffer.alloc(0);
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          const buffer = Buffer.from(chunk);
          bytes += buffer.byteLength;
          if (bytes > MAX_PDF_BYTES) throw new Error('PDF exceeds the download safety limit.');
          if (prefix.byteLength < 5) prefix = Buffer.concat([prefix, buffer]).subarray(0, 5);
          hash.update(buffer);
          let offset = 0;
          while (offset < buffer.byteLength) {
            const { bytesWritten } = await file.write(buffer, offset, buffer.byteLength - offset);
            if (bytesWritten <= 0) throw new Error('Could not persist the streamed PDF chunk.');
            offset += bytesWritten;
          }
        }
      } finally {
        await file.close();
      }
      if (prefix.toString('ascii') !== '%PDF-') throw new Error('Response is not a PDF file.');
      if (verifyDeclaredLength && declaredLength && Number(declaredLength) !== bytes) {
        throw new Error(
          `PDF Content-Length mismatch: declared ${declaredLength}, received ${bytes}.`,
        );
      }

      await assertPopplerAvailable();
      await runCommand('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, textPath]);
      const textStats = await stat(textPath);
      if (!textStats.isFile() || textStats.size <= 0 || textStats.size > MAX_PDF_TEXT_BYTES) {
        throw new Error('Poppler output has an invalid or unsafe size.');
      }
      const pages = splitPdfText(await readFile(textPath, 'utf8'));
      const pageMap = locateBookletSectionPages(pages, session);
      const sectionIds = expectedSectionIds.filter((id) => Boolean(pageMap[id]?.length));
      if (
        sectionIds.length !== expectedSectionIds.length ||
        sectionIds.some((id, index) => id !== expectedSectionIds[index])
      ) {
        throw new Error(`${session.toUpperCase()} official section headers are incomplete.`);
      }
      return { pdfUrl: final.href, bytes, sha256: hash.digest('hex'), sectionIds };
    } finally {
      await cancelBody(response);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

function exactExamDate(
  calendar: ReturnType<typeof calendarSchema.parse>,
  year: number,
  session: Session,
) {
  const matching = calendar.events.filter((event) => event.id === `yks-${year}-${session}`);
  const event = exactSingle(matching, `${year}-YKS ${session.toUpperCase()} calendar event`);
  if (event.type !== 'sinav' || event.end !== null) {
    throw new Error(`${year}-YKS ${session.toUpperCase()} calendar event is structurally invalid.`);
  }
  return event.start;
}

function assertPreviousRegistryPreserved(
  previous: OsymBookletRegistry,
  proposed: OsymBookletRegistry,
): void {
  if (
    JSON.stringify(proposed.booklets.slice(0, previous.booklets.length)) !==
    JSON.stringify(previous.booklets)
  ) {
    throw new Error('Candidate changed an existing official booklet record.');
  }
  for (const session of ['tyt', 'ayt'] as const) {
    if (
      JSON.stringify(proposed.questionBlockProfiles[session].questionBlocks) !==
      JSON.stringify(previous.questionBlockProfiles[session].questionBlocks)
    ) {
      throw new Error(`Candidate changed exact ${session.toUpperCase()} question blocks.`);
    }
  }
}

export async function discoverOsymBookletCandidate(options: {
  registry: OsymBookletRegistry;
  targetYear: number;
  fetchImpl?: FetchLike;
  inspectPdf?: InspectOfficialPdf;
  now?: Date;
}): Promise<OsymBookletDiscoveryCandidate> {
  const registry = osymBookletRegistrySchema.parse(options.registry);
  const expectedYear = registry.coverage.lastYear + 1;
  if (options.targetYear !== expectedYear) {
    throw new Error(
      `Discovery is fail-closed and only accepts the next contiguous year ${expectedYear}; received ${options.targetYear}.`,
    );
  }
  if (options.targetYear > BOOKLET_MAX_YEAR) {
    throw new Error(`Discovery year cannot exceed ${BOOKLET_MAX_YEAR}.`);
  }
  const now = options.now ?? new Date();
  if (Number.isNaN(now.valueOf())) throw new Error('Discovery requires a valid verification time.');
  const generatedAt = now.toISOString();
  const verifiedAt = generatedAt.slice(0, 10);
  const fetchImpl = options.fetchImpl ?? fetch;
  const inspectPdf = options.inspectPdf ?? inspectOfficialPdfWithPoppler;

  const listSource = await fetchOfficialHtml(OFFICIAL_YKS_LIST_URL, fetchImpl);
  if (listSource.finalUrl !== OFFICIAL_YKS_LIST_URL) {
    throw new Error('Canonical ÖSYM YKS list URL redirected; refusing source drift.');
  }
  const announcementUrl = discoverAnnouncementUrl(listSource.html, options.targetYear);
  const announcementSource = await fetchOfficialHtml(announcementUrl, fetchImpl);
  if (announcementSource.finalUrl !== announcementUrl) {
    throw new Error('ÖSYM announcement URL redirected; refusing source drift.');
  }
  const detailUrl = discoverDetailUrl(announcementSource.html, announcementUrl, options.targetYear);
  const detailSource = await fetchOfficialHtml(detailUrl, fetchImpl);
  if (detailSource.finalUrl !== detailUrl) {
    throw new Error('ÖSYM detail URL redirected; refusing source drift.');
  }
  const pdfUrls = discoverSessionPdfUrls(detailSource.html, detailUrl, options.targetYear);

  const calendarSource = await fetchOfficialHtml(OFFICIAL_CALENDAR_URL, fetchImpl);
  if (calendarSource.finalUrl !== OFFICIAL_CALENDAR_URL) {
    throw new Error('Canonical ÖSYM calendar URL redirected; refusing source drift.');
  }
  const calendar = calendarSchema.parse(
    parseOfficialCalendarHtml(calendarSource.html, calendarSource.finalUrl, generatedAt),
  );
  const calendarYearIds = new Set(
    calendar.events.flatMap((event) => {
      const match = /^yks-(\d{4})-/.exec(event.id);
      return match?.[1] ? [Number(match[1])] : [];
    }),
  );
  if (calendarYearIds.size !== 1 || !calendarYearIds.has(options.targetYear)) {
    throw new Error(`Official calendar does not contain exactly ${options.targetYear}-YKS.`);
  }

  const inspected = await Promise.all(
    (['tyt', 'ayt'] as const).map(async (session) => {
      const expectedSectionIds = registry.sessionStructures[session].sections.map(({ id }) => id);
      const result = await inspectPdf({
        pdfUrl: pdfUrls[session],
        year: options.targetYear,
        session,
        expectedSectionIds,
        fetchImpl,
      });
      const observedUrl = assertAllowedOfficialPdfUrl(result.pdfUrl);
      if (!expectedPdfPath(observedUrl, options.targetYear, session)) {
        throw new Error(`Inspected PDF URL does not match ${options.targetYear}-${session}.`);
      }
      if (
        result.sectionIds.length !== expectedSectionIds.length ||
        result.sectionIds.some((id, index) => id !== expectedSectionIds[index])
      ) {
        throw new Error(
          `${session.toUpperCase()} structural verification drift: expected ${expectedSectionIds.join(', ')}.`,
        );
      }
      return { session, result };
    }),
  );

  const newBooklets: OsymBooklet[] = inspected.map(({ session, result }) => ({
    year: options.targetYear,
    session,
    examDate: exactExamDate(calendar, options.targetYear, session),
    releasePageUrl: detailUrl,
    pdfUrl: result.pdfUrl,
    verifiedAt,
    bytes: result.bytes,
    sha256: result.sha256,
  }));
  const proposed = osymBookletRegistrySchema.parse({
    ...structuredClone(registry),
    coverage: { ...registry.coverage, lastYear: options.targetYear },
    questionBlockProfiles: Object.fromEntries(
      (['tyt', 'ayt'] as const).map((session) => [
        session,
        {
          ...structuredClone(registry.questionBlockProfiles[session]),
          verifiedAt,
          verifiedBookletIds: [
            ...registry.questionBlockProfiles[session].verifiedBookletIds,
            `${options.targetYear}-${session}`,
          ],
        },
      ]),
    ),
    booklets: [...structuredClone(registry.booklets), ...newBooklets],
  });
  assertPreviousRegistryPreserved(registry, proposed);

  return candidateSchema.parse({
    schemaVersion: BOOKLET_DISCOVERY_SCHEMA_VERSION,
    kind: 'osym-booklet-registry-candidate',
    generatedAt,
    targetYear: options.targetYear,
    sources: {
      listUrl: listSource.finalUrl,
      announcementUrl,
      detailUrl,
      calendarUrl: calendarSource.finalUrl,
    },
    structuralVerification: inspected.map(({ session, result }) => ({
      bookletId: `${options.targetYear}-${session}`,
      method: 'poppler-official-section-headers',
      sectionIds: result.sectionIds,
    })),
    registry: proposed,
    publication: { automatic: false, reason: 'human-review-required' },
  });
}

export function parseOsymBookletDiscoveryCandidate(value: unknown): OsymBookletDiscoveryCandidate {
  return candidateSchema.parse(value);
}
