import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { CLASSIFIER_FORBIDDEN_TEXT_CONTROL_CHARS } from '../../infra/cloudflare/src/index.ts';

export type PdfTextPage = { page: number; text: string };

export type OfficialPageQuestionScope = {
  page: number;
  sectionQuestionRange: { first: number; last: number };
  blockQuestionNumbers: number[];
};

export type ExtractedBookletSection = {
  bookletSectionId: string;
  textPages: PdfTextPage[];
  imagePaths: { page: number; path: string }[];
};

const SECTION_ORDER = {
  tyt: ['turkce', 'sosyal-bilimler', 'temel-matematik', 'fen-bilimleri'],
  ayt: [
    'turk-dili-ve-edebiyati-sosyal-bilimler-1',
    'sosyal-bilimler-2',
    'matematik',
    'fen-bilimleri',
  ],
} as const;

const SECTION_MARKERS: Record<
  (typeof SECTION_ORDER)['tyt'][number] | (typeof SECTION_ORDER)['ayt'][number],
  RegExp
> = {
  turkce: /\bTURKCE\s+TESTI\b/,
  'sosyal-bilimler': /\bSOSYAL\s+BILIMLER\s+TESTI\b/,
  'temel-matematik': /\bTEMEL\s+MATEMATIK\s+TESTI\b/,
  'fen-bilimleri': /\bFEN\s+BILIMLERI\s+TESTI\b/,
  'turk-dili-ve-edebiyati-sosyal-bilimler-1':
    /\bTURK\s+DILI\s+VE\s+EDEBIYATI[\s\S]{0,120}SOSYAL\s+BILIMLER[\s-]*1\s+TESTI\b/,
  'sosyal-bilimler-2': /\bSOSYAL\s+BILIMLER[\s-]*2\s+TESTI\b/,
  matematik: /\bMATEMATIK\s+TESTI\b/,
};

function normalizeForDetection(value: string): string {
  return value
    .toLocaleUpperCase('tr-TR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Z0-9\n]+/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

// Worker'ın metin sözleşmesiyle aynı yasak küme: bozuk ToUnicode CMap'li
// PDF'lerde pdftotext'in sızdırabildiği başıboş C0 baytları burada temizlenir;
// aksi hâlde sınıflandırıcı isteği 400 alır ve tüm yıllık pas düşer.
const FORBIDDEN_PDF_CONTROL_CHARS = new RegExp(
  CLASSIFIER_FORBIDDEN_TEXT_CONTROL_CHARS.source,
  'g',
);

export function splitPdfText(raw: string): PdfTextPage[] {
  const chunks = raw
    .replace(/\r\n?/g, '\n')
    .split('\f')
    .map((chunk) => chunk.replace(FORBIDDEN_PDF_CONTROL_CHARS, ''));
  if (chunks.at(-1)?.trim() === '') chunks.pop();
  if (!chunks.length) throw new Error('Poppler produced no PDF text pages');
  return chunks.map((text, index) => ({ page: index + 1, text }));
}

function looksLikeExamPage(normalized: string): boolean {
  return normalized.length >= 300 && /\b1\b/.test(normalized) && /\b2\b/.test(normalized);
}

function isOfficialInstructionMarker(text: string): boolean {
  const normalized = text.trim().toLocaleUpperCase('tr-TR').normalize('NFD').replace(/\p{M}/gu, '');
  return /^(?:BU TESTTE\b|CEVAPLARINIZI\b)/u.test(normalized);
}

function explicitQuestionStarts(page: PdfTextPage): number[] {
  const starts: number[] = [];
  for (const line of page.text.replace(/\r\n?/g, '\n').split('\n')) {
    const match = /^\s*(\d{1,3})\.(?:\s+|$)(.*)$/u.exec(line);
    if (!match || isOfficialInstructionMarker(match[2] ?? '')) continue;
    starts.push(Number(match[1]));
  }
  return [...new Set(starts)].sort((left, right) => left - right);
}

function officialBoilerplateSignature(text: string): string {
  return [
    ...text
      .toLocaleUpperCase('tr-TR')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^A-Z0-9]+/g, ''),
  ]
    .sort()
    .join('');
}

const VERIFIED_TRAILING_BOILERPLATE_SIGNATURES = new Set(
  [
    'ÖSYM',
    'Bu soruların telif hakları ÖSYM’ye aittir. Sorular, ÖSYM’nin yazılı izni olmaksızın hiçbir kişi, kurum veya kuruluş tarafından kullanılamaz. ÖSYM',
  ].map(officialBoilerplateSignature),
);

/**
 * Removes only byte-extracted pages whose complete letter multiset exactly matches a
 * known ÖSYM end-page signature. A markerless diagram or question continuation is
 * intentionally retained so downstream ownership derivation fails closed.
 */
export function trimVerifiedTrailingBoilerplatePages(pages: PdfTextPage[]): PdfTextPage[] {
  let endExclusive = pages.length;
  while (endExclusive > 0) {
    const page = pages[endExclusive - 1]!;
    if (
      explicitQuestionStarts(page).length ||
      !VERIFIED_TRAILING_BOILERPLATE_SIGNATURES.has(officialBoilerplateSignature(page.text))
    ) {
      break;
    }
    endExclusive -= 1;
  }
  if (!endExclusive) throw new Error('Official section contains only trailing boilerplate pages');
  return pages.slice(0, endExclusive);
}

function assertQuestionRange(range: { first: number; last: number }, label: string): void {
  if (
    !Number.isInteger(range.first) ||
    !Number.isInteger(range.last) ||
    range.first < 1 ||
    range.last < range.first
  ) {
    throw new Error(`${label} question range is invalid`);
  }
}

/**
 * Derives physical-page question ownership only from explicit Poppler layout markers.
 * Every section page must expose a strictly increasing first `N.` boundary. The next
 * page boundary (or exact section end) closes the current page; the result is then
 * clamped to the selected canonical/alternative block.
 */
export function deriveOfficialPageQuestionScopes({
  pages,
  sectionQuestionRange,
  blockQuestionRange,
}: {
  pages: PdfTextPage[];
  sectionQuestionRange: { first: number; last: number };
  blockQuestionRange: { first: number; last: number };
}): OfficialPageQuestionScope[] {
  if (!pages.length) throw new Error('Cannot derive question scopes from an empty section');
  assertQuestionRange(sectionQuestionRange, 'Section');
  assertQuestionRange(blockQuestionRange, 'Block');
  if (
    blockQuestionRange.first < sectionQuestionRange.first ||
    blockQuestionRange.last > sectionQuestionRange.last
  ) {
    throw new Error('Block question range is outside its official section');
  }

  const questionPages = trimVerifiedTrailingBoilerplatePages(pages);
  let previousFirstMarker = sectionQuestionRange.first - 1;
  const markersByPage = questionPages.map((page, index) => {
    if (!Number.isInteger(page.page) || page.page < 1) {
      throw new Error('Physical page number is invalid');
    }
    if (index > 0 && page.page <= pages[index - 1]!.page) {
      throw new Error('Physical pages must be unique and strictly increasing');
    }
    const markers = explicitQuestionStarts(page);
    if (!markers.length) {
      throw new Error(`Physical page ${page.page} is missing an explicit question boundary`);
    }
    if (
      markers.some(
        (marker) => marker < sectionQuestionRange.first || marker > sectionQuestionRange.last,
      )
    ) {
      throw new Error(`Physical page ${page.page} has an ambiguous question boundary`);
    }
    const firstMarker =
      index === 0
        ? markers.find((marker) => marker === sectionQuestionRange.first)
        : markers.find((marker) => marker > previousFirstMarker);
    if (firstMarker === undefined) {
      throw new Error(
        `Physical page ${page.page} has nonmonotonic or ambiguous question boundaries`,
      );
    }
    previousFirstMarker = firstMarker;
    return { page: page.page, firstMarker };
  });

  if (markersByPage[0]!.firstMarker !== sectionQuestionRange.first) {
    throw new Error('The first section page is missing the exact section-start boundary');
  }
  for (let index = 1; index < markersByPage.length; index += 1) {
    const previous = markersByPage[index - 1]!;
    const current = markersByPage[index]!;
    if (current.firstMarker <= previous.firstMarker) {
      throw new Error(
        `Physical page ${current.page} has nonmonotonic or ambiguous question boundaries`,
      );
    }
  }

  return markersByPage.map(({ page, firstMarker }, index) => {
    const first = firstMarker;
    const last =
      index + 1 < markersByPage.length
        ? markersByPage[index + 1]!.firstMarker - 1
        : sectionQuestionRange.last;
    if (last < first) {
      throw new Error(`Physical page ${page} has ambiguous question ownership`);
    }
    const blockFirst = Math.max(first, blockQuestionRange.first);
    const blockLast = Math.min(last, blockQuestionRange.last);
    return {
      page,
      sectionQuestionRange: { first, last },
      blockQuestionNumbers:
        blockFirst > blockLast
          ? []
          : Array.from({ length: blockLast - blockFirst + 1 }, (_, offset) => blockFirst + offset),
    };
  });
}

/**
 * Locates official test boundaries from their stable ÖSYM booklet headings.
 * It fails when any boundary is ambiguous instead of guessing page offsets.
 */
export function locateBookletSectionPages(
  pages: PdfTextPage[],
  exam: 'tyt' | 'ayt',
): Record<string, number[]> {
  if (!pages.length) throw new Error('Cannot locate sections in an empty booklet');
  const normalized = pages.map((page) => normalizeForDetection(page.text));
  const starts: { id: string; index: number }[] = [];
  let cursor = 0;
  for (const id of SECTION_ORDER[exam]) {
    const marker = SECTION_MARKERS[id];
    const candidates: number[] = [];
    for (let index = cursor; index < normalized.length; index += 1) {
      const pageText = normalized[index]!;
      if (marker.test(pageText) && looksLikeExamPage(pageText)) candidates.push(index);
    }
    if (!candidates.length) {
      throw new Error(`Could not locate official booklet section ${id}`);
    }
    const index = candidates[0]!;
    starts.push({ id, index });
    cursor = index + 1;
  }

  const lastStart = starts.at(-1)!.index;
  const sessionMarkers = SECTION_ORDER[exam].map((id) => SECTION_MARKERS[id]);
  const answerKeyIndexes = normalized
    .map((pageText, index) => ({ pageText, index }))
    .filter(
      ({ pageText, index }) =>
        index > lastStart &&
        (/\b(?:CEVAP\s+ANAHTARI|YANIT\s+ANAHTARI)\b/.test(pageText) ||
          sessionMarkers.filter((marker) => marker.test(pageText)).length >= 2),
    )
    .map(({ index }) => index);
  if (!answerKeyIndexes.length) {
    throw new Error('Could not locate the official answer-key boundary');
  }
  const answerKeyStart = answerKeyIndexes[0]!;

  return Object.fromEntries(
    starts.map((start, index) => {
      const endExclusive = starts[index + 1]?.index ?? answerKeyStart;
      if (endExclusive <= start.index) {
        throw new Error(`Official booklet section ${start.id} has an invalid page boundary`);
      }
      return [start.id, pages.slice(start.index, endExclusive).map((page) => page.page)];
    }),
  );
}

async function runQuiet(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false,
      env: { ...process.env, LC_ALL: 'C' },
    });
    let stderrBytes = 0;
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 64 * 1024) child.kill('SIGKILL');
    });
    child.once('error', () => reject(new Error(`Required command ${command} is unavailable`)));
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal ? 'signal' : 'exit'} ${signal ?? code})`));
    });
  });
}

export async function assertPopplerAvailable(): Promise<void> {
  await runQuiet('pdftotext', ['-v']);
  await runQuiet('pdftoppm', ['-v']);
}

export async function extractOfficialBookletSections({
  pdfPath,
  tempDirectory,
  exam,
  targetSectionIds,
}: {
  pdfPath: string;
  tempDirectory: string;
  exam: 'tyt' | 'ayt';
  targetSectionIds: string[];
}): Promise<Map<string, ExtractedBookletSection>> {
  const supported = new Set<string>(SECTION_ORDER[exam]);
  const uniqueTargets = [...new Set(targetSectionIds)];
  if (!uniqueTargets.length || uniqueTargets.some((id) => !supported.has(id))) {
    throw new Error('Requested booklet section is outside the official session structure');
  }

  const textPath = path.join(tempDirectory, 'booklet-layout.txt');
  await runQuiet('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, textPath]);
  const pages = splitPdfText(await readFile(textPath, 'utf8'));
  const pageMap = locateBookletSectionPages(pages, exam);
  const pageByNumber = new Map(pages.map((page) => [page.page, page] as const));
  const sections = new Map<string, ExtractedBookletSection>();

  for (const bookletSectionId of uniqueTargets) {
    const pageNumbers = pageMap[bookletSectionId];
    if (!pageNumbers?.length) {
      throw new Error(`Official booklet section ${bookletSectionId} has no pages`);
    }
    const textPages = trimVerifiedTrailingBoilerplatePages(
      pageNumbers.map((page) => pageByNumber.get(page)!),
    );
    const imagePaths: { page: number; path: string }[] = [];
    for (const { page } of textPages) {
      const prefix = path.join(tempDirectory, `page-${String(page).padStart(3, '0')}`);
      await runQuiet('pdftoppm', [
        '-f',
        String(page),
        '-l',
        String(page),
        '-singlefile',
        '-jpeg',
        '-r',
        '120',
        '-jpegopt',
        'quality=82,optimize=y,progressive=y',
        pdfPath,
        prefix,
      ]);
      const imagePath = `${prefix}.jpg`;
      const bytes = await readFile(imagePath);
      if (!bytes.length || bytes.length > 5 * 1024 * 1024) {
        throw new Error(`Rendered PDF page ${page} has an unsafe byte size`);
      }
      imagePaths.push({ page, path: imagePath });
    }
    sections.set(bookletSectionId, {
      bookletSectionId,
      textPages,
      imagePaths,
    });
  }
  return sections;
}
