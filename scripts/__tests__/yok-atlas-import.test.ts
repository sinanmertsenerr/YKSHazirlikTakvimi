import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  importYokAtlasPrograms,
  prepareStableProgramsFixture,
} from '../import-yok-atlas-programs.ts';
import {
  buildYokAtlasFixture,
  normalizeYokAtlasRow,
  normalizeYokAtlasTalentRow,
} from '../lib/yok-atlas.ts';

const verifiedAt = '2026-07-14T12:00:00.000Z';
const freshVerifiedAt = '2026-07-15T12:00:00.000Z';
const officialRow = {
  kilavuzKodu: 123456789,
  yil: 2025,
  universiteAdi: 'ÖRNEK DEVLET ÜNİVERSİTESİ',
  birimAdi: 'Bilgisayar Mühendisliği (İngilizce)',
  ilAdi: 'ANKARA',
  universiteTuru: 'DEVLET',
  puanTuru: 'SAY',
  bursOraniAdi: 'Ücretsiz',
  ogrenimDiliAdi: 'İngilizce',
  kontenjan: 80,
  gkY: 78,
  // Kategori kırılımı bir önceki yıla aittir (`1` ekli aile) — details tarafı bunu okur.
  gkY1: 78,
  minPuan: 501.25,
  basariSirasi: 12_345,
  gk1: 80,
  minPuan1: '498.5',
  basariSirasi1: 13_000,
  gk2: 70,
  minPuan2: 0,
  basariSirasi2: null,
  gk3: 60,
  minPuan3: 490,
  basariSirasi3: 15_000,
  fymkAdi: 'Mühendislik Fakültesi',
  ilceAdi: 'ÇANKAYA',
  ogrenimTuruAdi: 'Örgün Öğretim',
  ogrenimSuresi: 4,
  birimGrupId: 2010,
  birimGrupAdi: 'Bilgisayar Mühendisliği',
  prof: 5,
  doc: 3,
  dou: 4,
  ogrGor: 0,
  arGor: 7,
  tyc: '*',
  kosul: '17,46',
  kosulList: [{ '17': 'Örnek koşul metni.' }, { '46': 'İkinci örnek koşul metni.' }],
  obk1: 2,
  obkY1: 2,
} as const;

const onlisansRow = {
  ...officialRow,
  kilavuzKodu: 105590209,
  birimAdi: 'Siber Güvenlik Analistliği ve Operatörlüğü',
  puanTuru: 'TYT',
} as const;

// TABLO 5 shape: no central cutoffs on any year, free-form/absent puanTuru, own year.
const talentRow = {
  ...officialRow,
  kilavuzKodu: 300110477,
  yil: 2026,
  universiteAdi: 'GAZİ ÜNİVERSİTESİ (ANKARA)',
  birimAdi: 'Beden Eğitimi ve Spor Öğretmenliği',
  puanTuru: null,
  minPuan: null,
  basariSirasi: null,
  gkY: null,
  gk1: null,
  minPuan1: null,
  basariSirasi1: null,
  gk2: null,
  minPuan2: null,
  basariSirasi2: null,
  gk3: null,
  minPuan3: null,
  basariSirasi3: null,
} as const;

const netsRow = {
  yil: 2024,
  kilavuzKodu: 123456789,
  puanTuru: 'SAY',
  katsayi: 0.12,
  tabanPuan: 498.5,
  obp: 450.75,
  tytTrkNet: 32.5,
  tytMatNet: 36,
  aytMatNet: 30.25,
} as const;

const MOCK_BUNDLE =
  'minPuan1 minPuan2 minPuan3 basariSirasi1 basariSirasi2 basariSirasi3 ["gk".concat' +
  ' {kategori:"Genel",kontenjan:E.gk1||0,yerlesen:E.gkY1||0}' +
  ' {kontenjan:E.obk1||0,yerlesen:E.obkY1||0}' +
  ' {kontenjan:E.dprm1||0,yerlesen:E.dprmY1||0}' +
  ' {kontenjan:E.sgy1||0,yerlesen:E.sgyY1||0}' +
  ' {kontenjan:E.y34_1||0,yerlesen:E.y34Y1||0}' +
  ' "/netler/search" tytTrkNet';

test('normalizes only proven current and three-year historical fields', () => {
  const result = normalizeYokAtlasRow(officialRow, verifiedAt);
  assert.equal(result.program?.id, '123456789');
  assert.equal(result.program?.scoreType, 'say');
  assert.equal(result.program?.type, 'devlet');
  assert.deepEqual(result.program?.university, {
    tr: 'ÖRNEK DEVLET ÜNİVERSİTESİ',
    en: 'ÖRNEK DEVLET ÜNİVERSİTESİ',
  });
  assert.deepEqual(
    result.program?.years.map((year) => ({
      year: year.year,
      quota: year.quota,
      placed: year.placed,
      minScore: year.minScore,
      minRank: year.minRank,
    })),
    [
      // Current-year placed comes from gkY (genel yerleşen); history has no such field.
      { year: 2025, quota: 80, placed: 78, minScore: 501.25, minRank: 12_345 },
      { year: 2024, quota: 80, placed: null, minScore: 498.5, minRank: 13_000 },
      { year: 2023, quota: 70, placed: null, minScore: null, minRank: null },
      { year: 2022, quota: 60, placed: null, minScore: 490, minRank: 15_000 },
    ],
  );
  assert.ok(result.program?.years.every((year) => year.verifiedAt === verifiedAt));
});

test('does not trust a zero yerleşen on a year without any published cutoff', () => {
  // A freshly loaded kılavuz reports gkY 0 with null cutoffs — that means "placement
  // not run yet", never "0 placed"; a real 0-placed year is indistinguishable and the
  // honest answer for both is null.
  const pending = normalizeYokAtlasRow(
    { ...officialRow, gkY: 0, minPuan: null, basariSirasi: null },
    verifiedAt,
  );
  assert.equal(pending.program?.years.find((year) => year.year === 2025)?.placed, null);
  // A zero next to a PUBLISHED cutoff is a real official total and is kept.
  const real = normalizeYokAtlasRow({ ...officialRow, gkY: 0 }, verifiedAt);
  assert.equal(real.program?.years.find((year) => year.year === 2025)?.placed, 0);
});

test('supports all five official university types and null foreign cities', () => {
  const foreign = normalizeYokAtlasRow(
    { ...officialRow, universiteTuru: 'YURTDISI KAMU', ilAdi: null },
    verifiedAt,
  );
  assert.equal(foreign.program?.type, 'yurtdisi-kamu');
  assert.equal(foreign.program?.city, null);
  const myo = normalizeYokAtlasRow({ ...officialRow, universiteTuru: 'VAKIF MYO' }, verifiedAt);
  assert.equal(myo.program?.type, 'vakif-myo');
  // A DOMESTIC row without a city is still snapshot corruption.
  assert.throws(
    () => normalizeYokAtlasRow({ ...officialRow, ilAdi: null }, verifiedAt),
    /no official city value/,
  );
});

test('normalizes önlisans TYT rows into the tyt score type', () => {
  const result = normalizeYokAtlasRow(onlisansRow, verifiedAt);
  assert.equal(result.program?.scoreType, 'tyt');
  assert.equal(result.program?.id, '105590209');
});

test('fails closed for university types that cannot be represented faithfully', () => {
  const result = normalizeYokAtlasRow(
    { ...officialRow, universiteTuru: 'YENİ BİLİNMEYEN TÜR' },
    verifiedAt,
  );
  assert.equal(result.program, null);
  assert.equal(result.skippedUniversityType, 'YENİ BİLİNMEYEN TÜR');
});

test('preserves the official scholarship category without coercion', () => {
  const result = normalizeYokAtlasRow(
    { ...officialRow, universiteTuru: 'VAKIF', bursOraniAdi: '%25 İndirimli' },
    verifiedAt,
  );
  assert.equal(result.program?.scholarship, '%25');
  assert.equal(result.omittedScholarshipLabel, null);
});

test('rejects duplicate program codes because they indicate an unstable paginated snapshot', () => {
  assert.throws(
    () => buildYokAtlasFixture([officialRow, officialRow], verifiedAt),
    /Duplicate YÖP code/,
  );
});

test('normalizes talent-exam rows into the yetenek score type with null cutoffs', () => {
  const result = normalizeYokAtlasTalentRow(talentRow, verifiedAt);
  assert.equal(result.program?.scoreType, 'yetenek');
  assert.equal(result.program?.id, '300110477');
  assert.equal(result.program?.source, 'https://yokatlas.yok.gov.tr/detay/300110477');
  // The current-year row survives with quota only; all-null historical rows are dropped.
  assert.deepEqual(
    result.program?.years.map((year) => ({
      year: year.year,
      quota: year.quota,
      minScore: year.minScore,
      minRank: year.minRank,
    })),
    [{ year: 2026, quota: 80, minScore: null, minRank: null }],
  );
});

test('rejects duplicate YÖP codes across the merkezi and talent levels', () => {
  assert.throws(
    () =>
      buildYokAtlasFixture([officialRow], verifiedAt, [
        { ...talentRow, kilavuzKodu: 123456789 },
      ]),
    /Duplicate YÖP code 123456789/,
  );
});

test('counts talent programs separately in the import statistics', () => {
  const { fixture, statistics } = buildYokAtlasFixture([officialRow], verifiedAt, [talentRow]);
  assert.equal(statistics.importedPrograms, 2);
  assert.equal(statistics.importedTalentPrograms, 1);
  assert.equal(statistics.receivedTalentRows, 1);
  assert.equal(fixture.programs.filter((program) => program.scoreType === 'yetenek').length, 1);
});

test('rejects impossible official numeric values instead of silently dropping them', () => {
  assert.throws(
    () => normalizeYokAtlasRow({ ...officialRow, basariSirasi1: -1 }, verifiedAt),
    /must be zero\/missing or a positive integer/,
  );
});

test('builds a fully sourced, non-sample fixture', () => {
  const { fixture, statistics } = buildYokAtlasFixture([officialRow], verifiedAt);
  assert.equal(fixture.dataStatus.verified, true);
  assert.equal(fixture.dataStatus.sample, false);
  assert.equal(fixture.programs[0]?.source, 'https://yokatlas.yok.gov.tr/detay/123456789');
  assert.equal(fixture.programs[0]?.verifiedAt, verifiedAt);
  assert.equal(statistics.importedPrograms, 1);
});

test('a repeated program snapshot with a different now reuses the existing fixture bytes exactly', () => {
  const first = buildYokAtlasFixture([officialRow], verifiedAt).fixture;
  const existingBytes = `  ${JSON.stringify(first)}\n`;
  const secondCandidate = buildYokAtlasFixture([officialRow], freshVerifiedAt).fixture;
  const prepared = prepareStableProgramsFixture(secondCandidate, existingBytes);

  assert.equal(prepared.reusedExistingBytes, true);
  assert.equal(prepared.fixtureJson, existingBytes);
  assert.equal(prepared.fixture.programs[0]?.verifiedAt, verifiedAt);
  assert.ok(prepared.fixture.programs[0]?.years.every((year) => year.verifiedAt === verifiedAt));
});

test('changed and new program facts receive fresh verification without refreshing stable records', () => {
  const first = buildYokAtlasFixture([officialRow], verifiedAt).fixture;
  const existingBytes = `${JSON.stringify(first, null, 2)}\n`;

  const changedCandidate = buildYokAtlasFixture(
    [{ ...officialRow, kontenjan: 81 }],
    freshVerifiedAt,
  ).fixture;
  const changed = prepareStableProgramsFixture(changedCandidate, existingBytes);
  const changedProgram = changed.fixture.programs[0]!;
  assert.equal(changed.reusedExistingBytes, false);
  assert.equal(changedProgram.verifiedAt, freshVerifiedAt);
  assert.equal(
    changedProgram.years.find((year) => year.year === 2025)?.verifiedAt,
    freshVerifiedAt,
  );
  assert.ok(
    changedProgram.years
      .filter((year) => year.year !== 2025)
      .every((year) => year.verifiedAt === verifiedAt),
  );

  const newProgramRow = {
    ...officialRow,
    kilavuzKodu: 987654321,
    birimAdi: 'Yazılım Mühendisliği',
  };
  const additionCandidate = buildYokAtlasFixture(
    [officialRow, newProgramRow],
    freshVerifiedAt,
  ).fixture;
  const addition = prepareStableProgramsFixture(additionCandidate, existingBytes);
  const stableProgram = addition.fixture.programs.find((program) => program.id === '123456789')!;
  const newProgram = addition.fixture.programs.find((program) => program.id === '987654321')!;
  assert.equal(stableProgram.verifiedAt, verifiedAt);
  assert.ok(stableProgram.years.every((year) => year.verifiedAt === verifiedAt));
  assert.equal(newProgram.verifiedAt, freshVerifiedAt);
  assert.ok(newProgram.years.every((year) => year.verifiedAt === freshVerifiedAt));
});

test('a repeated import audits provenance separately while leaving fixture bytes untouched', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yks-program-import-stability-'));
  const outputPath = join(directory, 'programs.fixture.json');
  const provenancePath = join(directory, 'programs.provenance.json');
  const detailsOutputPath = join(directory, 'programs-details.fixture.json');
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://yokatlas.yok.gov.tr/tercih-sihirbazi-t4.php') {
      return new Response('<script src="/static/js/main.abc123.js"></script>');
    }
    if (url === 'https://yokatlas.yok.gov.tr/static/js/main.abc123.js') {
      return new Response(MOCK_BUNDLE);
    }
    if (url === 'https://yokatlas.yok.gov.tr/api/netler/search') {
      const request = JSON.parse(String(init?.body)) as { filters: { yil: number } };
      const content = request.filters.yil === 2024 ? [netsRow] : [];
      return Response.json({
        content,
        number: 0,
        numberOfElements: content.length,
        size: 25_000,
        totalElements: content.length,
        totalPages: content.length ? 1 : 0,
        source: 'snapshot',
      });
    }
    if (url === 'https://yokatlas.yok.gov.tr/api/tercih-kilavuz/search') {
      const request = JSON.parse(String(init?.body)) as {
        filters: { puanTuru: 'SAY' | 'EA' | 'SÖZ' | 'DİL' | 'TYT' | null; birimTuruId: number };
      };
      // The özel yetenek sweep posts birimTuruId 48 with a null puanTuru and rides its
      // own snapshot year — mirrors the live API observed 2026-07-16 (empty TABLO 5).
      if (request.filters.birimTuruId === 48) {
        if (request.filters.puanTuru !== null) {
          return new Response('unexpected talent puanTuru', { status: 400 });
        }
        return Response.json({
          content: [],
          number: 0,
          numberOfElements: 0,
          size: 500,
          totalElements: 0,
          totalPages: 0,
          yil: 2026,
          source: 'snapshot',
        });
      }
      // The level selector must ride along with the score type: lisans sweeps post 46,
      // the önlisans (TYT) sweep posts 47. A mismatch is a contract regression.
      const expectedBirimTuruId = request.filters.puanTuru === 'TYT' ? 47 : 46;
      if (request.filters.birimTuruId !== expectedBirimTuruId) {
        return new Response('unexpected birimTuruId', { status: 400 });
      }
      const content =
        request.filters.puanTuru === 'SAY'
          ? [officialRow]
          : request.filters.puanTuru === 'TYT'
            ? [onlisansRow]
            : [];
      return Response.json({
        content,
        number: 0,
        numberOfElements: content.length,
        size: 500,
        totalElements: content.length,
        totalPages: content.length ? 1 : 0,
        yil: 2025,
        source: 'snapshot',
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const commonOptions = {
      outputPath,
      provenancePath,
      detailsOutputPath,
      expectedYear: 2025,
      pageSize: 500,
      requestDelayMs: 0,
      dryRun: false,
      fetchImpl,
    };
    await importYokAtlasPrograms({ ...commonOptions, now: new Date(verifiedAt) });
    const firstFixture = await readFile(outputPath, 'utf8');
    const firstDetails = await readFile(detailsOutputPath, 'utf8');
    const firstProvenance = await readFile(provenancePath, 'utf8');
    const firstStat = await stat(outputPath);
    const firstDetailsStat = await stat(detailsOutputPath);

    const details = JSON.parse(firstDetails) as {
      generatedAt: string;
      conditions: Record<string, string>;
      programs: {
        id: string;
        faculty: string | null;
        tyc: boolean;
        conditionCodes: string[];
        quotaCategories: { category: string; quota: number | null; placed: number | null }[];
        nets: { year: number; scoreType: string; minScore: number | null }[];
      }[];
    };
    // The details fixture mirrors the SAME sweep: staff/kosul/categories plus the nets.
    assert.deepEqual(Object.keys(details.conditions).sort(), ['17', '46']);
    const detailRecord = details.programs.find((program) => program.id === '123456789')!;
    assert.equal(detailRecord.faculty, 'Mühendislik Fakültesi');
    assert.equal(detailRecord.tyc, true);
    assert.deepEqual(detailRecord.conditionCodes, ['17', '46']);
    assert.deepEqual(detailRecord.quotaCategories, [
      { category: 'genel', quota: 80, placed: 78 },
      { category: 'okul-birincisi', quota: 2, placed: 2 },
    ]);
    assert.deepEqual(
      detailRecord.nets.map((net) => ({
        year: net.year,
        scoreType: net.scoreType,
        minScore: net.minScore,
      })),
      [{ year: 2024, scoreType: 'say', minScore: 498.5 }],
    );

    await importYokAtlasPrograms({ ...commonOptions, now: new Date(freshVerifiedAt) });
    const secondFixture = await readFile(outputPath, 'utf8');
    const secondDetails = await readFile(detailsOutputPath, 'utf8');
    const secondProvenance = await readFile(provenancePath, 'utf8');
    const secondStat = await stat(outputPath);
    const secondDetailsStat = await stat(detailsOutputPath);
    const audit = JSON.parse(secondProvenance) as {
      verifiedAt: string;
      source: { talentSnapshotYear: number };
      selection: { levels: { level: string }[] };
      details: { netYears: number[]; statistics: { netRowsAttached: number } };
      result: { fixtureSha256: string; receivedTalentRows: number };
    };

    // The empty talent level is audited, never treated as a failure (allowEmpty).
    assert.equal(audit.result.receivedTalentRows, 0);
    assert.equal(audit.source.talentSnapshotYear, 2026);
    assert.ok(audit.selection.levels.some((level) => level.level === 'ozelyetenek'));
    assert.deepEqual(audit.details.netYears, [2023, 2024, 2025]);
    assert.equal(audit.details.statistics.netRowsAttached, 1);

    assert.equal(secondFixture, firstFixture);
    assert.equal(secondStat.ino, firstStat.ino);
    assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
    // A repeat snapshot reuses the details bytes too (generatedAt alone never rewrites).
    assert.equal(secondDetails, firstDetails);
    assert.equal(secondDetailsStat.mtimeMs, firstDetailsStat.mtimeMs);
    assert.notEqual(secondProvenance, firstProvenance);
    assert.equal(audit.verifiedAt, freshVerifiedAt);
    assert.equal(
      audit.result.fixtureSha256,
      createHash('sha256').update(firstFixture).digest('hex'),
    );
    assert.deepEqual((await readdir(directory)).sort(), [
      'programs-details.fixture.json',
      'programs.fixture.json',
      'programs.provenance.json',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('aborts the whole import when the talent sweep fails after merkezi succeeded', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yks-program-import-talent-abort-'));
  const outputPath = join(directory, 'programs.fixture.json');
  const provenancePath = join(directory, 'programs.provenance.json');
  const detailsOutputPath = join(directory, 'programs-details.fixture.json');
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://yokatlas.yok.gov.tr/tercih-sihirbazi-t4.php') {
      return new Response('<script src="/static/js/main.abc123.js"></script>');
    }
    if (url === 'https://yokatlas.yok.gov.tr/static/js/main.abc123.js') {
      return new Response(MOCK_BUNDLE);
    }
    if (url === 'https://yokatlas.yok.gov.tr/api/tercih-kilavuz/search') {
      const request = JSON.parse(String(init?.body)) as {
        filters: { puanTuru: 'SAY' | 'EA' | 'SÖZ' | 'DİL' | 'TYT' | null; birimTuruId: number };
      };
      // Merkezi sweeps succeed; the talent level fails non-retryably mid-run.
      if (request.filters.birimTuruId === 48) return new Response('gone', { status: 404 });
      const content =
        request.filters.puanTuru === 'SAY'
          ? [officialRow]
          : request.filters.puanTuru === 'TYT'
            ? [onlisansRow]
            : [];
      return Response.json({
        content,
        number: 0,
        numberOfElements: content.length,
        size: 500,
        totalElements: content.length,
        totalPages: content.length ? 1 : 0,
        yil: 2025,
        source: 'snapshot',
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      importYokAtlasPrograms({
        outputPath,
        provenancePath,
        detailsOutputPath,
        expectedYear: 2025,
        pageSize: 500,
        requestDelayMs: 0,
        dryRun: false,
        now: new Date(verifiedAt),
        fetchImpl,
      }),
      /HTTP 404/,
    );
    // Atomicity: no fixture, details, or provenance may exist after the abort.
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
