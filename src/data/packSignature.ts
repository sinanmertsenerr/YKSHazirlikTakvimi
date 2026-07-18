import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

import {
  canonicalPackManifestBytes,
  decodeBase64,
  parsePackSignatureEnvelope,
  parseTrustedPackPublicKeys,
  type PackSignatureEnvelope,
} from '../../scripts/lib/pack-signature-contract';
import { TRUSTED_PACK_PUBLIC_KEYS } from '../../scripts/lib/trusted-pack-keys';

ed25519.hashes.sha512 = sha512;

export type TrustedPackPublicKeys = Readonly<Record<string, string>>;

export function verifyPackManifestSignature(
  manifest: unknown,
  envelopeInput: unknown,
  trustedKeysInput: TrustedPackPublicKeys = TRUSTED_PACK_PUBLIC_KEYS,
): PackSignatureEnvelope {
  const envelope = parsePackSignatureEnvelope(envelopeInput);
  const trustedKeys = parseTrustedPackPublicKeys(trustedKeysInput);
  const message = canonicalPackManifestBytes(manifest);

  for (const candidate of envelope.signatures) {
    const publicKey = trustedKeys[candidate.keyId];
    if (!publicKey) continue;
    try {
      if (
        ed25519.verify(decodeBase64(candidate.signature), message, decodeBase64(publicKey), {
          zip215: false,
        })
      ) {
        return envelope;
      }
    } catch {
      // A malformed candidate never prevents another trusted rotation signature from succeeding.
    }
  }

  throw new Error('Content pack manifest signature is not trusted or valid.');
}
