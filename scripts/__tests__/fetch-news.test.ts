import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  fetchNews,
  fetchOfficialHtml,
  isRelevantNewsTitle,
  MAX_RESPONSE_BYTES,
  OSYM_YKS_LIST_URL,
  parseOsymYksList,
  parseYokDetail,
  parseYokListCandidates,
  stabilizeNewsDocument,
  YOK_LIST_URLS,
} from '../fetch-news.ts';
import { newsSchema } from '../lib/content-schemas.ts';

const OSYM_CURRENT_PAGE_URL = 'https://www.osym.gov.tr/TR,33849/2026.html';
const YOK_DETAIL_URL = 'https://www.yok.gov.tr/tr/news/2026-yks-tercih-sureci-AbC12';
const VERIFIED_AT = '2026-07-14T12:00:00.000Z';
const FRESH_VERIFIED_AT = '2026-07-15T12:00:00.000Z';

async function fixture(name: string): Promise<string> {
  return readFile(resolve(process.cwd(), 'scripts/__tests__/fixtures', name), 'utf8');
}

function htmlResponse(html: string, status = 200, headers: Record<string, string> = {}): Response {
  const bytes = new TextEncoder().encode(html);
  return new Response(bytes, {
    status,
    headers: {
      'content-length': String(bytes.byteLength),
      'content-type': 'text/html; charset=utf-8',
      ...headers,
    },
  });
}

async function createSuccessfulFetch(): Promise<typeof fetch> {
  const osymList = await fixture('osym-yks-list.html');
  const yokList = await fixture('yok-news-list.html');
  const yokDetail = await fixture('yok-news-detail.html');

  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === OSYM_YKS_LIST_URL) {
      return new Response(null, { status: 302, headers: { location: OSYM_CURRENT_PAGE_URL } });
    }
    if (url === OSYM_CURRENT_PAGE_URL) return htmlResponse(osymList);
    if (url === YOK_LIST_URLS[0] || url === YOK_LIST_URLS[1]) return htmlResponse(yokList);
    if (url === YOK_DETAIL_URL) return htmlResponse(yokDetail);
    return htmlResponse('not found', 404);
  }) as typeof fetch;
}

test('ÖSYM parser reads only the exact table#list and rejects generic exam false positives', async () => {
  const html = await fixture('osym-yks-list.html');
  const first = parseOsymYksList(html, OSYM_CURRENT_PAGE_URL, VERIFIED_AT);
  const second = parseOsymYksList(html, OSYM_CURRENT_PAGE_URL, VERIFIED_AT);

  assert.equal(first.length, 2);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((item) => item.title.tr),
    [
      '2026-YKS: Değerlendirme İşlemleri (01.07.2026)',
      'Yükseköğretim Kurumları Sınavı Kitapçıkları Yayımlandı (21.06.2026)',
    ],
  );
  assert.deepEqual(
    first.map((item) => item.publishedAt),
    ['2026-07-01T00:00:00+03:00', '2026-06-21T00:00:00+03:00'],
  );
  assert.ok(first.every((item) => item.id.startsWith('osym-')));
  assert.ok(first.every((item) => item.title.en === item.title.tr));
  assert.ok(first.every((item) => item.summary.en === item.title.tr));
  assert.ok(first.every((item) => item.verifiedAt === VERIFIED_AT));
  assert.ok(
    first.every(
      (item) =>
        item.provenance.listUrl === OSYM_CURRENT_PAGE_URL &&
        item.provenance.detailUrl === item.url &&
        item.provenance.publishedAtEvidence === 'osym-list-title-date',
    ),
  );
});

test('relevance requires an explicit YKS family term or exact higher-education exam context', () => {
  assert.equal(isRelevantNewsTitle('2026-YKS Başvuruları Alınıyor'), true);
  assert.equal(isRelevantNewsTitle('Alan Yeterlilik Testleri (AYT) Sonuçları'), true);
  assert.equal(isRelevantNewsTitle('Yükseköğretim Kurumları Sınavı Başladı'), true);
  assert.equal(isRelevantNewsTitle('Üniversite Tercihleri İçin Rehber'), true);
  assert.equal(isRelevantNewsTitle('Genel Sınav Başvuruları Açıldı'), false);
  assert.equal(isRelevantNewsTitle('Yükseköğretim Sistemi Yapay Zekâda Büyüyor'), false);
  assert.equal(isRelevantNewsTitle('Öğrenci Yerleştirme Duyurusu'), false);
});

test('YÖK item is emitted only after the list title and exact detail update date agree', async () => {
  const list = await fixture('yok-news-list.html');
  const detail = await fixture('yok-news-detail.html');
  const candidates = parseYokListCandidates(list, YOK_LIST_URLS[0]);

  assert.deepEqual(candidates, [
    {
      title: '2026-YKS Tercih Süreci Başlıyor',
      url: YOK_DETAIL_URL,
      listUrl: YOK_LIST_URLS[0],
    },
  ]);
  const item = parseYokDetail(
    detail,
    candidates[0]!.url,
    candidates[0]!.title,
    candidates[0]!.listUrl,
    VERIFIED_AT,
  );
  assert.equal(item.publishedAt, '2026-07-14T00:00:00+03:00');
  assert.equal(item.source, 'YÖK');
  assert.equal(item.title.en, item.title.tr);
  assert.equal(item.verifiedAt, VERIFIED_AT);
  assert.deepEqual(item.provenance, {
    listUrl: YOK_LIST_URLS[0],
    detailUrl: YOK_DETAIL_URL,
    publishedAtEvidence: 'yok-detail-update-date',
  });

  assert.throws(
    () =>
      parseYokDetail(
        detail.replace('Güncelleme Tarihi:', 'Tarih:'),
        item.url,
        item.title.tr,
        YOK_LIST_URLS[0],
        VERIFIED_AT,
      ),
    /unambiguous YÖK update date/,
  );
  assert.throws(
    () =>
      parseYokDetail(detail, item.url, '2026-YKS Başka Bir Başlık', YOK_LIST_URLS[0], VERIFIED_AT),
    /title does not match/,
  );
});

test('manual redirect handling refuses leaving the requested official authority', async () => {
  let calls = 0;
  await assert.rejects(
    fetchOfficialHtml(OSYM_YKS_LIST_URL, 'osym', async () => {
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/fake-yks.html' },
      });
    }),
    /refused redirect/,
  );
  assert.equal(calls, 1);
});

test('streamed HTML is rejected when it crosses the response safety limit', async () => {
  const oversizedBody = new Uint8Array(MAX_RESPONSE_BYTES + 1);
  await assert.rejects(
    fetchOfficialHtml(
      OSYM_YKS_LIST_URL,
      'osym',
      (async () =>
        new Response(oversizedBody, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })) as typeof fetch,
    ),
    /response exceeds/,
  );
});

test('dry-run follows the canonical ÖSYM redirect and never creates its output file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yks-news-dry-run-'));
  const outputPath = join(directory, 'news.json');
  try {
    const result = await fetchNews({
      dryRun: true,
      fetchImpl: await createSuccessfulFetch(),
      outputPath,
      now: new Date(VERIFIED_AT),
    });
    assert.equal(result.count, 3);
    assert.equal(result.items.filter((item) => item.source === 'ÖSYM').length, 2);
    assert.equal(result.items.filter((item) => item.source === 'YÖK').length, 1);
    assert.deepEqual(
      {
        genericOrNonYks: result.items.filter((item) => !isRelevantNewsTitle(item.title.tr)).length,
        sampleUnverifiedOrUnsourced: result.items.filter(
          (item) =>
            item.sample ||
            !item.verified ||
            !item.verifiedAt ||
            !item.provenance.listUrl ||
            !item.provenance.detailUrl,
        ).length,
      },
      { genericOrNonYks: 0, sampleUnverifiedOrUnsourced: 0 },
    );
    await assert.rejects(access(outputPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('schema-v2 news rejects missing provenance and non-production verification flags', async () => {
  const result = await fetchNews({
    dryRun: true,
    fetchImpl: await createSuccessfulFetch(),
    now: new Date(VERIFIED_AT),
  });
  const valid = {
    schemaVersion: 2,
    dataStatus: {
      verified: true,
      approximate: false,
      sample: false,
      source: result.items[0]!.provenance.listUrl,
      note: { tr: 'Resmî kaynak.', en: 'Official source.' },
    },
    items: result.items,
  };
  assert.equal(newsSchema.safeParse(valid).success, true);

  const missingProvenance = structuredClone(valid) as {
    items: Array<{ provenance?: unknown }>;
  };
  delete missingProvenance.items[0]!.provenance;
  assert.equal(newsSchema.safeParse(missingProvenance).success, false);

  const sample = structuredClone(valid) as { items: Array<{ sample: boolean }> };
  sample.items[0]!.sample = true;
  assert.equal(newsSchema.safeParse(sample).success, false);
});

test('a required ÖSYM failure preserves the last-good file byte for byte', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yks-news-last-good-'));
  const outputPath = join(directory, 'news.json');
  const lastGood = '{"lastGood":true}\n';
  await writeFile(outputPath, lastGood, 'utf8');

  try {
    await assert.rejects(
      fetchNews({
        fetchImpl: (async () => htmlResponse('upstream unavailable', 503)) as typeof fetch,
        outputPath,
      }),
      /HTTP 503/,
    );
    assert.equal(await readFile(outputPath, 'utf8'), lastGood);
    assert.deepEqual(await readdir(directory), ['news.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('two news syncs with different now values preserve exact bytes and do not rewrite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yks-news-stability-'));
  const outputPath = join(directory, 'news.json');
  try {
    const first = await fetchNews({
      fetchImpl: await createSuccessfulFetch(),
      outputPath,
      now: new Date(VERIFIED_AT),
    });
    const firstBytes = await readFile(outputPath, 'utf8');
    const firstStat = await stat(outputPath);
    const second = await fetchNews({
      fetchImpl: await createSuccessfulFetch(),
      outputPath,
      now: new Date(FRESH_VERIFIED_AT),
    });
    const secondStat = await stat(outputPath);

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(await readFile(outputPath, 'utf8'), firstBytes);
    assert.equal(secondStat.ino, firstStat.ino);
    assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
    assert.ok(second.items.every((item) => item.verifiedAt === VERIFIED_AT));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('news changes and additions receive fresh verification while stable items retain theirs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yks-news-record-stability-'));
  try {
    const previousResult = await fetchNews({
      dryRun: true,
      fetchImpl: await createSuccessfulFetch(),
      outputPath: join(directory, 'previous.json'),
      now: new Date(VERIFIED_AT),
    });
    const candidateResult = await fetchNews({
      dryRun: true,
      fetchImpl: await createSuccessfulFetch(),
      outputPath: join(directory, 'candidate.json'),
      now: new Date(FRESH_VERIFIED_AT),
    });
    const previous = newsSchema.parse({
      schemaVersion: 2,
      dataStatus: {
        verified: true,
        approximate: false,
        sample: false,
        source: previousResult.items[0]!.provenance.listUrl,
        note: { tr: 'Resmî kaynak.', en: 'Official source.' },
      },
      items: previousResult.items,
    });
    const candidate = newsSchema.parse({ ...previous, items: candidateResult.items });
    const changedId = candidate.items[0]!.id;
    const changedCandidate = structuredClone(candidate);
    const updatedTitle = `${changedCandidate.items[0]!.title.tr} — güncellendi`;
    changedCandidate.items[0]!.title = { tr: updatedTitle, en: updatedTitle };
    changedCandidate.items[0]!.summary = { tr: updatedTitle, en: updatedTitle };
    const changed = stabilizeNewsDocument(changedCandidate, previous);

    assert.equal(
      changed.items.find((item) => item.id === changedId)?.verifiedAt,
      FRESH_VERIFIED_AT,
    );
    assert.ok(
      changed.items
        .filter((item) => item.id !== changedId)
        .every((item) => item.verifiedAt === VERIFIED_AT),
    );

    const template = candidate.items.find((item) => item.source === 'YÖK')!;
    const newItem = {
      ...template,
      id: 'yok-aaaaaaaaaaaaaaaaaaaaaaaa',
      publishedAt: '2026-07-15T00:00:00+03:00',
      title: { tr: '2026-YKS Yeni Duyuru', en: '2026-YKS Yeni Duyuru' },
      summary: { tr: '2026-YKS Yeni Duyuru', en: '2026-YKS Yeni Duyuru' },
      url: 'https://www.yok.gov.tr/tr/news/2026-yks-yeni-duyuru-XyZ99',
      provenance: {
        ...template.provenance,
        detailUrl: 'https://www.yok.gov.tr/tr/news/2026-yks-yeni-duyuru-XyZ99',
      },
    };
    const withAddition = newsSchema.parse({
      ...candidate,
      items: [...candidate.items, newItem],
    });
    const stabilizedAddition = stabilizeNewsDocument(withAddition, previous);
    assert.equal(
      stabilizedAddition.items.find((item) => item.id === newItem.id)?.verifiedAt,
      FRESH_VERIFIED_AT,
    );
    assert.ok(
      stabilizedAddition.items
        .filter((item) => item.id !== newItem.id)
        .every((item) => item.verifiedAt === VERIFIED_AT),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
