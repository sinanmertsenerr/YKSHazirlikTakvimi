import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  discoverOfficialPreferenceEvent,
  OSYM_YKS_ANNOUNCEMENTS_URL,
  OSYM_YKS_LIST_URL,
  parsePreferenceCandidateFromList,
  parsePreferenceDetail,
  PREFERENCE_TIME_ZONE,
} from '../lib/osym-preference-calendar.ts';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const VERIFIED_AT = '2026-07-15T08:45:00.000Z';
const YEAR_LIST_URL = 'https://www.osym.gov.tr/TR,32996/2025.html';

async function fixture(name: string): Promise<string> {
  return readFile(resolve(FIXTURES, name), 'utf8');
}

test('extracts one exact main YKS preference period from the official list and detail', async () => {
  const list = await fixture('osym-preference-list-valid.html');
  const detail = await fixture('osym-preference-detail-valid.html');
  const candidate = parsePreferenceCandidateFromList(list, YEAR_LIST_URL, 2025);

  assert.ok(candidate);
  assert.deepEqual(candidate, {
    year: 2025,
    title: '2025-YKS: Tercihlerin Alınması',
    publishedDate: '2025-08-01',
    listUrl: YEAR_LIST_URL,
    detailUrl: 'https://www.osym.gov.tr/TR,33376/2025-yks-tercihlerin-alinmasi-01082025.html',
    documentId: '33376',
  });
  assert.deepEqual(parsePreferenceDetail(detail, candidate, VERIFIED_AT), {
    id: 'yks-2025-tercih',
    start: '2025-08-01',
    end: '2025-08-13',
    startTime: '15:45',
    endTime: '23:59',
    type: 'tercih',
    title: { tr: '2025-YKS tercih dönemi', en: '2025 YKS preference period' },
    verified: true,
    verifiedAt: VERIFIED_AT,
    approximate: false,
    sample: false,
    source: 'https://www.osym.gov.tr/TR,33376/2025-yks-tercihlerin-alinmasi-01082025.html',
  });
  assert.equal(PREFERENCE_TIME_ZONE, 'Europe/Istanbul');
});

test('returns no event before an exact preference announcement is published', async () => {
  const list = await fixture('osym-preference-list-2026-unannounced.html');
  assert.equal(
    parsePreferenceCandidateFromList(list, 'https://www.osym.gov.tr/TR,33849/2026.html', 2026),
    null,
  );
});

test('fails closed when the canonical list has ambiguous exact preference announcements', async () => {
  const list = await fixture('osym-preference-list-ambiguous.html');
  assert.throws(
    () => parsePreferenceCandidateFromList(list, YEAR_LIST_URL, 2025),
    /at most one exact/u,
  );
});

test('fails closed when explicit start/end evidence is absent or ambiguous', async () => {
  const list = await fixture('osym-preference-list-valid.html');
  const candidate = parsePreferenceCandidateFromList(list, YEAR_LIST_URL, 2025);
  assert.ok(candidate);
  const noDates = await fixture('osym-preference-detail-no-dates.html');
  assert.throws(
    () => parsePreferenceDetail(noDates, candidate, VERIFIED_AT),
    /start.*exactly one/u,
  );

  const valid = await fixture('osym-preference-detail-valid.html');
  const ambiguous = valid.replace(
    '<!-- ###### 33376 anahlı dal içerik bitti ##### -->',
    `<p>Tercih işlemleri, 2 Ağustos 2025 tarihinde saat 09.00'da başlayacaktır.</p>
     <!-- ###### 33376 anahlı dal içerik bitti ##### -->`,
  );
  assert.throws(() => parsePreferenceDetail(ambiguous, candidate, VERIFIED_AT), /start.*found 2/u);
});

test('fails closed on a wrong-year list fixture', async () => {
  const list = await fixture('osym-preference-list-wrong-year.html');
  assert.throws(
    () => parsePreferenceCandidateFromList(list, YEAR_LIST_URL, 2025),
    /2024 preference announcement while 2025 was required/u,
  );
});

test('rejects non-official list and detail URLs even with otherwise valid fixtures', async () => {
  const list = await fixture('osym-preference-list-valid.html');
  assert.throws(
    () => parsePreferenceCandidateFromList(list, 'https://example.com/TR,32996/2025.html', 2025),
    /non-official ÖSYM preference URL/u,
  );
  const nonOfficialCandidate = await fixture('osym-preference-list-nonofficial.html');
  assert.throws(
    () => parsePreferenceCandidateFromList(nonOfficialCandidate, YEAR_LIST_URL, 2025),
    /non-official ÖSYM preference URL/u,
  );
  const candidate = parsePreferenceCandidateFromList(list, YEAR_LIST_URL, 2025);
  assert.ok(candidate);
  const detail = await fixture('osym-preference-detail-valid.html');
  assert.throws(
    () =>
      parsePreferenceDetail(
        detail,
        { ...candidate, detailUrl: candidate.detailUrl.replace('www.osym.gov.tr', 'evil.test') },
        VERIFIED_AT,
      ),
    /non-official ÖSYM preference URL/u,
  );
});

test('discovery follows canonical list to the single selected official detail', async () => {
  const list = await fixture('osym-preference-list-valid.html');
  const detail = await fixture('osym-preference-detail-valid.html');
  const requested: string[] = [];
  const fetchImpl = async (input: string | URL) => {
    const url = input.toString();
    requested.push(url);
    if (url === OSYM_YKS_LIST_URL) {
      return new Response('', {
        status: 302,
        headers: { location: OSYM_YKS_ANNOUNCEMENTS_URL, 'content-type': 'text/html' },
      });
    }
    if (url === OSYM_YKS_ANNOUNCEMENTS_URL) {
      return new Response('', {
        status: 302,
        headers: { location: YEAR_LIST_URL, 'content-type': 'text/html' },
      });
    }
    if (url === YEAR_LIST_URL) {
      return new Response(list, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.includes('/TR,33376/')) {
      return new Response(detail, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    throw new Error(`Unexpected fixture URL: ${url}`);
  };

  const event = await discoverOfficialPreferenceEvent({
    targetYear: 2025,
    verifiedAt: VERIFIED_AT,
    fetchImpl,
  });
  assert.equal(event?.id, 'yks-2025-tercih');
  assert.deepEqual(requested, [
    OSYM_YKS_LIST_URL,
    OSYM_YKS_ANNOUNCEMENTS_URL,
    YEAR_LIST_URL,
    'https://www.osym.gov.tr/TR,33376/2025-yks-tercihlerin-alinmasi-01082025.html',
  ]);
});
