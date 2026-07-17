import assert from 'node:assert/strict';
import test from 'node:test';

import ExcelJS from 'exceljs';

import {
  mergeArchiveYears,
  osymArchiveFixtureSchema,
  parseOsymWorksheet,
  type OsymArchiveFixture,
} from '../lib/osym-archive.ts';
import type { ProgramsFixture } from '../lib/content-schemas.ts';

const generatedAt = '2026-07-17T01:00:00.000Z';

function makeWizardProgram(
  overrides: Partial<ProgramsFixture['programs'][number]> & { id: string },
): ProgramsFixture['programs'][number] {
  return {
    university: { tr: 'EGE ÜNİVERSİTESİ (İZMİR)', en: 'EGE ÜNİVERSİTESİ (İZMİR)' },
    name: { tr: 'Bilgisayar Mühendisliği (İngilizce)', en: 'Bilgisayar Mühendisliği (İngilizce)' },
    city: { tr: 'İZMİR', en: 'İZMİR' },
    type: 'devlet',
    scoreType: 'say',
    scholarship: null,
    language: null,
    verified: true,
    verifiedAt: generatedAt,
    approximate: false,
    sample: false,
    source: 'https://yokatlas.yok.gov.tr/detay/103490617',
    years: [
      {
        year: 2025,
        quota: 120,
        placed: null,
        minScore: 469.88576,
        minRank: 29487,
        verified: true,
        verifiedAt: generatedAt,
        source: 'https://yokatlas.yok.gov.tr/detay/103490617',
        approximate: false,
        sample: false,
      },
    ],
    ...overrides,
  };
}

function makeArchive(records: OsymArchiveFixture['records']): OsymArchiveFixture {
  const yearLevels = new Set(records.map((record) => `${record.year}|${record.level}`));
  return osymArchiveFixtureSchema.parse({
    schemaVersion: 1,
    authority: 'Ölçme, Seçme ve Yerleştirme Merkezi (ÖSYM)',
    generatedAt,
    note: 'test',
    sources: [...yearLevels].map((yearLevel) => {
      const [year, level] = yearLevel.split('|');
      return {
        year: Number(year),
        level,
        url: `https://dokuman.osym.gov.tr/pdfdokuman/${year}/YKS/YER/test-${level}.xlsx`,
        sha256: 'a'.repeat(64),
        bytes: 1,
        rows: records.filter((record) => `${record.year}|${record.level}` === yearLevel).length,
        skippedRows: {},
      };
    }),
    records,
  });
}

const egeArchiveRecord = {
  year: 2023,
  level: 'lisans',
  code: '103490470',
  scoreType: 'say',
  quota: 100,
  placed: 100,
  minScore: 512.12592,
  university: 'EGE ÜNİVERSİTESİ (İZMİR)',
  name: 'Bilgisayar Mühendisliği (İngilizce)',
} as const;

test('parses the 2018-2020 flat schema with compound program names', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('t4');
  sheet.addRow(['2018 YKS Yerleştirme Sonuçları']);
  sheet.addRow([
    'Program Kodu',
    'Program Adı',
    'Puan Türü',
    'Genel Kontenjan',
    'Genel Yerleşen',
    'En Küçük Puan',
    'En Büyük Puan',
    'OB Kont.',
  ]);
  sheet.addRow([
    '106510014',
    'ABDULLAH GÜL ÜNİVERSİTESİ (KAYSERİ)/Mimarlık Fakültesi/Mimarlık (İngilizce)',
    'SAY',
    '50',
    '50',
    418.77754,
    468.51633,
    '2',
  ]);
  sheet.addRow([]);
  sheet.addRow(['999999999', 'X ÜNİVERSİTESİ/Konservatuvar/Piyano', 'Özel Yetenek', '', '', '', '', '']);

  const parsed = parseOsymWorksheet(sheet);
  assert.equal(parsed.records.length, 1);
  assert.deepEqual(parsed.records[0], {
    code: '106510014',
    scoreType: 'say',
    quota: 50,
    placed: 50,
    minScore: 418.77754,
    university: 'ABDULLAH GÜL ÜNİVERSİTESİ (KAYSERİ)',
    name: 'Mimarlık (İngilizce)',
  });
  assert.equal(parsed.skippedRows['unsupported-score-type:Özel Yetenek'], 1);
});

test('parses the 2021-2022 split-column schema', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('t4');
  sheet.addRow([
    'Program Kodu',
    'Üniversite Türü',
    'Üniversite Adı',
    'Fakülte/Yüksekokul Adı',
    'Program Adı',
    'Puan Türü',
    'Genel Kont.',
    'Yerleşen',
    'En Küçük Puan',
    'En Büyük Puan',
  ]);
  sheet.addRow([
    '203110477',
    'VAKIF',
    'İSTANBUL MEDİPOL ÜNİVERSİTESİ',
    'Tıp Fakültesi',
    'Tıp (İngilizce) (Burslu)',
    'SAY',
    17,
    17,
    549.17594,
    562.94526,
  ]);

  const parsed = parseOsymWorksheet(sheet);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0]?.university, 'İSTANBUL MEDİPOL ÜNİVERSİTESİ');
  assert.equal(parsed.records[0]?.name, 'Tıp (İngilizce) (Burslu)');
  assert.equal(parsed.records[0]?.quota, 17);
});

test('parses the 2023-2024 merged five-tier header, reading only the Genel group', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('t4');
  sheet.addRow(['Program Kodu', 'Üniversite Adı', 'Program Adı', 'Puan Türü']);
  sheet.addRow([]);
  sheet.mergeCells('A1:A2');
  sheet.mergeCells('B1:B2');
  sheet.mergeCells('C1:C2');
  sheet.mergeCells('D1:D2');
  sheet.getCell('E1').value = 'Genel Yerleştirme';
  sheet.mergeCells('E1:G1');
  sheet.getCell('H1').value = 'Okul Birincisi Yerleştirme';
  sheet.mergeCells('H1:J1');
  sheet.getRow(2).getCell(5).value = 'Kontenjan';
  sheet.getRow(2).getCell(6).value = 'Yerleşen';
  sheet.getRow(2).getCell(7).value = 'En Küçük Puan';
  sheet.getRow(2).getCell(8).value = 'Kontenjan';
  sheet.getRow(2).getCell(9).value = 'Yerleşen';
  sheet.getRow(2).getCell(10).value = 'En Küçük Puan';
  sheet.addRow([
    '108470124',
    'ORTA DOĞU TEKNİK ÜNİVERSİTESİ (ANKARA)',
    'Beden Eğitimi ve Spor Öğretmenliği (İngilizce)',
    'EA',
    25,
    26,
    356.07528,
    1,
    1,
    401.5,
  ]);

  const parsed = parseOsymWorksheet(sheet);
  assert.equal(parsed.records.length, 1);
  // Genel tier only: the Okul Birincisi columns (H-J) must never leak into the record.
  assert.deepEqual(parsed.records[0], {
    code: '108470124',
    scoreType: 'ea',
    quota: 25,
    placed: 26,
    minScore: 356.07528,
    university: 'ORTA DOĞU TEKNİK ÜNİVERSİTESİ (ANKARA)',
    name: 'Beden Eğitimi ve Spor Öğretmenliği (İngilizce)',
  });
});

test('merges archive years by code, keeping wizard years authoritative', () => {
  const program = makeWizardProgram({
    id: '203110477',
    university: { tr: 'İSTANBUL MEDİPOL ÜNİVERSİTESİ', en: 'İSTANBUL MEDİPOL ÜNİVERSİTESİ' },
    name: { tr: 'Tıp (İngilizce) (Burslu)', en: 'Tıp (İngilizce) (Burslu)' },
  });
  const archive = makeArchive([
    { ...egeArchiveRecord, code: '203110477', year: 2018, university: 'İSTANBUL MEDİPOL ÜNİVERSİTESİ', name: 'Tıp (İngilizce) (Burslu)', quota: 17, placed: 17, minScore: 549.17594 },
    // Wizard already carries 2025 — the archive row for it must be ignored.
    { ...egeArchiveRecord, code: '203110477', year: 2023, university: 'İSTANBUL MEDİPOL ÜNİVERSİTESİ', name: 'Tıp (İngilizce) (Burslu)' },
  ]);
  const { programs, stats } = mergeArchiveYears([program], archive);
  const years = programs[0]!.years.map((year) => year.year);
  assert.deepEqual(years, [2025, 2023, 2018]);
  assert.equal(stats.matchedByCode, 2);
  assert.equal(stats.yearsAttached, 2);
  const attached = programs[0]!.years.find((year) => year.year === 2018)!;
  assert.equal(attached.minRank, null);
  assert.equal(attached.placed, 17);
  assert.match(attached.source!, /^https:\/\/dokuman\.osym\.gov\.tr\//);
});

test('heals re-issued program codes through the unique name-key fallback (Ege case)', () => {
  const program = makeWizardProgram({ id: '103490617' });
  const archive = makeArchive([egeArchiveRecord]);
  const { programs, stats } = mergeArchiveYears([program], archive);
  assert.deepEqual(
    programs[0]!.years.map((year) => year.year),
    [2025, 2023],
  );
  assert.equal(stats.matchedByNameKey, 1);
  assert.equal(programs[0]!.years.find((year) => year.year === 2023)!.minScore, 512.12592);
});

test('never guesses when a name key maps to two different codes in one year', () => {
  const program = makeWizardProgram({ id: '103490617' });
  const archive = makeArchive([
    egeArchiveRecord,
    { ...egeArchiveRecord, code: '103490999' },
  ]);
  const { programs, stats } = mergeArchiveYears([program], archive);
  assert.deepEqual(
    programs[0]!.years.map((year) => year.year),
    [2025],
  );
  assert.equal(stats.ambiguousNameKeys, 1);
  assert.equal(stats.unmatchedRecords, 2);
});

test('drops archive rows for programs that no longer exist and counts them honestly', () => {
  const program = makeWizardProgram({ id: '103490617' });
  const archive = makeArchive([
    egeArchiveRecord,
    { ...egeArchiveRecord, code: '111111111', year: 2019, university: 'KAPANMIŞ ÜNİVERSİTE', name: 'Kapanmış Program' },
  ]);
  const { stats } = mergeArchiveYears([program], archive);
  assert.equal(stats.unmatchedRecords, 1);
  assert.equal(stats.yearsAttached, 1);
});

test('fills null kontenjan/yerleşen on wizard-owned years without touching scores', () => {
  const program = makeWizardProgram({ id: '103490470' });
  program.years = [
    {
      ...program.years[0]!,
      year: 2023,
      quota: null,
      placed: null,
      minScore: 512.12592,
      minRank: 13000,
    },
  ];
  const archive = makeArchive([egeArchiveRecord]);
  const { programs, stats } = mergeArchiveYears([program], archive);
  const year = programs[0]!.years[0]!;
  assert.equal(year.quota, 100);
  assert.equal(year.placed, 100);
  assert.equal(year.minScore, 512.12592); // wizard score/rank stay authoritative
  assert.equal(year.minRank, 13000);
  assert.equal(stats.yearsFieldFilled, 1);
  assert.equal(stats.yearsAttached, 0);
});

test('keeps official placed counts even when they exceed the genel kontenjan', () => {
  const program = makeWizardProgram({ id: '103490617', years: [] as never });
  const fixed = { ...program, years: [] };
  const archive = makeArchive([{ ...egeArchiveRecord, quota: 25, placed: 26 }]);
  const { programs, stats } = mergeArchiveYears([fixed], archive);
  const year = programs[0]!.years[0]!;
  assert.equal(year.quota, 25);
  assert.equal(year.placed, 26);
  assert.equal(stats.placedOverQuotaYears, 1);
});
