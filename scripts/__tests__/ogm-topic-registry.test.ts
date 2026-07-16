import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  assertAllowedOgmUrl,
  includedOgmTopicSources,
  ogmTopicSourceRegistrySchema,
  type IncludedOgmTopicSource,
  type OgmTopicSourceRegistry,
} from '../lib/ogm-topic-registry.ts';
import {
  auditOgmTopicPdf,
  auditOgmTopicRegistry,
  compareOgmRegistryToObservations,
  MAX_OGM_PDF_BYTES,
  parseOgmTopicCliOptions,
} from '../sync-ogm-topic-books.ts';

const REGISTRY_PATH = resolve(process.cwd(), 'content/ogm-yks-topic-sources.json');

async function readRegistry(): Promise<OgmTopicSourceRegistry> {
  return ogmTopicSourceRegistrySchema.parse(
    JSON.parse(await readFile(REGISTRY_PATH, 'utf8')) as unknown,
  );
}

function fixtureSource(body: Uint8Array): IncludedOgmTopicSource {
  return {
    sourceId: 176299,
    key: 'tyt',
    titleTr: 'Test',
    status: 'included',
    resolverUrl: 'https://ogmmateryal.eba.gov.tr/pdf-goster/176299',
    intendedUse: 'topic-label-reference-audit',
    api: {
      contentId: 176299,
      discoveryUrl: 'https://ogmmateryal.eba.gov.tr/icerik-goster/176299',
      bookObjectId: '68b4f30ceb079be0e77092c8',
      bookTitle: 'YKS Çıkmış Sorular - 2018-2025 - TYT',
      expectedTestCount: 69,
      expectedQuestionCount: 956,
      pdfPublicUrl:
        'https://ogm-small-cdn.eba.gov.tr/ogm-test-images/6a0498c3e7146abee1a581cf/CIKMIS_SORULAR_2018_2025_TYT_1.pdf',
      pdfAssociation: 'resolver-target-match',
    },
    expected: {
      bytes: body.byteLength,
      sha256: createHash('sha256').update(body).digest('hex'),
    },
  };
}

test('registry pins the seven approved OGM observations including YDT', async () => {
  const registry = await readRegistry();
  assert.equal(registry.observedAt, '2026-07-15');
  assert.deepEqual(
    includedOgmTopicSources(registry).map(({ sourceId, expected }) => [
      sourceId,
      expected.bytes,
      expected.sha256,
    ]),
    [
      [176299, 35975026, 'c97dfa21186bcf5dd309cd3fe319d8d2bca6f2110c9652dfedcfb00f511c2545'],
      [176295, 23726448, '87208a748fcf19a4f5cf33540ef54e6a6e92e6eebe908a8939a3639296181df7'],
      [176296, 28348993, 'cd9a46189b3a36b319d1d84d2227db9f95820f631ff643da60e849c1097ef599'],
      [176297, 28708412, '6e6b2452e019f72e43a2bf9f2fd4ab018f918ed39d5444fd93d7c73d79b89598'],
      [176294, 15009809, 'a7cedd03371ee6324a84edf924069d466840a00d7c9aea1d330014299087928c'],
      [176293, 16372848, 'dd519d7e067332e29447b985e57a69cef551dcb2473dbba76740fc24d005a776'],
      [176298, 14636803, 'a42d6955f2aecab4ad7d4df3be0b465dc3c99f30686a3838d8abb9aaacc2cf60'],
    ],
  );
  assert.deepEqual(
    includedOgmTopicSources(registry).map(({ sourceId, api }) => [
      sourceId,
      api.bookObjectId,
      api.expectedQuestionCount,
    ]),
    [
      [176299, '68b4f30ceb079be0e77092c8', 956],
      [176295, '68b1f111eb079be0e76eac8a', 629],
      [176296, '68b232a7eb079be0e76eea43', 639],
      [176297, '68b4ebc4eb079be0e770922c', 625],
      [176294, '68d3a8a1dbcaa9db10a16aa1', 37],
      [176293, '68d39ef3dbcaa9db10a159b4', 48],
      [176298, '68b4cc3beb079be0e7708108', 640],
    ],
  );
  const ydt = registry.sources.at(-1)!;
  assert.deepEqual(
    { sourceId: ydt.sourceId, key: ydt.key, status: ydt.status },
    { sourceId: 176298, key: 'ydt', status: 'included' },
  );
});

test('strict schema rejects raw content and a missing excluded YDT record', async () => {
  const withContent = structuredClone(await readRegistry()) as unknown as Record<string, unknown>;
  (withContent.sources as Record<string, unknown>[])[0]!.questionText = 'never store this';
  assert.equal(ogmTopicSourceRegistrySchema.safeParse(withContent).success, false);

  const withoutYdt = structuredClone(await readRegistry());
  withoutYdt.sources.pop();
  assert.equal(ogmTopicSourceRegistrySchema.safeParse(withoutYdt).success, false);
});

test('a future MEB edition (later date, 2018-2026 span) validates without a code change', async () => {
  const registry = structuredClone(await readRegistry());
  // Simulate MEB republishing the same content ids as a 2018-2026 edition, re-verified later.
  registry.observedAt = '2027-02-01';
  registry.coverage.lastYear = 2026;
  for (const source of registry.sources) {
    if (source.status === 'included') {
      source.api.bookTitle = source.api.bookTitle.replace('2018-2025', '2018-2026');
    }
  }
  assert.equal(ogmTopicSourceRegistrySchema.safeParse(registry).success, true);

  // A title/coverage mismatch must still fail closed.
  const mismatched = structuredClone(registry);
  mismatched.coverage.lastYear = 2025;
  assert.equal(ogmTopicSourceRegistrySchema.safeParse(mismatched).success, false);
});

test('allowlist requires HTTPS and exact OGM hosts', () => {
  assert.equal(
    assertAllowedOgmUrl('https://ogm-small-cdn.eba.gov.tr/book.pdf'),
    'https://ogm-small-cdn.eba.gov.tr/book.pdf',
  );
  assert.throws(() => assertAllowedOgmUrl('http://ogmmateryal.eba.gov.tr/book.pdf'), /HTTPS/);
  assert.throws(
    () => assertAllowedOgmUrl('https://ogmmateryal.eba.gov.tr.evil.example/book.pdf'),
    /not allowlisted/,
  );
});

test('audit follows an allowlisted redirect, hashes the PDF, and removes its temporary file', async () => {
  const body = new TextEncoder().encode('%PDF-1.7\nOGM audit fixture');
  const source = fixtureSource(body);
  const root = await mkdtemp(join(tmpdir(), 'ogm-test-root-'));
  const calls: string[] = [];
  try {
    const observation = await auditOgmTopicPdf(source, {
      tempRoot: root,
      fetchImpl: async (input) => {
        calls.push(String(input));
        if (calls.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://ogm-small-cdn.eba.gov.tr/source.pdf' },
          });
        }
        return new Response(body, {
          headers: {
            'content-length': String(body.byteLength),
            'content-type': 'application/pdf; charset=binary',
          },
        });
      },
    });
    assert.equal(observation.resolvedPdfUrl, 'https://ogm-small-cdn.eba.gov.tr/source.pdf');
    assert.equal(observation.sha256, source.expected.sha256);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('audit retries a transient PDF download timeout and still verifies the hash', async () => {
  const body = new TextEncoder().encode('%PDF-1.7\nretry fixture');
  const source = fixtureSource(body);
  let attempts = 0;
  const delays: number[] = [];
  const observation = await auditOgmTopicPdf(source, {
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      return new Response(body, {
        headers: {
          'content-length': String(body.byteLength),
          'content-type': 'application/pdf',
        },
      });
    },
    retryDelayImpl: async (ms) => {
      delays.push(ms);
    },
  });
  assert.equal(attempts, 3);
  assert.equal(observation.sha256, source.expected.sha256);
  assert.deepEqual(delays, [250, 750]);
});

test('a genuine SHA-256 drift fails immediately and is never retried', async () => {
  const original = new TextEncoder().encode('%PDF-1.7\noriginal-content');
  const tampered = new TextEncoder().encode('%PDF-1.7\ntampered-content'); // same length, other bytes
  assert.equal(tampered.byteLength, original.byteLength);
  const source = fixtureSource(original);
  let attempts = 0;
  await assert.rejects(
    auditOgmTopicPdf(source, {
      fetchImpl: async () => {
        attempts += 1;
        return new Response(tampered, {
          headers: {
            'content-length': String(tampered.byteLength),
            'content-type': 'application/pdf',
          },
        });
      },
      retryDelayImpl: async () => {
        throw new Error('a real drift must never be retried');
      },
    }),
    /SHA-256 drift/,
  );
  assert.equal(attempts, 1);
});

test('audit refuses redirects outside the exact host allowlist', async () => {
  const body = new TextEncoder().encode('%PDF-fixture');
  await assert.rejects(
    auditOgmTopicPdf(fixtureSource(body), {
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: 'https://example.com/a.pdf' } }),
    }),
    /refused redirect to non-allowlisted URL/,
  );
});

test('audit rejects content-length drift before accepting content', async () => {
  const body = new TextEncoder().encode('%PDF-fixture');
  await assert.rejects(
    auditOgmTopicPdf(fixtureSource(body), {
      fetchImpl: async () =>
        new Response(body, {
          headers: {
            'content-length': String(body.byteLength + 1),
            'content-type': 'application/pdf',
          },
        }),
    }),
    /byte drift/,
  );
});

test('audit rejects wrong content type, oversized declarations, and invalid PDF magic', async () => {
  const body = new TextEncoder().encode('%PDF-fixture');
  const source = fixtureSource(body);
  await assert.rejects(
    auditOgmTopicPdf(source, {
      fetchImpl: async () =>
        new Response(body, {
          headers: { 'content-length': String(body.byteLength), 'content-type': 'text/html' },
        }),
    }),
    /expected Content-Type application\/pdf/,
  );
  await assert.rejects(
    auditOgmTopicPdf(source, {
      fetchImpl: async () =>
        new Response(body, {
          headers: {
            'content-length': String(MAX_OGM_PDF_BYTES + 1),
            'content-type': 'application/pdf',
          },
        }),
    }),
    /exceeds the .* safety limit/,
  );

  const invalid = new TextEncoder().encode('not a PDF');
  await assert.rejects(
    auditOgmTopicPdf(fixtureSource(invalid), {
      fetchImpl: async () =>
        new Response(invalid, {
          headers: {
            'content-length': String(invalid.byteLength),
            'content-type': 'application/pdf',
          },
        }),
    }),
    /PDF file signature/,
  );
});

test('included YDT is audited exactly like every other source', async () => {
  const registry = await readRegistry();
  const tinyBody = new TextEncoder().encode('%PDF-x');
  const scoped = structuredClone(registry);
  for (const source of scoped.sources) {
    if (source.status === 'included') {
      source.expected.bytes = tinyBody.byteLength;
      source.expected.sha256 = createHash('sha256').update(tinyBody).digest('hex');
    }
  }
  const requested: string[] = [];
  const observations = await auditOgmTopicRegistry(scoped, {
    concurrency: 3,
    fetchImpl: async (input) => {
      requested.push(String(input));
      return new Response(tinyBody, {
        headers: {
          'content-length': String(tinyBody.byteLength),
          'content-type': 'application/pdf',
        },
      });
    },
  });
  assert.equal(observations.length, 7);
  assert.equal(
    requested.some((url) => url.endsWith('/176298')),
    true,
  );
});

test('comparison reports pinned metadata drift without mutating registry', async () => {
  const registry = await readRegistry();
  const before = JSON.stringify(registry);
  const observations = includedOgmTopicSources(registry).map((source, index) => ({
    sourceId: source.sourceId,
    resolverUrl: source.resolverUrl,
    resolvedPdfUrl: source.resolverUrl,
    bytes: source.expected.bytes,
    sha256: index === 0 ? 'f'.repeat(64) : source.expected.sha256,
  }));
  assert.deepEqual(compareOgmRegistryToObservations(registry, observations), [
    {
      key: 'tyt',
      field: 'sha256',
      expected: includedOgmTopicSources(registry)[0]!.expected.sha256,
      observed: 'f'.repeat(64),
    },
  ]);
  assert.equal(JSON.stringify(registry), before);
});

test('CLI is audit-only by default and rejects every write flag', () => {
  assert.equal(parseOgmTopicCliOptions([]).mode, 'audit');
  assert.equal(parseOgmTopicCliOptions(['--api-only']).mode, 'api-only');
  assert.equal(parseOgmTopicCliOptions(['--api-deep']).mode, 'api-deep');
  assert.throws(() => parseOgmTopicCliOptions(['--write']), /read-only/);
  assert.throws(() => parseOgmTopicCliOptions(['--accept-changes']), /read-only/);
});
