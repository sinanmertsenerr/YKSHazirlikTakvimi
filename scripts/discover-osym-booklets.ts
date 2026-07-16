import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { discoverOsymBookletCandidate } from './lib/osym-booklet-discovery.ts';
import { osymBookletRegistrySchema } from './lib/osym-booklet-registry.ts';

const REGISTRY_PATH = path.resolve(process.cwd(), 'content/osym-booklets.json');
const TEMP_ROOT = path.resolve(process.cwd(), 'tmp');
const OUTPUT_ROOT = path.resolve(process.cwd(), 'tmp/osym-booklet-discovery');
const MAX_REGISTRY_BYTES = 2 * 1024 * 1024;

type CliOptions = { year: number; outputPath: string };

function parseOptions(args: string[]): CliOptions {
  let year: number | undefined;
  let outputPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--year' && value) {
      if (!/^\d{4}$/.test(value)) throw new Error('--year must be a four-digit integer.');
      year = Number(value);
      index += 1;
    } else if (argument === '--output' && value) {
      outputPath = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    }
  }
  if (year === undefined || outputPath === undefined) {
    throw new Error(
      'Usage: discover-osym-booklets --year YYYY --output tmp/osym-booklet-discovery/candidate.json',
    );
  }
  if (path.dirname(outputPath) !== OUTPUT_ROOT) {
    throw new Error(
      'Candidate output must be an explicit direct child of tmp/osym-booklet-discovery.',
    );
  }
  if (path.extname(outputPath).toLocaleLowerCase('en-US') !== '.json') {
    throw new Error('Candidate output must be a .json file.');
  }
  return { year, outputPath };
}

async function prepareSafeOutputRoot(): Promise<void> {
  await mkdir(TEMP_ROOT, { recursive: true, mode: 0o700 });
  const tempStats = await lstat(TEMP_ROOT);
  if (!tempStats.isDirectory() || tempStats.isSymbolicLink()) {
    throw new Error('tmp must be a real directory, not a symbolic link.');
  }
  await mkdir(OUTPUT_ROOT, { recursive: true, mode: 0o700 });
  const outputStats = await lstat(OUTPUT_ROOT);
  if (!outputStats.isDirectory() || outputStats.isSymbolicLink()) {
    throw new Error('Candidate output root must be a real directory, not a symbolic link.');
  }
}

async function readRegistry(): Promise<ReturnType<typeof osymBookletRegistrySchema.parse>> {
  const stats = await lstat(REGISTRY_PATH);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size <= 0 ||
    stats.size > MAX_REGISTRY_BYTES
  ) {
    throw new Error('Official booklet registry is missing or unsafe.');
  }
  return osymBookletRegistrySchema.parse(JSON.parse(await readFile(REGISTRY_PATH, 'utf8')));
}

export async function runBookletDiscoveryCli(args: string[]): Promise<string> {
  const options = parseOptions(args);
  const candidate = await discoverOsymBookletCandidate({
    registry: await readRegistry(),
    targetYear: options.year,
  });
  await prepareSafeOutputRoot();
  await writeFile(options.outputPath, `${JSON.stringify(candidate, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return options.outputPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runBookletDiscoveryCli(process.argv.slice(2))
    .then((outputPath) => {
      process.stdout.write(
        `Wrote a review-only ÖSYM booklet registry candidate to ${outputPath}; no content was published.\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'Discovery failed.'}\n`);
      process.exitCode = 1;
    });
}
