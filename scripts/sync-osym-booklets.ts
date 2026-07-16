import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertAllowedOfficialPdfUrl,
  osymBookletRegistrySchema,
  type OsymBooklet,
  type OsymBookletRegistry,
} from './lib/osym-booklet-registry.ts';

export const DEFAULT_REGISTRY_PATH = resolve(process.cwd(), 'content/osym-booklets.json');
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_ATTEMPTS = 3;
const USER_AGENT = 'YKS-Source-Registry/1.0 (+https://github.com/)';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type PdfObservation = {
  pdfUrl: string;
  bytes: number;
  sha256: string;
};

export type RegistryDifference = {
  key: string;
  field: 'bytes' | 'sha256';
  expected: number | string;
  observed: number | string;
};

type AuditPdfOptions = {
  attempts?: number;
  fetchImpl?: FetchLike;
  maxBytes?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
};

type AuditRegistryOptions = AuditPdfOptions & {
  concurrency?: number;
  onVerified?: (booklet: OsymBooklet, observation: PdfObservation) => void;
};

class SourceAuditError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'SourceAuditError';
    this.retryable = retryable;
  }
}

function bookletKey(booklet: Pick<OsymBooklet, 'year' | 'session'>): string {
  return `${booklet.year}-${booklet.session}`;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The connection may already be closed or aborted.
  }
}

function parseDeclaredLength(response: Response, maxBytes: number): number | undefined {
  const header = response.headers.get('content-length');
  if (!header) return undefined;
  if (!/^\d+$/.test(header)) {
    throw new SourceAuditError(`invalid Content-Length header: ${header}`, false);
  }
  const bytes = Number(header);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new SourceAuditError(`invalid Content-Length value: ${header}`, false);
  }
  if (bytes > maxBytes) {
    throw new SourceAuditError(
      `declared PDF size ${bytes} exceeds the ${maxBytes}-byte safety limit`,
      false,
    );
  }
  return bytes;
}

async function openOfficialPdf(
  initialUrl: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<Response> {
  let currentUrl = assertAllowedOfficialPdfUrl(initialUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetchImpl(currentUrl, {
      headers: {
        accept: 'application/pdf',
        'user-agent': USER_AGENT,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await cancelBody(response);
      if (!location) {
        throw new SourceAuditError(
          `HTTP ${response.status} redirect has no Location header`,
          false,
        );
      }
      if (redirectCount === MAX_REDIRECTS) {
        throw new SourceAuditError(`more than ${MAX_REDIRECTS} redirects`, false);
      }

      const redirectedUrl = new URL(location, currentUrl);
      try {
        currentUrl = assertAllowedOfficialPdfUrl(redirectedUrl.href);
      } catch (error) {
        throw new SourceAuditError(
          `refused redirect to non-allowlisted URL ${redirectedUrl.href}: ${error instanceof Error ? error.message : String(error)}`,
          false,
        );
      }
      continue;
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      await cancelBody(response);
      throw new SourceAuditError(`official source returned HTTP ${response.status}`, retryable);
    }

    return response;
  }

  throw new SourceAuditError('redirect loop ended unexpectedly', false);
}

async function auditOfficialPdfOnce(
  pdfUrl: string,
  options: Required<Pick<AuditPdfOptions, 'fetchImpl' | 'maxBytes' | 'timeoutMs'>>,
): Promise<PdfObservation> {
  const response = await openOfficialPdf(pdfUrl, options.fetchImpl, options.timeoutMs);

  try {
    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== 'application/pdf') {
      throw new SourceAuditError(
        `expected Content-Type application/pdf, received ${contentType ?? '<missing>'}`,
        false,
      );
    }
    if (!response.body) throw new SourceAuditError('official source returned an empty body', true);

    const declaredLength = parseDeclaredLength(response, options.maxBytes);
    const verifyDeclaredLength =
      !response.headers.get('content-encoding') ||
      response.headers.get('content-encoding')?.toLowerCase() === 'identity';
    const hash = createHash('sha256');
    let bytes = 0;
    let prefix = Buffer.alloc(0);
    let magicChecked = false;

    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > options.maxBytes) {
        throw new SourceAuditError(
          `downloaded PDF exceeds the ${options.maxBytes}-byte safety limit`,
          false,
        );
      }

      if (!magicChecked) {
        prefix = Buffer.concat([prefix, buffer]).subarray(0, 5);
        if (prefix.byteLength === 5) {
          magicChecked = true;
          if (prefix.toString('ascii') !== '%PDF-') {
            throw new SourceAuditError('response does not have a PDF file signature', false);
          }
        }
      }
      hash.update(buffer);
    }

    if (!magicChecked) throw new SourceAuditError('response is too short to be a PDF', false);
    if (verifyDeclaredLength && declaredLength !== undefined && declaredLength !== bytes) {
      throw new SourceAuditError(
        `Content-Length mismatch: declared ${declaredLength}, downloaded ${bytes}`,
        true,
      );
    }

    return { pdfUrl, bytes, sha256: hash.digest('hex') };
  } catch (error) {
    await cancelBody(response);
    throw error;
  }
}

export async function auditOfficialPdf(
  pdfUrl: string,
  options: AuditPdfOptions = {},
): Promise<PdfObservation> {
  assertAllowedOfficialPdfUrl(pdfUrl);
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) {
    throw new Error('attempts must be an integer from 1 through 5');
  }
  const maxBytes = options.maxBytes ?? MAX_PDF_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds)));

  let lastError: unknown;
  let performedAttempts = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    performedAttempts = attempt;
    try {
      return await auditOfficialPdfOnce(pdfUrl, { fetchImpl, maxBytes, timeoutMs });
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof SourceAuditError) || error.retryable;
      if (!retryable || attempt === attempts) break;
      await sleep(400 * 2 ** (attempt - 1));
    }
  }

  throw new Error(
    `could not audit ${pdfUrl} after ${performedAttempts} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    { cause: lastError },
  );
}

export async function auditRegistrySources(
  registry: OsymBookletRegistry,
  options: AuditRegistryOptions = {},
): Promise<PdfObservation[]> {
  const concurrency = options.concurrency ?? 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error('concurrency must be an integer from 1 through 4');
  }

  const observations = new Array<PdfObservation>(registry.booklets.length);
  const failures: Error[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      const booklet = registry.booklets[index];
      if (!booklet) return;

      try {
        const observation = await auditOfficialPdf(booklet.pdfUrl, options);
        observations[index] = observation;
        options.onVerified?.(booklet, observation);
      } catch (error) {
        failures.push(
          new Error(
            `${bookletKey(booklet)}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          ),
        );
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (failures.length) {
    throw new AggregateError(
      failures,
      `${failures.length} official booklet source audit(s) failed`,
    );
  }
  return observations;
}

export function compareRegistryToObservations(
  registry: OsymBookletRegistry,
  observations: readonly PdfObservation[],
): RegistryDifference[] {
  const byUrl = new Map(observations.map((observation) => [observation.pdfUrl, observation]));
  const differences: RegistryDifference[] = [];

  for (const booklet of registry.booklets) {
    const observation = byUrl.get(booklet.pdfUrl);
    if (!observation) {
      throw new Error(`missing observation for ${bookletKey(booklet)}`);
    }
    if (booklet.bytes !== observation.bytes) {
      differences.push({
        key: bookletKey(booklet),
        field: 'bytes',
        expected: booklet.bytes,
        observed: observation.bytes,
      });
    }
    if (booklet.sha256 !== observation.sha256) {
      differences.push({
        key: bookletKey(booklet),
        field: 'sha256',
        expected: booklet.sha256,
        observed: observation.sha256,
      });
    }
  }
  return differences;
}

/** Applies byte/hash observations without ever re-attesting structural header metadata. */
export function applyRegistryObservations(
  registry: OsymBookletRegistry,
  observations: readonly PdfObservation[],
  verifiedAt: string,
): OsymBookletRegistry {
  const normalizedVerifiedAt = /^\d{4}-\d{2}-\d{2}$/.test(verifiedAt)
    ? verifiedAt
    : (() => {
        throw new Error('verifiedAt must be an ISO calendar date');
      })();
  const observedByUrl = new Map(
    observations.map((observation) => [observation.pdfUrl, observation]),
  );
  if (observedByUrl.size !== registry.booklets.length) {
    throw new Error('observations must cover every registered booklet exactly once');
  }
  const updated = {
    ...registry,
    booklets: registry.booklets.map((booklet) => {
      const observation = observedByUrl.get(booklet.pdfUrl);
      if (!observation) throw new Error(`missing observation for ${bookletKey(booklet)}`);
      return {
        ...booklet,
        verifiedAt: normalizedVerifiedAt,
        bytes: observation.bytes,
        sha256: observation.sha256,
      };
    }),
  };
  const parsed = osymBookletRegistrySchema.parse(updated);
  if (
    JSON.stringify(parsed.questionBlockProfiles) !== JSON.stringify(registry.questionBlockProfiles)
  ) {
    throw new Error('source sync must preserve independently verified question-block profiles');
  }
  return parsed;
}

async function readRegistry(path: string): Promise<OsymBookletRegistry> {
  const parsedJson = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const parsed = osymBookletRegistrySchema.safeParse(parsedJson);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
      .join('\n');
    throw new Error(`invalid booklet registry at ${path}:\n${issues}`);
  }
  return parsed.data;
}

async function writeRegistryAtomically(path: string, registry: OsymBookletRegistry): Promise<void> {
  const validated = osymBookletRegistrySchema.parse(registry);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

type CliOptions = {
  acceptChanges: boolean;
  concurrency: number;
  mode: 'check' | 'validate-only' | 'write';
  registryPath: string;
};

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    acceptChanges: false,
    concurrency: 2,
    mode: 'check',
    registryPath: DEFAULT_REGISTRY_PATH,
  };
  let explicitMode: CliOptions['mode'] | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--check' || argument === '--validate-only' || argument === '--write') {
      const mode = argument.slice(2) as CliOptions['mode'];
      if (explicitMode && explicitMode !== mode) {
        throw new Error('choose exactly one of --check, --validate-only, or --write');
      }
      explicitMode = mode;
      options.mode = mode;
    } else if (argument === '--accept-changes') {
      options.acceptChanges = true;
    } else if (argument === '--concurrency') {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 4) {
        throw new Error('--concurrency must be an integer from 1 through 4');
      }
      options.concurrency = value;
      index += 1;
    } else if (argument === '--registry') {
      const value = args[index + 1];
      if (!value) throw new Error('--registry requires a path');
      options.registryPath = resolve(value);
      index += 1;
    } else {
      throw new Error(`unknown or incomplete argument: ${argument ?? '<empty>'}`);
    }
  }

  if (options.acceptChanges && options.mode !== 'write') {
    throw new Error('--accept-changes is only valid together with --write');
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const registry = await readRegistry(options.registryPath);
  console.log(`Registry schema is valid: ${registry.booklets.length} official TYT/AYT booklets.`);
  if (options.mode === 'validate-only') return;

  const observations = await auditRegistrySources(registry, {
    concurrency: options.concurrency,
    onVerified: (booklet, observation) => {
      console.log(
        `Verified ${bookletKey(booklet)}: ${observation.bytes} bytes, SHA-256 ${observation.sha256.slice(0, 12)}…`,
      );
    },
  });
  const differences = compareRegistryToObservations(registry, observations);

  if (differences.length && (options.mode !== 'write' || !options.acceptChanges)) {
    for (const difference of differences) {
      console.error(
        `CHANGED ${difference.key} ${difference.field}: expected ${difference.expected}, observed ${difference.observed}`,
      );
    }
    throw new Error(
      'Official source content changed. Review the upstream document; only then use --write --accept-changes.',
    );
  }

  if (options.mode === 'check') {
    console.log('All registered hashes and byte lengths match the live official PDFs.');
    return;
  }

  const verifiedAt = new Date().toISOString().slice(0, 10);
  const updatedRegistry = applyRegistryObservations(registry, observations, verifiedAt);
  await writeRegistryAtomically(options.registryPath, updatedRegistry);
  console.log(
    `Atomically updated ${options.registryPath} (${differences.length} accepted upstream field change(s)).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    if (error instanceof AggregateError) {
      console.error(error.message);
      for (const cause of error.errors) {
        console.error(cause instanceof Error ? cause.message : String(cause));
      }
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
}
