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
    expected: {
      bytes: body.byteLength,
      sha256: createHash('sha256').update(body).digest('hex'),
    },
  };
}

test('registry pins the six approved OGM observations and explicitly excludes YDT', async () => {
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
    ],
  );
  const excluded = registry.sources.at(-1)!;
  assert.deepEqual(
    { sourceId: excluded.sourceId, key: excluded.key, status: excluded.status },
    { sourceId: 176298, key: 'ydt', status: 'excluded' },
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

test('excluded YDT is never fetched by registry audit', async () => {
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
  assert.equal(observations.length, 6);
  assert.equal(
    requested.some((url) => url.endsWith('/176298')),
    false,
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
  assert.throws(() => parseOgmTopicCliOptions(['--write']), /read-only/);
  assert.throws(() => parseOgmTopicCliOptions(['--accept-changes']), /read-only/);
});
