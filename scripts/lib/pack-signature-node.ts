import {
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
  type KeyObject,
} from 'node:crypto';

import {
  canonicalPackManifestBytes,
  decodeBase64,
  parsePackSignatureEnvelope,
  parseTrustedPackPublicKeys,
  type PackSignatureEnvelope,
} from './pack-signature-contract.ts';

function base64UrlToBase64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
}

function rawPublicKeyObject(publicKeyBase64: string): KeyObject {
  const raw = decodeBase64(publicKeyBase64);
  if (raw.byteLength !== 32) throw new Error('Ed25519 public key must contain 32 bytes.');
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  return createPublicKey({
    key: Buffer.concat([spkiPrefix, Buffer.from(raw)]),
    format: 'der',
    type: 'spki',
  });
}

export function publicKeyBase64FromPrivatePem(privateKeyPem: string): string {
  createPrivateKey(privateKeyPem);
  const publicJwk = createPublicKey(privateKeyPem).export({ format: 'jwk' });
  if (publicJwk.kty !== 'OKP' || publicJwk.crv !== 'Ed25519' || !publicJwk.x) {
    throw new Error('Signing key is not an Ed25519 private key.');
  }
  return base64UrlToBase64(publicJwk.x);
}

export function signPackManifest(
  manifest: unknown,
  keyId: string,
  privateKeyPem: string,
  trustedKeysInput: Readonly<Record<string, string>>,
): PackSignatureEnvelope {
  const trustedKeys = parseTrustedPackPublicKeys(trustedKeysInput);
  const trustedPublicKey = trustedKeys[keyId];
  if (!trustedPublicKey) throw new Error(`Signing key ID is not trusted by the app: ${keyId}`);
  if (publicKeyBase64FromPrivatePem(privateKeyPem) !== trustedPublicKey) {
    throw new Error(`Private key does not match trusted public key ${keyId}.`);
  }
  const signature = signBytes(
    null,
    canonicalPackManifestBytes(manifest),
    createPrivateKey(privateKeyPem),
  );
  return {
    schemaVersion: 1,
    signatures: [{ keyId, algorithm: 'Ed25519', signature: signature.toString('base64') }],
  };
}

export function verifyPackManifestSignatureWithNode(
  manifest: unknown,
  envelopeInput: unknown,
  trustedKeysInput: Readonly<Record<string, string>>,
): PackSignatureEnvelope {
  const envelope = parsePackSignatureEnvelope(envelopeInput);
  const trustedKeys = parseTrustedPackPublicKeys(trustedKeysInput);
  const payload = canonicalPackManifestBytes(manifest);
  for (const candidate of envelope.signatures) {
    const publicKey = trustedKeys[candidate.keyId];
    if (!publicKey) continue;
    if (
      verifyBytes(
        null,
        payload,
        rawPublicKeyObject(publicKey),
        Buffer.from(decodeBase64(candidate.signature)),
      )
    ) {
      return envelope;
    }
  }
  throw new Error('Content pack manifest signature is not trusted or valid.');
}
