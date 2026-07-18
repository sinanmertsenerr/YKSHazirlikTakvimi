import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  MAX_PACK_SIGNATURE_BYTES,
  PACK_SIGNATURE_FILE_NAME,
  parsePackSignatureEnvelope,
  type PackSignature,
} from './lib/pack-signature-contract.ts';
import {
  signPackManifest,
  verifyPackManifestSignatureWithNode,
} from './lib/pack-signature-node.ts';
import { TRUSTED_PACK_PUBLIC_KEYS } from './lib/trusted-pack-keys.ts';

const MAX_MANIFEST_BYTES = 1024 * 1024;

type SignPackOptions = {
  manifestPath: string;
  outputPath: string;
  keyId: string;
  privateKeyPem: string;
  append?: boolean;
};

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

export async function signPack(options: SignPackOptions): Promise<void> {
  const manifest = await readLimitedJson(options.manifestPath, MAX_MANIFEST_BYTES, 'Pack manifest');
  const signed = signPackManifest(
    manifest,
    options.keyId,
    options.privateKeyPem,
    TRUSTED_PACK_PUBLIC_KEYS,
  );
  const signatures: PackSignature[] = [];
  if (options.append) {
    const existing = parsePackSignatureEnvelope(
      await readLimitedJson(
        options.outputPath,
        MAX_PACK_SIGNATURE_BYTES,
        'Existing pack signature',
      ),
    );
    for (const candidate of existing.signatures) {
      if (candidate.keyId === options.keyId) continue;
      verifyPackManifestSignatureWithNode(
        manifest,
        { schemaVersion: 1, signatures: [candidate] },
        TRUSTED_PACK_PUBLIC_KEYS,
      );
      signatures.push(candidate);
    }
  }
  signatures.push(...signed.signatures);
  const envelope = parsePackSignatureEnvelope({ schemaVersion: 1, signatures });
  verifyPackManifestSignatureWithNode(manifest, envelope, TRUSTED_PACK_PUBLIC_KEYS);
  const contents = `${JSON.stringify(envelope, null, 2)}\n`;
  if (Buffer.byteLength(contents) > MAX_PACK_SIGNATURE_BYTES) {
    throw new Error('Generated pack signature envelope exceeds its size limit.');
  }
  const temporaryPath = resolve(dirname(options.outputPath), `.manifest.sig-${process.pid}.tmp`);
  await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o644 });
  await rename(temporaryPath, options.outputPath);
}

function parseOptions(args: string[]): Omit<SignPackOptions, 'privateKeyPem'> {
  let manifestPath = resolve(process.cwd(), 'assets/pack/manifest.json');
  let outputPath = resolve(process.cwd(), 'assets/pack', PACK_SIGNATURE_FILE_NAME);
  let keyId = process.env.PACK_SIGNING_KEY_ID ?? '';
  let append = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--append') {
      append = true;
      continue;
    }
    const value = args[index + 1];
    if (argument === '--manifest' && value) manifestPath = resolve(value);
    else if (argument === '--output' && value) outputPath = resolve(value);
    else if (argument === '--key-id' && value) keyId = value;
    else throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    index += 1;
  }
  if (!keyId) throw new Error('PACK_SIGNING_KEY_ID or --key-id is required.');
  return { manifestPath, outputPath, keyId, append };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options: Omit<SignPackOptions, 'privateKeyPem'>;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    options = { manifestPath: '', outputPath: '', keyId: '' };
  }
  if (process.exitCode !== 1) {
    const privateKeyPem = process.env.PACK_SIGNING_PRIVATE_KEY_PEM;
    if (!privateKeyPem) {
      console.error('PACK_SIGNING_PRIVATE_KEY_PEM is required.');
      process.exitCode = 1;
    } else {
      signPack({ ...options, privateKeyPem })
        .then(() => console.log(`Signed pack manifest: ${options.outputPath}`))
        .catch((error: unknown) => {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        });
    }
  }
}
