import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  discoverOsymBookletCandidate,
  type InspectOfficialPdf,
} from '../lib/osym-booklet-discovery.ts';
import {
  osymBookletRegistrySchema,
  type OsymBookletRegistry,
} from '../lib/osym-booklet-registry.ts';
import { runBookletDiscoveryCli } from '../discover-osym-booklets.ts';
import { OFFICIAL_CALENDAR_URL } from '../sync-calendar.ts';

const FIXTURE_ROOT = path.resolve(
  process.cwd(),
  'scripts/__tests__/fixtures/osym-booklet-discovery',
);
const LIST_URL = 'https://www.osym.gov.tr/TR,13493/yks.html';
const ANNOUNCEMENT_URL =
  'https://www.osym.gov.tr/TR,41000/2027-yuksekogretim-kurumlari-sinavi-2027-yks-temel-soru-kitapciklari-ve-cevap-anahtarlari-yayimlandi-20062027.html';
const DETAIL_URL =
  'https://www.osym.gov.tr/TR,41001/2027-yks-tyt-ayt-ve-ydt-temel-soru-kitapciklari-ve-cevap-anahtarlari.html';
const DISCOVERY_NOW = new Date('2027-07-01T12:00:00.000Z');

async function registry(): Promise<OsymBookletRegistry> {
  return osymBookletRegistrySchema.parse(
    JSON.parse(await readFile(path.resolve(process.cwd(), 'content/osym-booklets.json'), 'utf8')),
  );
}

async function fixtures(): Promise<Record<string, string>> {
  const [list, announcement, detail, calendar] = await Promise.all(
    ['list.html', 'announcement.html', 'detail.html', 'calendar.html'].map((name) =>
      readFile(path.join(FIXTURE_ROOT, name), 'utf8'),
    ),
  );
  return {
    [LIST_URL]: list!,
    [ANNOUNCEMENT_URL]: announcement!,
    [DETAIL_URL]: detail!,
    [OFFICIAL_CALENDAR_URL]: calendar!,
  };
}

function fixtureFetch(documents: Record<string, string>, onCall?: (url: string) => void) {
  return async (input: string | URL): Promise<Response> => {
    const url = String(input);
    onCall?.(url);
    const document = documents[url];
    if (document === undefined) return new Response('missing fixture', { status: 404 });
    return new Response(document, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };
}

const inspectFixturePdf: InspectOfficialPdf = async ({ pdfUrl, session, expectedSectionIds }) => ({
  pdfUrl,
  bytes: session === 'tyt' ? 2_700_001 : 3_800_002,
  sha256: (session === 'tyt' ? 'a' : 'b').repeat(64),
  sectionIds: [...expectedSectionIds],
});

test('builds a review-only contiguous 2027 candidate while preserving every existing record', async () => {
  const current = await registry();
  const candidate = await discoverOsymBookletCandidate({
    registry: current,
    targetYear: 2027,
    fetchImpl: fixtureFetch(await fixtures()),
    inspectPdf: inspectFixturePdf,
    now: DISCOVERY_NOW,
  });

  assert.equal(candidate.publication.automatic, false);
  assert.equal(candidate.registry.coverage.lastYear, 2027);
  assert.deepEqual(candidate.registry.booklets.slice(0, current.booklets.length), current.booklets);
  assert.deepEqual(
    candidate.registry.questionBlockProfiles.tyt.questionBlocks,
    current.questionBlockProfiles.tyt.questionBlocks,
  );
  assert.deepEqual(
    candidate.registry.questionBlockProfiles.ayt.questionBlocks,
    current.questionBlockProfiles.ayt.questionBlocks,
  );
  assert.deepEqual(
    candidate.registry.booklets.slice(-2).map(({ year, session, examDate }) => ({
      year,
      session,
      examDate,
    })),
    [
      { year: 2027, session: 'tyt', examDate: '2027-06-19' },
      { year: 2027, session: 'ayt', examDate: '2027-06-20' },
    ],
  );
  assert.deepEqual(candidate.structuralVerification, [
    {
      bookletId: '2027-tyt',
      method: 'poppler-official-section-headers',
      sectionIds: ['turkce', 'sosyal-bilimler', 'temel-matematik', 'fen-bilimleri'],
    },
    {
      bookletId: '2027-ayt',
      method: 'poppler-official-section-headers',
      sectionIds: [
        'turk-dili-ve-edebiyati-sosyal-bilimler-1',
        'sosyal-bilimler-2',
        'matematik',
        'fen-bilimleri',
      ],
    },
  ]);

  const missingAyt = structuredClone(candidate.registry);
  missingAyt.booklets.pop();
  assert.equal(osymBookletRegistrySchema.safeParse(missingAyt).success, false);
  const skippedYear = structuredClone(candidate.registry);
  skippedYear.coverage.lastYear = 2028;
  assert.equal(osymBookletRegistrySchema.safeParse(skippedYear).success, false);
});

test('fails closed when the canonical list contains two matching announcements', async () => {
  const documents = await fixtures();
  const closingTable = documents[LIST_URL]!.lastIndexOf('</table>');
  documents[LIST_URL] =
    `${documents[LIST_URL]!.slice(0, closingTable)}<tr><td><a href="/TR,41002/2027-yks-temel-soru-kitapciklari-ve-cevap-anahtarlari-yayimlandi.html">2027-YKS Temel Soru Kitapçıkları ve Cevap Anahtarları Yayımlandı</a></td></tr>${documents[LIST_URL]!.slice(closingTable)}`;
  await assert.rejects(
    discoverOsymBookletCandidate({
      registry: await registry(),
      targetYear: 2027,
      fetchImpl: fixtureFetch(documents),
      inspectPdf: inspectFixturePdf,
      now: DISCOVERY_NOW,
    }),
    /exactly one 2027-YKS booklet publication announcement; found 2/i,
  );
});

test('fails closed when the detail page contains two TYT PDF candidates', async () => {
  const documents = await fixtures();
  documents[DETAIL_URL] = documents[DETAIL_URL]!.replace(
    '</body>',
    `<a href="https://cdn.osym.gov.tr/pdfdokuman/2027/YKS/TSK/yks_tyt_2027_kitapcik_duplicate.pdf">Temel Yeterlilik Testi (TYT) Temel Soru Kitapçığı ve Cevap Anahtarı</a></body>`,
  );
  await assert.rejects(
    discoverOsymBookletCandidate({
      registry: await registry(),
      targetYear: 2027,
      fetchImpl: fixtureFetch(documents),
      inspectPdf: inspectFixturePdf,
      now: DISCOVERY_NOW,
    }),
    /exactly one 2027-YKS TYT PDF; found 2/i,
  );
});

test('fails closed when Poppler-observed section headers drift', async () => {
  const driftedInspector: InspectOfficialPdf = async (input) => ({
    ...(await inspectFixturePdf(input)),
    sectionIds: input.expectedSectionIds.slice(0, -1),
  });
  await assert.rejects(
    discoverOsymBookletCandidate({
      registry: await registry(),
      targetYear: 2027,
      fetchImpl: fixtureFetch(await fixtures()),
      inspectPdf: driftedInspector,
      now: DISCOVERY_NOW,
    }),
    /structural verification drift/i,
  );
});

test('rejects a non-contiguous target year before making a network request', async () => {
  let calls = 0;
  await assert.rejects(
    discoverOsymBookletCandidate({
      registry: await registry(),
      targetYear: 2028,
      fetchImpl: fixtureFetch(await fixtures(), () => {
        calls += 1;
      }),
      inspectPdf: inspectFixturePdf,
    }),
    /only accepts the next contiguous year 2027/i,
  );
  assert.equal(calls, 0);
});

test('CLI cannot target content paths or request publication', async () => {
  await assert.rejects(
    runBookletDiscoveryCli(['--year', '2027', '--output', 'content/candidate.json']),
    /direct child of tmp\/osym-booklet-discovery/i,
  );
  await assert.rejects(
    runBookletDiscoveryCli([
      '--year',
      '2027',
      '--output',
      'tmp/osym-booklet-discovery/2027.json',
      '--publish',
    ]),
    /unknown or incomplete argument: --publish/i,
  );
});
