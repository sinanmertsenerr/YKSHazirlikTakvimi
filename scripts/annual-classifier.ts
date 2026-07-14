import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertAllowedOfficialPdfUrl,
  osymBookletRegistrySchema,
  type OsymBooklet,
} from './lib/osym-booklet-registry.ts';
import {
  assertIdOnlyPayload,
  annualClassifierReportSchema,
} from './lib/annual-classifier-contract.ts';
import {
  assertPopplerAvailable,
  extractOfficialBookletSections,
} from './lib/annual-classifier-extraction.ts';
import {
  FatalClassifierProviderError,
  HttpAnnualClassifierProvider,
  runAnnualClassifierBlock,
} from './lib/annual-classifier-orchestrator.ts';
import { canonicalTopicReviewSchema } from './lib/topic-review-contract.ts';

const DEFAULT_REGISTRY_PATH = 'content/osym-booklets.json';
const DEFAULT_TAXONOMY_PATH = 'content/topics.json';
const DEFAULT_CACHE_PATH = '.cache/annual-topic-classifier';
const MAX_REDIRECTS = 3;

type CliOptions = {
  year: number;
  exam: 'tyt' | 'ayt';
  allBlocks: boolean;
  blockIds: string[];
  outputDirectory: string;
  cacheDirectory: string;
  registryPath: string;
  taxonomyPath: string;
  endpoint: string | null;
  token: string | null;
  preflightOnly: boolean;
};

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseAnnualClassifierArgs(
  args: string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CliOptions {
  let year: number | undefined;
  let exam: 'tyt' | 'ayt' | undefined;
  let allBlocks = false;
  const blockIds: string[] = [];
  let outputDirectory: string | undefined;
  let cacheDirectory = DEFAULT_CACHE_PATH;
  let registryPath = DEFAULT_REGISTRY_PATH;
  let taxonomyPath = DEFAULT_TAXONOMY_PATH;
  let explicitDryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag === '--year') {
      year = Number(requireValue(args, index, flag));
      index += 1;
    } else if (flag === '--exam') {
      const value = requireValue(args, index, flag);
      if (value !== 'tyt' && value !== 'ayt') throw new Error('--exam must be tyt or ayt');
      exam = value;
      index += 1;
    } else if (flag === '--all-blocks') {
      allBlocks = true;
    } else if (flag === '--block-id') {
      blockIds.push(requireValue(args, index, flag));
      index += 1;
    } else if (flag === '--output') {
      outputDirectory = requireValue(args, index, flag);
      index += 1;
    } else if (flag === '--cache') {
      cacheDirectory = requireValue(args, index, flag);
      index += 1;
    } else if (flag === '--registry') {
      registryPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === '--taxonomy') {
      taxonomyPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === '--dry-run') {
      // This command is permanently dry-run; the flag is accepted for explicit CI intent.
      explicitDryRun = true;
    } else if (flag === '--publish') {
      throw new Error('Automatic topic publication is intentionally unsupported');
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!Number.isInteger(year)) throw new Error('--year must be an integer');
  if (!exam) throw new Error('--exam is required');
  if (allBlocks === Boolean(blockIds.length)) {
    throw new Error('Choose exactly one of --all-blocks or one/more --block-id values');
  }
  const endpoint = environment.CF_CLASSIFIER_ENDPOINT?.trim();
  const token = environment.CF_CLASSIFIER_TOKEN?.trim();
  const preflightOnly = !endpoint || !token;
  if (preflightOnly && !explicitDryRun) {
    throw new Error('CF_CLASSIFIER_ENDPOINT and CF_CLASSIFIER_TOKEN are required');
  }
  return {
    year: year!,
    exam,
    allBlocks,
    blockIds: [...new Set(blockIds)],
    outputDirectory: outputDirectory ?? `tmp/annual-topic-classifier/${year!}-${exam}`,
    cacheDirectory,
    registryPath,
    taxonomyPath,
    endpoint: endpoint ?? null,
    token: token ?? null,
    preflightOnly,
  };
}

function assertWorkspacePath(
  value: string,
  workspace: string,
  allowedRoot: string,
  label: string,
): string {
  const resolved = path.resolve(workspace, value);
  const root = path.resolve(workspace, allowedRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} must remain inside ${allowedRoot}`);
  }
  return resolved;
}

async function loadJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

async function fetchOfficialPdf(urlValue: string, redirectCount = 0): Promise<Response> {
  const url = assertAllowedOfficialPdfUrl(urlValue);
  const response = await fetch(url, {
    redirect: 'manual',
    headers: { accept: 'application/pdf', 'user-agent': 'YKSHazirlikAnnualClassifier/1.0' },
  });
  if (response.status >= 300 && response.status < 400) {
    if (redirectCount >= MAX_REDIRECTS) throw new Error('Official PDF exceeded redirect limit');
    const location = response.headers.get('location');
    if (!location) throw new Error('Official PDF redirect omitted Location');
    return fetchOfficialPdf(new URL(location, url).toString(), redirectCount + 1);
  }
  if (!response.ok) throw new Error(`Official PDF download failed with HTTP ${response.status}`);
  return response;
}

async function downloadAndVerifyBooklet(booklet: OsymBooklet, destination: string): Promise<void> {
  const response = await fetchOfficialPdf(booklet.pdfUrl);
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && Number(declaredLength) !== booklet.bytes) {
    throw new Error('Official PDF Content-Length does not match the pinned registry');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== booklet.bytes) {
    throw new Error('Official PDF byte length does not match the pinned registry');
  }
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error('Official booklet response is not a PDF');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== booklet.sha256) {
    throw new Error('Official PDF SHA-256 does not match the pinned registry');
  }
  await writeFile(destination, bytes, { mode: 0o600 });
}

async function writeIdOnlyJson(filePath: string, value: unknown): Promise<void> {
  assertIdOnlyPayload(value);
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, filePath);
}

export async function runAnnualClassifierCli(
  args = process.argv.slice(2),
  workspace = process.cwd(),
): Promise<void> {
  const options = parseAnnualClassifierArgs(args);
  const outputDirectory = assertWorkspacePath(
    options.outputDirectory,
    workspace,
    'tmp/annual-topic-classifier',
    'Output directory',
  );
  const cacheDirectory = assertWorkspacePath(
    options.cacheDirectory,
    workspace,
    '.cache/annual-topic-classifier',
    'Cache directory',
  );
  const registry = osymBookletRegistrySchema.parse(
    await loadJson(path.resolve(workspace, options.registryPath)),
  );
  const topicCatalog = await loadJson(path.resolve(workspace, options.taxonomyPath));
  const bookletMatches = registry.booklets.filter(
    (candidate) => candidate.year === options.year && candidate.session === options.exam,
  );
  if (bookletMatches.length !== 1) {
    throw new Error(
      `Registry does not contain exactly one ${options.year}-${options.exam} booklet`,
    );
  }
  const allBlocks = registry.questionBlockProfiles[options.exam].questionBlocks;
  const selectedBlocks = options.allBlocks
    ? allBlocks
    : options.blockIds.map((blockId) => {
        const matches = allBlocks.filter((block) => block.id === blockId);
        if (matches.length !== 1) throw new Error(`Unknown/ambiguous question block ${blockId}`);
        return matches[0]!;
      });
  if (options.preflightOnly) {
    process.stdout.write(
      `Credential-free dry-run preflight validated ${options.year}-${options.exam} and ${selectedBlocks.length} official block(s); no PDF was downloaded and no classifier was called.\n`,
    );
    return;
  }
  const endpoint = new URL(options.endpoint!);
  const provider = new HttpAnnualClassifierProvider(endpoint, options.token!);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'yks-annual-classifier-'));

  try {
    await assertPopplerAvailable();
    const pdfPath = path.join(temporaryDirectory, 'official-booklet.pdf');
    await downloadAndVerifyBooklet(bookletMatches[0]!, pdfPath);
    const sections = await extractOfficialBookletSections({
      pdfPath,
      tempDirectory: temporaryDirectory,
      exam: options.exam,
      targetSectionIds: selectedBlocks.map((block) => block.bookletSectionId),
    });
    await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

    for (const block of selectedBlocks) {
      const section = sections.get(block.bookletSectionId);
      if (!section) throw new Error(`Missing extracted section ${block.bookletSectionId}`);
      const visionPages = await Promise.all(
        section.imagePaths.map(async (image) => ({
          page: image.page,
          imageDataUrl: `data:image/jpeg;base64,${(await readFile(image.path)).toString('base64')}`,
        })),
      );
      const result = await runAnnualClassifierBlock({
        year: options.year,
        exam: options.exam,
        questionBlock: block,
        bookletRegistry: registry,
        topicCatalog,
        sources: { textPages: section.textPages, visionPages },
        provider,
        cacheDirectory,
      });
      canonicalTopicReviewSchema.parse(result.textReview);
      canonicalTopicReviewSchema.parse(result.visionReview);
      annualClassifierReportSchema.parse(result.report);
      await writeIdOnlyJson(
        path.join(outputDirectory, `${options.year}-${options.exam}-${block.id}.text.review.json`),
        result.textReview,
      );
      await writeIdOnlyJson(
        path.join(
          outputDirectory,
          `${options.year}-${options.exam}-${block.id}.vision.review.json`,
        ),
        result.visionReview,
      );
      await writeIdOnlyJson(
        path.join(outputDirectory, `${options.year}-${options.exam}-${block.id}.report.json`),
        result.report,
      );
      process.stdout.write(
        `${block.id}: ${result.report.summary.agreed} agreed, ${result.report.summary.disputed} disputed, ${result.report.summary.needsReview} needs review\n`,
      );
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runAnnualClassifierCli().catch((error: unknown) => {
    const message =
      error instanceof FatalClassifierProviderError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Annual classifier failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
