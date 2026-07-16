import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { programsFixtureSchema, type ProgramsFixture } from './lib/content-schemas.ts';
import {
  readTextFileIfExists,
  writeTextFileAtomicallyIfChanged,
} from './lib/semantic-stability.ts';
import {
  buildYokAtlasFixture,
  fetchAllYokAtlasPrograms,
  stabilizeYokAtlasFixture,
  YOK_ATLAS_API_URL,
  YOK_ATLAS_DETAIL_BASE_URL,
  YOK_ATLAS_LEVELS,
} from './lib/yok-atlas.ts';

const YOK_ATLAS_APP_URL = 'https://yokatlas.yok.gov.tr/tercih-sihirbazi-t4.php';

export type ImportOptions = {
  outputPath: string;
  provenancePath: string;
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
  const pageResponse = await fetchImpl(YOK_ATLAS_APP_URL, {
    headers: { Accept: 'text/html' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!pageResponse.ok) {
    throw new Error(`YÖK Atlas application returned HTTP ${pageResponse.status}`);
  }
  const html = await pageResponse.text();
  const match = html.match(/src=["'](\/static\/js\/main\.[a-z0-9]+\.js)["']/i);
  if (!match?.[1]) throw new Error('Could not discover the YÖK Atlas application bundle');
  const bundleUrl = new URL(match[1], YOK_ATLAS_APP_URL).href;
  const bundleResponse = await fetchImpl(bundleUrl, {
    headers: { Accept: 'application/javascript,text/javascript' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!bundleResponse.ok) {
    throw new Error(`YÖK Atlas application bundle returned HTTP ${bundleResponse.status}`);
  }
  const bundle = await bundleResponse.text();
  if (bundle.length > 10 * 1024 * 1024) {
    throw new Error('YÖK Atlas application bundle exceeded the 10 MiB safety limit');
  }

  const requiredContractEvidence = [
    'minPuan1',
    'minPuan2',
    'minPuan3',
    'basariSirasi1',
    'basariSirasi2',
    'basariSirasi3',
    '["gk".concat',
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

async function writeImportAtomically(
  outputPath: string,
  fixtureJson: string,
  provenancePath: string,
  provenanceJson: string,
): Promise<void> {
  const fixtureTemporaryPath = await stageFile(outputPath, fixtureJson);
  let provenanceTemporaryPath: string | null = null;
  try {
    provenanceTemporaryPath = await stageFile(provenancePath, provenanceJson);
    // The fixture is the activation point. Provenance is installed first so a visible new fixture
    // never exists without its audit record.
    await rename(provenanceTemporaryPath, provenancePath);
    provenanceTemporaryPath = null;
    await rename(fixtureTemporaryPath, outputPath);
  } catch (error) {
    await rm(fixtureTemporaryPath, { force: true });
    if (provenanceTemporaryPath) await rm(provenanceTemporaryPath, { force: true });
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
  if (options.outputPath === options.provenancePath) {
    throw new Error('Fixture and provenance outputs must be different files');
  }
  return options;
}

export async function importYokAtlasPrograms(options: ImportOptions): Promise<void> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.valueOf())) throw new Error('Invalid program verification time');
  const verifiedAt = now.toISOString();
  const bundle = await discoverAndVerifySpaBundle(options.fetchImpl);
  const fetched = await fetchAllYokAtlasPrograms({
    expectedYear: options.expectedYear,
    pageSize: options.pageSize,
    requestDelayMs: options.requestDelayMs,
    fetchImpl: options.fetchImpl,
    onProgress: (message) => console.log(message),
  });
  const { fixture: candidateFixture, statistics } = buildYokAtlasFixture(fetched.rows, verifiedAt);
  const existingFixtureJson = await readTextFileIfExists(options.outputPath);
  const { fixture, fixtureJson, reusedExistingBytes } = prepareStableProgramsFixture(
    candidateFixture,
    existingFixtureJson,
  );
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
      spaBundle: bundle,
    },
    selection: {
      // One sweep per program level; TYT is the önlisans placement score, the other four
      // sweep lisans. Kept as data (not prose) so the audit trail names the exact API filters.
      levels: YOK_ATLAS_LEVELS,
      supportedUniversityTypes: ['DEVLET', 'VAKIF', 'KKTC'],
      localePolicy: 'source-only',
    },
    pagination: {
      pageSize: options.pageSize,
      delayMs: options.requestDelayMs,
      requestCount: fetched.statistics.requestCount,
      totalsByScoreType: fetched.statistics.totalsByScoreType,
    },
    fieldMappings: {
      currentYear: {
        year: 'yil',
        quota: 'kontenjan',
        minScore: 'minPuan',
        minRank: 'basariSirasi',
      },
      historicalYears: [
        { offset: -1, quota: 'gk1', minScore: 'minPuan1', minRank: 'basariSirasi1' },
        { offset: -2, quota: 'gk2', minScore: 'minPuan2', minRank: 'basariSirasi2' },
        { offset: -3, quota: 'gk3', minScore: 'minPuan3', minRank: 'basariSirasi3' },
      ],
      placed:
        'null — no proven year-by-year placed-count field is imported; values are never inferred',
      unsupportedScholarship:
        'null — source label remains visible in birimAdi and is counted below; no lossy category mapping',
    },
    result: {
      receivedRows: statistics.receivedRows,
      importedPrograms: statistics.importedPrograms,
      programYears,
      skippedPrograms,
      skippedByUniversityType: statistics.skippedByUniversityType,
      omittedScholarshipLabels: statistics.omittedScholarshipLabels,
      fixtureSha256: sha256(fixtureJson),
    },
  };
  const provenanceJson = `${JSON.stringify(provenance, null, 2)}\n`;

  if (!options.dryRun) {
    if (reusedExistingBytes) {
      await writeTextFileAtomicallyIfChanged(options.provenancePath, provenanceJson);
    } else {
      await writeImportAtomically(
        options.outputPath,
        fixtureJson,
        options.provenancePath,
        provenanceJson,
      );
    }
  }
  console.log(
    `${options.dryRun ? 'Validated' : reusedExistingBytes ? 'Audited' : 'Imported'} ${statistics.importedPrograms} official programs ` +
      `and ${programYears} program-year rows from the ${fetched.statistics.snapshotYear} YÖK Atlas snapshot` +
      `${skippedPrograms ? `; skipped ${skippedPrograms} unsupported foreign-type rows` : ''}.`,
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
      pageSize: 500,
      requestDelayMs: 250,
      dryRun: true,
    };
  }
  if (process.exitCode !== 1) {
    importYokAtlasPrograms(options).catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
