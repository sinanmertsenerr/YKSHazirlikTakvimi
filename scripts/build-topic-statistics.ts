import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildTopicStatisticsReport, type TopicStatisticsReport } from './lib/topic-annotations.ts';

const MAX_LOCAL_INPUT_BYTES = 10 * 1024 * 1024;

export const DEFAULT_BOOKLET_REGISTRY_PATH = resolve(process.cwd(), 'content/osym-booklets.json');
export const DEFAULT_TOPIC_CATALOG_PATH = resolve(process.cwd(), 'content/topics.json');

type BuildTopicStatisticsOptions = {
  annotationsPath: string;
  registryPath?: string;
  topicsPath?: string;
  outputPath?: string;
  generatedAt?: string;
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

export async function buildTopicStatisticsFromFiles({
  annotationsPath,
  registryPath = DEFAULT_BOOKLET_REGISTRY_PATH,
  topicsPath = DEFAULT_TOPIC_CATALOG_PATH,
  outputPath,
  generatedAt,
}: BuildTopicStatisticsOptions): Promise<TopicStatisticsReport> {
  const resolvedAnnotationsPath = resolve(annotationsPath);
  const resolvedRegistryPath = resolve(registryPath);
  const resolvedTopicsPath = resolve(topicsPath);
  const resolvedOutputPath = outputPath ? resolve(outputPath) : null;

  if (
    resolvedOutputPath &&
    [resolvedAnnotationsPath, resolvedRegistryPath, resolvedTopicsPath].includes(resolvedOutputPath)
  ) {
    throw new Error('The dry-run report cannot overwrite annotations, registry, or topics input.');
  }

  const [annotationBatch, bookletRegistry, topicCatalog] = await Promise.all([
    readLimitedJson(resolvedAnnotationsPath),
    readLimitedJson(resolvedRegistryPath),
    readLimitedJson(resolvedTopicsPath),
  ]);
  const report = buildTopicStatisticsReport({
    annotationBatch,
    bookletRegistry,
    topicCatalog,
    ...(generatedAt === undefined ? {} : { generatedAt }),
  });

  if (resolvedOutputPath) await writeJsonAtomically(resolvedOutputPath, report);
  return report;
}

function parseCliOptions(args: string[]): BuildTopicStatisticsOptions {
  let annotationsPath: string | undefined;
  let registryPath: string | undefined;
  let topicsPath: string | undefined;
  let outputPath: string | undefined;
  let generatedAt: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (
      ['--annotations', '--registry', '--topics', '--output', '--generated-at'].includes(
        argument ?? '',
      ) &&
      !value
    ) {
      throw new Error(`${argument} requires a value`);
    }
    if (argument === '--annotations') {
      annotationsPath = value;
      index += 1;
    } else if (argument === '--registry') {
      registryPath = value;
      index += 1;
    } else if (argument === '--topics') {
      topicsPath = value;
      index += 1;
    } else if (argument === '--output') {
      outputPath = value;
      index += 1;
    } else if (argument === '--generated-at') {
      generatedAt = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    }
  }

  if (!annotationsPath) throw new Error('--annotations is required');
  return {
    annotationsPath,
    ...(registryPath === undefined ? {} : { registryPath }),
    ...(topicsPath === undefined ? {} : { topicsPath }),
    ...(outputPath === undefined ? {} : { outputPath }),
    ...(generatedAt === undefined ? {} : { generatedAt }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options: BuildTopicStatisticsOptions;
  try {
    options = parseCliOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    options = { annotationsPath: '' };
  }

  if (process.exitCode !== 1) {
    buildTopicStatisticsFromFiles(options)
      .then((report) => {
        if (!options.outputPath) console.log(JSON.stringify(report, null, 2));
        else
          console.log(`Wrote dry-run topic statistics report to ${resolve(options.outputPath)}.`);
      })
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
