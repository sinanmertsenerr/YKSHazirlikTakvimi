import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  bookletCoverageYears,
  osymBookletRegistrySchema,
  type OsymBookletRegistry,
} from '../lib/osym-booklet-registry.ts';
import {
  applyRegistryObservations,
  auditOfficialPdf,
  compareRegistryToObservations,
  MAX_PDF_BYTES,
} from '../sync-osym-booklets.ts';

const OFFICIAL_TEST_URL =
  'https://dokuman.osym.gov.tr/pdfdokuman/2026/YKS/TSK/yks_tyt_2026_kitapcik_test.pdf';

async function readRegistry(): Promise<OsymBookletRegistry> {
  const data = JSON.parse(
    await readFile(resolve(process.cwd(), 'content/osym-booklets.json'), 'utf8'),
  ) as unknown;
  return osymBookletRegistrySchema.parse(data);
}

test('the registry covers every declared TYT/AYT pair with official structures', async () => {
  const registry = await readRegistry();
  const years = bookletCoverageYears(registry.coverage.lastYear);
  assert.equal(registry.booklets.length, years.length * 2);
  assert.deepEqual(
    registry.booklets.map(({ year, session }) => `${year}-${session}`),
    years.flatMap((year) => [`${year}-tyt`, `${year}-ayt`]),
  );
  assert.equal(registry.sessionStructures.tyt.questionsToAnswer, 120);
  assert.equal(registry.sessionStructures.tyt.questionsPrinted, 125);
  assert.equal(registry.sessionStructures.ayt.questionsToAnswer, 160);
  assert.equal(registry.sessionStructures.ayt.questionsPrinted, 166);
  assert.equal(registry.questionBlockProfiles.tyt.questionBlocks.length, 10);
  assert.equal(registry.questionBlockProfiles.ayt.questionBlocks.length, 12);
  assert.equal(registry.questionBlockProfiles.tyt.verifiedBookletIds.length, years.length);
  assert.equal(registry.questionBlockProfiles.ayt.verifiedBookletIds.length, years.length);
});

test('default and no-DKAB paths preserve official answer totals without double counting', async () => {
  const registry = await readRegistry();
  for (const [session, bookletSectionId, expected] of [
    ['tyt', 'sosyal-bilimler', 20],
    ['ayt', 'sosyal-bilimler-2', 40],
  ] as const) {
    const blocks = registry.questionBlockProfiles[session].questionBlocks.filter(
      (block) => block.bookletSectionId === bookletSectionId,
    );
    const size = (block: (typeof blocks)[number]) =>
      block.officialQuestionRange.last - block.officialQuestionRange.first + 1;
    const canonical = blocks.filter((block) => block.countsTowardDefaultStats);
    const alternatives = blocks.filter((block) => block.answerSetId === 'no-dkab');
    const replaced = new Set(alternatives.map((block) => block.alternativeForSubjectId));
    const exempt = [
      ...canonical.filter(
        (block) => !block.subjectIds.some((subjectId) => replaced.has(subjectId)),
      ),
      ...alternatives,
    ];
    assert.equal(
      canonical.reduce((sum, block) => sum + size(block), 0),
      expected,
    );
    assert.equal(
      exempt.reduce((sum, block) => sum + size(block), 0),
      expected,
    );
    assert.ok(alternatives.every((block) => !block.countsTowardDefaultStats));
  }
});

test('an equal-length but shifted structural range fails exact registry parity', async () => {
  const registry = structuredClone(await readRegistry());
  const block = registry.questionBlockProfiles.tyt.questionBlocks.find(
    (candidate) => candidate.id === 'tyt-sosyal-cografya-default',
  )!;
  block.officialQuestionRange = { first: 7, last: 11 };
  const result = osymBookletRegistrySchema.safeParse(registry);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some((issue) => issue.message.includes('exactly match')));
  }
});

test('the strict registry rejects stored question content', async () => {
  const registry = structuredClone(await readRegistry()) as unknown as Record<string, unknown>;
  const booklets = registry.booklets as Record<string, unknown>[];
  booklets[0]!.questionText = 'must never be stored';
  const result = osymBookletRegistrySchema.safeParse(registry);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some((issue) => issue.code === 'unrecognized_keys'));
  }
});

test('the PDF audit streams a valid response into byte length and SHA-256 metadata', async () => {
  const body = new TextEncoder().encode('%PDF-1.7\nsource registry test fixture');
  const observation = await auditOfficialPdf(OFFICIAL_TEST_URL, {
    attempts: 1,
    fetchImpl: async () =>
      new Response(body, {
        headers: {
          'content-length': String(body.byteLength),
          'content-type': 'application/pdf',
        },
      }),
  });

  assert.equal(observation.bytes, body.byteLength);
  assert.equal(observation.sha256, createHash('sha256').update(body).digest('hex'));
});

test('the PDF audit refuses a redirect outside the exact ÖSYM PDF host allowlist', async () => {
  let calls = 0;
  await assert.rejects(
    auditOfficialPdf(OFFICIAL_TEST_URL, {
      attempts: 1,
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/not-osym.pdf' },
        });
      },
    }),
    /refused redirect to non-allowlisted URL/,
  );
  assert.equal(calls, 1);
});

test('the PDF audit rejects oversized sources before consuming their body', async () => {
  await assert.rejects(
    auditOfficialPdf(OFFICIAL_TEST_URL, {
      attempts: 1,
      fetchImpl: async () =>
        new Response(new TextEncoder().encode('%PDF-'), {
          headers: {
            'content-length': String(MAX_PDF_BYTES + 1),
            'content-type': 'application/pdf',
          },
        }),
    }),
    /exceeds the .* safety limit/,
  );
});

test('registry comparison reports an upstream hash change without accepting it', async () => {
  const registry = await readRegistry();
  const observations = registry.booklets.map((booklet, index) => ({
    pdfUrl: booklet.pdfUrl,
    bytes: booklet.bytes,
    sha256: index === 0 ? 'f'.repeat(64) : booklet.sha256,
  }));
  const differences = compareRegistryToObservations(registry, observations);
  assert.deepEqual(differences, [
    {
      key: '2018-tyt',
      field: 'sha256',
      expected: registry.booklets[0]!.sha256,
      observed: 'f'.repeat(64),
    },
  ]);
});

test('source sync updates observations while preserving exact question-block parity', async () => {
  const registry = await readRegistry();
  const observations = registry.booklets.map((booklet) => ({
    pdfUrl: booklet.pdfUrl,
    bytes: booklet.bytes,
    sha256: booklet.sha256,
  }));
  const updated = applyRegistryObservations(registry, observations, '2026-07-14');
  assert.deepEqual(updated.questionBlockProfiles, registry.questionBlockProfiles);
  assert.deepEqual(
    updated.booklets.map((booklet) => booklet.verifiedAt),
    Array.from({ length: 18 }, () => '2026-07-14'),
  );
});
