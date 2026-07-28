import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { programsFixtureSchema, type ProgramsFixture } from './lib/content-schemas.ts';
import { reportUpstreamOutageAndSucceed } from './lib/fetch-safety.ts';
import {
  readTextFileIfExists,
  writeTextFileAtomicallyIfChanged,
} from './lib/semantic-stability.ts';
import { fetchYokAtlas, readBoundedText } from './lib/yok-atlas-fetch.ts';
import {
  buildProgramsDetailsFixture,
  fetchAllYokAtlasNets,
  prepareStableDetailsFixture,
  YOK_ATLAS_NETS_API_URL,
  YOK_ATLAS_NETS_FIRST_YEAR,
  YOK_ATLAS_QUOTA_CATEGORIES,
} from './lib/yok-atlas-details.ts';
import {
  buildYokAtlasFixture,
  fetchAllYokAtlasPrograms,
  fetchAllYokAtlasTalentPrograms,
  stabilizeYokAtlasFixture,
  YOK_ATLAS_API_URL,
  YOK_ATLAS_DETAIL_BASE_URL,
  YOK_ATLAS_LEVELS,
  YOK_ATLAS_TALENT_LEVEL,
} from './lib/yok-atlas.ts';

const YOK_ATLAS_APP_URL = 'https://yokatlas.yok.gov.tr/tercih-sihirbazi-t4.php';

export type ImportOptions = {
  outputPath: string;
  provenancePath: string;
  detailsOutputPath: string;
  expectedYear?: number;
  pageSize: number;
  requestDelayMs: number;
  dryRun: boolean;
  now?: Date;
  fetchImpl?: typeof fetch;
};

export type PreparedProgramsFixture = {
  fixture: ProgramsFixture;
  fixtureJson: string;
  reusedExistingBytes: boolean;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function prepareStableProgramsFixture(
  candidateInput: unknown,
  existingJson: string | null,
): PreparedProgramsFixture {
  const candidate = programsFixtureSchema.parse(candidateInput);
  let previous: ProgramsFixture | undefined;
  if (existingJson !== null) {
    try {
      const parsed = programsFixtureSchema.safeParse(JSON.parse(existingJson) as unknown);
      if (parsed.success) previous = parsed.data;
    } catch {
      // A malformed previous artifact is never used as verification evidence.
    }
  }

  const fixture = stabilizeYokAtlasFixture(candidate, previous);
  if (existingJson !== null && previous && isDeepStrictEqual(fixture, previous)) {
    return { fixture, fixtureJson: existingJson, reusedExistingBytes: true };
  }
  return {
    fixture,
    fixtureJson: `${JSON.stringify(fixture, null, 2)}\n`,
    reusedExistingBytes: false,
  };
}

async function discoverAndVerifySpaBundle(
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: string; sha256: string }> {
  const pageResponse = await fetchYokAtlas(
    YOK_ATLAS_APP_URL,
    {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(20_000),
    },
    fetchImpl,
  );
  if (!pageResponse.ok) {
    throw new Error(`YÖK Atlas application returned HTTP ${pageResponse.status}`);
  }
  const html = await readBoundedText(pageResponse, 8 * 1024 * 1024, 'YÖK Atlas application page');
  const match = html.match(/src=["'](\/static\/js\/main\.[a-z0-9]+\.js)["']/i);
  if (!match?.[1]) throw new Error('Could not discover the YÖK Atlas application bundle');
  const bundleUrl = new URL(match[1], YOK_ATLAS_APP_URL).href;
  const bundleResponse = await fetchYokAtlas(
    bundleUrl,
    {
      headers: { Accept: 'application/javascript,text/javascript' },
      signal: AbortSignal.timeout(20_000),
    },
    fetchImpl,
  );
  if (!bundleResponse.ok) {
    throw new Error(`YÖK Atlas application bundle returned HTTP ${bundleResponse.status}`);
  }
  const bundle = await readBoundedText(
    bundleResponse,
    10 * 1024 * 1024,
    'YÖK Atlas application bundle',
  );

  const requiredContractEvidence = [
    'minPuan1',
    'minPuan2',
    'minPuan3',
    'basariSirasi1',
    'basariSirasi2',
    'basariSirasi3',
    '["gk".concat',
    // Kontenjan kırılımı sözleşmesi (canlı doğrulama 2026-07-28, bundle main.ffe6ecf9.js):
    // SPA'nın "Kontenjan ve Yerleşme" tablosu kategorileri yıl-indeksli alanlara bağlar.
    // Tam bağlama dizesi pinlenir — `.gkY` gibi kısa bir parça `gkY1` içinde de eşleşip
    // yeniden adlandırmayı gizlerdi. YÖK bunları yeniden adlandırır ya da anlamını
    // değiştirirse import, sessizce yeniden yorumlanmış sayı yayımlamak yerine durur.
    'kategori:"Genel",kontenjan:E.gk1||0,yerlesen:E.gkY1||0',
    'kontenjan:E.obk1||0,yerlesen:E.obkY1||0',
    'kontenjan:E.dprm1||0,yerlesen:E.dprmY1||0',
    'kontenjan:E.sgy1||0,yerlesen:E.sgyY1||0',
    'kontenjan:E.y34_1||0,yerlesen:E.y34Y1||0',
    // Netler paneli sözleşmesi (canlı doğrulama 2026-07-17, 2026-07-28'de yeniden görüldü).
    '/netler/search',
    'tytTrkNet',
  ];
  const missing = requiredContractEvidence.filter((token) => !bundle.includes(token));
  if (missing.length) {
    throw new Error(
      `YÖK Atlas SPA no longer contains the proven historical-field contract: ${missing.join(', ')}`,
    );
  }
  return { url: bundleUrl, sha256: sha256(bundle) };
}

async function stageFile(path: string, contents: string): Promise<string> {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await mkdir(dirname(path), { recursive: true });
  await rm(temporaryPath, { force: true });
  await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
  return temporaryPath;
}

/**
 * Stages every file first, then renames in list order. The MAIN fixture must be the
 * LAST entry: it is the activation point, so its audit record (provenance) and its
 * companion details fixture are always installed before a new fixture becomes visible.
 */
async function writeImportAtomically(files: { path: string; contents: string }[]): Promise<void> {
  const staged: { temporaryPath: string; path: string }[] = [];
  try {
    for (const file of files) {
      staged.push({ temporaryPath: await stageFile(file.path, file.contents), path: file.path });
    }
    while (staged.length) {
      const next = staged[0]!;
      await rename(next.temporaryPath, next.path);
      staged.shift();
    }
  } catch (error) {
    await Promise.all(staged.map((entry) => rm(entry.temporaryPath, { force: true })));
    throw error;
  }
}

function parseInteger(value: string, label: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

function parseOptions(args: string[]): ImportOptions {
  const options: ImportOptions = {
    outputPath: resolve(process.cwd(), 'content/programs.fixture.json'),
    provenancePath: resolve(process.cwd(), 'content/programs.provenance.json'),
    detailsOutputPath: resolve(process.cwd(), 'content/programs-details.fixture.json'),
    pageSize: 500,
    requestDelayMs: 250,
    dryRun: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--output' && value) {
      options.outputPath = resolve(value);
      index += 1;
    } else if (argument === '--provenance-output' && value) {
      options.provenancePath = resolve(value);
      index += 1;
    } else if (argument === '--details-output' && value) {
      options.detailsOutputPath = resolve(value);
      index += 1;
    } else if (argument === '--expected-year' && value) {
      options.expectedYear = parseInteger(value, 'expectedYear', 2018, 2100);
      index += 1;
    } else if (argument === '--page-size' && value) {
      options.pageSize = parseInteger(value, 'pageSize', 10, 1_000);
      index += 1;
    } else if (argument === '--delay-ms' && value) {
      options.requestDelayMs = parseInteger(value, 'delayMs', 0, 10_000);
      index += 1;
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    }
  }
  const outputPaths = [options.outputPath, options.provenancePath, options.detailsOutputPath];
  if (new Set(outputPaths).size !== outputPaths.length) {
    throw new Error('Fixture, details, and provenance outputs must be different files');
  }
  return options;
}

export async function importYokAtlasPrograms(options: ImportOptions): Promise<void> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.valueOf())) throw new Error('Invalid program verification time');
  const verifiedAt = now.toISOString();
  const bundle = await discoverAndVerifySpaBundle(options.fetchImpl);
  // Raw page rows feed the details fixture from the SAME sweep the program fixture is
  // built from — the two artifacts can never describe two different snapshots.
  const rawDetailRows: unknown[] = [];
  const fetched = await fetchAllYokAtlasPrograms({
    expectedYear: options.expectedYear,
    pageSize: options.pageSize,
    requestDelayMs: options.requestDelayMs,
    fetchImpl: options.fetchImpl,
    onProgress: (message) => console.log(message),
    onRawRow: (raw) => rawDetailRows.push(raw),
  });
  // Same straight-line throw chain as the merkezi sweep: a talent-level failure aborts
  // the WHOLE import before anything is written — no partial fixture can ever publish.
  // (An EMPTY talent level is a success, not a failure; see fetchAllYokAtlasTalentPrograms.)
  const talent = await fetchAllYokAtlasTalentPrograms({
    pageSize: options.pageSize,
    requestDelayMs: options.requestDelayMs,
    fetchImpl: options.fetchImpl,
    onProgress: (message) => console.log(message),
    onRawRow: (raw) => rawDetailRows.push(raw),
  });
  // Nets are archived from 2023; the sweep covers the snapshot year and up to two
  // preceding years so the detail screen can show the full published nets history.
  const netYears: number[] = [];
  for (
    let year = Math.max(YOK_ATLAS_NETS_FIRST_YEAR, fetched.statistics.snapshotYear - 2);
    year <= fetched.statistics.snapshotYear;
    year += 1
  ) {
    netYears.push(year);
  }
  // No pageSize passthrough: the nets sweep sizes its own single-request-per-year
  // reads (the endpoint's unsorted pagination is unstable across pages).
  const nets = await fetchAllYokAtlasNets(netYears, {
    requestDelayMs: options.requestDelayMs,
    fetchImpl: options.fetchImpl,
    onProgress: (message) => console.log(message),
  });
  const { fixture: candidateFixture, statistics } = buildYokAtlasFixture(
    fetched.rows,
    verifiedAt,
    talent.rows,
  );
  const { fixture: detailsFixture, statistics: detailsStatistics } = buildProgramsDetailsFixture({
    rawRows: rawDetailRows,
    netsRows: nets.rows,
    snapshotYear: fetched.statistics.snapshotYear,
    netYears,
    generatedAt: verifiedAt,
  });
  const existingFixtureJson = await readTextFileIfExists(options.outputPath);
  const { fixture, fixtureJson, reusedExistingBytes } = prepareStableProgramsFixture(
    candidateFixture,
    existingFixtureJson,
  );
  const existingDetailsJson = await readTextFileIfExists(options.detailsOutputPath);
  const { fixtureJson: detailsJson, reusedExistingBytes: reusedDetailsBytes } =
    prepareStableDetailsFixture(detailsFixture, existingDetailsJson);
  const programYears = fixture.programs.reduce((total, program) => total + program.years.length, 0);
  const skippedPrograms = Object.values(statistics.skippedByUniversityType).reduce(
    (total, count) => total + count,
    0,
  );
  const provenance = {
    schemaVersion: 1,
    authority: 'Yükseköğretim Kurulu (YÖK)',
    product: 'YÖK Atlas',
    verifiedAt,
    source: {
      applicationUrl: YOK_ATLAS_APP_URL,
      apiUrl: YOK_ATLAS_API_URL,
      detailBaseUrl: YOK_ATLAS_DETAIL_BASE_URL,
      snapshotSource: fetched.statistics.snapshotSource,
      snapshotYear: fetched.statistics.snapshotYear,
      // TABLO 5 runs on its own kılavuz cycle; its snapshot year is independent of the
      // merkezi levels' year and may lead it around each year's guide publication.
      talentSnapshotYear: talent.statistics.snapshotYear,
      spaBundle: bundle,
    },
    selection: {
      // One sweep per program level; TYT is the önlisans placement score, the other four
      // sweep lisans. Kept as data (not prose) so the audit trail names the exact API filters.
      levels: [...YOK_ATLAS_LEVELS, YOK_ATLAS_TALENT_LEVEL],
      supportedUniversityTypes: [
        'DEVLET',
        'VAKIF',
        'KKTC',
        'VAKIF MYO',
        'YURTDISI VAKIF',
        'YURTDISI KAMU',
      ],
      localePolicy: 'source-only',
    },
    pagination: {
      pageSize: options.pageSize,
      delayMs: options.requestDelayMs,
      requestCount: fetched.statistics.requestCount + talent.statistics.requestCount,
      totalsByScoreType: fetched.statistics.totalsByScoreType,
      talentRows: talent.statistics.rowCount,
    },
    fieldMappings: {
      currentYear: {
        year: 'yil',
        quota: 'kontenjan',
        placed: 'gkY',
        minScore: 'minPuan',
        minRank: 'basariSirasi',
      },
      historicalYears: [
        { offset: -1, quota: 'gk1', minScore: 'minPuan1', minRank: 'basariSirasi1' },
        { offset: -2, quota: 'gk2', minScore: 'minPuan2', minRank: 'basariSirasi2' },
        { offset: -3, quota: 'gk3', minScore: 'minPuan3', minRank: 'basariSirasi3' },
      ],
      placed:
        "current year only, from gkY (genel yerleşen — proven by the SPA's own Kontenjan ve Yerleşme " +
        'rendering and canary-pinned); a 0 without any published cutoff means "placement not run yet" ' +
        'and stays null. Historical placed counts come from the ÖSYM archive at build time.',
      foreignCity:
        'null — YURTDISI rows publish no il field (the official UI renders "--"); never derived from the university name',
      unsupportedScholarship:
        'null — source label remains visible in birimAdi and is counted below; no lossy category mapping',
      talent:
        "scoreType 'yetenek' — TABLO 5 rows regardless of source puanTuru label; central cutoffs stay null (admission is TYT threshold + university talent exam)",
    },
    details: {
      netsApiUrl: YOK_ATLAS_NETS_API_URL,
      netYears,
      netsRequestCount: nets.statistics.requestCount,
      netsRowsByYear: nets.statistics.rowsByYear,
      // The exact source-field → category binding, mirroring the SPA's own table.
      quotaCategories: YOK_ATLAS_QUOTA_CATEGORIES,
      excludedFields:
        'tustt1/tustt2/tusktp/kpss1/kpss2/dus are present in the API but rendered nowhere in the ' +
        'official UI; without an official label their meaning is unverifiable, so they are not imported',
      statistics: detailsStatistics,
      detailsFixtureSha256: sha256(detailsJson),
    },
    result: {
      receivedRows: statistics.receivedRows,
      receivedTalentRows: statistics.receivedTalentRows,
      importedPrograms: statistics.importedPrograms,
      importedTalentPrograms: statistics.importedTalentPrograms,
      programYears,
      skippedPrograms,
      skippedByUniversityType: statistics.skippedByUniversityType,
      omittedScholarshipLabels: statistics.omittedScholarshipLabels,
      fixtureSha256: sha256(fixtureJson),
    },
  };
  const provenanceJson = `${JSON.stringify(provenance, null, 2)}\n`;

  if (!options.dryRun) {
    if (reusedExistingBytes && reusedDetailsBytes) {
      await writeTextFileAtomicallyIfChanged(options.provenancePath, provenanceJson);
    } else {
      // Install order: audit record first, companion details second, the main fixture
      // LAST (activation point) — a visible new fixture always has its full context.
      const files = [{ path: options.provenancePath, contents: provenanceJson }];
      if (!reusedDetailsBytes)
        files.push({ path: options.detailsOutputPath, contents: detailsJson });
      if (!reusedExistingBytes) files.push({ path: options.outputPath, contents: fixtureJson });
      await writeImportAtomically(files);
    }
  }
  console.log(
    `${options.dryRun ? 'Validated' : reusedExistingBytes ? 'Audited' : 'Imported'} ${statistics.importedPrograms} official programs ` +
      `and ${programYears} program-year rows from the ${fetched.statistics.snapshotYear} YÖK Atlas snapshot` +
      ` (özel yetenek: ${statistics.importedTalentPrograms} of ${statistics.receivedTalentRows} rows, ${talent.statistics.snapshotYear} snapshot)` +
      `${skippedPrograms ? `; skipped ${skippedPrograms} unsupported foreign-type rows` : ''}.`,
  );
  console.log(
    `Details${options.dryRun ? ' (validated)' : reusedDetailsBytes ? ' (unchanged)' : ''}: ` +
      `${detailsStatistics.detailRecords} programs, ${detailsStatistics.conditionCount} kosul texts, ` +
      `${detailsStatistics.netRowsAttached}/${detailsStatistics.netRowsReceived} nets rows attached ` +
      `(${detailsStatistics.netRowsDropped} for closed programs) across ${netYears.join('/')}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options: ImportOptions;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    options = {
      outputPath: '',
      provenancePath: '',
      detailsOutputPath: '',
      pageSize: 500,
      requestDelayMs: 250,
      dryRun: true,
    };
  }
  if (process.exitCode !== 1) {
    importYokAtlasPrograms(options).catch((error: unknown) => {
      if (reportUpstreamOutageAndSucceed(error, 'YÖK Atlas')) return;
      console.error(error);
      process.exitCode = 1;
    });
  }
}
