import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type PdfTextPage = { page: number; text: string };

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

export function splitPdfText(raw: string): PdfTextPage[] {
  const chunks = raw.replace(/\r\n?/g, '\n').split('\f');
  if (chunks.at(-1)?.trim() === '') chunks.pop();
  if (!chunks.length) throw new Error('Poppler produced no PDF text pages');
  return chunks.map((text, index) => ({ page: index + 1, text }));
}

function looksLikeExamPage(normalized: string): boolean {
  return normalized.length >= 300 && /\b1\b/.test(normalized) && /\b2\b/.test(normalized);
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
    const imagePaths: { page: number; path: string }[] = [];
    for (const page of pageNumbers) {
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
      textPages: pageNumbers.map((page) => pageByNumber.get(page)!),
      imagePaths,
    });
  }
  return sections;
}
