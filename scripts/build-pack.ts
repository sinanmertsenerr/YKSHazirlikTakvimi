import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildPrograms } from './build-programs.ts';
import { manifestSourceSchema } from './lib/content-schemas.ts';
import { validateSourcePack } from './validate-pack.ts';

export type BuildPackOptions = {
  contentDir?: string;
  outputDir?: string;
  packVersion?: string;
};

type FileManifest = {
  path: string;
  sha256: string;
  bytes: number;
};

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

async function replaceDirectoryAtomically(stagingDir: string, outputDir: string): Promise<void> {
  const backupDir = `${outputDir}.backup-${process.pid}`;
  await rm(backupDir, { recursive: true, force: true });

  let movedExisting = false;
  try {
    await rename(outputDir, backupDir);
    movedExisting = true;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (code !== 'ENOENT') throw error;
  }

  try {
    await rename(stagingDir, outputDir);
    if (movedExisting) await rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (movedExisting) await rename(backupDir, outputDir);
    throw error;
  }
}

export async function buildPack(options: BuildPackOptions = {}): Promise<string> {
  const contentDir = resolve(options.contentDir ?? resolve(process.cwd(), 'content'));
  const outputDir = resolve(options.outputDir ?? resolve(process.cwd(), 'assets/pack'));
  const sourceManifestPath = resolve(contentDir, 'manifest.source.json');

  const sourceManifestResult = manifestSourceSchema.safeParse(
    JSON.parse(await readFile(sourceManifestPath, 'utf8')) as unknown,
  );
  if (!sourceManifestResult.success) {
    throw new Error(
      `Invalid manifest source:\n${sourceManifestResult.error.issues
        .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
        .join('\n')}`,
    );
  }
  const sourceManifest = sourceManifestResult.data;
  const packVersionResult = manifestSourceSchema.shape.packVersion.safeParse(
    options.packVersion ?? sourceManifest.packVersion,
  );
  if (!packVersionResult.success) {
    throw new Error(
      `Invalid pack version override: ${packVersionResult.error.issues
        .map((issue) => issue.message)
        .join('; ')}`,
    );
  }
  const packVersion = packVersionResult.data;
  const programsSource = sourceManifest.files.programs.buildFrom;
  if (!programsSource) throw new Error('manifest.files.programs.buildFrom is required');

  await buildPrograms({
    inputPath: resolve(contentDir, programsSource),
    outputPath: resolve(contentDir, sourceManifest.files.programs.path),
  });

  const validation = await validateSourcePack({
    contentDir,
    programsDbPath: resolve(contentDir, sourceManifest.files.programs.path),
    // This run replaces assets/pack right after; the stale committed copy is expected
    // here. The bundled gate stays active in standalone validate:pack / CI.
    skipBundledDatabase: true,
  });
  if (validation.errors.length) {
    throw new Error(
      `Pack validation failed:\n${validation.errors.map((error) => `- ${error}`).join('\n')}`,
    );
  }

  await mkdir(dirname(outputDir), { recursive: true });
  const stagingDir = `${outputDir}.staging-${process.pid}`;
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  try {
    const files: Record<string, FileManifest> = {};
    for (const [key, descriptor] of Object.entries(sourceManifest.files)) {
      const sourcePath = resolve(contentDir, descriptor.path);
      const destinationPath = resolve(stagingDir, descriptor.path);
      await mkdir(dirname(destinationPath), { recursive: true });
      if (descriptor.path.endsWith('.json')) {
        const document = JSON.parse(await readFile(sourcePath, 'utf8')) as unknown;
        await writeFile(destinationPath, `${JSON.stringify(document)}\n`, 'utf8');
      } else {
        await copyFile(sourcePath, destinationPath);
      }
      const fileStat = await stat(destinationPath);
      files[key] = {
        path: descriptor.path,
        sha256: await sha256(destinationPath),
        bytes: fileStat.size,
      };
    }

    const manifest = {
      schemaVersion: sourceManifest.schemaVersion,
      packVersion,
      minAppVersion: sourceManifest.minAppVersion,
      examYear: sourceManifest.examYear,
      files,
    };
    await writeFile(resolve(stagingDir, 'manifest.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
    await replaceDirectoryAtomically(stagingDir, outputDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }

  return outputDir;
}

function parseOptions(args: string[]): BuildPackOptions {
  const options: BuildPackOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--content-dir' && value) {
      options.contentDir = value;
      index += 1;
    } else if (argument === '--output-dir' && value) {
      options.outputDir = value;
      index += 1;
    } else if (argument === '--pack-version' && value) {
      options.packVersion = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options: BuildPackOptions;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    options = { contentDir: resolve(process.cwd(), '__invalid__') };
  }

  if (process.exitCode !== 1) {
    buildPack(options)
      .then((outputDir) => console.log(`Built validated SHA-256 content pack: ${outputDir}`))
      .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
