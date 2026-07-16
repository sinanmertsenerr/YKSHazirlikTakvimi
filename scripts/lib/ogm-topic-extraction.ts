/**
 * Fail-closed extraction helpers for OGM topic books produced with
 * `pdftotext -bbox-layout`. Results deliberately contain no question text or
 * images: only distribution cells and question identifiers/provenance leave
 * this module.
 */

export const OGM_DISTRIBUTION_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;
export type OgmDistributionYear = (typeof OGM_DISTRIBUTION_YEARS)[number];

export type BboxWord = {
  page: number;
  pageWidth: number;
  pageHeight: number;
  lineId: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  text: string;
};

export type BboxPage = {
  page: number;
  width: number;
  height: number;
  words: BboxWord[];
};

export type BboxDocument = { pages: BboxPage[] };

export type OgmTopicDistributionRow = {
  sourceGroup: string;
  subject: string;
  topic: string;
  physicalPage: number;
  yearCounts: Record<OgmDistributionYear, number>;
  total: number;
  rawCells: Record<string, string>;
};

export type OgmTopicDistributionFailure = {
  sourceGroup: string;
  physicalPage: number;
  tableIndex: number;
  rowIndex: number;
  reason: string;
  subject?: string;
  topic?: string;
  explicitYearCounts?: Partial<Record<OgmDistributionYear, number>>;
  missingYears?: OgmDistributionYear[];
  rowTotal?: number;
};

export type OgmTopicDistributionReport = {
  tableCount: number;
  rows: OgmTopicDistributionRow[];
  failures: OgmTopicDistributionFailure[];
};

export type OgmQuestionEvidence = {
  sourceGroup: string;
  subject: string;
  localQuestionNumber: number;
  physicalPage: number;
  year: number;
  session: 'TYT' | 'AYT' | 'YDT';
  yearSessionLabel: string;
};

type VisualLine = { y: number; words: BboxWord[]; text: string };

function fail(message: string): never {
  throw new Error(`OGM extraction failed closed: ${message}`);
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_, entity: string) => {
    if (entity === 'amp') return '&';
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    const point = entity.toLowerCase().startsWith('#x')
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    if (!Number.isSafeInteger(point) || point <= 0 || point > 0x10ffff) fail('invalid XML entity');
    return String.fromCodePoint(point);
  });
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  const body = tag.replace(/^<\/?\s*[\w:-]+/u, '').replace(/\/?>$/u, '');
  const matcher = /([\w:-]+)\s*=\s*(["'])(.*?)\2/gsu;
  for (const match of body.matchAll(matcher)) {
    const name = match[1]!.toLowerCase();
    if (name in result) fail(`duplicate XML attribute ${name}`);
    result[name] = decodeXml(match[3]!);
  }
  return result;
}

function finiteCoordinate(attrs: Record<string, string>, name: string): number {
  const value = Number(attrs[name.toLowerCase()]);
  if (!Number.isFinite(value)) fail(`word/page is missing finite ${name}`);
  return value;
}

/** Parses Poppler bbox XHTML. Raw/layout text without word coordinates is rejected. */
export function parsePdftotextBboxLayout(
  xhtml: string,
  options: { firstPhysicalPage?: number } = {},
): BboxDocument {
  if (!xhtml.trim() || xhtml.length > 100 * 1024 * 1024) fail('unsafe XHTML input size');
  if (/<!\s*ENTITY\b/iu.test(xhtml)) fail('DTD/entity declarations are forbidden');
  const popplerDoctype =
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';
  const doctypes = xhtml.match(/<!\s*DOCTYPE\b[^>]*>/giu) ?? [];
  if (doctypes.some((doctype) => doctype !== popplerDoctype) || doctypes.length > 1) {
    fail('DTD/entity declarations are forbidden');
  }
  if (doctypes.length === 1 && xhtml.trimStart().startsWith(popplerDoctype) === false) {
    fail('DTD/entity declarations are forbidden');
  }
  const firstPage = options.firstPhysicalPage ?? 1;
  if (!Number.isInteger(firstPage) || firstPage < 1) fail('invalid first physical page');

  const pages: BboxPage[] = [];
  let currentPage: BboxPage | undefined;
  let currentLine = 0;
  let wordAttrs: Record<string, string> | undefined;
  let wordText = '';
  const tokens = xhtml.match(/<[^>]+>|[^<]+/gsu) ?? [];

  for (const token of tokens) {
    if (!token.startsWith('<')) {
      if (wordAttrs) wordText += token;
      continue;
    }
    if (/^<\?|^<!--|^<\/\s*(?:html|body|doc|flow|block)\b/iu.test(token)) continue;
    const close = /^<\/\s*([\w:-]+)/u.exec(token)?.[1]?.split(':').at(-1)?.toLowerCase();
    const open = /^<\s*([\w:-]+)/u.exec(token)?.[1]?.split(':').at(-1)?.toLowerCase();
    if (close === 'word') {
      if (!currentPage || !wordAttrs) fail('orphan closing word tag');
      let xMin = finiteCoordinate(wordAttrs, 'xmin');
      let yMin = finiteCoordinate(wordAttrs, 'ymin');
      let xMax = finiteCoordinate(wordAttrs, 'xmax');
      let yMax = finiteCoordinate(wordAttrs, 'ymax');
      const text = decodeXml(wordText).trim();
      const bleedLimit = Math.min(32, Math.min(currentPage.width, currentPage.height) * 0.05);
      if (
        xMin < -bleedLimit ||
        yMin < -bleedLimit ||
        xMax > currentPage.width + bleedLimit ||
        yMax > currentPage.height + bleedLimit ||
        xMax <= 0 ||
        yMax <= 0 ||
        xMin >= currentPage.width ||
        yMin >= currentPage.height ||
        xMax <= xMin ||
        yMax <= yMin
      ) {
        fail(
          `invalid bbox word on physical page ${currentPage.page}: ${JSON.stringify({ text, xMin, yMin, xMax, yMax })}`,
        );
      }
      xMin = Math.max(0, xMin);
      yMin = Math.max(0, yMin);
      xMax = Math.min(currentPage.width, xMax);
      yMax = Math.min(currentPage.height, yMax);
      if (!text) {
        wordAttrs = undefined;
        wordText = '';
        continue;
      }
      currentPage.words.push({
        page: currentPage.page,
        pageWidth: currentPage.width,
        pageHeight: currentPage.height,
        lineId: currentLine,
        xMin,
        yMin,
        xMax,
        yMax,
        text,
      });
      wordAttrs = undefined;
      wordText = '';
      continue;
    }
    if (close === 'page') {
      if (!currentPage) fail('orphan closing page tag');
      pages.push(currentPage);
      currentPage = undefined;
      continue;
    }
    if (!open || token.startsWith('</') || token.endsWith('/>')) continue;
    if (open === 'page') {
      if (currentPage) fail('nested page tags');
      const attrs = attributes(token);
      const width = finiteCoordinate(attrs, 'width');
      const height = finiteCoordinate(attrs, 'height');
      if (width <= 0 || height <= 0) fail('invalid page dimensions');
      currentPage = { page: firstPage + pages.length, width, height, words: [] };
    } else if (open === 'line') {
      if (!currentPage) fail('line outside page');
      currentLine += 1;
    } else if (open === 'word') {
      if (!currentPage || wordAttrs) fail('nested/orphan word tag');
      wordAttrs = attributes(token);
      wordText = '';
    }
  }
  if (currentPage || wordAttrs) fail('unclosed bbox markup');
  if (!pages.length) fail('input is not pdftotext bbox XHTML');
  return { pages };
}

function normalize(value: string): string {
  return value
    .toLocaleUpperCase('tr-TR')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function joinWords(words: BboxWord[]): string {
  return words
    .sort((a, b) => a.xMin - b.xMin)
    .map((word) => word.text)
    .join(' ')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .trim();
}

function visualLines(words: BboxWord[]): VisualLine[] {
  const sorted = [...words].sort((a, b) => (a.yMin + a.yMax) / 2 - (b.yMin + b.yMax) / 2);
  const medianHeight =
    sorted.map((w) => w.yMax - w.yMin).sort((a, b) => a - b)[Math.floor(sorted.length / 2)] ?? 8;
  const tolerance = Math.max(1.5, medianHeight * 0.48);
  const lines: { y: number; words: BboxWord[] }[] = [];
  for (const word of sorted) {
    const y = (word.yMin + word.yMax) / 2;
    const line = lines.at(-1);
    if (!line || Math.abs(y - line.y) > tolerance) lines.push({ y, words: [word] });
    else {
      line.words.push(word);
      line.y =
        line.words.reduce((sum, item) => sum + (item.yMin + item.yMax) / 2, 0) / line.words.length;
    }
  }
  return lines.map((line) => ({ ...line, text: joinWords(line.words) }));
}

const HEADER_LABELS = [...OGM_DISTRIBUTION_YEARS.map(String), 'TOPLAM'];
type Header = { page: BboxPage; y: number; words: BboxWord[]; centers: number[]; step: number };

function rotatePageClockwise(page: BboxPage): BboxPage {
  return {
    page: page.page,
    width: page.height,
    height: page.width,
    words: page.words.map((word) => ({
      ...word,
      pageWidth: page.height,
      pageHeight: page.width,
      xMin: page.height - word.yMax,
      yMin: word.xMin,
      xMax: page.height - word.yMin,
      yMax: word.xMax,
    })),
  };
}

function headersOnPage(page: BboxPage): Header[] {
  const headers: Header[] = [];
  for (const line of visualLines(page.words)) {
    const ordered = [...line.words].sort((a, b) => a.xMin - b.xMin);
    for (let start = 0; start <= ordered.length - HEADER_LABELS.length; start += 1) {
      const slice = ordered.slice(start, start + HEADER_LABELS.length);
      if (!slice.every((word, index) => normalize(word.text) === HEADER_LABELS[index])) continue;
      const centers = slice.map((word) => (word.xMin + word.xMax) / 2);
      const gaps = centers.slice(1).map((center, index) => center - centers[index]!);
      const step = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!;
      if (step <= 0 || gaps.some((gap) => gap < step * 0.55 || gap > step * 1.55)) {
        fail(`ambiguous year-column drift on physical page ${page.page}`);
      }
      headers.push({ page, y: line.y, words: slice, centers, step });
      start += HEADER_LABELS.length - 1;
    }
  }
  if (headers.length) return headers;

  for (const first of page.words.filter((word) => normalize(word.text) === HEADER_LABELS[0])) {
    const words = [first];
    const firstY = (first.yMin + first.yMax) / 2;
    const yTolerance = Math.max(18, (first.yMax - first.yMin) * 1.5);
    for (const label of HEADER_LABELS.slice(1)) {
      const previousCenter = (words.at(-1)!.xMin + words.at(-1)!.xMax) / 2;
      const candidate = page.words
        .filter((word) => {
          const center = (word.xMin + word.xMax) / 2;
          const y = (word.yMin + word.yMax) / 2;
          return (
            normalize(word.text) === label &&
            center > previousCenter &&
            Math.abs(y - firstY) <= yTolerance
          );
        })
        .sort((left, right) => left.xMin - right.xMin)[0];
      if (!candidate) break;
      words.push(candidate);
    }
    if (words.length !== HEADER_LABELS.length) continue;
    const centers = words.map((word) => (word.xMin + word.xMax) / 2);
    const gaps = centers.slice(1).map((center, index) => center - centers[index]!);
    const step = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!;
    if (step <= 0 || gaps.some((gap) => gap < step * 0.55 || gap > step * 1.55)) continue;
    const yCenters = words.map((word) => (word.yMin + word.yMax) / 2).sort((a, b) => a - b);
    headers.push({ page, y: yCenters[Math.floor(yCenters.length / 2)]!, words, centers, step });
  }
  return headers;
}

function inferredSubject(header: Header, tableIndex: number, supplied?: readonly string[]): string {
  if (supplied) {
    const subject = supplied[tableIndex]?.trim();
    if (!subject) fail(`missing supplied subject for table ${tableIndex + 1}`);
    return subject;
  }
  const left = header.centers[0]! - header.step * 7;
  const right = header.centers.at(-1)! + header.step * 0.6;
  const candidates = visualLines(
    header.page.words.filter(
      (word) =>
        (word.xMin + word.xMax) / 2 >= left &&
        (word.xMin + word.xMax) / 2 <= right &&
        word.yMax < header.y &&
        word.yMin > header.y - 100,
    ),
  ).filter((line) => line.y < header.y - 2);
  const heading = candidates
    .slice(-3)
    .map((line) => line.text)
    .join(' ');
  const subject = normalize(heading)
    .split(' ')
    .filter(
      (token) =>
        token &&
        !/^(?:TYT|AYT|YKS|KONU|KONULAR|SORU|SORULAR|DAGILIMI|DAGILIM|DERSI|TESTI|CIKMIS|YILLARA|GORE|20\d{2})$/u.test(
          token,
        ),
    )
    .join(' ');
  if (!subject) fail(`cannot prove subject heading on physical page ${header.page.page}`);
  return subject;
}

function cellValue(raw: string): number {
  if (/^[-–—]$/u.test(raw)) return 0;
  if (!/^\d+$/u.test(raw)) fail(`invalid distribution cell ${raw}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) fail(`unsafe distribution cell ${raw}`);
  return value;
}

export function inspectOgmTopicDistributionRows(
  input: string | BboxDocument,
  options: { sourceGroup: string; firstPhysicalPage?: number; subjectByTable?: readonly string[] },
): OgmTopicDistributionReport {
  const sourceGroup = options.sourceGroup.trim();
  if (!sourceGroup) fail('sourceGroup is required');
  const document =
    typeof input === 'string'
      ? parsePdftotextBboxLayout(input, { firstPhysicalPage: options.firstPhysicalPage })
      : input;
  const allHeaders = document.pages.flatMap((page) => {
    const original = headersOnPage(page);
    const clockwisePage = rotatePageClockwise(page);
    const clockwise = headersOnPage(clockwisePage);
    if (original.length && clockwise.length) {
      fail(`ambiguous table orientation on physical page ${page.page}`);
    }
    return original.length ? original : clockwise;
  });
  if (!allHeaders.length) fail('no exact 2018..2025 + TOPLAM header');
  if (options.subjectByTable && options.subjectByTable.length !== allHeaders.length) {
    fail('subjectByTable count does not match detected tables');
  }

  const rows: OgmTopicDistributionRow[] = [];
  const failures: OgmTopicDistributionFailure[] = [];
  allHeaders.forEach((header, tableIndex) => {
    const samePageHeaders = allHeaders.filter((candidate) => candidate.page === header.page);
    const nextHeader = samePageHeaders.find((candidate) => candidate.y > header.y + 3);
    const structuralHeaderWords = header.page.words.filter((word) => {
      const x = (word.xMin + word.xMax) / 2;
      const y = (word.yMin + word.yMax) / 2;
      return (
        x < header.centers[0]! &&
        Math.abs(y - header.y) <= header.step &&
        /^(?:KONU|UNITE|SAYFA|NO|SORU|TIPI)$/u.test(normalize(word.text))
      );
    });
    const xLeft = structuralHeaderWords.length
      ? Math.max(0, Math.min(...structuralHeaderWords.map((word) => word.xMin)) - header.step)
      : header.centers[0]! - header.step * 7;
    const topicHeaderWords = structuralHeaderWords.filter(
      (word) => normalize(word.text) === 'KONU' || normalize(word.text) === 'TIPI',
    );
    if (topicHeaderWords.length > 1) {
      fail(`ambiguous KONU column on physical page ${header.page.page}`);
    }
    const topicXRight = header.centers[0]! - header.step * 0.48;
    const topicXLeft = topicHeaderWords.length
      ? Math.max(
          xLeft,
          (2 * (topicHeaderWords[0]!.xMin + topicHeaderWords[0]!.xMax)) / 2 - topicXRight,
        )
      : xLeft;
    const xRight = header.centers.at(-1)! + header.step * 0.6;
    const below = header.page.words.filter((word) => {
      const x = (word.xMin + word.xMax) / 2;
      const y = (word.yMin + word.yMax) / 2;
      return x >= xLeft && x <= xRight && y > header.y + 2 && (!nextHeader || y < nextHeader.y - 2);
    });
    const rowLines = visualLines(below)
      .map((line) => {
        const assigned = new Map<number, BboxWord>();
        for (const word of line.words) {
          if (!/^(?:\d+|[-–—])$/u.test(word.text)) continue;
          const x = (word.xMin + word.xMax) / 2;
          let nearest = 0;
          for (let i = 1; i < header.centers.length; i += 1) {
            if (Math.abs(x - header.centers[i]!) < Math.abs(x - header.centers[nearest]!))
              nearest = i;
          }
          if (Math.abs(x - header.centers[nearest]!) > header.step * 0.44) continue;
          if (assigned.has(nearest))
            fail(`duplicate/shifted cell on physical page ${header.page.page}`);
          assigned.set(nearest, word);
        }
        return { line, assigned };
      })
      .filter(({ assigned }) => assigned.size >= 5);
    if (!rowLines.length) fail(`table on physical page ${header.page.page} has no rows`);

    rowLines.forEach(({ line, assigned }, rowIndex) => {
      let failureSubject: string | undefined;
      let failureTopic: string | undefined;
      try {
        const previousY = rowLines[rowIndex - 1]?.line.y ?? header.y;
        const nextY = rowLines[rowIndex + 1]?.line.y ?? line.y + Math.max(18, line.y - previousY);
        const topicWords = below.filter((word) => {
          const x = (word.xMin + word.xMax) / 2;
          const y = (word.yMin + word.yMax) / 2;
          return (
            x >= topicXLeft &&
            x < topicXRight &&
            y > (previousY + line.y) / 2 &&
            y < (line.y + nextY) / 2
          );
        });
        failureTopic = visualLines(topicWords)
          .map((topicLine) => topicLine.text)
          .join(' ')
          .trim();
        if (!failureTopic) {
          fail(
            `missing topic heading for row ${rowIndex + 1} on physical page ${header.page.page}`,
          );
        }
        failureSubject = inferredSubject(header, tableIndex, options.subjectByTable);
        if (assigned.size !== HEADER_LABELS.length) {
          fail(
            `missing distribution cell for row ${rowIndex + 1} on physical page ${header.page.page}: found columns ${[...assigned.keys()].join(',')}`,
          );
        }
        const rawCells = Object.fromEntries(
          HEADER_LABELS.map((label, index) => [label, assigned.get(index)!.text]),
        );
        const values = HEADER_LABELS.map((_, index) => cellValue(assigned.get(index)!.text));
        const total = values.at(-1)!;
        const sum = values.slice(0, -1).reduce((accumulator, value) => accumulator + value, 0);
        if (sum !== total) {
          fail(
            `${failureSubject} / ${failureTopic}: year sum ${sum} does not equal TOPLAM ${total}`,
          );
        }
        rows.push({
          sourceGroup,
          subject: failureSubject,
          topic: failureTopic,
          physicalPage: header.page.page,
          yearCounts: Object.fromEntries(
            OGM_DISTRIBUTION_YEARS.map((year, index) => [year, values[index]!]),
          ) as Record<OgmDistributionYear, number>,
          total,
          rawCells,
        });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.startsWith('OGM extraction failed closed:')
        ) {
          throw error;
        }
        failures.push({
          sourceGroup,
          physicalPage: header.page.page,
          tableIndex: tableIndex + 1,
          rowIndex: rowIndex + 1,
          reason: error.message,
          ...(failureSubject ? { subject: failureSubject } : {}),
          ...(failureTopic ? { topic: failureTopic } : {}),
          explicitYearCounts: Object.fromEntries(
            OGM_DISTRIBUTION_YEARS.flatMap((year, index) => {
              const word = assigned.get(index);
              return word ? [[year, cellValue(word.text)]] : [];
            }),
          ),
          missingYears: OGM_DISTRIBUTION_YEARS.filter((_, index) => !assigned.has(index)),
          ...(assigned.has(HEADER_LABELS.length - 1)
            ? { rowTotal: cellValue(assigned.get(HEADER_LABELS.length - 1)!.text) }
            : {}),
        });
      }
    });
  });
  return { tableCount: allHeaders.length, rows, failures };
}

export function extractOgmTopicDistributionRows(
  input: string | BboxDocument,
  options: { sourceGroup: string; firstPhysicalPage?: number; subjectByTable?: readonly string[] },
): OgmTopicDistributionRow[] {
  const report = inspectOgmTopicDistributionRows(input, options);
  if (report.failures.length)
    fail(report.failures[0]!.reason.replace(/^OGM extraction failed closed: /u, ''));
  return report.rows;
}

function matchSubject(line: string, subjects: readonly string[]): string | undefined {
  const normalizedLine = normalize(line);
  const matches = subjects.filter((subject) => {
    const candidate = normalize(subject);
    return (
      candidate &&
      new RegExp(`(?:^| )${candidate.replace(/ /g, ' +')}(?: |$)`, 'u').test(normalizedLine)
    );
  });
  if (matches.length > 1) fail(`ambiguous subject heading: ${line}`);
  return matches[0];
}

/** Extracts identifiers only; no source question text is returned or written. */
export function extractOgmQuestionEvidence(
  input: string | BboxDocument,
  options: {
    sourceGroup: string;
    subjects: readonly string[];
    firstPhysicalPage?: number;
  },
): OgmQuestionEvidence[] {
  const sourceGroup = options.sourceGroup.trim();
  if (
    !sourceGroup ||
    !options.subjects.length ||
    options.subjects.some((subject) => !subject.trim())
  ) {
    fail('sourceGroup and controlled subject labels are required');
  }
  const document =
    typeof input === 'string'
      ? parsePdftotextBboxLayout(input, { firstPhysicalPage: options.firstPhysicalPage })
      : input;
  const result: OgmQuestionEvidence[] = [];
  const seen = new Set<string>();
  for (const page of document.pages) {
    const linesById = new Map<number, BboxWord[]>();
    for (const word of page.words) {
      const words = linesById.get(word.lineId) ?? [];
      words.push(word);
      linesById.set(word.lineId, words);
    }
    const lines = [...linesById.values()].map((words) => ({
      words: words.sort((a, b) => a.xMin - b.xMin),
      text: joinWords(words),
    }));
    const labels = lines.flatMap(({ text }) => {
      const matches = [...normalize(text).matchAll(/\b(20\d{2}) +(TYT|AYT|YDT)\b/gu)];
      if (matches.length > 1) fail(`multiple year/session labels on physical page ${page.page}`);
      return matches.map((match) => ({
        year: Number(match[1]),
        session: match[2] as 'TYT' | 'AYT' | 'YDT',
      }));
    });
    const uniqueLabels = new Map(labels.map((label) => [`${label.year}-${label.session}`, label]));
    const subjects = new Set(
      lines.map(({ text }) => matchSubject(text, options.subjects)).filter(Boolean),
    );
    const markers = lines.flatMap(({ words }) => {
      const match = /^(\d{1,3})[.)]$/u.exec(words[0]?.text ?? '');
      return match ? [Number(match[1])] : [];
    });
    if (!markers.length) continue;
    if (uniqueLabels.size !== 1 || subjects.size !== 1) {
      fail(`question context is ambiguous on physical page ${page.page}`);
    }
    const label = [...uniqueLabels.values()][0]!;
    if (!(OGM_DISTRIBUTION_YEARS as readonly number[]).includes(label.year)) {
      fail(`question year ${label.year} is outside the pinned 2018-2025 coverage`);
    }
    const subject = [...subjects][0]!;
    for (const localQuestionNumber of markers) {
      if (!Number.isSafeInteger(localQuestionNumber) || localQuestionNumber < 1)
        fail('invalid question ID');
      const key = `${sourceGroup}\0${subject}\0${label.year}-${label.session}\0${localQuestionNumber}`;
      if (seen.has(key)) fail(`duplicate local question ${localQuestionNumber} for ${subject}`);
      seen.add(key);
      result.push({
        sourceGroup,
        subject,
        localQuestionNumber,
        physicalPage: page.page,
        year: label.year,
        session: label.session,
        yearSessionLabel: `${label.year} ${label.session}`,
      });
    }
  }
  return result;
}
