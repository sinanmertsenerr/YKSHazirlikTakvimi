import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  checkPackContentChange,
  writeGithubOutputs,
  type BuiltPackManifest,
} from '../check-pack-content-change.ts';
import { signPackManifest } from '../lib/pack-signature-node.ts';

const descriptor = (path: string, hash = 'a'.repeat(64)) => ({
  path,
  sha256: hash,
  bytes: 10,
});

function manifest(packVersion: string): BuiltPackManifest {
  return {
    schemaVersion: 3,
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
      topicGroupStatistics: descriptor('topic-group-statistics.json'),
      topicGroupMappings: descriptor('topic-group-mappings.json'),
    },
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
}

function pgpSignatureResponse(value: unknown): Response {
  // GitHub Pages (and most static hosts) serve a `.sig` file as
  // application/pgp-signature, never application/json, even though its bytes are a
  // JSON-shaped signature envelope. This mirrors production reality.
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/pgp-signature' },
  });
}

const signingKeyId = 'content-change-test';
const signingKeyPair = generateKeyPairSync('ed25519');
const signingPublicJwk = signingKeyPair.publicKey.export({ format: 'jwk' });
assert.ok(signingPublicJwk.x);
const trustedKeys = {
  [signingKeyId]: signingPublicJwk.x
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(signingPublicJwk.x.length / 4) * 4, '='),
};
const signingPrivateKeyPem = String(
  signingKeyPair.privateKey.export({ format: 'pem', type: 'pkcs8' }),
);

function signedFetch(remote: BuiltPackManifest): typeof fetch {
  const signature = signPackManifest(remote, signingKeyId, signingPrivateKeyPem, trustedKeys);
  return async (input) =>
    String(input).endsWith('/manifest.sig') ? jsonResponse(signature) : jsonResponse(remote);
}

test('content identity ignores only packVersion and writes fixed safe action outputs', async () => {
  const candidate = manifest('2026.07.150000000000001');
  const remote = manifest('2026.07.3');
  const result = await checkPackContentChange({
    candidateManifest: candidate,
    remoteManifestUrl: 'https://example.com/pack/manifest.json',
    fetchImpl: signedFetch(remote),
    trustedKeys,
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

test('a detached signature is accepted under a non-JSON Content-Type from a static host', async () => {
  const candidate = manifest('2026.07.150000000000001');
  const remote = manifest('2026.07.3');
  const signature = signPackManifest(remote, signingKeyId, signingPrivateKeyPem, trustedKeys);
  const result = await checkPackContentChange({
    candidateManifest: candidate,
    remoteManifestUrl: 'https://example.com/pack/manifest.json',
    fetchImpl: async (input) =>
      String(input).endsWith('/manifest.sig')
        ? pgpSignatureResponse(signature)
        : jsonResponse(remote),
    trustedKeys,
  });
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'content-unchanged');
});

test('a file identity change publishes while an initial remote 404 also publishes', async () => {
  const candidate = manifest('2026.07.4');
  const remote = manifest('2026.07.3');
  remote.files.news.sha256 = 'b'.repeat(64);
  const changed = await checkPackContentChange({
    candidateManifest: candidate,
    remoteManifestUrl: 'https://example.com/pack/manifest.json',
    fetchImpl: signedFetch(remote),
    trustedKeys,
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

test('missing or invalid remote signatures force a repair publish', async () => {
  const candidate = manifest('2026.07.4');
  const remote = manifest('2026.07.3');
  const missing = await checkPackContentChange({
    candidateManifest: candidate,
    remoteManifestUrl: 'https://example.com/pack/manifest.json',
    fetchImpl: async (input) =>
      String(input).endsWith('/manifest.sig')
        ? new Response(null, { status: 404 })
        : jsonResponse(remote),
    trustedKeys,
  });
  assert.deepEqual(missing, {
    changed: true,
    reason: 'remote-signature-invalid',
    remotePackVersion: '2026.07.3',
  });

  const signature = signPackManifest(remote, signingKeyId, signingPrivateKeyPem, trustedKeys);
  signature.signatures[0]!.signature = `${
    signature.signatures[0]!.signature.startsWith('A') ? 'B' : 'A'
  }${signature.signatures[0]!.signature.slice(1)}`;
  const invalid = await checkPackContentChange({
    candidateManifest: candidate,
    remoteManifestUrl: 'https://example.com/pack/manifest.json',
    fetchImpl: async (input) =>
      String(input).endsWith('/manifest.sig') ? jsonResponse(signature) : jsonResponse(remote),
    trustedKeys,
  });
  assert.equal(invalid.reason, 'remote-signature-invalid');
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
