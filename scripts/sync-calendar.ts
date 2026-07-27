import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { calendarSchema, CURRENT_SCHEMA_VERSION } from './lib/content-schemas.ts';
import {
  assertDeclaredContentLength,
  cancelBody,
  reportUpstreamOutageAndSucceed,
  withTransientRetries,
} from './lib/fetch-safety.ts';
import { htmlToText } from './lib/html-text.ts';
import {
  preserveStableRecordVerificationTimes,
  readTextFileIfExists,
  writeTextFileAtomicallyIfChanged,
} from './lib/semantic-stability.ts';
import { discoverOfficialPreferenceEvent } from './lib/osym-preference-calendar.ts';

export const OFFICIAL_CALENDAR_URL = 'https://www.osym.gov.tr/Sayfa/SinavTakvimi';

const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
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
  return htmlToText(html, { lineBreakTags: HTML_LINE_BREAK_TAGS }).split('\n');
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

/**
 * ÖSYM'nin yenilenen takvim sayfası (2026-07) her tarih türünü ayrı bir
 * `div.takvimSinavKolon.<tür>` hücresinde verir; hücre `data-sinavad` ile sınavı,
 * `<h6>` ile oturum kimliğini, `<p class="ltr">` içinde `<br>` ile ayrılmış
 * tarihleri taşır. Sayfa artık tüm ÖSYM sınavlarını tek listede topladığı için
 * YKS filtresi hem attribute hem başlık üzerinden iki kez doğrulanır.
 */
const CELL_KINDS = {
  sinavtarihi: 'exam',
  basvurutarihi: 'application',
  gecbasvurutarihi: 'lateApplication',
  sonuctarihi: 'result',
} as const;

type CellKind = (typeof CELL_KINDS)[keyof typeof CELL_KINDS];

/** Her hücre türünün taşıması gereken tarih adedi; sapma fail-closed hatadır (§9.1). */
const CELL_VALUE_COUNTS: Record<CellKind, number> = {
  exam: 1,
  application: 2,
  lateApplication: 2,
  result: 1,
};

type CalendarCell = {
  kind: CellKind;
  year: number;
  session: SessionName;
  sessionNumber: 1 | 2 | 3;
  values: DateTimeParts[];
};

function parseSessionIdentity(
  heading: string,
): { year: number; session: SessionName; sessionNumber: 1 | 2 | 3 } | null {
  const match = heading.match(/^(20\d{2})-YKS\s+([123])\.\s+Oturum\s+\((TYT|AYT|YDT)\)$/u);
  if (!match?.[1] || !match[2] || !match[3]) return null;

  const session = match[3] as SessionName;
  const sessionNumber = Number(match[2]) as 1 | 2 | 3;
  const expectedSessions: Record<SessionName, 1 | 2 | 3> = { TYT: 1, AYT: 2, YDT: 3 };
  if (expectedSessions[session] !== sessionNumber) {
    throw new Error(`Session number/name mismatch: ${heading}`);
  }
  return { year: Number(match[1]), session, sessionNumber };
}

function extractYksCells(html: string): CalendarCell[] {
  const cellPattern =
    /<div\b[^>]*\bclass\s*=\s*(['"])takvimSinavKolon\s+([a-z]+)\1([^>]*)>([\s\S]*?)<\/div>/gi;
  const cells: CalendarCell[] = [];

  for (const match of html.matchAll(cellPattern)) {
    const kind = CELL_KINDS[match[2] as keyof typeof CELL_KINDS];
    if (!kind) continue;
    if (!/\bdata-sinavad\s*=\s*(['"])YKS\1/i.test(match[3] ?? '')) continue;

    const body = match[4] ?? '';
    const headingMatch = body.match(/<h6\b[^>]*>([\s\S]*?)<\/h6>/i);
    if (!headingMatch) continue;
    const identity = parseSessionIdentity(htmlToText(headingMatch[1] ?? '').trim());
    if (!identity) continue;

    const valuesMatch = body.match(
      /<p\b[^>]*\bclass\s*=\s*(['"])[^'"]*\bltr\b[^'"]*\1[^>]*>([\s\S]*?)<\/p>/i,
    );
    if (!valuesMatch) {
      throw new Error(`Official ${identity.session} ${kind} cell has no date values.`);
    }

    const rawValues = htmlLines(valuesMatch[2] ?? '')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const expectedCount = CELL_VALUE_COUNTS[kind];
    if (rawValues.length !== expectedCount) {
      throw new Error(
        `Expected ${expectedCount} value(s) in the ${identity.year} YKS ${identity.session} ${kind} cell, received: ${rawValues.join(' | ') || '<empty>'}`,
      );
    }

    cells.push({
      ...identity,
      kind,
      values: rawValues.map((value, index) =>
        parseOfficialDateTime(value, `${identity.session} ${kind} value ${index + 1}`),
      ),
    });
  }

  return cells;
}

function collectSessions(html: string): OfficialSession[] {
  const grouped = new Map<string, Map<CellKind, DateTimeParts[]>>();
  const identities = new Map<string, { year: number; session: SessionName; sessionNumber: 1 | 2 | 3 }>();

  for (const cell of extractYksCells(html)) {
    const key = `${cell.year}-${cell.session}`;
    identities.set(key, { year: cell.year, session: cell.session, sessionNumber: cell.sessionNumber });
    const byKind = grouped.get(key) ?? new Map<CellKind, DateTimeParts[]>();
    const existing = byKind.get(cell.kind);
    if (existing && !existing.every((value, index) => sameDateTime(value, cell.values[index]!))) {
      throw new Error(`ÖSYM lists conflicting ${cell.kind} values for ${key}.`);
    }
    byKind.set(cell.kind, cell.values);
    grouped.set(key, byKind);
  }

  const sessions: OfficialSession[] = [];
  for (const [key, byKind] of grouped) {
    const identity = identities.get(key)!;
    const exam = byKind.get('exam')?.[0];
    const [applicationStart, applicationEnd] = byKind.get('application') ?? [];
    const [lateApplicationStart, lateApplicationEnd] = byKind.get('lateApplication') ?? [];
    const result = byKind.get('result')?.[0];

    // Eksik hücre bırakan bir oturum sessizce atlanır: tam üçlü kuralı (TYT/AYT/YDT)
    // aşağıda yılı seçerken zaten eksik yılı eler ve kaynak kapalı kalır (§9.1).
    if (
      !exam ||
      !applicationStart ||
      !applicationEnd ||
      !lateApplicationStart ||
      !lateApplicationEnd ||
      !result
    ) {
      continue;
    }

    sessions.push({
      ...identity,
      exam,
      applicationStart,
      applicationEnd,
      lateApplicationStart,
      lateApplicationEnd,
      result,
    });
  }

  return sessions;
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

  const sessions = collectSessions(html);
  // Yıllık geçişte ÖSYM sayfası kısa süre iki yılın (veya eksik yeni yılın) satırlarını birlikte
  // listeleyebilir; insan müdahalesi gerektirmemek için tam ve tekrarsız TYT/AYT/YDT üçlüsü
  // taşıyan en yeni yıl seçilir. Hiçbir yıl tam değilse eskisi gibi kapalı kalınır (§9.1).
  const sessionsByYear = new Map<number, OfficialSession[]>();
  for (const session of sessions) {
    const group = sessionsByYear.get(session.year) ?? [];
    group.push(session);
    sessionsByYear.set(session.year, group);
  }
  const year = [...sessionsByYear.entries()]
    .filter(
      ([, group]) =>
        group.length === 3 && new Set(group.map((session) => session.session)).size === 3,
    )
    .map(([groupYear]) => groupYear)
    .sort((left, right) => right - left)[0];
  if (year === undefined) {
    throw new Error(
      `Expected exactly TYT, AYT and YDT rows from ÖSYM; received ${sessions.length} YKS row(s) without a complete exam year.`,
    );
  }

  const byName = new Map(sessionsByYear.get(year)!.map((session) => [session.session, session]));
  const orderedSessions = (['TYT', 'AYT', 'YDT'] as const).map((name) => {
    const session = byName.get(name);
    if (!session) throw new Error(`Missing official ${name} row.`);
    return session;
  });

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
  await assertDeclaredContentLength(response, MAX_RESPONSE_BYTES, 'ÖSYM response');
  if (!response.body) throw new Error('ÖSYM response has no body.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
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
      await cancelBody(response);
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error('ÖSYM calendar returned an invalid or excessive redirect.');
      }
      url = assertAllowedOfficialUrl(new URL(location, url).href);
      continue;
    }

    if (!response.ok) {
      await cancelBody(response);
      throw new Error(`ÖSYM calendar returned HTTP ${response.status}`);
    }
    assertAllowedOfficialUrl(response.url || url.href);
    const contentType = response.headers.get('content-type')?.toLocaleLowerCase('en-US') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      await cancelBody(response);
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
    withTransientRetries(() => syncCalendar(options))
      .then(({ outputPath, count, examYear, changed }) => {
        console.log(
          `${options.dryRun ? 'Validated' : changed ? 'Wrote' : 'Kept'} ${count} official ${examYear}-YKS calendar event(s)${options.dryRun ? ' (dry run)' : ` at ${outputPath}`}.`,
        );
      })
      .catch((error: unknown) => {
        if (reportUpstreamOutageAndSucceed(error, 'ÖSYM takvimi')) return;
        console.error(error);
        process.exitCode = 1;
      });
  }
}
