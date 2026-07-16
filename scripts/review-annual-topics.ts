import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertIdOnlyPayload } from './lib/annual-classifier-contract.ts';
import {
  prepareAnnualTopicHumanReview,
  validateAnnualTopicHumanReview,
  type AnnualTopicHumanReview,
} from './lib/annual-topic-publication.ts';

const MAX_INPUT_BYTES = 5 * 1024 * 1024;

type ReviewAnnualTopicsOptions = {
  mode: 'prepare' | 'validate';
  reportPath: string;
  reviewPath?: string;
  outputPath?: string;
  registryPath: string;
  topicsPath: string;
  currentDate?: string;
};

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseReviewAnnualTopicsArgs(args: string[]): ReviewAnnualTopicsOptions {
  let mode: 'prepare' | 'validate' | undefined;
  let reportPath: string | undefined;
  let reviewPath: string | undefined;
  let outputPath: string | undefined;
  let registryPath = 'content/osym-booklets.json';
  let topicsPath = 'content/topics.json';
  let currentDate: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag === '--prepare' || flag === '--validate') {
      const nextMode = flag.slice(2) as 'prepare' | 'validate';
      if (mode && mode !== nextMode)
        throw new Error('Choose exactly one of --prepare or --validate');
      mode = nextMode;
    } else if (flag === '--report') {
      reportPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === '--review') {
      reviewPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === '--output') {
      outputPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === '--registry') {
      registryPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === '--topics') {
      topicsPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === '--current-date') {
      currentDate = requireValue(args, index, flag);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!mode) throw new Error('Choose exactly one of --prepare or --validate');
  if (!reportPath) throw new Error('--report is required');
  if (mode === 'prepare' && (!outputPath || reviewPath)) {
    throw new Error('--prepare requires --output and does not accept --review');
  }
  if (mode === 'validate' && (!reviewPath || outputPath)) {
    throw new Error('--validate requires --review and does not accept --output');
  }
  return {
    mode,
    reportPath,
    registryPath,
    topicsPath,
    ...(reviewPath === undefined ? {} : { reviewPath }),
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(currentDate === undefined ? {} : { currentDate }),
  };
}

async function readLimitedJson(filePath: string): Promise<unknown> {
  const metadata = await lstat(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size <= 0 ||
    metadata.size > MAX_INPUT_BYTES
  ) {
    throw new Error(`Unsafe or oversized JSON input: ${filePath}`);
  }
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

async function writeIdOnlyJson(filePath: string, value: unknown): Promise<void> {
  assertIdOnlyPayload(value);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function runReviewAnnualTopicsCli(
  args = process.argv.slice(2),
  workspace = process.cwd(),
): Promise<AnnualTopicHumanReview> {
  const options = parseReviewAnnualTopicsArgs(args);
  const [report, registry, catalog] = await Promise.all([
    readLimitedJson(path.resolve(workspace, options.reportPath)),
    readLimitedJson(path.resolve(workspace, options.registryPath)),
    readLimitedJson(path.resolve(workspace, options.topicsPath)),
  ]);
  if (options.mode === 'prepare') {
    const review = prepareAnnualTopicHumanReview({
      report,
      bookletRegistry: registry,
      topicCatalog: catalog,
    });
    await writeIdOnlyJson(path.resolve(workspace, options.outputPath!), review);
    return review;
  }
  const reviewInput = await readLimitedJson(path.resolve(workspace, options.reviewPath!));
  const result = validateAnnualTopicHumanReview({
    review: reviewInput,
    report,
    bookletRegistry: registry,
    topicCatalog: catalog,
    ...(options.currentDate === undefined ? {} : { currentDate: options.currentDate }),
  });
  return result.review;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runReviewAnnualTopicsCli()
    .then((review) => {
      process.stdout.write(
        review.decision === 'pending'
          ? `Prepared ${review.records.length} ID-only pending decisions; no topic data was published.\n`
          : `Validated ${review.records.length} explicitly human-approved ID-only decisions.\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'Annual review failed'}\n`);
      process.exitCode = 1;
    });
}
