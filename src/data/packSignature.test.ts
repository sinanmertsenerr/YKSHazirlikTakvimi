import { generateKeyPairSync } from 'node:crypto';

import { signPackManifest } from '../../scripts/lib/pack-signature-node';

import { verifyPackManifestSignature } from './packSignature';

function createSigningKey(keyId: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicJwk = publicKey.export({ format: 'jwk' });
  if (!publicJwk.x) throw new Error('Missing Ed25519 public key.');
  return {
    keyId,
    privateKeyPem: String(privateKey.export({ format: 'pem', type: 'pkcs8' })),
    publicKeyBase64: publicJwk.x
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(publicJwk.x.length / 4) * 4, '='),
  };
}

const manifest = {
  schemaVersion: 3,
  packVersion: '2026.07.1',
  minAppVersion: '1.0.0',
  examYear: 2026,
  files: {
    topics: { path: 'topics.json', sha256: 'a'.repeat(64), bytes: 1 },
    coefficients: { path: 'coefficients.json', sha256: 'b'.repeat(64), bytes: 2 },
    rankTables: { path: 'rank-tables.json', sha256: 'c'.repeat(64), bytes: 3 },
    programs: { path: 'programs.db', sha256: 'd'.repeat(64), bytes: 4 },
    calendar: { path: 'calendar.json', sha256: 'e'.repeat(64), bytes: 5 },
    news: { path: 'news.json', sha256: 'f'.repeat(64), bytes: 6 },
    topicGroupStatistics: {
      path: 'topic-group-statistics.json',
      sha256: '1'.repeat(64),
      bytes: 7,
    },
    topicGroupMappings: {
      path: 'topic-group-mappings.json',
      sha256: '2'.repeat(64),
      bytes: 8,
    },
  },
};

describe('runtime content-pack signature verification', () => {
  it('verifies a strict Ed25519 signature without WebCrypto', () => {
    const key = createSigningKey('runtime-test');
    const trusted = { [key.keyId]: key.publicKeyBase64 };
    const envelope = signPackManifest(manifest, key.keyId, key.privateKeyPem, trusted);

    expect(() => verifyPackManifestSignature(manifest, envelope, trusted)).not.toThrow();
    expect(() =>
      verifyPackManifestSignature({ ...manifest, examYear: 2027 }, envelope, trusted),
    ).toThrow('not trusted or valid');
  });

  it('accepts a valid trusted key during a multi-signature rotation', () => {
    const oldKey = createSigningKey('runtime-old');
    const newKey = createSigningKey('runtime-new');
    const oldEnvelope = signPackManifest(manifest, oldKey.keyId, oldKey.privateKeyPem, {
      [oldKey.keyId]: oldKey.publicKeyBase64,
    });
    const newEnvelope = signPackManifest(manifest, newKey.keyId, newKey.privateKeyPem, {
      [newKey.keyId]: newKey.publicKeyBase64,
    });

    expect(() =>
      verifyPackManifestSignature(
        {
          ...manifest,
          files: { ...manifest.files },
        },
        {
          schemaVersion: 1,
          signatures: [...oldEnvelope.signatures, ...newEnvelope.signatures],
        },
        { [newKey.keyId]: newKey.publicKeyBase64 },
      ),
    ).not.toThrow();
  });
});
