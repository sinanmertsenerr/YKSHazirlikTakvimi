import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  checkPackContentChange,
  writeGithubOutputs,
  type BuiltPackManifest,
} from '../check-pack-content-change.ts';

const descriptor = (path: string, hash = 'a'.repeat(64)) => ({
  path,
  sha256: hash,
  bytes: 10,
});

function manifest(packVersion: string): BuiltPackManifest {
  return {
    schemaVersion: 2,
    packVersion,
    minAppVersion: '1.0.0',
    examYear: 2026,
    files: {
      topics: descriptor('topics.json'),
      coefficients: descriptor('coefficients.json'),
      rankTables: descriptor('rank-tables.json'),
      programs: descriptor('programs.db'),
      calendar: descriptor('calendar.json'),
      news: descriptor('news.json'),
    },
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
}

test('content identity ignores only packVersion and writes fixed safe action outputs', async () => {
  const candidate = manifest('2026.07.150000000000001');
  const remote = manifest('2026.07.3');
  const result = await checkPackContentChange({
    candidateManifest: candidate,
    remoteManifestUrl: 'https://example.com/pack/manifest.json',
    fetchImpl: async () => jsonResponse(remote),
  });
  assert.deepEqual(result, {
    changed: false,
    reason: 'content-unchanged',
    remotePackVersion: '2026.07.3',
  });

  const directory = await mkdtemp(join(tmpdir(), 'yks-pack-output-'));
  const output = join(directory, 'github-output');
  try {
    await writeGithubOutputs(output, result);
    assert.equal(
      await readFile(output, 'utf8'),
      'changed=false\nreason=content-unchanged\nremote_pack_version=2026.07.3\n',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a file identity change publishes while an initial remote 404 also publishes', async () => {
  const candidate = manifest('2026.07.4');
  const remote = manifest('2026.07.3');
  remote.files.news.sha256 = 'b'.repeat(64);
  const changed = await checkPackContentChange({
    candidateManifest: candidate,
    remoteManifestUrl: 'https://example.com/pack/manifest.json',
    fetchImpl: async () => jsonResponse(remote),
  });
  assert.equal(changed.changed, true);
  assert.equal(changed.reason, 'content-changed');

  const missing = await checkPackContentChange({
    candidateManifest: candidate,
    remoteManifestUrl: 'https://example.com/pack/manifest.json',
    fetchImpl: async () => new Response(null, { status: 404 }),
  });
  assert.deepEqual(missing, {
    changed: true,
    reason: 'remote-missing',
    remotePackVersion: null,
  });
});

test('remote transport and schema safeguards fail closed', async () => {
  const candidate = manifest('2026.07.4');
  await assert.rejects(
    checkPackContentChange({
      candidateManifest: candidate,
      remoteManifestUrl: 'http://example.com/pack/manifest.json',
      fetchImpl: async () => jsonResponse(candidate),
    }),
    /clean HTTPS/,
  );
  await assert.rejects(
    checkPackContentChange({
      candidateManifest: candidate,
      remoteManifestUrl: 'https://example.com/pack/manifest.json',
      fetchImpl: async () =>
        new Response('{}', {
          headers: {
            'content-length': String(256 * 1024 + 1),
            'content-type': 'application/json',
          },
        }),
    }),
    /size limit/,
  );
  await assert.rejects(
    checkPackContentChange({
      candidateManifest: candidate,
      remoteManifestUrl: 'https://example.com/pack/manifest.json',
      fetchImpl: async () => jsonResponse({ ...candidate, unexpected: true }),
    }),
    /remote pack manifest is invalid/,
  );
  await assert.rejects(
    checkPackContentChange({
      candidateManifest: candidate,
      remoteManifestUrl: 'https://example.com/pack/manifest.json',
      timeoutMs: 100,
      fetchImpl: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return reject(new Error('missing timeout signal'));
          if (signal.aborted) return reject(signal.reason);
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    }),
    /timeout|aborted/i,
  );
});
