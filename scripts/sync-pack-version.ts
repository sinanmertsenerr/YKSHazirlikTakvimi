import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { manifestSourceSchema } from './lib/content-schemas.ts';
import { writeTextFileAtomicallyIfChanged } from './lib/semantic-stability.ts';

type SyncPackVersionOptions = {
  candidateVersion?: string;
  manifestPath?: string;
  remoteVersion?: string;
};

type CliOptions = SyncPackVersionOptions & {
  verifyNewerThan?: string;
};

type VersionParts = readonly [year: bigint, month: bigint, revision: bigint];

function parsePackVersion(value: string, label: string): VersionParts {
  const parsed = manifestSourceSchema.shape.packVersion.safeParse(value);
  if (!parsed.success) throw new Error(`${label} is not a valid pack version`);
  const parts = parsed.data.split('.');
  if (parts.length !== 3 || parts.some((part) => part === undefined)) {
    throw new Error(`${label} is not a valid pack version`);
  }
  return [BigInt(parts[0]!), BigInt(parts[1]!), BigInt(parts[2]!)];
}

export function comparePackVersions(left: string, right: string): number {
  const leftParts = parsePackVersion(left, 'left version');
  const rightParts = parsePackVersion(right, 'right version');
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index]! > rightParts[index]!) return 1;
    if (leftParts[index]! < rightParts[index]!) return -1;
  }
  return 0;
}

function incrementPackVersion(value: string): string {
  const [year, month, revision] = parsePackVersion(value, 'version floor');
  return `${year.toString().padStart(4, '0')}.${month.toString().padStart(2, '0')}.${revision + 1n}`;
}

export function nextMonotonicPackVersion(
  candidateVersion: string,
  currentVersion: string,
  remoteVersion?: string,
): string {
  parsePackVersion(candidateVersion, 'candidate version');
  parsePackVersion(currentVersion, 'current version');
  if (remoteVersion) parsePackVersion(remoteVersion, 'remote version');

  const floor =
    remoteVersion && comparePackVersions(remoteVersion, currentVersion) > 0
      ? remoteVersion
      : currentVersion;
  return comparePackVersions(candidateVersion, floor) > 0
    ? candidateVersion
    : incrementPackVersion(floor);
}

async function readSourceManifest(manifestPath: string) {
  const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  const parsed = manifestSourceSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid manifest source:\n${parsed.error.issues
        .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
        .join('\n')}`,
    );
  }
  return parsed.data;
}

export async function syncSourcePackVersion(
  options: SyncPackVersionOptions,
): Promise<{ changed: boolean; packVersion: string }> {
  const manifestPath = resolve(
    options.manifestPath ?? resolve(process.cwd(), 'content/manifest.source.json'),
  );
  const manifest = await readSourceManifest(manifestPath);
  const remoteVersion = options.remoteVersion?.trim() || undefined;
  if (remoteVersion) parsePackVersion(remoteVersion, 'remote version');

  let packVersion = manifest.packVersion;
  if (options.candidateVersion) {
    // A persisted revision that is already newer than the published one represents an
    // undelivered deployment attempt. Reuse it on retries instead of manufacturing a new
    // revision every time the remote site remains stale.
    if (!remoteVersion || comparePackVersions(manifest.packVersion, remoteVersion) <= 0) {
      packVersion = nextMonotonicPackVersion(
        options.candidateVersion,
        manifest.packVersion,
        remoteVersion,
      );
    }
  } else if (remoteVersion && comparePackVersions(remoteVersion, manifest.packVersion) > 0) {
    // Equal pack identities should carry the already-published content revision into future
    // bundled app builds, without manufacturing another deployment.
    packVersion = remoteVersion;
  }

  const changed = packVersion !== manifest.packVersion;
  if (changed) {
    await writeTextFileAtomicallyIfChanged(
      manifestPath,
      `${JSON.stringify({ ...manifest, packVersion }, null, 2)}\n`,
    );
  }
  return { changed, packVersion };
}

export async function assertSourcePackVersionNewer(
  manifestPath: string,
  minimumVersion: string,
): Promise<string> {
  const manifest = await readSourceManifest(resolve(manifestPath));
  parsePackVersion(minimumVersion, 'minimum version');
  if (comparePackVersions(manifest.packVersion, minimumVersion) <= 0) {
    throw new Error(
      `Source pack version ${manifest.packVersion} must be newer than published version ${minimumVersion}`,
    );
  }
  return manifest.packVersion;
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = {};
  const fields = new Map<string, keyof CliOptions>([
    ['--candidate-version', 'candidateVersion'],
    ['--manifest', 'manifestPath'],
    ['--remote-version', 'remoteVersion'],
    ['--verify-newer-than', 'verifyNewerThan'],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const field = argument ? fields.get(argument) : undefined;
    const value = args[index + 1];
    if (!field || !value)
      throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    options[field] = value;
    index += 1;
  }
  if (options.verifyNewerThan && (options.candidateVersion || options.remoteVersion)) {
    throw new Error('--verify-newer-than cannot be combined with sync options');
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options: CliOptions;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    options = {};
  }

  if (process.exitCode !== 1) {
    const manifestPath = resolve(
      options.manifestPath ?? resolve(process.cwd(), 'content/manifest.source.json'),
    );
    const operation = options.verifyNewerThan
      ? assertSourcePackVersionNewer(manifestPath, options.verifyNewerThan).then((packVersion) => ({
          changed: false,
          packVersion,
        }))
      : syncSourcePackVersion(options);
    operation
      .then(({ changed, packVersion }) =>
        console.log(`${changed ? 'Updated' : 'Kept'} source pack version ${packVersion}.`),
      )
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
