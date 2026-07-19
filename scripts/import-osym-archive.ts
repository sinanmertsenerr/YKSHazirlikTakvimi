import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import ExcelJS from 'exceljs';

import {
  OSYM_ARCHIVE_SOURCES,
  osymArchiveFixtureSchema,
  parseOsymWorksheet,
  type OsymArchiveFixture,
} from './lib/osym-archive.ts';

// One-time (per new archive year) importer for ÖSYM's yearly placement tables. The
// output fixture is committed and consumed by build-programs at pack build time; the
// daily YÖK Atlas cron never runs this. Re-running is idempotent for unchanged files
// (past years are static official publications).
const MAX_FILE_BYTES = 20 * 1024 * 1024;

type ImportOptions = {
  outputPath: string;
  requestDelayMs: number;
  dryRun: boolean;
  now?: Date;
  fetchImpl?: typeof fetch;
};

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function downloadArchiveFile(
  url: string,
  fetchImpl: typeof fetch,
  retries = 3,
): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*',
          'User-Agent':
            'YKSHazirlikTakvimi/1.0 (+https://github.com/sinanmertsener/YKSHazirlikTakvimi; static-content-importer)',
        },
        signal: AbortSignal.timeout(60_000),
      });
      const retryable = response.status === 429 || response.status >= 500;
      if (!response.ok) {
        const error = new Error(`ÖSYM archive ${url} returned HTTP ${response.status}`);
        if (!retryable || attempt === retries) throw error;
        lastError = error;
        await wait(Math.min(1_000 * 2 ** attempt, 8_000));
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.byteLength) throw new Error(`ÖSYM archive ${url} returned an empty body`);
      if (buffer.byteLength > MAX_FILE_BYTES) {
        throw new Error(`ÖSYM archive ${url} exceeded the ${MAX_FILE_BYTES}-byte safety limit`);
      }
      return buffer;
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await wait(Math.min(1_000 * 2 ** attempt, 8_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function importOsymArchive(options: ImportOptions): Promise<OsymArchiveFixture> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.valueOf())) throw new Error('Invalid archive verification time');
  const fetchImpl = options.fetchImpl ?? fetch;
  const sources: OsymArchiveFixture['sources'][number][] = [];
  const records: OsymArchiveFixture['records'] = [];

  for (const source of OSYM_ARCHIVE_SOURCES) {
    if (sources.length) await wait(options.requestDelayMs);
    console.log(`ÖSYM ${source.year} ${source.level}: downloading`);
    const buffer = await downloadArchiveFile(source.url, fetchImpl);
    const workbook = new ExcelJS.Workbook();
    // Round-trip through a temp file: exceljs ships pre-Node-22 Buffer typings that
    // reject current Buffers at the type level; readFile sidesteps the mismatch.
    const spoolPath = `${options.outputPath}.download-${process.pid}.xlsx`;
    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(spoolPath, buffer);
    try {
      await workbook.xlsx.readFile(spoolPath);
    } finally {
      await rm(spoolPath, { force: true });
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error(`ÖSYM ${source.year} ${source.level} workbook has no sheets`);
    const parsed = parseOsymWorksheet(worksheet);
    if (!parsed.records.length) {
      throw new Error(`ÖSYM ${source.year} ${source.level} produced no parseable rows`);
    }
    for (const record of parsed.records) {
      records.push({ ...record, year: source.year, level: source.level });
    }
    sources.push({
      year: source.year,
      level: source.level,
      url: source.url,
      sha256: sha256(buffer),
      bytes: buffer.byteLength,
      rows: parsed.records.length,
      skippedRows: parsed.skippedRows,
    });
    console.log(
      `ÖSYM ${source.year} ${source.level}: ${parsed.records.length} rows` +
        `${Object.keys(parsed.skippedRows).length ? ` (skipped: ${JSON.stringify(parsed.skippedRows)})` : ''}`,
    );
  }

  // Same (year, level, code) appearing twice inside one official file would poison the
  // year-join downstream — abort loudly instead of keeping either row.
  const seen = new Set<string>();
  for (const record of records) {
    const key = `${record.year}|${record.level}|${record.code}`;
    if (seen.has(key)) throw new Error(`Duplicate ÖSYM archive row ${key}; aborting`);
    seen.add(key);
  }

  const fixture = osymArchiveFixtureSchema.parse({
    schemaVersion: 1,
    authority: 'Ölçme, Seçme ve Yerleştirme Merkezi (ÖSYM)',
    generatedAt: now.toISOString(),
    note:
      'Resmî ÖSYM YKS yerleştirme sonuç tabloları (Tablo-3 önlisans + Tablo-4 lisans, 2018-2024). ' +
      'Hiçbir yıl başarı sırası yayımlamaz (minRank bu kaynaktan asla türetilmez); yerleşen sayıları ' +
      'ek yerleştirme/okul birincisi nedeniyle genel kontenjanı aşabilir ve olduğu gibi korunur.',
    sources,
    records,
  } satisfies OsymArchiveFixture);

  if (!options.dryRun) {
    const temporaryPath = `${options.outputPath}.tmp-${process.pid}`;
    await mkdir(dirname(options.outputPath), { recursive: true });
    await rm(temporaryPath, { force: true });
    // Compact JSON on purpose: ~150k records; content/*.json is prettier-ignored.
    await writeFile(temporaryPath, `${JSON.stringify(fixture)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, options.outputPath);
  }
  console.log(
    `${options.dryRun ? 'Validated' : 'Imported'} ${records.length} ÖSYM archive rows across ${sources.length} files (2018-2024).`,
  );
  return fixture;
}

function parseOptions(args: string[]): ImportOptions {
  const options: ImportOptions = {
    outputPath: resolve(process.cwd(), 'content/programs-archive.fixture.json'),
    requestDelayMs: 1_500,
    dryRun: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--output' && value) {
      options.outputPath = resolve(value);
      index += 1;
    } else if (argument === '--delay-ms' && value) {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 10_000) {
        throw new Error('delayMs must be an integer from 0 through 10000');
      }
      options.requestDelayMs = parsed;
      index += 1;
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  importOsymArchive(parseOptions(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
