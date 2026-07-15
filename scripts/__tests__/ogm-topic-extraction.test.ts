import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractOgmQuestionEvidence,
  extractOgmTopicDistributionRows,
  inspectOgmTopicDistributionRows,
  parsePdftotextBboxLayout,
} from '../lib/ogm-topic-extraction.ts';

type Word = { text: string; x: number; y: number; width?: number };

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function page(wordsByLine: Word[][], width = 1100, height = 800): string {
  return `<page width="${width}" height="${height}"><flow><block>${wordsByLine
    .map(
      (words) =>
        `<line>${words
          .map(
            (word) =>
              `<word xMin="${word.x}" yMin="${word.y}" xMax="${word.x + (word.width ?? Math.max(7, word.text.length * 5))}" yMax="${word.y + 10}">${escapeXml(word.text)}</word>`,
          )
          .join('')}</line>`,
    )
    .join('')}</block></flow></page>`;
}

function clockwiseEncodedPage(wordsByLine: Word[][], width = 1100, height = 800): string {
  return `<page width="${height}" height="${width}"><flow><block>${wordsByLine
    .map(
      (words) =>
        `<line>${words
          .map((word) => {
            const wordWidth = word.width ?? Math.max(7, word.text.length * 5);
            return `<word xMin="${word.y}" yMin="${width - word.x - wordWidth}" xMax="${word.y + 10}" yMax="${width - word.x}">${escapeXml(word.text)}</word>`;
          })
          .join('')}</line>`,
    )
    .join('')}</block></flow></page>`;
}

function document(...pages: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><html><body><doc>${pages.join('')}</doc></body></html>`;
}

const labels = ['2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', 'TOPLAM'];

function table({
  startX = 250,
  heading = ['TYT TÜRK DİLİ VE', 'EDEBİYATI SORU DAĞILIMI'],
  topic = ['Sözcükte', 'Anlam'],
  cells = ['1', '-', '0', '2', '1', '-', '1', '0', '5'],
}: {
  startX?: number;
  heading?: string[];
  topic?: string[];
  cells?: string[];
} = {}): Word[][] {
  return [
    ...heading.map((text, index) => [{ text, x: startX - 190, y: 15 + index * 13, width: 170 }]),
    labels.map((text, index) => ({ text, x: startX + index * 30, y: 55, width: 20 })),
    [{ text: topic[0]!, x: startX - 190, y: 89, width: 65 }],
    [
      { text: topic[1]!, x: startX - 190, y: 102, width: 55 },
      ...cells.map((text, index) => ({ text, x: startX + index * 30 + 5, y: 97, width: 8 })),
    ],
  ];
}

test('bbox parser rejects raw text, DTDs, and words without coordinates', () => {
  assert.throws(() => parsePdftotextBboxLayout('2018 2019 2020'), /not pdftotext bbox XHTML/);
  assert.throws(() => parsePdftotextBboxLayout('<!DOCTYPE doc><doc/>'), /DTD\/entity declarations/);
  assert.throws(
    () => parsePdftotextBboxLayout(document('<page width="10" height="10"><word>x</word></page>')),
    /finite xmin/,
  );
});

test('bbox parser accepts only the exact non-entity doctype emitted by Poppler', () => {
  const canonical =
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';
  assert.equal(
    parsePdftotextBboxLayout(`${canonical}${document(page([[{ text: 'x', x: 1, y: 1 }]]))}`).pages
      .length,
    1,
  );
  assert.throws(
    () =>
      parsePdftotextBboxLayout(
        `<!DOCTYPE html SYSTEM "https://evil.example/evil.dtd">${document(page([[{ text: 'x', x: 1, y: 1 }]]))}`,
      ),
    /DTD\/entity declarations/,
  );
});

test('bbox parser preserves an intentionally blank physical PDF page', () => {
  const blank = '<page width="1100" height="800"><flow></flow></page>';
  const parsed = parsePdftotextBboxLayout(document(blank, page([[{ text: 'x', x: 1, y: 1 }]])));
  assert.deepEqual(
    parsed.pages.map(({ page: physicalPage, words }) => ({ physicalPage, words: words.length })),
    [
      { physicalPage: 1, words: 0 },
      { physicalPage: 2, words: 1 },
    ],
  );
});

test('bbox parser ignores Poppler whitespace-only word placeholders', () => {
  const whitespaceWord =
    '<page width="1100" height="800"><flow><block><line><word xMin="1" yMin="1" xMax="10" yMax="10">\t </word></line></block></flow></page>';
  assert.equal(parsePdftotextBboxLayout(document(whitespaceWord)).pages[0]!.words.length, 0);
});

test('bbox parser clamps bounded Poppler bleed but rejects coordinates far outside the page', () => {
  const bounded =
    '<page width="100" height="100"><flow><block><line><word xMin="1" yMin="-4" xMax="20" yMax="8">x</word></line></block></flow></page>';
  assert.equal(parsePdftotextBboxLayout(document(bounded)).pages[0]!.words[0]!.yMin, 0);
  const excessive = bounded.replace('yMin="-4"', 'yMin="-20"');
  assert.throws(() => parsePdftotextBboxLayout(document(excessive)), /invalid bbox word/);
});

test('extracts exact year columns, multiline Turkish topic, dash and literal zero', () => {
  const rows = extractOgmTopicDistributionRows(document(page(table())), {
    sourceGroup: 'ogm-tyt-edebiyat-2025',
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    sourceGroup: 'ogm-tyt-edebiyat-2025',
    subject: 'TURK DILI VE EDEBIYATI',
    topic: 'Sözcükte Anlam',
    physicalPage: 1,
    yearCounts: { 2018: 1, 2019: 0, 2020: 0, 2021: 2, 2022: 1, 2023: 0, 2024: 1, 2025: 0 },
    total: 5,
    rawCells: {
      2018: '1',
      2019: '-',
      2020: '0',
      2021: '2',
      2022: '1',
      2023: '-',
      2024: '1',
      2025: '0',
      TOPLAM: '5',
    },
  });
});

test('extracts a distribution table from the clockwise-encoded geometry used by real OGM PDFs', () => {
  const rows = extractOgmTopicDistributionRows(document(clockwiseEncodedPage(table())), {
    sourceGroup: 'ogm-rotated',
    subjectByTable: ['Türkçe'],
  });
  assert.deepEqual(
    rows.map(({ topic, total }) => ({ topic, total })),
    [{ topic: 'Sözcükte Anlam', total: 5 }],
  );
});

test('detects a real-style header whose TOPLAM baseline is offset from the year labels', () => {
  const fixture = table();
  fixture[2]!.at(-1)!.y += 10;
  assert.equal(
    extractOgmTopicDistributionRows(document(page(fixture)), {
      sourceGroup: 'ogm-offset-header',
      subjectByTable: ['Türkçe'],
    }).length,
    1,
  );
});

test('keeps two side-by-side tables isolated and tolerates bounded column drift', () => {
  const left = table({ heading: ['TYT TÜRKÇE SORU DAĞILIMI'], topic: ['Paragraf', 'Yorum'] });
  const right = table({
    startX: 760,
    heading: ['AYT MATEMATİK SORU DAĞILIMI'],
    topic: ['Trigonometri', 'Denklemleri'],
    cells: ['0', '1', '1', '0', '1', '1', '0', '1', '5'],
  });
  const combined = [...left, ...right].reduce<Word[][]>((lines, line) => {
    const existing = lines.find((candidate) => candidate[0]?.y === line[0]?.y);
    if (existing) existing.push(...line);
    else lines.push([...line]);
    return lines;
  }, []);
  // A small x drift must still bind to its intended coordinate-derived column.
  combined.flat().find((word) => word.text === 'TOPLAM')!.x += 2;
  const rows = extractOgmTopicDistributionRows(document(page(combined)), {
    sourceGroup: 'ogm-two-column',
    subjectByTable: ['Türkçe', 'Matematik'],
  });
  assert.deepEqual(
    rows.map(({ subject, topic, total }) => ({ subject, topic, total })),
    [
      { subject: 'Türkçe', topic: 'Paragraf Yorum', total: 5 },
      { subject: 'Matematik', topic: 'Trigonometri Denklemleri', total: 5 },
    ],
  );
});

test('fails closed for a missing year cell instead of shifting later columns', () => {
  const malformed = table({ cells: ['1', '0', '0', '2', '1', '1', '0', '5'] });
  assert.throws(
    () =>
      extractOgmTopicDistributionRows(document(page(malformed)), {
        sourceGroup: 'ogm-malformed',
        subjectByTable: ['Türkçe'],
      }),
    /missing distribution cell/,
  );
});

test('known inconsistent philosophy total is rejected', () => {
  const philosophy = table({
    heading: ['TYT FELSEFE SORU DAĞILIMI'],
    topic: ['Bilgi', 'Felsefesi'],
    cells: ['1', '1', '1', '1', '1', '1', '1', '0', '8'],
  });
  assert.throws(
    () =>
      extractOgmTopicDistributionRows(document(page(philosophy)), {
        sourceGroup: 'ogm-known-inconsistent-philosophy',
      }),
    /year sum 7 does not equal TOPLAM 8/,
  );
});

test('inspection reports an invalid row without publishing it', () => {
  const missing2025 = table({ cells: ['1', '0', '0', '2', '1', '1', '0', '-', '5'] });
  missing2025.at(-1)!.splice(-2, 1);
  const report = inspectOgmTopicDistributionRows(document(page(missing2025)), {
    sourceGroup: 'ogm-row-report',
    subjectByTable: ['Türkçe'],
  });
  assert.equal(report.rows.length, 0);
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0]!.reason, /missing distribution cell/);
});

test('question evidence is ID-only and permits local numbering resets per subject', () => {
  const turkish = page([
    [{ text: 'TÜRKÇE', x: 40, y: 20 }],
    [{ text: '2019 TYT', x: 40, y: 35 }],
    [
      { text: '1.', x: 40, y: 80 },
      { text: 'question text never leaves parser', x: 60, y: 80 },
    ],
  ]);
  const maths = page([
    [{ text: 'MATEMATİK', x: 40, y: 20 }],
    [{ text: '2019 TYT', x: 40, y: 35 }],
    [
      { text: '1.', x: 40, y: 80 },
      { text: 'another secret stem', x: 60, y: 80 },
    ],
  ]);
  const evidence = extractOgmQuestionEvidence(document(turkish, maths), {
    sourceGroup: 'ogm-question-book',
    subjects: ['Türkçe', 'Matematik'],
    firstPhysicalPage: 12,
  });
  assert.deepEqual(evidence, [
    {
      sourceGroup: 'ogm-question-book',
      subject: 'Türkçe',
      localQuestionNumber: 1,
      physicalPage: 12,
      year: 2019,
      session: 'TYT',
      yearSessionLabel: '2019 TYT',
    },
    {
      sourceGroup: 'ogm-question-book',
      subject: 'Matematik',
      localQuestionNumber: 1,
      physicalPage: 13,
      year: 2019,
      session: 'TYT',
      yearSessionLabel: '2019 TYT',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(evidence), /question text|secret stem/);
});

test('question evidence rejects ambiguous page context', () => {
  const ambiguous = page([
    [{ text: 'TÜRKÇE', x: 40, y: 20 }],
    [{ text: '2019 TYT', x: 40, y: 35 }],
    [{ text: '2020 TYT', x: 500, y: 35 }],
    [{ text: '1.', x: 40, y: 80 }],
  ]);
  assert.throws(
    () =>
      extractOgmQuestionEvidence(document(ambiguous), {
        sourceGroup: 'ogm-question-book',
        subjects: ['Türkçe'],
      }),
    /question context is ambiguous/,
  );
});

test('question evidence rejects a year outside the pinned source coverage', () => {
  const future = page([
    [{ text: 'TÜRKÇE', x: 40, y: 20 }],
    [{ text: '2026 TYT', x: 40, y: 35 }],
    [{ text: '1.', x: 40, y: 80 }],
  ]);
  assert.throws(
    () =>
      extractOgmQuestionEvidence(document(future), {
        sourceGroup: 'ogm-question-book',
        subjects: ['Türkçe'],
      }),
    /outside the pinned 2018-2025 coverage/,
  );
});

test('recognizes a SORU TİPİ header column and keeps page numbers out of topic labels', () => {
  const rows = [
    [{ text: 'KONU BAZLI SORU DAĞILIM TABLOSU', x: 60, y: 15, width: 300 }],
    [
      { text: 'SAYFA', x: 10, y: 48, width: 40 },
      { text: 'SORU', x: 120, y: 48, width: 30 },
      { text: 'NO', x: 10, y: 60, width: 20 },
      { text: 'TİPİ', x: 122, y: 60, width: 26 },
    ],
    labels.map((text, index) => ({ text, x: 250 + index * 30, y: 55, width: 20 })),
    [
      { text: '11', x: 10, y: 97, width: 14 },
      { text: 'VOCABULARY', x: 60, y: 97, width: 100 },
      ...['5', '5', '5', '5', '5', '5', '5', '5', '40'].map((text, index) => ({
        text,
        x: 250 + index * 30 + 5,
        y: 97,
        width: 8,
      })),
    ],
  ];
  const parsed = parsePdftotextBboxLayout(document(page(rows)));
  const report = inspectOgmTopicDistributionRows(parsed, {
    sourceGroup: 'ydt',
    subjectByTable: ['İngilizce'],
  });
  assert.equal(report.failures.length, 0);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0]!.topic, 'VOCABULARY');
  assert.equal(report.rows[0]!.subject, 'İngilizce');
  assert.equal(report.rows[0]!.total, 40);
});
