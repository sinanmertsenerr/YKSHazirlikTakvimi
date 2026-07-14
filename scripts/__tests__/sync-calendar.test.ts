import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { calendarSchema } from '../lib/content-schemas.ts';
import { OSYM_YKS_ANNOUNCEMENTS_URL, OSYM_YKS_LIST_URL } from '../lib/osym-preference-calendar.ts';
import {
  OFFICIAL_CALENDAR_URL,
  parseOfficialCalendarHtml,
  stabilizeCalendarDocument,
  syncCalendar,
} from '../sync-calendar.ts';

const VERIFIED_AT = '2026-07-14T19:45:00.000Z';
const FRESH_VERIFIED_AT = '2026-07-15T19:45:00.000Z';
const PREFERENCE_YEAR_LIST_URL = 'https://www.osym.gov.tr/TR,33849/2026.html';

function officialRow(
  number: 1 | 2 | 3,
  session: 'TYT' | 'AYT' | 'YDT',
  exam: string,
  result = '22.07.2026',
): string {
  return `
    <div class='row'>
      <div class='col-sm-3'>
        <strong><a href='/TR,13493/yks.html'>YKS</a></strong>
        <br />Yükseköğretim Kurumları Sınavı
        <br />2026-YKS ${number}. Oturum (${session})
      </div>
      <div class='col-sm-2'>Sınav Tarihi:<br>${exam}</div>
      <div class='col-sm-2'>Başvuru Tarihleri:<br>06.02.2026 14:30<br />02.03.2026 23:59</div>
      <div class='col-sm-2'>Geç Başvuru Günü:<br>10.03.2026<br />12.03.2026 23:59</div>
      <div class='col-sm-2'>Sonuç Tarihi:<br>${result}</div>
      <div style='display:none;'><br /></div>
    </div>`;
}

const OFFICIAL_FIXTURE = `
  <html><body>
    <div class='row'><div class='col-sm-3'>Başka sınav</div></div>
    ${officialRow(1, 'TYT', '20.06.2026 10:15')}
    ${officialRow(2, 'AYT', '21.06.2026 10:15')}
    ${officialRow(3, 'YDT', '21.06.2026 15:45')}
  </body></html>`;

async function createCalendarFetch(
  preferenceFixtureName = 'osym-preference-list-2026-unannounced.html',
): Promise<typeof fetch> {
  const preferenceList = await readFile(
    new URL(`./fixtures/${preferenceFixtureName}`, import.meta.url),
    'utf8',
  );
  return (async (input: string | URL | Request) => {
    const url = input.toString();
    if (url === OFFICIAL_CALENDAR_URL) {
      return new Response(OFFICIAL_FIXTURE, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    if (url === OSYM_YKS_LIST_URL) {
      return new Response(null, {
        status: 302,
        headers: { location: OSYM_YKS_ANNOUNCEMENTS_URL },
      });
    }
    if (url === OSYM_YKS_ANNOUNCEMENTS_URL) {
      return new Response(null, {
        status: 302,
        headers: { location: PREFERENCE_YEAR_LIST_URL },
      });
    }
    if (url === PREFERENCE_YEAR_LIST_URL) {
      return new Response(preferenceList, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    throw new Error(`Unexpected fixture URL: ${url}`);
  }) as typeof fetch;
}

test('normalizes only the exact official YKS rows with source and verification time', () => {
  const document = parseOfficialCalendarHtml(OFFICIAL_FIXTURE, OFFICIAL_CALENDAR_URL, VERIFIED_AT);
  const parsed = calendarSchema.parse(document);

  assert.equal(parsed.dataStatus.verified, true);
  assert.equal(parsed.dataStatus.source, OFFICIAL_CALENDAR_URL);
  assert.equal(parsed.events.length, 6);
  assert.deepEqual(
    parsed.events.map(({ id, start, end, startTime, endTime, type }) => ({
      id,
      start,
      end,
      startTime,
      endTime,
      type,
    })),
    [
      {
        id: 'yks-2026-basvuru',
        start: '2026-02-06',
        end: '2026-03-02',
        startTime: '14:30',
        endTime: '23:59',
        type: 'basvuru',
      },
      {
        id: 'yks-2026-gec-basvuru',
        start: '2026-03-10',
        end: '2026-03-12',
        startTime: null,
        endTime: '23:59',
        type: 'basvuru',
      },
      {
        id: 'yks-2026-tyt',
        start: '2026-06-20',
        end: null,
        startTime: '10:15',
        endTime: null,
        type: 'sinav',
      },
      {
        id: 'yks-2026-ayt',
        start: '2026-06-21',
        end: null,
        startTime: '10:15',
        endTime: null,
        type: 'sinav',
      },
      {
        id: 'yks-2026-ydt',
        start: '2026-06-21',
        end: null,
        startTime: '15:45',
        endTime: null,
        type: 'sinav',
      },
      {
        id: 'yks-2026-sonuc',
        start: '2026-07-22',
        end: null,
        startTime: null,
        endTime: null,
        type: 'sonuc',
      },
    ],
  );
  assert.ok(
    parsed.events.every(
      (event) =>
        event.verified &&
        event.verifiedAt === VERIFIED_AT &&
        event.source === OFFICIAL_CALENDAR_URL &&
        !event.approximate &&
        !event.sample,
    ),
  );
});

test('fails closed when an official session row is missing', () => {
  const missingYdt = OFFICIAL_FIXTURE.replace(officialRow(3, 'YDT', '21.06.2026 15:45'), '');
  assert.throws(
    () => parseOfficialCalendarHtml(missingYdt, OFFICIAL_CALENDAR_URL, VERIFIED_AT),
    /exactly TYT, AYT and YDT/u,
  );
});

test('fails closed when shared dates disagree between ÖSYM session rows', () => {
  const disagreement = OFFICIAL_FIXTURE.replace(
    officialRow(3, 'YDT', '21.06.2026 15:45'),
    officialRow(3, 'YDT', '21.06.2026 15:45', '23.07.2026'),
  );
  assert.throws(
    () => parseOfficialCalendarHtml(disagreement, OFFICIAL_CALENDAR_URL, VERIFIED_AT),
    /disagree on result/u,
  );
});

test('verified calendar records require verifiedAt', () => {
  const document = parseOfficialCalendarHtml(
    OFFICIAL_FIXTURE,
    OFFICIAL_CALENDAR_URL,
    VERIFIED_AT,
  ) as { events: Array<{ verifiedAt: string | null }> };
  document.events[0]!.verifiedAt = null;
  const result = calendarSchema.safeParse(document);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(
      result.error.issues.some(
        (issue) =>
          issue.path.at(-1) === 'verifiedAt' && issue.message.includes('verification timestamp'),
      ),
    );
  }
});

test('rejects non-ÖSYM source URLs', () => {
  assert.throws(
    () => parseOfficialCalendarHtml(OFFICIAL_FIXTURE, 'https://example.com/calendar', VERIFIED_AT),
    /non-official calendar URL/u,
  );
});

test('keeps all official calendar events and emits zero preference events before announcement', async () => {
  const result = await syncCalendar({
    dryRun: true,
    fetchImpl: await createCalendarFetch(),
    now: new Date(VERIFIED_AT),
  });

  assert.equal(result.examYear, 2026);
  assert.equal(result.count, 6);
});

test('an invalid preference source leaves the last-good calendar untouched', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yks-calendar-last-good-'));
  const outputPath = join(directory, 'calendar.json');
  const lastGood = '{"lastGood":true}\n';
  await writeFile(outputPath, lastGood, 'utf8');

  try {
    await assert.rejects(
      syncCalendar({
        outputPath,
        fetchImpl: await createCalendarFetch('osym-preference-list-wrong-year.html'),
        now: new Date(VERIFIED_AT),
      }),
      /2024 preference announcement while 2026 was required/u,
    );
    assert.equal(await readFile(outputPath, 'utf8'), lastGood);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('two calendar syncs with different now values preserve exact bytes and do not rewrite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yks-calendar-stability-'));
  const outputPath = join(directory, 'calendar.json');
  const fetchImpl = await createCalendarFetch();

  try {
    const first = await syncCalendar({
      outputPath,
      fetchImpl,
      now: new Date(VERIFIED_AT),
    });
    const firstBytes = await readFile(outputPath, 'utf8');
    const firstStat = await stat(outputPath);
    const second = await syncCalendar({
      outputPath,
      fetchImpl,
      now: new Date(FRESH_VERIFIED_AT),
    });
    const secondStat = await stat(outputPath);

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(await readFile(outputPath, 'utf8'), firstBytes);
    assert.equal(secondStat.ino, firstStat.ino);
    assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
    assert.ok(
      calendarSchema
        .parse(JSON.parse(firstBytes) as unknown)
        .events.every((event) => event.verifiedAt === VERIFIED_AT),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('calendar changes and additions receive fresh verification while stable events retain theirs', () => {
  const previous = calendarSchema.parse(
    parseOfficialCalendarHtml(OFFICIAL_FIXTURE, OFFICIAL_CALENDAR_URL, VERIFIED_AT),
  );
  const changedCandidate = parseOfficialCalendarHtml(
    OFFICIAL_FIXTURE.replaceAll('22.07.2026', '23.07.2026'),
    OFFICIAL_CALENDAR_URL,
    FRESH_VERIFIED_AT,
  );
  const changed = stabilizeCalendarDocument(changedCandidate, previous);

  assert.equal(
    changed.events.find((event) => event.id === 'yks-2026-sonuc')?.verifiedAt,
    FRESH_VERIFIED_AT,
  );
  assert.ok(
    changed.events
      .filter((event) => event.id !== 'yks-2026-sonuc')
      .every((event) => event.verifiedAt === VERIFIED_AT),
  );

  const freshCandidate = calendarSchema.parse(
    parseOfficialCalendarHtml(OFFICIAL_FIXTURE, OFFICIAL_CALENDAR_URL, FRESH_VERIFIED_AT),
  );
  const template = freshCandidate.events.at(-1)!;
  const withNewEvent = calendarSchema.parse({
    ...freshCandidate,
    events: [
      ...freshCandidate.events,
      {
        ...template,
        id: 'yks-2026-ek-sonuc',
        start: '2026-08-01',
        title: { tr: '2026-YKS ek sonuçları', en: '2026 YKS additional results' },
      },
    ],
  });
  const stabilizedAddition = stabilizeCalendarDocument(withNewEvent, previous);
  assert.equal(
    stabilizedAddition.events.find((event) => event.id === 'yks-2026-ek-sonuc')?.verifiedAt,
    FRESH_VERIFIED_AT,
  );
  assert.ok(
    stabilizedAddition.events
      .filter((event) => event.id !== 'yks-2026-ek-sonuc')
      .every((event) => event.verifiedAt === VERIFIED_AT),
  );
});
