import { appendFile, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import { CURRENT_SCHEMA_VERSION, manifestSourceSchema } from './lib/content-schemas.ts';

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_PACK_FILE_BYTES = 250 * 1024 * 1024;
const MAX_TOTAL_PACK_BYTES = 300 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const manifestFileSchema = z
  .object({
    path: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.int().nonnegative().max(MAX_PACK_FILE_BYTES),
  })
  .strict();

export const builtPackManifestSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    packVersion: manifestSourceSchema.shape.packVersion,
    minAppVersion: manifestSourceSchema.shape.minAppVersion,
    examYear: manifestSourceSchema.shape.examYear,
    files: z
      .object({
        topics: manifestFileSchema,
        coefficients: manifestFileSchema,
        rankTables: manifestFileSchema,
        programs: manifestFileSchema,
        calendar: manifestFileSchema,
        news: manifestFileSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const paths = Object.values(manifest.files).map((descriptor) => descriptor.path);
    if (new Set(paths).size !== paths.length) {
      context.addIssue({ code: 'custom', path: ['files'], message: 'file paths must be unique' });
    }
    if (paths.includes('manifest.json')) {
      context.addIssue({ code: 'custom', path: ['files'], message: 'manifest.json is reserved' });
    }
    const totalBytes = Object.values(manifest.files).reduce(
      (total, descriptor) => total + descriptor.bytes,
      0,
    );
    if (totalBytes > MAX_TOTAL_PACK_BYTES) {
      context.addIssue({ code: 'custom', path: ['files'], message: 'pack is too large' });
    }
  });

export type BuiltPackManifest = z.infer<typeof builtPackManifestSchema>;
export type PackContentChangeResult =
  | {
      changed: false;
      reason: 'content-unchanged';
      remotePackVersion: string;
    }
  | {
      changed: true;
      reason: 'content-changed';
      remotePackVersion: string;
    }
  | {
      changed: true;
      reason: 'remote-missing';
      remotePackVersion: null;
    };

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type CheckPackContentChangeOptions = {
  candidateManifest: unknown;
  remoteManifestUrl: string;
  fetchImpl?: FetchLike;
  maxBytes?: number;
  timeoutMs?: number;
};

type CliOptions = {
  appConfigPath?: string;
  githubOutputPath?: string;
  localManifestPath?: string;
  remoteManifestUrl?: string;
};

function formatSchemaError(label: string, error: z.ZodError): Error {
  return new Error(
    `${label} is invalid:\n${error.issues
      .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
      .join('\n')}`,
  );
}

function parseManifest(value: unknown, label: string): BuiltPackManifest {
  const result = builtPackManifestSchema.safeParse(value);
  if (!result.success) throw formatSchemaError(label, result.error);
  return result.data;
}

export function packContentIdentity(manifest: unknown): Omit<BuiltPackManifest, 'packVersion'> {
  const { packVersion: _ignored, ...identity } = parseManifest(manifest, 'pack manifest');
  return identity;
}

function assertRemoteManifestUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Remote manifest URL must be a valid HTTPS URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('/manifest.json')
  ) {
    throw new Error('Remote manifest URL must be a clean HTTPS .../manifest.json URL.');
  }
  return url;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body may already be closed.
  }
}

function declaredResponseBytes(response: Response, maxBytes: number): number | undefined {
  const header = response.headers.get('content-length');
  if (header === null) return undefined;
  if (!/^\d+$/.test(header)) throw new Error('Remote manifest has an invalid Content-Length.');
  const bytes = Number(header);
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new Error('Remote manifest has an invalid Content-Length.');
  }
  if (bytes > maxBytes) throw new Error('Remote manifest exceeds the response size limit.');
  return bytes;
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  declaredResponseBytes(response, maxBytes);
  if (!response.body) throw new Error('Remote manifest response has no body.');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) throw new Error('Remote manifest exceeds the response size limit.');
    chunks.push(buffer);
  }
  if (bytes === 0) throw new Error('Remote manifest response is empty.');
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchRemoteManifest(
  value: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
  maxBytes: number,
): Promise<BuiltPackManifest | null> {
  const initialUrl = assertRemoteManifestUrl(value);
  let currentUrl = initialUrl;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('Remote manifest request timeout.')),
    timeoutMs,
  );

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetchImpl(currentUrl, {
        headers: { accept: 'application/json', 'cache-control': 'no-cache' },
        redirect: 'manual',
        signal: controller.signal,
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        await cancelBody(response);
        if (!location) throw new Error('Remote manifest redirect has no Location header.');
        if (redirectCount === MAX_REDIRECTS) {
          throw new Error(`Remote manifest exceeded ${MAX_REDIRECTS} redirects.`);
        }
        const redirected = assertRemoteManifestUrl(new URL(location, currentUrl).href);
        if (redirected.origin !== initialUrl.origin) {
          throw new Error('Remote manifest redirect changed origin.');
        }
        currentUrl = redirected;
        continue;
      }
      if (response.status === 404) {
        await cancelBody(response);
        return null;
      }
      if (!response.ok) {
        await cancelBody(response);
        throw new Error(`Remote manifest request failed with HTTP ${response.status}.`);
      }
      const contentType = response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== 'application/json' && !contentType?.endsWith('+json')) {
        await cancelBody(response);
        throw new Error('Remote manifest response must use a JSON Content-Type.');
      }
      const text = await readResponseText(response, maxBytes);
      let data: unknown;
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        throw new Error('Remote manifest is not valid JSON.');
      }
      return parseManifest(data, 'remote pack manifest');
    }
    throw new Error('Remote manifest redirect loop ended unexpectedly.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkPackContentChange({
  candidateManifest,
  remoteManifestUrl,
  fetchImpl = fetch,
  maxBytes = MAX_MANIFEST_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: CheckPackContentChangeOptions): Promise<PackContentChangeResult> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error('timeoutMs must be an integer from 100 through 60000.');
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_MANIFEST_BYTES) {
    throw new Error(`maxBytes must be an integer from 1024 through ${MAX_MANIFEST_BYTES}.`);
  }
  const candidate = parseManifest(candidateManifest, 'candidate pack manifest');
  const remote = await fetchRemoteManifest(remoteManifestUrl, fetchImpl, timeoutMs, maxBytes);
  if (remote === null) {
    return { changed: true, reason: 'remote-missing', remotePackVersion: null };
  }
  const changed = !isDeepStrictEqual(packContentIdentity(candidate), packContentIdentity(remote));
  return changed
    ? { changed: true, reason: 'content-changed', remotePackVersion: remote.packVersion }
    : { changed: false, reason: 'content-unchanged', remotePackVersion: remote.packVersion };
}

async function readLimitedJson(path: string, label: string): Promise<unknown> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`${label} must be a file.`);
  if (metadata.size < 1 || metadata.size > MAX_MANIFEST_BYTES) {
    throw new Error(`${label} exceeds the local file size limit.`);
  }
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export async function configuredRemoteManifestUrl(appConfigPath: string): Promise<string> {
  const raw = await readLimitedJson(appConfigPath, 'app config');
  const result = z
    .object({
      expo: z
        .object({
          extra: z.object({ packBaseUrl: z.string().min(1) }).passthrough(),
        })
        .passthrough(),
    })
    .passthrough()
    .safeParse(raw);
  if (!result.success) throw formatSchemaError('app config', result.error);
  const baseUrl = result.data.expo.extra.packBaseUrl.trim().replace(/\/+$/, '');
  return assertRemoteManifestUrl(`${baseUrl}/manifest.json`).href;
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {};
  const fields = new Map<string, keyof CliOptions>([
    ['--app-config', 'appConfigPath'],
    ['--github-output', 'githubOutputPath'],
    ['--local', 'localManifestPath'],
    ['--remote-url', 'remoteManifestUrl'],
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
  return options;
}

export async function writeGithubOutputs(
  path: string,
  result: PackContentChangeResult,
): Promise<void> {
  const outputs = {
    changed: String(result.changed),
    reason: result.reason,
    remote_pack_version: result.remotePackVersion ?? '',
  };
  const lines = Object.entries(outputs).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /[\r\n]/.test(value)) {
      throw new Error('Refused an unsafe GitHub Actions output value.');
    }
    return `${key}=${value}`;
  });
  await appendFile(resolve(path), `${lines.join('\n')}\n`, 'utf8');
}

async function runCli(options: CliOptions): Promise<PackContentChangeResult> {
  const localManifestPath = resolve(
    options.localManifestPath ?? resolve(process.cwd(), 'assets/pack/manifest.json'),
  );
  const appConfigPath = resolve(options.appConfigPath ?? resolve(process.cwd(), 'app.json'));
  const remoteManifestUrl =
    options.remoteManifestUrl ?? (await configuredRemoteManifestUrl(appConfigPath));
  const result = await checkPackContentChange({
    candidateManifest: await readLimitedJson(localManifestPath, 'candidate pack manifest'),
    remoteManifestUrl,
  });
  if (options.githubOutputPath) await writeGithubOutputs(options.githubOutputPath, result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options: CliOptions;
  try {
    options = parseCliOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    options = {};
  }
  if (process.exitCode !== 1) {
    runCli(options)
      .then((result) => console.log(JSON.stringify(result)))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
