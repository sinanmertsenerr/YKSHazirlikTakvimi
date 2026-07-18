import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  canonicalPackManifestBytes,
  parsePackSignatureEnvelope,
  parseSignablePackManifest,
} from '../lib/pack-signature-contract.ts';
import {
  signPackManifest,
  verifyPackManifestSignatureWithNode,
} from '../lib/pack-signature-node.ts';

function keyPair(keyId: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicJwk = publicKey.export({ format: 'jwk' });
  assert.equal(publicJwk.kty, 'OKP');
  assert.equal(publicJwk.crv, 'Ed25519');
  assert.ok(publicJwk.x);
  const publicKeyBase64 = publicJwk.x
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(publicJwk.x.length / 4) * 4, '=');
  return {
    keyId,
    privateKeyPem: String(privateKey.export({ format: 'pem', type: 'pkcs8' })),
    publicKeyBase64,
  };
}

function descriptor(path: string) {
  return { path, sha256: 'A'.repeat(64), bytes: 123 };
}

function manifest() {
  return {
    schemaVersion: 3,
    packVersion: '2026.07.1',
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

test('canonical payload is stable across source object order and hash casing', () => {
  const first = manifest();
  const second = {
    files: Object.fromEntries(Object.entries(first.files).reverse()),
    examYear: first.examYear,
    minAppVersion: first.minAppVersion,
    packVersion: first.packVersion,
    schemaVersion: first.schemaVersion,
  };
  assert.deepEqual(canonicalPackManifestBytes(first), canonicalPackManifestBytes(second));
});

test('signed manifests verify and semantic tampering is rejected', () => {
  const key = keyPair('test-2026-01');
  const trusted = { [key.keyId]: key.publicKeyBase64 };
  const source = manifest();
  const envelope = signPackManifest(source, key.keyId, key.privateKeyPem, trusted);
  assert.doesNotThrow(() => verifyPackManifestSignatureWithNode(source, envelope, trusted));
  assert.throws(
    () =>
      verifyPackManifestSignatureWithNode(
        { ...source, examYear: source.examYear + 1 },
        envelope,
        trusted,
      ),
    /not trusted or valid/,
  );
});

test('rotation envelope succeeds when any trusted signature is valid', () => {
  const oldKey = keyPair('test-old');
  const newKey = keyPair('test-new');
  const source = manifest();
  const oldEnvelope = signPackManifest(source, oldKey.keyId, oldKey.privateKeyPem, {
    [oldKey.keyId]: oldKey.publicKeyBase64,
  });
  const newEnvelope = signPackManifest(source, newKey.keyId, newKey.privateKeyPem, {
    [newKey.keyId]: newKey.publicKeyBase64,
  });
  const rotationEnvelope = {
    schemaVersion: 1,
    signatures: [...oldEnvelope.signatures, ...newEnvelope.signatures],
  };
  assert.doesNotThrow(() =>
    verifyPackManifestSignatureWithNode(source, rotationEnvelope, {
      [newKey.keyId]: newKey.publicKeyBase64,
    }),
  );
});

test('unknown keys, duplicate signatures, and reserved paths fail closed', () => {
  const key = keyPair('test-unknown');
  const source = manifest();
  const envelope = signPackManifest(source, key.keyId, key.privateKeyPem, {
    [key.keyId]: key.publicKeyBase64,
  });
  const other = keyPair('test-other');
  assert.throws(
    () =>
      verifyPackManifestSignatureWithNode(source, envelope, {
        [other.keyId]: other.publicKeyBase64,
      }),
    /not trusted or valid/,
  );
  assert.throws(
    () =>
      parsePackSignatureEnvelope({
        schemaVersion: 1,
        signatures: [envelope.signatures[0], envelope.signatures[0]],
      }),
    /duplicated/,
  );
  const invalid = manifest();
  invalid.files.news.path = 'manifest.sig';
  assert.throws(() => parseSignablePackManifest(invalid), /path news is invalid/);
});
