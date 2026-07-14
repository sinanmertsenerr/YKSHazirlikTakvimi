import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  compareTopicReviews,
  type TopicReviewComparisonResult,
} from './lib/compare-topic-reviews.ts';

const MAX_LOCAL_INPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_PRIMARY_PATH = resolve(
  process.cwd(),
  'content/topic-annotations/reviews/2026-tyt-turkce.primary.json',
);
const DEFAULT_SECONDARY_PATH = resolve(
  process.cwd(),
  'content/topic-annotations/reviews/2026-tyt-turkce.secondary.json',
);
const DEFAULT_REGISTRY_PATH = resolve(process.cwd(), 'content/osym-booklets.json');
const DEFAULT_TOPICS_PATH = resolve(process.cwd(), 'content/topics.json');
const DEFAULT_OUTPUT_PATH = resolve(
  process.cwd(),
  'content/topic-annotations/2026-tyt-turkce.json',
);

export type CompareTopicReviewFilesOptions = {
  primaryPath?: string;
  secondaryPath?: string;
  registryPath?: string;
  topicsPath?: string;
  outputPath?: string;
  waveId?: string;
  relatedConsensusPolicy?: 'intersection' | 'union';
  currentDate?: string;
};

async function readLimitedJson(path: string): Promise<unknown> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`Expected a JSON file: ${path}`);
  if (metadata.size > MAX_LOCAL_INPUT_BYTES) {
    throw new Error(`${path} exceeds the ${MAX_LOCAL_INPUT_BYTES}-byte local input limit`);
  }
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Could not parse JSON at ${path}`, { cause: error });
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function compareTopicReviewFiles(
  options: CompareTopicReviewFilesOptions = {},
): Promise<TopicReviewComparisonResult> {
  const primaryPath = resolve(options.primaryPath ?? DEFAULT_PRIMARY_PATH);
  const secondaryPath = resolve(options.secondaryPath ?? DEFAULT_SECONDARY_PATH);
  const registryPath = resolve(options.registryPath ?? DEFAULT_REGISTRY_PATH);
  const topicsPath = resolve(options.topicsPath ?? DEFAULT_TOPICS_PATH);
  const outputPath = resolve(options.outputPath ?? DEFAULT_OUTPUT_PATH);
  if ([primaryPath, secondaryPath, registryPath, topicsPath].includes(outputPath)) {
    throw new Error('Consensus output cannot overwrite a review, registry, or topic catalog.');
  }

  const [primaryReview, secondaryReview, bookletRegistry, topicCatalog] = await Promise.all([
    readLimitedJson(primaryPath),
    readLimitedJson(secondaryPath),
    readLimitedJson(registryPath),
    readLimitedJson(topicsPath),
  ]);
  const result = compareTopicReviews({
    primaryReview,
    secondaryReview,
    bookletRegistry,
    topicCatalog,
    waveId: options.waveId ?? '2026-tyt-turkce',
    relatedConsensusPolicy: options.relatedConsensusPolicy ?? 'intersection',
    ...(options.currentDate === undefined ? {} : { currentDate: options.currentDate }),
  });
  await writeJsonAtomically(outputPath, result.batch);
  return result;
}

function parseCliOptions(args: string[]): CompareTopicReviewFilesOptions {
  const options: CompareTopicReviewFilesOptions = {};
  const pathOptions: ReadonlyMap<
    string,
    Exclude<keyof CompareTopicReviewFilesOptions, 'relatedConsensusPolicy'>
  > = new Map([
    ['--primary', 'primaryPath'],
    ['--secondary', 'secondaryPath'],
    ['--registry', 'registryPath'],
    ['--topics', 'topicsPath'],
    ['--output', 'outputPath'],
    ['--wave-id', 'waveId'],
    ['--current-date', 'currentDate'],
  ] as const);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--related-consensus') {
      const policy = args[index + 1];
      if (policy !== 'intersection' && policy !== 'union') {
        throw new Error('--related-consensus must be intersection or union');
      }
      options.relatedConsensusPolicy = policy;
      index += 1;
      continue;
    }
    const field = argument ? pathOptions.get(argument) : undefined;
    const value = args[index + 1];
    if (!field || !value)
      throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    options[field] = value;
    index += 1;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options: CompareTopicReviewFilesOptions;
  try {
    options = parseCliOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    options = {};
  }

  if (process.exitCode !== 1) {
    compareTopicReviewFiles(options)
      .then(({ summary }) => {
        console.log(
          JSON.stringify(
            {
              outputPath: resolve(options.outputPath ?? DEFAULT_OUTPUT_PATH),
              ...summary,
            },
            null,
            2,
          ),
        );
      })
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
