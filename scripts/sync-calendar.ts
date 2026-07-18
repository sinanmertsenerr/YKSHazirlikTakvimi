import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { calendarSchema, CURRENT_SCHEMA_VERSION } from './lib/content-schemas.ts';
import { htmlToText } from './lib/html-text.ts';
import {
  preserveStableRecordVerificationTimes,
  readTextFileIfExists,
  writeTextFileAtomicallyIfChanged,
} from './lib/semantic-stability.ts';
import { discoverOfficialPreferenceEvent } from './lib/osym-preference-calendar.ts';

export const OFFICIAL_CALENDAR_URL = 'https://www.osym.gov.tr/TR,8797/takvim.html?category_id=1';

const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 12_000;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type SessionName = 'TYT' | 'AYT' | 'YDT';

type DateTimeParts = {
  date: string;
  time: string | null;
};

type OfficialSession = {
  year: number;
  session: SessionName;
  sessionNumber: 1 | 2 | 3;
  exam: DateTimeParts;
  applicationStart: DateTimeParts;
  applicationEnd: DateTimeParts;
  lateApplicationStart: DateTimeParts;
  lateApplicationEnd: DateTimeParts;
  result: DateTimeParts;
};

type CalendarEvent = {
  id: string;
  start: string;
  end: string | null;
  startTime: string | null;
  endTime: string | null;
  type: 'basvuru' | 'sinav' | 'sonuc' | 'tercih';
  title: { tr: string; en: string };
  verified: true;
  verifiedAt: string;
  approximate: false;
  sample: false;
  source: string;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type SyncCalendarOptions = {
  outputPath?: string;
  dryRun?: boolean;
  now?: Date;
  fetchImpl?: FetchLike;
};

type CalendarDocument = ReturnType<typeof calendarSchema.parse>;

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase('en-US');
  return host === 'osym.gov.tr' || host.endsWith('.osym.gov.tr');
}

function assertAllowedOfficialUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !isAllowedHost(url.hostname) || url.username || url.password) {
    throw new Error(`Refusing non-official calendar URL: ${rawUrl}`);
  }
  return url;
}

const HTML_LINE_BREAK_TAGS = new Set(['br']);

function htmlLines(html: string): string[] {
  return htmlToText(html, { lineBreakTags: HTML_LINE_BREAK_TAGS })
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function isValidIsoDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function parseOfficialDateTime(value: string, context: string): DateTimeParts {
  const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(20\d{2})(?:\s+(\d{2}:\d{2}))?$/);
  if (!match) throw new Error(`Invalid ${context}: ${value}`);

  const [, day, month, year, time] = match;
  if (!day || !month || !year) throw new Error(`Incomplete ${context}: ${value}`);
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (!isValidIsoDate(date) || (time && !TIME_PATTERN.test(time))) {
    throw new Error(`Invalid ${context}: ${value}`);
  }
  return { date, time: time ?? null };
}

function readLabelledValues(lines: string[], label: string, count: number): DateTimeParts[] {
  if (lines[0] !== label || lines.length !== count + 1) {
    throw new Error(
      `Expected ${count} value(s) after “${label}”, received: ${lines.join(' | ') || '<empty>'}`,
    );
  }
  return lines
    .slice(1)
    .map((value, index) => parseOfficialDateTime(value, `${label} value ${index + 1}`));
}

function extractColumns(rowHtml: string): string[][] {
  const columns: string[][] = [];
  const pattern =
    /<div\b[^>]*\bclass\s*=\s*(['"])[^'"]*\bcol-sm-(?:2|3)\b[^'"]*\1[^>]*>([\s\S]*?)<\/div>/gi;
  for (const match of rowHtml.matchAll(pattern)) columns.push(htmlLines(match[2] ?? ''));
  return columns;
}

function extractCalendarRows(html: string): string[] {
  const markers = [
    ...html.matchAll(/<div\b[^>]*\bclass\s*=\s*(['"])[^'"]*\brow\b[^'"]*\1[^>]*>/gi),
  ];
  return markers.map((marker, index) => {
    const start = marker.index ?? 0;
    const next = markers[index + 1];
    return html.slice(start, next?.index ?? html.length);
  });
}

function parseSession(rowHtml: string): OfficialSession | null {
  const columns = extractColumns(rowHtml);
  const identity = columns[0] ?? [];
  const sessionLine = identity.find((line) => /-YKS\s+[123]\.\s+Oturum\s+\(/u.test(line));
  if (!sessionLine) return null;

  const identityMatch = sessionLine.match(
    /^(20\d{2})-YKS\s+([123])\.\s+Oturum\s+\((TYT|AYT|YDT)\)$/u,
  );
  if (!identityMatch) throw new Error(`Unrecognized YKS session identity: ${sessionLine}`);
  if (columns.length !== 5) {
    throw new Error(`Expected five columns for ${sessionLine}, received ${columns.length}`);
  }

  const year = Number(identityMatch[1]);
  const sessionNumber = Number(identityMatch[2]) as 1 | 2 | 3;
  const session = identityMatch[3] as SessionName;
  const expectedSessions: Record<SessionName, 1 | 2 | 3> = { TYT: 1, AYT: 2, YDT: 3 };
  if (expectedSessions[session] !== sessionNumber) {
    throw new Error(`Session number/name mismatch: ${sessionLine}`);
  }

  const [exam] = readLabelledValues(columns[1] ?? [], 'Sınav Tarihi:', 1);
  const [applicationStart, applicationEnd] = readLabelledValues(
    columns[2] ?? [],
    'Başvuru Tarihleri:',
    2,
  );
  const [lateApplicationStart, lateApplicationEnd] = readLabelledValues(
    columns[3] ?? [],
    'Geç Başvuru Günü:',
    2,
  );
  const [result] = readLabelledValues(columns[4] ?? [], 'Sonuç Tarihi:', 1);

  if (
    !exam ||
    !applicationStart ||
    !applicationEnd ||
    !lateApplicationStart ||
    !lateApplicationEnd ||
    !result
  ) {
    throw new Error(`Incomplete official fields for ${sessionLine}`);
  }

  return {
    year,
    session,
    sessionNumber,
    exam,
    applicationStart,
    applicationEnd,
    lateApplicationStart,
    lateApplicationEnd,
    result,
  };
}

function sameDateTime(left: DateTimeParts, right: DateTimeParts): boolean {
  return left.date === right.date && left.time === right.time;
}

function assertSharedField(
  sessions: OfficialSession[],
  field:
    | 'applicationStart'
    | 'applicationEnd'
    | 'lateApplicationStart'
    | 'lateApplicationEnd'
    | 'result',
): DateTimeParts {
  const first = sessions[0]?.[field];
  if (!first || sessions.some((session) => !sameDateTime(session[field], first))) {
    throw new Error(`ÖSYM YKS rows disagree on ${field}; refusing partial calendar update.`);
  }
  return first;
}

function event(
  input: Omit<CalendarEvent, 'verified' | 'verifiedAt' | 'approximate' | 'sample' | 'source'>,
  verifiedAt: string,
  source: string,
): CalendarEvent {
  return {
    ...input,
    verified: true,
    verifiedAt,
    approximate: false,
    sample: false,
    source,
  };
}

export function parseOfficialCalendarHtml(
  html: string,
  sourceUrl = OFFICIAL_CALENDAR_URL,
  verifiedAt = new Date().toISOString(),
): unknown {
  assertAllowedOfficialUrl(sourceUrl);
  if (!verifiedAt || Number.isNaN(new Date(verifiedAt).valueOf())) {
    throw new Error(`Invalid verification time: ${verifiedAt}`);
  }

  const sessions = extractCalendarRows(html)
    .map(parseSession)
    .filter((session): session is OfficialSession => session !== null);
  const byName = new Map(sessions.map((session) => [session.session, session]));
  if (sessions.length !== 3 || byName.size !== 3) {
    throw new Error(
      `Expected exactly TYT, AYT and YDT rows from ÖSYM; received ${sessions.length} YKS row(s).`,
    );
  }

  const orderedSessions = (['TYT', 'AYT', 'YDT'] as const).map((name) => {
    const session = byName.get(name);
    if (!session) throw new Error(`Missing official ${name} row.`);
    return session;
  });
  const years = new Set(orderedSessions.map((session) => session.year));
  if (years.size !== 1) throw new Error('ÖSYM YKS rows contain multiple exam years.');
  const year = orderedSessions[0]!.year;

  const applicationStart = assertSharedField(orderedSessions, 'applicationStart');
  const applicationEnd = assertSharedField(orderedSessions, 'applicationEnd');
  const lateApplicationStart = assertSharedField(orderedSessions, 'lateApplicationStart');
  const lateApplicationEnd = assertSharedField(orderedSessions, 'lateApplicationEnd');
  const result = assertSharedField(orderedSessions, 'result');

  const events: CalendarEvent[] = [
    event(
      {
        id: `yks-${year}-basvuru`,
        start: applicationStart.date,
        end: applicationEnd.date,
        startTime: applicationStart.time,
        endTime: applicationEnd.time,
        type: 'basvuru',
        title: { tr: `${year}-YKS başvuruları`, en: `${year} YKS applications` },
      },
      verifiedAt,
      sourceUrl,
    ),
    event(
      {
        id: `yks-${year}-gec-basvuru`,
        start: lateApplicationStart.date,
        end: lateApplicationEnd.date,
        startTime: lateApplicationStart.time,
        endTime: lateApplicationEnd.time,
        type: 'basvuru',
        title: { tr: `${year}-YKS geç başvuruları`, en: `${year} YKS late applications` },
      },
      verifiedAt,
      sourceUrl,
    ),
    ...orderedSessions.map((session) =>
      event(
        {
          id: `yks-${year}-${session.session.toLocaleLowerCase('en-US')}`,
          start: session.exam.date,
          end: null,
          startTime: session.exam.time,
          endTime: null,
          type: 'sinav',
          title: {
            tr: `${year}-YKS ${session.session}`,
            en: `${year} YKS ${session.session}`,
          },
        },
        verifiedAt,
        sourceUrl,
      ),
    ),
    event(
      {
        id: `yks-${year}-sonuc`,
        start: result.date,
        end: null,
        startTime: result.time,
        endTime: null,
        type: 'sonuc',
        title: { tr: `${year}-YKS sonuçları`, en: `${year} YKS results` },
      },
      verifiedAt,
      sourceUrl,
    ),
  ].sort((left, right) => {
    const leftKey = `${left.start}T${left.startTime ?? '00:00'}`;
    const rightKey = `${right.start}T${right.startTime ?? '00:00'}`;
    return leftKey.localeCompare(rightKey) || left.id.localeCompare(right.id);
  });

  const document = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    dataStatus: {
      verified: true,
      approximate: false,
      sample: false,
      source: sourceUrl,
      note: {
        tr: 'Tarihler ÖSYM sınav takviminden otomatik doğrulanmıştır. ÖSYM takvimi güncelleyebileceği için son doğrulama zamanı her kayıtta tutulur.',
        en: 'Dates are automatically verified against the ÖSYM exam calendar. Each record stores its last verification time because ÖSYM may revise the calendar.',
      },
    },
    events,
  };

  const parsed = calendarSchema.safeParse(document);
  if (!parsed.success) {
    throw new Error(`Normalized calendar failed schema validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function stabilizeCalendarDocument(
  candidateDocument: unknown,
  previousDocument: unknown,
): CalendarDocument {
  const candidate = calendarSchema.parse(candidateDocument);
  const previous = calendarSchema.safeParse(previousDocument);
  if (!previous.success) return candidate;
  return calendarSchema.parse({
    ...candidate,
    events: preserveStableRecordVerificationTimes(
      candidate.events,
      previous.data.events,
      (calendarEvent) => calendarEvent.id,
    ),
  });
}

async function readLimitedHtml(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(`ÖSYM response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  if (!response.body) throw new Error('ÖSYM response has no body.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`ÖSYM response exceeds ${MAX_RESPONSE_BYTES} bytes`);
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

async function fetchOfficialCalendarHtml(
  fetchImpl: FetchLike = fetch,
): Promise<{ html: string; sourceUrl: string }> {
  let url = assertAllowedOfficialUrl(OFFICIAL_CALENDAR_URL);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'cache-control': 'no-cache',
        'user-agent': 'YKS-Hazirlik-Static-Calendar-Builder/1.0 (+offline content pack)',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error('ÖSYM calendar returned an invalid or excessive redirect.');
      }
      url = assertAllowedOfficialUrl(new URL(location, url).href);
      continue;
    }

    if (!response.ok) throw new Error(`ÖSYM calendar returned HTTP ${response.status}`);
    assertAllowedOfficialUrl(response.url || url.href);
    const contentType = response.headers.get('content-type')?.toLocaleLowerCase('en-US') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error(
        `ÖSYM calendar returned unsupported content type ${contentType || '<missing>'}`,
      );
    }
    return { html: await readLimitedHtml(response), sourceUrl: url.href };
  }

  throw new Error('ÖSYM calendar redirect limit exceeded.');
}

export async function syncCalendar(
  options: SyncCalendarOptions = {},
): Promise<{ outputPath: string; count: number; examYear: number; changed: boolean }> {
  const outputPath = resolve(options.outputPath ?? resolve(process.cwd(), 'content/calendar.json'));
  const { html, sourceUrl } = await fetchOfficialCalendarHtml(options.fetchImpl);
  const verifiedAt = (options.now ?? new Date()).toISOString();
  const baseDocument = calendarSchema.parse(parseOfficialCalendarHtml(html, sourceUrl, verifiedAt));
  const examYear = Number(baseDocument.events[0]?.id.match(/^yks-(\d{4})-/)?.[1]);
  if (!Number.isInteger(examYear)) throw new Error('Could not determine normalized exam year.');
  const preferenceEvent = await discoverOfficialPreferenceEvent({
    targetYear: examYear,
    verifiedAt,
    fetchImpl: options.fetchImpl,
  });
  const candidateDocument = calendarSchema.parse({
    ...baseDocument,
    events: [...baseDocument.events, ...(preferenceEvent ? [preferenceEvent] : [])].sort(
      (left, right) => {
        const leftKey = `${left.start}T${left.startTime ?? '00:00'}`;
        const rightKey = `${right.start}T${right.startTime ?? '00:00'}`;
        return leftKey.localeCompare(rightKey) || left.id.localeCompare(right.id);
      },
    ),
  });
  const previousRaw = await readTextFileIfExists(outputPath);
  let previousDocument: unknown;
  try {
    previousDocument = previousRaw === null ? undefined : (JSON.parse(previousRaw) as unknown);
  } catch {
    previousDocument = undefined;
  }
  const document = stabilizeCalendarDocument(candidateDocument, previousDocument);
  const serialized =
    previousRaw !== null && isDeepStrictEqual(document, previousDocument)
      ? previousRaw
      : `${JSON.stringify(document, null, 2)}\n`;
  const changed = previousRaw !== serialized;

  if (!options.dryRun) {
    await writeTextFileAtomicallyIfChanged(outputPath, serialized);
  }

  return { outputPath, count: document.events.length, examYear, changed };
}

function parseOptions(args: string[]): SyncCalendarOptions {
  const options: SyncCalendarOptions = {};
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
  let options: SyncCalendarOptions;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    options = { dryRun: true };
  }

  if (process.exitCode !== 1) {
    syncCalendar(options)
      .then(({ outputPath, count, examYear, changed }) => {
        console.log(
          `${options.dryRun ? 'Validated' : changed ? 'Wrote' : 'Kept'} ${count} official ${examYear}-YKS calendar event(s)${options.dryRun ? ' (dry run)' : ` at ${outputPath}`}.`,
        );
      })
      .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
