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
import { buildYokAtlasFixture, normalizeYokAtlasRow } from '../lib/yok-atlas.ts';

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
} as const;

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
      { year: 2025, quota: 80, placed: null, minScore: 501.25, minRank: 12_345 },
      { year: 2024, quota: 80, placed: null, minScore: 498.5, minRank: 13_000 },
      { year: 2023, quota: 70, placed: null, minScore: null, minRank: null },
      { year: 2022, quota: 60, placed: null, minScore: 490, minRank: 15_000 },
    ],
  );
  assert.ok(result.program?.years.every((year) => year.verifiedAt === verifiedAt));
});

test('fails closed for university types that cannot be represented faithfully', () => {
  const result = normalizeYokAtlasRow(
    { ...officialRow, universiteTuru: 'YURTDISI KAMU' },
    verifiedAt,
  );
  assert.equal(result.program, null);
  assert.equal(result.skippedUniversityType, 'YURTDISI KAMU');
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
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://yokatlas.yok.gov.tr/tercih-sihirbazi-t4.php') {
      return new Response('<script src="/static/js/main.abc123.js"></script>');
    }
    if (url === 'https://yokatlas.yok.gov.tr/static/js/main.abc123.js') {
      return new Response(
        'minPuan1 minPuan2 minPuan3 basariSirasi1 basariSirasi2 basariSirasi3 ["gk".concat',
      );
    }
    if (url === 'https://yokatlas.yok.gov.tr/api/tercih-kilavuz/search') {
      const request = JSON.parse(String(init?.body)) as {
        filters: { puanTuru: 'SAY' | 'EA' | 'SÖZ' };
      };
      const content = request.filters.puanTuru === 'SAY' ? [officialRow] : [];
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
      expectedYear: 2025,
      pageSize: 500,
      requestDelayMs: 0,
      dryRun: false,
      fetchImpl,
    };
    await importYokAtlasPrograms({ ...commonOptions, now: new Date(verifiedAt) });
    const firstFixture = await readFile(outputPath, 'utf8');
    const firstProvenance = await readFile(provenancePath, 'utf8');
    const firstStat = await stat(outputPath);

    await importYokAtlasPrograms({ ...commonOptions, now: new Date(freshVerifiedAt) });
    const secondFixture = await readFile(outputPath, 'utf8');
    const secondProvenance = await readFile(provenancePath, 'utf8');
    const secondStat = await stat(outputPath);
    const audit = JSON.parse(secondProvenance) as {
      verifiedAt: string;
      result: { fixtureSha256: string };
    };

    assert.equal(secondFixture, firstFixture);
    assert.equal(secondStat.ino, firstStat.ino);
    assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
    assert.notEqual(secondProvenance, firstProvenance);
    assert.equal(audit.verifiedAt, freshVerifiedAt);
    assert.equal(
      audit.result.fixtureSha256,
      createHash('sha256').update(firstFixture).digest('hex'),
    );
    assert.deepEqual((await readdir(directory)).sort(), [
      'programs.fixture.json',
      'programs.provenance.json',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
