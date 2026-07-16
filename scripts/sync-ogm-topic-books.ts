import { createHash } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertAllowedOgmUrl,
  includedOgmTopicSources,
  loadOgmTopicSourceRegistry,
  type IncludedOgmTopicSource,
  type OgmTopicSourceRegistry,
} from './lib/ogm-topic-registry.ts';
import { auditOgmTopicApi } from './lib/ogm-topic-api.ts';

export const DEFAULT_OGM_TOPIC_REGISTRY_PATH = resolve(
  process.cwd(),
  'content/ogm-yks-topic-sources.json',
);
export const MAX_OGM_PDF_BYTES = 64 * 1024 * 1024;
export const MAX_OGM_REDIRECTS = 3;
export const DEFAULT_OGM_TIMEOUT_MS = 90_000;
/** A transient download timeout is retried this many times total; a real drift never is. */
export const MAX_OGM_PDF_TIMEOUT_ATTEMPTS = 3;

const USER_AGENT = 'YKS-OGM-Topic-Source-Audit/1.0';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type OgmPdfObservation = {
  sourceId: number;
  resolverUrl: string;
  resolvedPdfUrl: string;
  bytes: number;
  sha256: string;
};

export type OgmRegistryDifference = {
  key: string;
  field: 'bytes' | 'sha256';
  expected: number | string;
  observed: number | string;
};

export type AuditOgmPdfOptions = {
  fetchImpl?: FetchLike;
  maxBytes?: number;
  tempRoot?: string;
  timeoutMs?: number;
  retryDelayImpl?: (milliseconds: number) => Promise<void>;
};

function isTransientTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

async function defaultRetryDelay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

type AuditOgmRegistryOptions = AuditOgmPdfOptions & { concurrency?: number };

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The stream may already be closed or aborted.
  }
}

async function openOfficialPdf(
  resolverUrl: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<{ response: Response; resolvedPdfUrl: string }> {
  let currentUrl = assertAllowedOgmUrl(resolverUrl);
  const signal = AbortSignal.timeout(timeoutMs);

  for (let redirectCount = 0; redirectCount <= MAX_OGM_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, {
      headers: { accept: 'application/pdf', 'user-agent': USER_AGENT },
      redirect: 'manual',
      signal,
    });
    if (!REDIRECT_STATUSES.has(response.status)) {
      if (!response.ok) {
        await cancelBody(response);
        throw new Error(`official OGM source returned HTTP ${response.status}`);
      }
      return { response, resolvedPdfUrl: currentUrl };
    }

    const location = response.headers.get('location');
    await cancelBody(response);
    if (!location) throw new Error(`HTTP ${response.status} redirect has no Location header`);
    if (redirectCount === MAX_OGM_REDIRECTS) {
      throw new Error(`official OGM source exceeded ${MAX_OGM_REDIRECTS} redirects`);
    }
    const target = new URL(location, currentUrl).href;
    try {
      currentUrl = assertAllowedOgmUrl(target);
    } catch (error) {
      throw new Error(
        `refused redirect to non-allowlisted URL ${target}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error('OGM redirect loop ended unexpectedly');
}

function declaredPdfBytes(response: Response, maxBytes: number): number {
  const header = response.headers.get('content-length');
  if (!header || !/^\d+$/.test(header)) {
    throw new Error('official OGM PDF must declare a valid Content-Length');
  }
  const bytes = Number(header);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error(`invalid Content-Length value: ${header}`);
  }
  if (bytes > maxBytes) {
    throw new Error(`declared PDF size ${bytes} exceeds the ${maxBytes}-byte safety limit`);
  }
  return bytes;
}

/**
 * Downloads and verifies one official PDF, retrying ONLY a transient download timeout. Every
 * §9.1 integrity failure (byte/sha256 drift, content-type, PDF magic) throws a plain Error and
 * is never retried, so a real drift can never be masked by the retry loop.
 */
export async function auditOgmTopicPdf(
  source: IncludedOgmTopicSource,
  options: AuditOgmPdfOptions = {},
): Promise<OgmPdfObservation> {
  const retryDelay = options.retryDelayImpl ?? defaultRetryDelay;
  for (let attempt = 1; attempt <= MAX_OGM_PDF_TIMEOUT_ATTEMPTS; attempt += 1) {
    try {
      return await auditOgmTopicPdfOnce(source, options);
    } catch (error) {
      if (!isTransientTimeout(error) || attempt === MAX_OGM_PDF_TIMEOUT_ATTEMPTS) throw error;
      await retryDelay(attempt === 1 ? 250 : 750);
    }
  }
  throw new Error('official OGM PDF audit retry loop ended unexpectedly');
}

async function auditOgmTopicPdfOnce(
  source: IncludedOgmTopicSource,
  options: AuditOgmPdfOptions = {},
): Promise<OgmPdfObservation> {
  const maxBytes = options.maxBytes ?? MAX_OGM_PDF_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_OGM_TIMEOUT_MS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 5 || maxBytes > MAX_OGM_PDF_BYTES) {
    throw new Error(`maxBytes must be an integer from 5 through ${MAX_OGM_PDF_BYTES}`);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('timeoutMs must be an integer from 1 through 120000');
  }

  const temporaryDirectory = await mkdtemp(join(options.tempRoot ?? tmpdir(), 'ogm-topic-audit-'));
  const temporaryPdf = join(temporaryDirectory, `${source.sourceId}.pdf`);
  let response: Response | undefined;
  try {
    const opened = await openOfficialPdf(source.resolverUrl, options.fetchImpl ?? fetch, timeoutMs);
    response = opened.response;
    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== 'application/pdf') {
      throw new Error(
        `expected Content-Type application/pdf, received ${contentType ?? '<missing>'}`,
      );
    }
    const contentEncoding = response.headers.get('content-encoding')?.trim().toLowerCase();
    if (contentEncoding && contentEncoding !== 'identity') {
      throw new Error(
        `unsupported Content-Encoding for deterministic PDF audit: ${contentEncoding}`,
      );
    }
    const declaredBytes = declaredPdfBytes(response, maxBytes);
    if (declaredBytes !== source.expected.bytes) {
      throw new Error(
        `source ${source.key} byte drift: expected ${source.expected.bytes}, declared ${declaredBytes}`,
      );
    }
    if (!response.body) throw new Error('official OGM source returned an empty body');

    const file = await open(temporaryPdf, 'wx', 0o600);
    const hash = createHash('sha256');
    let bytes = 0;
    let prefix = Buffer.alloc(0);
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > maxBytes || bytes > source.expected.bytes) {
          throw new Error(`downloaded PDF exceeded the pinned byte limit for ${source.key}`);
        }
        if (prefix.byteLength < 5) prefix = Buffer.concat([prefix, buffer]).subarray(0, 5);
        hash.update(buffer);
        await file.write(buffer);
      }
    } finally {
      await file.close();
    }

    if (prefix.toString('ascii') !== '%PDF-') {
      throw new Error('response does not have a PDF file signature');
    }
    if (bytes !== declaredBytes || bytes !== source.expected.bytes) {
      throw new Error(
        `source ${source.key} byte drift: expected ${source.expected.bytes}, downloaded ${bytes}`,
      );
    }
    const sha256 = hash.digest('hex');
    if (sha256 !== source.expected.sha256) {
      throw new Error(
        `source ${source.key} SHA-256 drift: expected ${source.expected.sha256}, observed ${sha256}`,
      );
    }
    return {
      sourceId: source.sourceId,
      resolverUrl: source.resolverUrl,
      resolvedPdfUrl: opened.resolvedPdfUrl,
      bytes,
      sha256,
    };
  } finally {
    if (response) await cancelBody(response);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function auditOgmTopicRegistry(
  registry: OgmTopicSourceRegistry,
  options: AuditOgmRegistryOptions = {},
): Promise<OgmPdfObservation[]> {
  const sources = includedOgmTopicSources(registry);
  const concurrency = options.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) {
    throw new Error('concurrency must be an integer from 1 through 3');
  }

  const observations = new Array<OgmPdfObservation>(sources.length);
  const failures: Error[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      const source = sources[index];
      if (!source) return;
      try {
        observations[index] = await auditOgmTopicPdf(source, options);
      } catch (error) {
        failures.push(
          new Error(`${source.key}: ${error instanceof Error ? error.message : String(error)}`),
        );
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (failures.length) {
    throw new AggregateError(failures, `${failures.length} official OGM source audit(s) failed`);
  }
  return observations;
}

export function compareOgmRegistryToObservations(
  registry: OgmTopicSourceRegistry,
  observations: readonly OgmPdfObservation[],
): OgmRegistryDifference[] {
  const byId = new Map(observations.map((observation) => [observation.sourceId, observation]));
  const differences: OgmRegistryDifference[] = [];
  for (const source of includedOgmTopicSources(registry)) {
    const observation = byId.get(source.sourceId);
    if (!observation) throw new Error(`missing observation for ${source.key}`);
    for (const field of ['bytes', 'sha256'] as const) {
      if (source.expected[field] !== observation[field]) {
        differences.push({
          key: source.key,
          field,
          expected: source.expected[field],
          observed: observation[field],
        });
      }
    }
  }
  return differences;
}

type CliOptions = {
  concurrency: number;
  mode: 'api-deep' | 'api-only' | 'audit' | 'validate-only';
  registryPath: string;
};

export function parseOgmTopicCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    concurrency: 2,
    mode: 'audit',
    registryPath: DEFAULT_OGM_TOPIC_REGISTRY_PATH,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--audit') options.mode = 'audit';
    else if (argument === '--api-deep') options.mode = 'api-deep';
    else if (argument === '--api-only') options.mode = 'api-only';
    else if (argument === '--validate-only') options.mode = 'validate-only';
    else if (argument === '--registry') {
      const value = args[index + 1];
      if (!value) throw new Error('--registry requires a path');
      options.registryPath = resolve(value);
      index += 1;
    } else if (argument === '--concurrency') {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 3) {
        throw new Error('--concurrency must be an integer from 1 through 3');
      }
      options.concurrency = value;
      index += 1;
    } else if (argument === '--write' || argument === '--accept-changes') {
      throw new Error('OGM topic source audit is read-only; registry changes require code review');
    } else throw new Error(`unknown or incomplete argument: ${argument ?? '<empty>'}`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseOgmTopicCliOptions(process.argv.slice(2));
  const registry = await loadOgmTopicSourceRegistry(options.registryPath);
  const included = includedOgmTopicSources(registry);
  console.log(
    `OGM registry valid: ${included.length} included source(s), ${registry.sources.length - included.length} excluded source(s).`,
  );
  if (options.mode === 'validate-only') return;

  if (options.mode === 'audit') {
    const observations = await auditOgmTopicRegistry(registry, {
      concurrency: options.concurrency,
    });
    for (const observation of observations) {
      console.log(
        `Verified ${observation.sourceId}: ${observation.bytes} bytes, SHA-256 ${observation.sha256}.`,
      );
    }
    const differences = compareOgmRegistryToObservations(registry, observations);
    if (differences.length) throw new Error('official OGM source metadata drifted');
  }
  for (const source of included) {
    try {
      const observation = await auditOgmTopicApi(source, {
        concurrency: options.concurrency,
        deep: options.mode === 'api-deep',
      });
      const detail = observation.questionIdCount
        ? `, ${observation.questionIdCount} question ID records`
        : '';
      console.log(
        `Verified API ${source.key}: ${observation.testCount} tests, ${observation.questionCount} declared questions${detail}.`,
      );
    } catch (error) {
      throw new Error(
        `API audit failed for ${source.key}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  console.log('All included OGM source metadata match; no files were published.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    if (error instanceof AggregateError) {
      console.error(error.message);
      for (const cause of error.errors)
        console.error(cause instanceof Error ? cause.message : cause);
    } else console.error(error);
    process.exitCode = 1;
  });
}
