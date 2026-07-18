import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  MAX_PACK_SIGNATURE_BYTES,
  PACK_SIGNATURE_FILE_NAME,
} from './lib/pack-signature-contract.ts';
import { verifyPackManifestSignatureWithNode } from './lib/pack-signature-node.ts';
import { TRUSTED_PACK_PUBLIC_KEYS } from './lib/trusted-pack-keys.ts';

const MAX_MANIFEST_BYTES = 1024 * 1024;

async function readLimitedJson(path: string, maxBytes: number, label: string): Promise<unknown> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > maxBytes) {
    throw new Error(`${label} has an invalid size.`);
  }
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export async function verifyPackSignatureFiles(
  manifestPath: string,
  signaturePath: string,
): Promise<void> {
  const [manifest, signature] = await Promise.all([
    readLimitedJson(manifestPath, MAX_MANIFEST_BYTES, 'Pack manifest'),
    readLimitedJson(signaturePath, MAX_PACK_SIGNATURE_BYTES, 'Pack signature'),
  ]);
  verifyPackManifestSignatureWithNode(manifest, signature, TRUSTED_PACK_PUBLIC_KEYS);
}

function parseOptions(args: string[]): { manifestPath: string; signaturePath: string } {
  let manifestPath = resolve(process.cwd(), 'assets/pack/manifest.json');
  let signaturePath = resolve(process.cwd(), 'assets/pack', PACK_SIGNATURE_FILE_NAME);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--manifest' && value) manifestPath = resolve(value);
    else if (argument === '--signature' && value) signaturePath = resolve(value);
    else throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    index += 1;
  }
  return { manifestPath, signaturePath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options: ReturnType<typeof parseOptions>;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    options = { manifestPath: '', signaturePath: '' };
  }
  if (process.exitCode !== 1) {
    verifyPackSignatureFiles(options.manifestPath, options.signaturePath)
      .then(() => console.log(`Verified pack manifest signature: ${options.signaturePath}`))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
