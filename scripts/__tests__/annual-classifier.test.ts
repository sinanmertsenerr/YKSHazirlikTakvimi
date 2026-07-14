import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import worker, {
  CLASSIFIER_AI_TIMEOUT_MS,
  handleRequest,
  type Env as WorkerEnv,
} from '../../infra/cloudflare/src/index.ts';
import { parseAnnualClassifierArgs } from '../annual-classifier.ts';
import { validateAnnualClassifierArtifacts } from '../validate-annual-classifier-artifacts.ts';
import {
  ANNUAL_CLASSIFIER_RESPONSE_JSON_SCHEMA,
  ANNUAL_CLASSIFIER_SCHEMA_VERSION,
  ANNUAL_CLASSIFIER_TEXT_MODEL,
  ANNUAL_CLASSIFIER_VISION_MODEL,
  annualClassifierResponseSchema,
  assertIdOnlyPayload,
} from '../lib/annual-classifier-contract.ts';
import {
  locateBookletSectionPages,
  type PdfTextPage,
} from '../lib/annual-classifier-extraction.ts';
import {
  ANNUAL_CLASSIFIER_PROVIDER_TIMEOUT_MS,
  runAnnualClassifierBlock,
  type AnnualClassifierProvider,
  type ClassifierProviderRequest,
} from '../lib/annual-classifier-orchestrator.ts';
import { osymBookletRegistrySchema } from '../lib/osym-booklet-registry.ts';

async function loadFixtureData() {
  const registry = osymBookletRegistrySchema.parse(
    JSON.parse(await readFile('content/osym-booklets.json', 'utf8')) as unknown,
  );
  const catalog = JSON.parse(await readFile('content/topics.json', 'utf8')) as {
    exams: {
      id: string;
      sections: {
        id: string;
        subjects: { id: string; topics: { id: string }[] }[];
      }[];
    }[];
  };
  const block = registry.questionBlockProfiles.tyt.questionBlocks.find(
    (candidate) => candidate.id === 'tyt-sosyal-tarih-default',
  )!;
  const subject = catalog.exams
    .find((exam) => exam.id === 'tyt')!
    .sections.find((section) => section.id === block.sectionId)!
    .subjects.find((candidate) => candidate.id === 'tyt-tarih')!;
  return { registry, catalog, block, topicIds: subject.topics.map((topic) => topic.id) };
}

function classifications(
  questionBlockId: string,
  topicId: string,
  questionNos: number[],
  confidence = 0.95,
) {
  return {
    schemaVersion: ANNUAL_CLASSIFIER_SCHEMA_VERSION,
    questionBlockId,
    classifications: questionNos.map((officialQuestionNo) => ({
      officialQuestionNo,
      primaryTopicRef: {
        subjectId: 'tyt-tarih',
        topicId,
        countsTowardStats: true,
      },
      relatedTopicRefs: [],
      status: 'classified' as const,
      confidence,
      page: 4,
    })),
  };
}

const sources = {
  textPages: [{ page: 4, text: 'RAW_QUESTION_SENTINEL visible only in process memory' }],
  visionPages: [{ page: 4, imageDataUrl: 'data:image/jpeg;base64,UkFXX0lNQUdF' }],
};

test('runtime and artifact contracts reject source-content fields', () => {
  const malicious = {
    ...classifications('tyt-sosyal-tarih-default', 'ilk-ve-orta-caglarda-turk-dunyasi', [1]),
    classifications: [
      {
        ...classifications('tyt-sosyal-tarih-default', 'ilk-ve-orta-caglarda-turk-dunyasi', [1])
          .classifications[0],
        questionText: 'must never survive',
      },
    ],
  };
  assert.equal(annualClassifierResponseSchema.safeParse(malicious).success, false);
  assert.doesNotThrow(() => assertIdOnlyPayload({ promptVersion: 'annual-topic-v1' }));
  assert.throws(() => assertIdOnlyPayload({ sourceText: 'leak' }), /not permitted/);
  assert.throws(() => assertIdOnlyPayload({ value: 'data:image/png;base64,AAAA' }), /embedded/);
});

test('official section locator uses headings and fails instead of guessing offsets', () => {
  const page = (pageNumber: number, heading: string): PdfTextPage => ({
    page: pageNumber,
    text: `${heading}\n1 2\n${'booklet evidence '.repeat(30)}`,
  });
  const pages = [
    { page: 1, text: 'cover '.repeat(80) },
    page(2, 'TÜRKÇE TESTİ'),
    page(3, 'SOSYAL BİLİMLER TESTİ'),
    page(4, 'TEMEL MATEMATİK TESTİ'),
    page(5, 'FEN BİLİMLERİ TESTİ'),
    { page: 6, text: `CEVAP ANAHTARI\n${'answer '.repeat(80)}` },
  ];
  assert.deepEqual(locateBookletSectionPages(pages, 'tyt'), {
    turkce: [2],
    'sosyal-bilimler': [3],
    'temel-matematik': [4],
    'fen-bilimleri': [5],
  });
  assert.throws(() => locateBookletSectionPages(pages.slice(0, -1), 'tyt'), /answer-key boundary/);
});

test('two independent passes agree and cache only ID-only decisions', async () => {
  const { registry, catalog, block, topicIds } = await loadFixtureData();
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), 'annual-classifier-cache-'));
  const calls: ClassifierProviderRequest[] = [];
  const provider: AnnualClassifierProvider = {
    async classify(request) {
      calls.push(request);
      return classifications(block.id, topicIds[0]!, [1, 2, 3, 4, 5]);
    },
  };
  try {
    const result = await runAnnualClassifierBlock({
      year: 2026,
      exam: 'tyt',
      questionBlock: block,
      bookletRegistry: registry,
      topicCatalog: catalog,
      sources,
      provider,
      cacheDirectory,
      reviewedAt: '2026-07-14',
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((call) => call.model),
      [ANNUAL_CLASSIFIER_TEXT_MODEL, ANNUAL_CLASSIFIER_VISION_MODEL],
    );
    assert.equal(result.report.summary.agreed, 5);
    assert.equal(result.report.publication.automatic, false);
    const cacheFiles = await readdir(cacheDirectory);
    assert.equal(cacheFiles.length, 2);
    for (const file of cacheFiles) {
      const raw = await readFile(path.join(cacheDirectory, file), 'utf8');
      assert.doesNotMatch(raw, /RAW_QUESTION_SENTINEL|UkFXX0lNQUdF|questionText|imageDataUrl/);
      assert.match(raw, /bookletSha256/);
      assert.match(raw, /taxonomySha256/);
    }

    const cachedResult = await runAnnualClassifierBlock({
      year: 2026,
      exam: 'tyt',
      questionBlock: block,
      bookletRegistry: registry,
      topicCatalog: catalog,
      sources,
      provider,
      cacheDirectory,
      reviewedAt: '2026-07-14',
    });
    assert.equal(calls.length, 2);
    assert.equal(cachedResult.report.execution.textCacheHits, 1);
    assert.equal(cachedResult.report.execution.visionCacheHits, 1);
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

test('vision units run two at a time without completion order or isolated failures leaking', async () => {
  const { registry, catalog, block, topicIds } = await loadFixtureData();
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), 'annual-classifier-concurrency-'));
  const concurrentSources = {
    ...sources,
    visionPages: Array.from({ length: 6 }, (_, index) => ({
      page: index + 4,
      imageDataUrl: 'data:image/jpeg;base64,UkFXX0lNQUdF',
    })),
  };
  const firstUnit = `${block.id}-vision-primary-pages-4-5`;
  const failedUnit = `${block.id}-vision-primary-pages-6-7`;
  const lastUnit = `${block.id}-vision-primary-pages-8-9`;
  let activeVisionCalls = 0;
  let maxActiveVisionCalls = 0;
  let resolveFirstUnitStarted!: () => void;
  const firstUnitStarted = new Promise<void>((resolve) => {
    resolveFirstUnitStarted = resolve;
  });
  const completionOrder: string[] = [];
  const responseAtPage = (page: number) => {
    const response = classifications(block.id, topicIds[0]!, [1, 2, 3, 4, 5]);
    return {
      ...response,
      classifications: response.classifications.map((classification) => ({
        ...classification,
        page,
      })),
    };
  };
  const provider: AnnualClassifierProvider = {
    async classify(request) {
      if (request.mode === 'text') return responseAtPage(4);
      activeVisionCalls += 1;
      maxActiveVisionCalls = Math.max(maxActiveVisionCalls, activeVisionCalls);
      try {
        if (request.requestId === firstUnit) {
          resolveFirstUnitStarted();
          await new Promise((resolve) => setTimeout(resolve, 100));
          completionOrder.push(request.requestId);
          return responseAtPage(4);
        }
        if (request.requestId === failedUnit) {
          await firstUnitStarted;
          completionOrder.push(request.requestId);
          throw new Error('isolated vision unit failure');
        }
        assert.equal(request.requestId, lastUnit);
        await firstUnitStarted;
        completionOrder.push(request.requestId);
        return responseAtPage(8);
      } finally {
        activeVisionCalls -= 1;
      }
    },
  };
  try {
    const result = await runAnnualClassifierBlock({
      year: 2026,
      exam: 'tyt',
      questionBlock: block,
      bookletRegistry: registry,
      topicCatalog: catalog,
      sources: concurrentSources,
      provider,
      cacheDirectory,
      reviewedAt: '2026-07-15',
    });
    assert.equal(maxActiveVisionCalls, 2);
    assert.deepEqual(completionOrder, [failedUnit, lastUnit, firstUnit]);
    assert.equal(result.report.execution.visionProviderCalls, 3);
    assert.equal(result.report.execution.visionRetryUsed, false);
    assert.equal(result.report.summary.agreed, 5);
    assert.deepEqual(
      result.visionReview.records.map((record) => record.page),
      [4, 4, 4, 4, 4],
    );
    assert.equal((await readdir(cacheDirectory)).length, 3);
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

test('large sections are split into bounded text and vision inference units', async () => {
  const { registry, catalog, block, topicIds } = await loadFixtureData();
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), 'annual-classifier-chunks-'));
  const requests: ClassifierProviderRequest[] = [];
  const largeSources = {
    textPages: Array.from({ length: 14 }, (_, index) => ({
      page: index + 4,
      text: `page-${index + 4}`,
    })),
    visionPages: Array.from({ length: 14 }, (_, index) => ({
      page: index + 4,
      imageDataUrl: 'data:image/jpeg;base64,UkFXX0lNQUdF',
    })),
  };
  const provider: AnnualClassifierProvider = {
    async classify(request) {
      requests.push(request);
      return classifications(block.id, topicIds[0]!, [1, 2, 3, 4, 5]);
    },
  };
  try {
    const result = await runAnnualClassifierBlock({
      year: 2026,
      exam: 'tyt',
      questionBlock: block,
      bookletRegistry: registry,
      topicCatalog: catalog,
      sources: largeSources,
      provider,
      cacheDirectory,
      reviewedAt: '2026-07-15',
    });
    assert.equal(result.report.execution.textProviderCalls, 4);
    assert.equal(result.report.execution.visionProviderCalls, 7);
    assert.equal(result.report.execution.textRetryUsed, false);
    assert.equal(result.report.execution.visionRetryUsed, false);
    assert.equal(result.report.summary.agreed, 5);

    const textRequests = requests.filter((request) => request.mode === 'text');
    const visionRequests = requests.filter((request) => request.mode === 'vision');
    assert.deepEqual(
      textRequests.map((request) => request.requestId).sort(),
      [
        `${block.id}-text-primary-pages-4-5-6-7`,
        `${block.id}-text-primary-pages-8-9-10-11`,
        `${block.id}-text-primary-pages-12-13-14-15`,
        `${block.id}-text-primary-pages-16-17`,
      ].sort(),
    );
    assert.deepEqual(
      visionRequests.map((request) => request.requestId).sort(),
      [
        `${block.id}-vision-primary-pages-4-5`,
        `${block.id}-vision-primary-pages-6-7`,
        `${block.id}-vision-primary-pages-8-9`,
        `${block.id}-vision-primary-pages-10-11`,
        `${block.id}-vision-primary-pages-12-13`,
        `${block.id}-vision-primary-pages-14-15`,
        `${block.id}-vision-primary-pages-16-17`,
      ].sort(),
    );
    for (const request of textRequests) {
      const content = request.messages[1].content;
      assert.equal(typeof content, 'string');
      assert.ok((content as string).match(/\[PHYSICAL_PAGE_/g)!.length <= 4);
    }
    for (const request of visionRequests) {
      const content = request.messages[1].content;
      assert.ok(Array.isArray(content));
      assert.ok(content.filter((part) => part.type === 'image_url').length <= 2);
    }
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

test('artifact validation cross-links both reviews to the exact classifier report', async () => {
  const { registry, catalog, block, topicIds } = await loadFixtureData();
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), 'annual-cross-link-cache-'));
  await mkdir('tmp/annual-topic-classifier', { recursive: true });
  const artifactDirectory = await mkdtemp(path.resolve('tmp/annual-topic-classifier/cross-link-'));
  const provider: AnnualClassifierProvider = {
    async classify() {
      return classifications(block.id, topicIds[0]!, [1, 2, 3, 4, 5]);
    },
  };
  try {
    const result = await runAnnualClassifierBlock({
      year: 2026,
      exam: 'tyt',
      questionBlock: block,
      bookletRegistry: registry,
      topicCatalog: catalog,
      sources,
      provider,
      cacheDirectory,
      reviewedAt: '2026-07-14',
    });
    const prefix = `2026-tyt-${block.id}`;
    const textPath = path.join(artifactDirectory, `${prefix}.text.review.json`);
    await Promise.all([
      writeFile(textPath, JSON.stringify(result.textReview)),
      writeFile(
        path.join(artifactDirectory, `${prefix}.vision.review.json`),
        JSON.stringify(result.visionReview),
      ),
      writeFile(
        path.join(artifactDirectory, `${prefix}.report.json`),
        JSON.stringify(result.report),
      ),
    ]);
    assert.equal(await validateAnnualClassifierArtifacts(artifactDirectory), 3);

    const mismatchedText = structuredClone(result.textReview);
    if (mismatchedText.records[0]!.status !== 'classified')
      throw new Error('fixture must classify');
    mismatchedText.records[0]!.primaryTopicRef.topicId = topicIds[1]!;
    await writeFile(textPath, JSON.stringify(mismatchedText));
    await assert.rejects(
      validateAnnualClassifierArtifacts(artifactDirectory),
      /text review does not match its classifier report/,
    );
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('a single retry wave resolves missing IDs; invalid output then becomes disputes', async () => {
  const { registry, catalog, block, topicIds } = await loadFixtureData();
  const retryCache = await mkdtemp(path.join(os.tmpdir(), 'annual-classifier-retry-'));
  const retryCalls: string[] = [];
  const retryProvider: AnnualClassifierProvider = {
    async classify(request) {
      retryCalls.push(request.requestId);
      return request.requestId.includes('-retry-')
        ? classifications(block.id, topicIds[0]!, [2, 3, 4, 5])
        : classifications(block.id, topicIds[0]!, [1]);
    },
  };
  try {
    const resolved = await runAnnualClassifierBlock({
      year: 2026,
      exam: 'tyt',
      questionBlock: block,
      bookletRegistry: registry,
      topicCatalog: catalog,
      sources,
      provider: retryProvider,
      cacheDirectory: retryCache,
      reviewedAt: '2026-07-15',
    });
    assert.equal(retryCalls.length, 4);
    assert.equal(resolved.report.execution.textRetryUsed, true);
    assert.equal(resolved.report.execution.visionRetryUsed, true);
    assert.equal(resolved.report.summary.agreed, 5);
  } finally {
    await rm(retryCache, { recursive: true, force: true });
  }

  const invalidCache = await mkdtemp(path.join(os.tmpdir(), 'annual-classifier-invalid-'));
  let invalidCalls = 0;
  const invalidProvider: AnnualClassifierProvider = {
    async classify() {
      invalidCalls += 1;
      return { questionText: 'RAW_RESPONSE_MUST_NOT_BE_STORED' };
    },
  };
  try {
    const disputed = await runAnnualClassifierBlock({
      year: 2026,
      exam: 'tyt',
      questionBlock: block,
      bookletRegistry: registry,
      topicCatalog: catalog,
      sources,
      provider: invalidProvider,
      cacheDirectory: invalidCache,
      reviewedAt: '2026-07-15',
    });
    assert.equal(invalidCalls, 4);
    assert.equal(disputed.report.summary.disputed, 5);
    assert.deepEqual(await readdir(invalidCache).catch(() => []), []);
    assert.doesNotMatch(JSON.stringify(disputed), /RAW_RESPONSE_MUST_NOT_BE_STORED/);
  } finally {
    await rm(invalidCache, { recursive: true, force: true });
  }
});

test('CLI is permanently dry-run and supports a credential-free local preflight', () => {
  const environment = {
    CF_CLASSIFIER_ENDPOINT: 'https://classifier.example/v1/classify',
    CF_CLASSIFIER_TOKEN: 'x'.repeat(32),
  };
  assert.throws(
    () => parseAnnualClassifierArgs(['--year', '2026', '--exam', 'tyt', '--all-blocks'], {}),
    /required/,
  );
  assert.equal(
    parseAnnualClassifierArgs(['--year', '2026', '--exam', 'tyt', '--all-blocks', '--dry-run'], {})
      .preflightOnly,
    true,
  );
  assert.throws(
    () =>
      parseAnnualClassifierArgs(
        ['--year', '2026', '--exam', 'tyt', '--all-blocks', '--publish'],
        environment,
      ),
    /unsupported/,
  );
  assert.equal(
    parseAnnualClassifierArgs(
      ['--year', '2026', '--exam', 'tyt', '--all-blocks', '--dry-run'],
      environment,
    ).allBlocks,
    true,
  );
});

function workerRequest(body: unknown, token = 't'.repeat(32)): Request {
  return new Request('https://classifier.example/v1/classify', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validWorkerBody() {
  return {
    model: ANNUAL_CLASSIFIER_TEXT_MODEL,
    mode: 'text',
    requestId: 'tyt-block-text-primary-section-text',
    messages: [
      { role: 'system', content: 'Return ID-only JSON.' },
      { role: 'user', content: 'Temporary official evidence.' },
    ],
    responseJsonSchema: ANNUAL_CLASSIFIER_RESPONSE_JSON_SCHEMA,
    maxCompletionTokens: 1024,
    temperature: 0,
  };
}

test('Cloudflare gateway enforces auth, model/mode and no-store responses', async () => {
  assert.ok(
    ANNUAL_CLASSIFIER_PROVIDER_TIMEOUT_MS >= CLASSIFIER_AI_TIMEOUT_MS + 10_000,
    'the client must remain connected long enough to receive the Worker timeout response',
  );
  const calls: { model: string; input: Record<string, unknown> }[] = [];
  const env: WorkerEnv = {
    CLASSIFIER_AUTH_TOKEN: 't'.repeat(32),
    AI: {
      async run(model, input) {
        calls.push({ model, input });
        return { response: '{"schemaVersion":1,"questionBlockId":"x","classifications":[]}' };
      },
    },
  };
  const unauthorized = await worker.fetch(workerRequest(validWorkerBody(), 'bad-token'), env);
  assert.equal(unauthorized.status, 401);
  assert.equal(calls.length, 0);

  const mismatched = validWorkerBody();
  mismatched.model = ANNUAL_CLASSIFIER_VISION_MODEL;
  const rejected = await handleRequest(workerRequest(mismatched), env);
  assert.equal(rejected.status, 400);
  assert.equal(calls.length, 0);

  const accepted = await handleRequest(workerRequest(validWorkerBody()), env);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.model, ANNUAL_CLASSIFIER_TEXT_MODEL);
  assert.equal(calls[0]!.input.store, false);

  const vision = {
    ...validWorkerBody(),
    model: ANNUAL_CLASSIFIER_VISION_MODEL,
    mode: 'vision',
    messages: [
      { role: 'system', content: 'Return ID-only JSON.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'classify' },
          { type: 'image_url', image_url: { url: 'https://attacker.example/image.jpg' } },
        ],
      },
    ],
  };
  assert.equal((await handleRequest(workerRequest(vision), env)).status, 400);
  assert.equal(calls.length, 1);

  const oversizedVision = structuredClone(vision);
  oversizedVision.messages[1]!.content = [
    { type: 'text', text: 'classify' },
    ...Array.from({ length: 3 }, () => ({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,AAAA' },
    })),
  ];
  assert.equal((await handleRequest(workerRequest(oversizedVision), env)).status, 400);
  assert.equal(calls.length, 1);
});
