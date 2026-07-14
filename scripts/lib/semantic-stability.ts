import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

type VerifiedRecord = { verifiedAt: string | null };

function withoutVerificationTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutVerificationTimestamps);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'verifiedAt')
      .map(([key, nested]) => [key, withoutVerificationTimestamps(nested)]),
  );
}

export function verifiedFactsEqual(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(
    withoutVerificationTimestamps(left),
    withoutVerificationTimestamps(right),
  );
}

export function preserveVerifiedAtIfUnchanged<T extends VerifiedRecord>(
  candidate: T,
  previous: T | undefined,
): T {
  if (!previous || !verifiedFactsEqual(candidate, previous)) return candidate;
  return { ...candidate, verifiedAt: previous.verifiedAt };
}

export function preserveStableRecordVerificationTimes<T extends VerifiedRecord>(
  candidates: readonly T[],
  previousRecords: readonly T[],
  keyOf: (record: T) => string,
): T[] {
  const previousByKey = new Map<string, T>();
  for (const record of previousRecords) {
    const key = keyOf(record);
    if (previousByKey.has(key)) throw new Error(`Duplicate previous verified record key: ${key}`);
    previousByKey.set(key, record);
  }
  const candidateKeys = new Set<string>();
  return candidates.map((candidate) => {
    const key = keyOf(candidate);
    if (candidateKeys.has(key)) throw new Error(`Duplicate candidate verified record key: ${key}`);
    candidateKeys.add(key);
    return preserveVerifiedAtIfUnchanged(candidate, previousByKey.get(key));
  });
}

export async function readTextFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeTextFileAtomicallyIfChanged(
  path: string,
  contents: string,
): Promise<boolean> {
  if ((await readTextFileIfExists(path)) === contents) return false;
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return true;
}
