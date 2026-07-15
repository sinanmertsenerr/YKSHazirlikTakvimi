import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTopicGroupStatistics,
  type OgmTopicCandidate,
} from '../build-topic-group-statistics.ts';

const SOURCE_IDS = {
  tyt: 176299,
  'ayt-ea': 176295,
  'ayt-soz': 176296,
  'ayt-say': 176297,
  'tyt-dkab': 176294,
  'ayt-dkab': 176293,
} as const;

function row(sourceGroup: string, subject: string, topic: string, count = 1) {
  const yearCounts = Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [String(2018 + index), count]),
  ) as Record<string, number>;
  return {
    sourceGroup,
    subject,
    topic,
    physicalPage: 12,
    yearCounts,
    total: count * 8,
    rawCells: {
      ...Object.fromEntries(Object.keys(yearCounts).map((year) => [year, String(count)])),
      TOPLAM: String(count * 8),
    },
  };
}

function candidate(extraRows: ReturnType<typeof row>[] = []): OgmTopicCandidate {
  const rows = [
    row('tyt', 'Türkçe', 'Sözcükte Anlam'),
    row('tyt-dkab', 'Din Kültürü ve Ahlak Bilgisi', 'Bilgi ve İnanç'),
    row('ayt-say', 'Matematik', 'Fonksiyonlar'),
    row('ayt-ea', 'Matematik', 'Fonksiyonlar'),
    row('ayt-ea', 'Türk Dili ve Edebiyatı', 'Şiir Bilgisi'),
    row('ayt-soz', 'Türk Dili ve Edebiyatı', 'Şiir Bilgisi'),
    row('ayt-soz', 'Tarih-2', 'İlk Çağ'),
    row('ayt-dkab', 'Din Kültürü ve Ahlak Bilgisi', 'İnanç'),
    ...extraRows,
  ];
  const sources = Object.entries(SOURCE_IDS).map(([key, sourceId]) => ({
    key,
    sourceId,
    titleTr: `${key} resmî kaynak`,
    resolverUrl: `https://ogmmateryal.eba.gov.tr/pdf-goster/${sourceId}`,
    resolvedPdfUrl: `https://ogm-small-cdn.eba.gov.tr/${key}.pdf`,
    bytes: 100,
    sha256: 'a'.repeat(64),
    tableCount: 1,
    verifiedRowCount: rows.filter((item) => item.sourceGroup === key).length,
    failedRowCount: 0,
  }));
  return {
    schemaVersion: 1,
    authority: 'MEB OGM',
    dryRun: true,
    publicationAllowed: false,
    coverage: { firstYear: 2018, lastYear: 2025, includes2026: false },
    summary: { sources: 6, tables: 6, verifiedRows: rows.length, failedRows: 0 },
    sources,
    rows,
    failures: [],
    knownInconsistencies: {
      missingPrinted2025CellRows: 0,
      missingPrintedOtherYearCellRows: 0,
      noteTr: 'Eksik yok.',
    },
  };
}

const options = {
  observedAt: '2026-07-15',
  verifiedAt: '2026-07-15T04:00:00+03:00',
};

test('builds only exact configured broad groups and keeps API test ids absent', () => {
  const document = buildTopicGroupStatistics(candidate(), options);
  assert.equal(document.availability, 'available');
  if (document.availability !== 'available') return;
  assert.equal(document.groups.length, 7);
  assert.ok(document.groups.every((group) => group.evidenceMethod === 'official-pdf-table'));
  assert.ok(document.groups.every((group) => group.apiTestIds === undefined));
  assert.equal(
    document.groups.find((group) => group.sourceKey === 'ayt-soz' && group.sourceLabelTr === 'Şiir Bilgisi')
      ?.countingPolicy,
    'cross-check-only',
  );
  assert.equal(
    document.groups.find((group) => group.sourceKey === 'tyt-dkab')?.countingPolicy,
    'alternative-included',
  );
  assert.equal(
    document.groups.some(
      (group) => group.sourceKey === 'ayt-ea' && group.sourceLabelTr === 'Fonksiyonlar',
    ),
    false,
  );
});

function mantikCikarimRow(counts: Record<string, number>) {
  const base = row('ayt-soz', 'Mantık', 'Çıkarım', 0);
  const yearCounts = { ...base.yearCounts, ...counts };
  const total = Object.values(yearCounts).reduce((sum, count) => sum + count, 0);
  return {
    ...base,
    physicalPage: 215,
    yearCounts,
    total,
    rawCells: {
      ...Object.fromEntries(
        Object.entries(yearCounts).map(([year, count]) => [year, String(count)]),
      ),
      TOPLAM: String(total),
    },
  };
}

test('disambiguates the duplicate official Mantık label only via the pinned unit fingerprint', () => {
  const document = buildTopicGroupStatistics(
    candidate([mantikCikarimRow({ '2024': 1 }), mantikCikarimRow({})]),
    options,
  );
  const labels = document.groups
    .filter((group) => group.sourceLabelTr.startsWith('Çıkarım'))
    .map((group) => group.sourceLabelTr)
    .sort();
  assert.deepEqual(labels, ['Çıkarım (Klasik Mantık)', 'Çıkarım (Sembolik Mantık)']);

  assert.throws(
    () => buildTopicGroupStatistics(candidate([mantikCikarimRow({ '2023': 1 })]), options),
    /disambiguation fingerprint mismatch/,
  );
});

test('fails closed when even one PDF table row is unresolved', () => {
  const input = candidate();
  input.failures.push({
    sourceGroup: 'tyt',
    physicalPage: 12,
    tableIndex: 0,
    rowIndex: 0,
    reason: 'missing printed cell',
  });
  input.summary.failedRows = 1;
  input.sources[0]!.failedRowCount = 1;
  assert.throws(() => buildTopicGroupStatistics(input, options), /unresolved PDF row failure/);
});

test('rejects fuzzy subject mapping and disagreeing duplicate sources', () => {
  const unknown = candidate();
  unknown.rows[0]!.subject = 'Türkçe benzeri';
  assert.throws(() => buildTopicGroupStatistics(unknown, options), /No exact source\/subject mapping/);

  const mismatch = candidate();
  mismatch.rows.find(
    (item) => item.sourceGroup === 'ayt-soz' && item.subject === 'Türk Dili ve Edebiyatı',
  )!.yearCounts['2025'] = 2;
  mismatch.rows.find(
    (item) => item.sourceGroup === 'ayt-soz' && item.subject === 'Türk Dili ve Edebiyatı',
  )!.total = 9;
  assert.throws(() => buildTopicGroupStatistics(mismatch, options), /not an exact match/);
});
