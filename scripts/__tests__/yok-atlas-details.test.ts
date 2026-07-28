import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProgramsDetailsFixture,
  fetchAllYokAtlasNets,
  normalizeNetsRow,
  prepareStableDetailsFixture,
} from '../lib/yok-atlas-details.ts';

const generatedAt = '2026-07-17T12:00:00.000Z';

const detailRow = {
  kilavuzKodu: 123456789,
  yil: 2025,
  fymkAdi: 'Mühendislik Fakültesi',
  ilceAdi: 'ÇANKAYA',
  ogrenimTuruAdi: 'Örgün Öğretim',
  ogrenimSuresi: 4,
  birimGrupId: 2010,
  birimGrupAdi: 'Bilgisayar Mühendisliği',
  ucret: 950000,
  akreditasyon: 'ABET',
  akreditasyonAck: 'Accreditation Board for Engineering and Technology',
  tyc: '*',
  uygulamaliEgitimModeli: '3+1',
  minBasariSirasi: '300000',
  minBasariSirasiKosul: 'Başarı sırası şartı metni.',
  prof: 5,
  doc: 3,
  dou: 4,
  ogrGor: 0,
  arGor: 7,
  kosul: '17,46,343',
  kosulList: [{ '17': 'Birinci koşul metni.' }, { '46': 'İkinci koşul metni.' }],
  // Kılavuz yılının yerleştirmesi henüz yapılmamış: suffix'siz `gkY` boş, gerçekleşen veri
  // `1` ekli alanlarda (canlı sözleşme 2026-07-28 — docs/YOK_ATLAS_API_MIGRATION.md).
  minPuan: 501.25,
  basariSirasi: 12345,
  kontenjan: 95,
  gkY: null,
  gk1: 80,
  gkY1: 78,
  obk1: 2,
  obkY1: 2,
  y34_1: 1,
  y34Y1: 0,
};

const netsRow2024 = {
  yil: 2024,
  kilavuzKodu: 123456789,
  puanTuru: 'SAY',
  katsayi: 0.12,
  tabanPuan: 498.5,
  obp: 450.75,
  tytTrkNet: 32.5,
  tytMatNet: 36,
  aytMatNet: 30.25,
};

test('normalizes a nets row into slugged score type and mapped subjects', () => {
  const { id, net } = normalizeNetsRow(netsRow2024);
  assert.equal(id, '123456789');
  assert.equal(net.year, 2024);
  assert.equal(net.scoreType, 'say');
  assert.equal(net.minScore, 498.5);
  assert.equal(net.obp, 450.75);
  assert.deepEqual(net.nets, { tytTurkce: 32.5, tytMatematik: 36, aytMatematik: 30.25 });
});

test('builds a details record with official categories, staff, and kosul policy', () => {
  const { fixture, statistics } = buildProgramsDetailsFixture({
    rawRows: [detailRow],
    netsRows: [netsRow2024],
    snapshotYear: 2025,
    netYears: [2023, 2024, 2025],
    generatedAt,
  });
  const record = fixture.programs[0]!;
  assert.equal(record.id, '123456789');
  assert.equal(record.faculty, 'Mühendislik Fakültesi');
  assert.equal(record.tuition, 950000);
  assert.equal(record.tyc, true);
  assert.equal(record.minRankRequirement, 300000);
  assert.deepEqual(record.staff, {
    professor: 5,
    docent: 3,
    doctorFaculty: 4,
    lecturer: 0,
    researchAssistant: 7,
  });
  // Category rows carry quota AND placed; y34 keeps its real 0 because cutoffs exist.
  assert.deepEqual(record.quotaCategories, [
    { category: 'genel', quota: 80, placed: 78 },
    { category: 'okul-birincisi', quota: 2, placed: 2 },
    { category: 'kadin-34', quota: 1, placed: 0 },
  ]);
  // Code 343 is kept as an official reference even though the source ships no text.
  assert.deepEqual(record.conditionCodes, ['17', '46', '343']);
  assert.deepEqual(Object.keys(fixture.conditions).sort(), ['17', '46']);
  assert.equal(statistics.conditionCodesWithoutText, 1);
  assert.equal(statistics.netRowsAttached, 1);
  assert.equal(record.nets[0]?.minScore, 498.5);
});

test('does not trust category placed counts on a cutoff-less kılavuz row', () => {
  const pendingRow = {
    ...detailRow,
    minPuan: null,
    basariSirasi: null,
    gkY1: 0,
    obkY1: 0,
    y34Y1: 0,
  };
  const { fixture } = buildProgramsDetailsFixture({
    rawRows: [pendingRow],
    netsRows: [],
    snapshotYear: 2025,
    netYears: [2023],
    generatedAt,
  });
  assert.ok(
    fixture.programs[0]!.quotaCategories.every((category) => category.placed === null),
  );
});

test('drops nets of programs missing from the sweep and counts them', () => {
  const { statistics } = buildProgramsDetailsFixture({
    rawRows: [detailRow],
    netsRows: [netsRow2024, { ...netsRow2024, kilavuzKodu: 999999999 }],
    snapshotYear: 2025,
    netYears: [2024],
    generatedAt,
  });
  assert.equal(statistics.netRowsAttached, 1);
  assert.equal(statistics.netRowsDropped, 1);
});

test('rejects two DIFFERENT nets rows for one program-year', () => {
  assert.throws(
    () =>
      buildProgramsDetailsFixture({
        rawRows: [detailRow],
        netsRows: [netsRow2024, { ...netsRow2024, tabanPuan: 400 }],
        snapshotYear: 2025,
        netYears: [2024],
        generatedAt,
      }),
    /two DIFFERENT nets rows/,
  );
});

test('reuses existing details bytes when only generatedAt changed', () => {
  const first = buildProgramsDetailsFixture({
    rawRows: [detailRow],
    netsRows: [netsRow2024],
    snapshotYear: 2025,
    netYears: [2024],
    generatedAt,
  }).fixture;
  const existingJson = `${JSON.stringify(first, null, 2)}\n`;
  const second = buildProgramsDetailsFixture({
    rawRows: [detailRow],
    netsRows: [netsRow2024],
    snapshotYear: 2025,
    netYears: [2024],
    generatedAt: '2026-07-18T12:00:00.000Z',
  }).fixture;
  const prepared = prepareStableDetailsFixture(second, existingJson);
  assert.equal(prepared.reusedExistingBytes, true);
  assert.equal(prepared.fixtureJson, existingJson);

  const changed = buildProgramsDetailsFixture({
    rawRows: [{ ...detailRow, ucret: 1000000 }],
    netsRows: [netsRow2024],
    snapshotYear: 2025,
    netYears: [2024],
    generatedAt: '2026-07-18T12:00:00.000Z',
  }).fixture;
  assert.equal(prepareStableDetailsFixture(changed, existingJson).reusedExistingBytes, false);
});

function netsFetchImpl(rowsByYear: Record<number, unknown[]>): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { filters: { yil: number } };
    const content = rowsByYear[request.filters.yil] ?? [];
    return Response.json({
      content,
      number: 0,
      numberOfElements: content.length,
      size: 25_000,
      totalElements: content.length,
      totalPages: content.length ? 1 : 0,
      source: 'snapshot',
    });
  }) as typeof fetch;
}

test('nets sweep skips byte-identical duplicates the source publishes', async () => {
  const { rows, statistics } = await fetchAllYokAtlasNets([2024], {
    requestDelayMs: 0,
    fetchImpl: netsFetchImpl({ 2024: [netsRow2024, { ...netsRow2024 }] }),
  });
  assert.equal(rows.length, 1);
  assert.equal(statistics.identicalDuplicatesSkipped, 1);
  assert.equal(statistics.crossScoreTypeDuplicatesResolved, 0);
});

test('nets sweep resolves a score-type change to the row carrying the tabanPuan', async () => {
  const residueRow = {
    ...netsRow2024,
    puanTuru: 'EA',
    tabanPuan: null,
    katsayi: null,
    aytMatNet: 12,
  };
  const { rows, statistics } = await fetchAllYokAtlasNets([2024], {
    requestDelayMs: 0,
    fetchImpl: netsFetchImpl({ 2024: [residueRow, netsRow2024] }),
  });
  assert.equal(rows.length, 1);
  assert.equal(statistics.crossScoreTypeDuplicatesResolved, 1);
  assert.equal(normalizeNetsRow(rows[0]).net.scoreType, 'say');
});

test('nets sweep aborts when two distinct rows both carry a tabanPuan', async () => {
  await assert.rejects(
    fetchAllYokAtlasNets([2024], {
      requestDelayMs: 0,
      fetchImpl: netsFetchImpl({
        2024: [netsRow2024, { ...netsRow2024, puanTuru: 'EA', tabanPuan: 400 }],
      }),
    }),
    /cannot resolve which placement is real/,
  );
});

test('nets sweep aborts when a year no longer fits one response', async () => {
  const fetchImpl = (async () =>
    Response.json({
      content: [],
      number: 0,
      numberOfElements: 0,
      size: 25_000,
      totalElements: 26_000,
      totalPages: 2,
      source: 'snapshot',
    })) as typeof fetch;
  await assert.rejects(
    fetchAllYokAtlasNets([2024], { requestDelayMs: 0, fetchImpl }),
    /no longer fits one response/,
  );
});
