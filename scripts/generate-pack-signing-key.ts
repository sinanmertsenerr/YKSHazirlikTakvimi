import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function base64UrlToBase64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
}

function parseOptions(args: string[]): {
  keyId: string;
  privateOutput: string;
  publicOutput: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (
      !option ||
      !value ||
      !['--key-id', '--private-output', '--public-output'].includes(option)
    ) {
      throw new Error(`Unknown or incomplete argument: ${option ?? '<empty>'}`);
    }
    values.set(option, value);
  }
  const keyId = values.get('--key-id');
  const privateOutput = values.get('--private-output');
  const publicOutput = values.get('--public-output');
  if (!keyId || !privateOutput || !publicOutput) {
    throw new Error('--key-id, --private-output, and --public-output are required.');
  }
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(keyId) || keyId.length > 64) {
    throw new Error('keyId must be a lowercase identifier of at most 64 characters.');
  }
  return {
    keyId,
    privateOutput: resolve(privateOutput),
    publicOutput: resolve(publicOutput),
  };
}

export async function generatePackSigningKey(options: {
  keyId: string;
  privateOutput: string;
  publicOutput: string;
}): Promise<void> {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const publicJwk = publicKey.export({ format: 'jwk' });
  if (publicJwk.kty !== 'OKP' || publicJwk.crv !== 'Ed25519' || !publicJwk.x) {
    throw new Error('Generated key did not export as an Ed25519 public JWK.');
  }
  const publicKeyBase64 = base64UrlToBase64(publicJwk.x);
  await writeFile(options.privateOutput, privateKeyPem, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(
    options.publicOutput,
    `${JSON.stringify({ keyId: options.keyId, publicKey: publicKeyBase64 }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o644 },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options: ReturnType<typeof parseOptions>;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    options = { keyId: '', privateOutput: '', publicOutput: '' };
  }
  if (process.exitCode !== 1) {
    generatePackSigningKey(options)
      .then(() => {
        console.log(`Generated ${options.keyId} public metadata at ${options.publicOutput}.`);
        console.log(
          `Generated private key at ${options.privateOutput}; keep it secret and remove it after CI setup.`,
        );
      })
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
