export const PACK_SIGNATURE_SCHEMA_VERSION = 1 as const;
export const PACK_SIGNATURE_ALGORITHM = 'Ed25519' as const;
export const PACK_SIGNATURE_FILE_NAME = 'manifest.sig' as const;
export const MAX_PACK_SIGNATURE_BYTES = 16 * 1024;
export const MAX_PACK_SIGNATURES = 4;

export const PACK_FILE_KEYS = [
  'topics',
  'coefficients',
  'rankTables',
  'programs',
  'calendar',
  'news',
  'topicGroupStatistics',
  'topicGroupMappings',
] as const;

export type PackFileKey = (typeof PACK_FILE_KEYS)[number];

export type SignablePackManifest = {
  schemaVersion: number;
  packVersion: string;
  minAppVersion: string;
  examYear: number;
  files: Record<PackFileKey, { path: string; sha256: string; bytes: number }>;
};

export type PackSignature = {
  keyId: string;
  algorithm: typeof PACK_SIGNATURE_ALGORITHM;
  signature: string;
};

export type PackSignatureEnvelope = {
  schemaVersion: typeof PACK_SIGNATURE_SCHEMA_VERSION;
  signatures: PackSignature[];
};

const SIGNATURE_DOMAIN = 'YKSHazirlikTakvimi.pack-manifest.v1\n';
const MANIFEST_KEYS = ['schemaVersion', 'packVersion', 'minAppVersion', 'examYear', 'files'];
const DESCRIPTOR_KEYS = ['path', 'sha256', 'bytes'];
const ENVELOPE_KEYS = ['schemaVersion', 'signatures'];
const SIGNATURE_KEYS = ['keyId', 'algorithm', 'signature'];
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function assertSafeBase64(value: string, expectedBytes: number, label: string): void {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label} is not canonical base64.`);
  }
  if (decodeBase64(value).byteLength !== expectedBytes) {
    throw new Error(`${label} must decode to ${expectedBytes} bytes.`);
  }
}

export function decodeBase64(value: string): Uint8Array {
  if (!value.length || value.length % 4 !== 0) {
    throw new Error('Base64 input has an invalid length.');
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const output = new Uint8Array((value.length / 4) * 3 - padding);
  let outputIndex = 0;

  for (let index = 0; index < value.length; index += 4) {
    const characters = value.slice(index, index + 4);
    const values = [...characters].map((character, characterIndex) => {
      if (character === '=' && index + characterIndex >= value.length - padding) return 0;
      const decoded = BASE64_ALPHABET.indexOf(character);
      if (decoded < 0) throw new Error('Base64 input contains an invalid character.');
      return decoded;
    });
    const chunk =
      ((values[0] ?? 0) << 18) |
      ((values[1] ?? 0) << 12) |
      ((values[2] ?? 0) << 6) |
      (values[3] ?? 0);
    if (outputIndex < output.length) output[outputIndex++] = (chunk >>> 16) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = (chunk >>> 8) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = chunk & 0xff;
  }
  return output;
}

export function parseSignablePackManifest(value: unknown): SignablePackManifest {
  if (!isPlainObject(value) || !hasExactKeys(value, MANIFEST_KEYS)) {
    throw new Error('Pack manifest must contain only the supported fields.');
  }
  if (!Number.isSafeInteger(value.schemaVersion) || (value.schemaVersion as number) < 1) {
    throw new Error('Pack manifest schemaVersion is invalid.');
  }
  if (typeof value.packVersion !== 'string' || !/^\d{4}\.\d{2}\.\d+$/.test(value.packVersion)) {
    throw new Error('Pack manifest packVersion is invalid.');
  }
  if (
    typeof value.minAppVersion !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.minAppVersion)
  ) {
    throw new Error('Pack manifest minAppVersion is invalid.');
  }
  if (!Number.isSafeInteger(value.examYear) || (value.examYear as number) < 2026) {
    throw new Error('Pack manifest examYear is invalid.');
  }
  if (!isPlainObject(value.files) || !hasExactKeys(value.files, PACK_FILE_KEYS)) {
    throw new Error('Pack manifest files are invalid.');
  }

  const files = {} as SignablePackManifest['files'];
  const seenPaths = new Set<string>();
  for (const key of PACK_FILE_KEYS) {
    const descriptor = value.files[key];
    if (!isPlainObject(descriptor) || !hasExactKeys(descriptor, DESCRIPTOR_KEYS)) {
      throw new Error(`Pack manifest descriptor ${key} is invalid.`);
    }
    if (
      typeof descriptor.path !== 'string' ||
      !/^[a-z0-9][a-z0-9.-]*$/.test(descriptor.path) ||
      descriptor.path === 'manifest.json' ||
      descriptor.path === PACK_SIGNATURE_FILE_NAME ||
      seenPaths.has(descriptor.path)
    ) {
      throw new Error(`Pack manifest path ${key} is invalid.`);
    }
    if (typeof descriptor.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(descriptor.sha256)) {
      throw new Error(`Pack manifest hash ${key} is invalid.`);
    }
    if (!Number.isSafeInteger(descriptor.bytes) || (descriptor.bytes as number) < 0) {
      throw new Error(`Pack manifest byte count ${key} is invalid.`);
    }
    seenPaths.add(descriptor.path);
    files[key] = {
      path: descriptor.path,
      sha256: descriptor.sha256.toLowerCase(),
      bytes: descriptor.bytes as number,
    };
  }

  return {
    schemaVersion: value.schemaVersion as number,
    packVersion: value.packVersion,
    minAppVersion: value.minAppVersion,
    examYear: value.examYear as number,
    files,
  };
}

export function canonicalPackManifestBytes(value: unknown): Uint8Array {
  const manifest = parseSignablePackManifest(value);
  const payload = [
    manifest.schemaVersion,
    manifest.packVersion,
    manifest.minAppVersion,
    manifest.examYear,
    PACK_FILE_KEYS.map((key) => {
      const descriptor = manifest.files[key];
      return [key, descriptor.path, descriptor.sha256, descriptor.bytes];
    }),
  ];
  return new TextEncoder().encode(`${SIGNATURE_DOMAIN}${JSON.stringify(payload)}`);
}

export function parsePackSignatureEnvelope(value: unknown): PackSignatureEnvelope {
  if (!isPlainObject(value) || !hasExactKeys(value, ENVELOPE_KEYS)) {
    throw new Error('Pack signature envelope must contain only supported fields.');
  }
  if (value.schemaVersion !== PACK_SIGNATURE_SCHEMA_VERSION) {
    throw new Error('Pack signature envelope version is unsupported.');
  }
  if (
    !Array.isArray(value.signatures) ||
    value.signatures.length < 1 ||
    value.signatures.length > MAX_PACK_SIGNATURES
  ) {
    throw new Error('Pack signature envelope has an invalid signature count.');
  }

  const signatures: PackSignature[] = [];
  const keyIds = new Set<string>();
  for (const candidate of value.signatures) {
    if (!isPlainObject(candidate) || !hasExactKeys(candidate, SIGNATURE_KEYS)) {
      throw new Error('Pack signature entry must contain only supported fields.');
    }
    if (
      typeof candidate.keyId !== 'string' ||
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(candidate.keyId) ||
      candidate.keyId.length > 64 ||
      keyIds.has(candidate.keyId)
    ) {
      throw new Error('Pack signature keyId is invalid or duplicated.');
    }
    if (candidate.algorithm !== PACK_SIGNATURE_ALGORITHM) {
      throw new Error('Pack signature algorithm is unsupported.');
    }
    if (typeof candidate.signature !== 'string') {
      throw new Error('Pack signature value is invalid.');
    }
    assertSafeBase64(candidate.signature, 64, 'Pack signature');
    keyIds.add(candidate.keyId);
    signatures.push({
      keyId: candidate.keyId,
      algorithm: PACK_SIGNATURE_ALGORITHM,
      signature: candidate.signature,
    });
  }

  return { schemaVersion: PACK_SIGNATURE_SCHEMA_VERSION, signatures };
}

export function parseTrustedPackPublicKeys(
  value: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const entries = Object.entries(value);
  if (!entries.length || entries.length > MAX_PACK_SIGNATURES) {
    throw new Error('Trusted pack public-key registry has an invalid key count.');
  }
  for (const [keyId, publicKey] of entries) {
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(keyId) || keyId.length > 64) {
      throw new Error(`Trusted pack key ID is invalid: ${keyId}`);
    }
    assertSafeBase64(publicKey, 32, `Trusted pack public key ${keyId}`);
  }
  return Object.freeze({ ...value });
}
