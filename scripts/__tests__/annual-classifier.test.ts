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
  ANNUAL_CLASSIFIER_PROMPT_VERSION,
  annualClassifierResponseSchema,
  assertIdOnlyPayload,
  stableSha256,
} from '../lib/annual-classifier-contract.ts';
import {
  deriveOfficialPageQuestionScopes,
  locateBookletSectionPages,
  trimVerifiedTrailingBoilerplatePages,
  type PdfTextPage,
} from '../lib/annual-classifier-extraction.ts';
import {
  ANNUAL_CLASSIFIER_PROVIDER_TIMEOUT_MS,
  classifierPromptCatalogSchema,
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
  subjectId = 'tyt-tarih',
) {
  return {
    schemaVersion: ANNUAL_CLASSIFIER_SCHEMA_VERSION,
    questionBlockId,
    classifications: questionNos.map((officialQuestionNo) => ({
      officialQuestionNo,
      primaryTopicRef: {
        subjectId,
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

function requestedQuestionNumbers(request: ClassifierProviderRequest): number[] {
  const content = request.messages[1].content;
  const instruction =
    typeof content === 'string'
      ? content.slice(0, content.indexOf('\n\n'))
      : content.find((part) => part.type === 'text')?.text;
  if (!instruction) throw new Error('fixture request omitted its scoped instruction');
  const parsed = JSON.parse(instruction) as { classifyOfficialQuestionNos?: unknown };
  if (
    !Array.isArray(parsed.classifyOfficialQuestionNos) ||
    parsed.classifyOfficialQuestionNos.some((value) => !Number.isInteger(value))
  ) {
    throw new Error('fixture request has invalid scoped question IDs');
  }
  return parsed.classifyOfficialQuestionNos as number[];
}

const sources = {
  textPages: [{ page: 4, text: '1. RAW_QUESTION_SENTINEL visible only in process memory' }],
  visionPages: [{ page: 4, imageDataUrl: 'data:image/jpeg;base64,UkFXX0lNQUdF' }],
};

const TURKISH_PAGE_RANGES = [
  [1, 4],
  [5, 6],
  [7, 9],
  [10, 13],
  [14, 17],
  [18, 19],
  [20, 21],
  [22, 23],
  [24, 25],
  [26, 29],
  [30, 33],
  [34, 36],
  [37, 38],
  [39, 40],
] as const;

function turkishTextPages(): PdfTextPage[] {
  return TURKISH_PAGE_RANGES.map(([first, last], index) => ({
    page: index + 3,
    text: [
      ...(index === 0
        ? [
            '1. Bu testte 40 soru vardır.',
            '2. Cevaplarınızı, cevap kâğıdının Türkçe Testi kısmına işaretleyiniz.',
          ]
        : []),
      ...Array.from(
        { length: last - first + 1 },
        (_, offset) => `${first + offset}. official evidence`,
      ),
    ].join('\n'),
  }));
}

function visionPagesFor(textPages: PdfTextPage[]) {
  return textPages.map(({ page }) => ({
    page,
    imageDataUrl: 'data:image/jpeg;base64,UkFXX0lNQUdF',
  }));
}

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
  assert.doesNotThrow(() =>
    assertIdOnlyPayload({ promptVersion: ANNUAL_CLASSIFIER_PROMPT_VERSION }),
  );
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

test('page-local scope derives the exact 14-page 2026 Turkish mapping', () => {
  const scopes = deriveOfficialPageQuestionScopes({
    pages: turkishTextPages(),
    sectionQuestionRange: { first: 1, last: 40 },
    blockQuestionRange: { first: 1, last: 40 },
  });
  assert.deepEqual(
    scopes.map((scope) => [scope.sectionQuestionRange.first, scope.sectionQuestionRange.last]),
    TURKISH_PAGE_RANGES,
  );
  assert.deepEqual(
    scopes.flatMap((scope) => scope.blockQuestionNumbers),
    Array.from({ length: 40 }, (_, index) => index + 1),
  );
});

test('page-local scope sorts two-column boundaries from real 2019 and 2025 layouts', () => {
  const scopes2019 = deriveOfficialPageQuestionScopes({
    pages: [
      { page: 14, text: '35. - 36. soruları cevaplayınız.\n34. official evidence' },
      { page: 15, text: '37. - 38. soruları cevaplayınız.\n37. official evidence' },
      { page: 16, text: '39. - 40. soruları cevaplayınız.\n39. official evidence' },
    ],
    sectionQuestionRange: { first: 34, last: 40 },
    blockQuestionRange: { first: 34, last: 40 },
  });
  assert.deepEqual(
    scopes2019.map(({ sectionQuestionRange }) => sectionQuestionRange),
    [
      { first: 34, last: 36 },
      { first: 37, last: 38 },
      { first: 39, last: 40 },
    ],
  );

  const scopes2025 = deriveOfficialPageQuestionScopes({
    pages: [
      { page: 15, text: '35. official evidence' },
      {
        page: 16,
        text: '39. - 40. soruları cevaplayınız.\n37. - 38. soruları cevaplayınız.\n40. official evidence',
      },
    ],
    sectionQuestionRange: { first: 35, last: 40 },
    blockQuestionRange: { first: 35, last: 40 },
  });
  assert.deepEqual(
    scopes2025.map(({ sectionQuestionRange }) => sectionQuestionRange),
    [
      { first: 35, last: 36 },
      { first: 37, last: 40 },
    ],
  );
});

test('only exact ÖSYM trailing boilerplate is removed; meaningful markerless pages fail closed', () => {
  const officialNotice =
    'Bu soruların telif hakları ÖSYM’ye aittir. Sorular, ÖSYM’nin yazılı izni olmaksızın hiçbir kişi, kurum veya kuruluş tarafından kullanılamaz. ÖSYM';
  const pages = [
    { page: 40, text: '19. official evidence\n20. official evidence' },
    { page: 41, text: officialNotice.split('').reverse().join('\n') },
  ];
  assert.deepEqual(trimVerifiedTrailingBoilerplatePages(pages), [pages[0]]);
  assert.deepEqual(
    deriveOfficialPageQuestionScopes({
      pages,
      sectionQuestionRange: { first: 19, last: 20 },
      blockQuestionRange: { first: 19, last: 20 },
    }).map(({ page }) => page),
    [40],
  );
  assert.throws(
    () =>
      deriveOfficialPageQuestionScopes({
        pages: [
          pages[0]!,
          { page: 41, text: 'Question diagram continues here without a numbered boundary.' },
        ],
        sectionQuestionRange: { first: 19, last: 20 },
        blockQuestionRange: { first: 19, last: 20 },
      }),
    /missing an explicit question boundary/,
  );
});

test('page-local scope clamps shared sections to default and alternative blocks', async () => {
  const { registry } = await loadFixtureData();
  const pages = [1, 6, 11, 16, 21].map((first, index) => ({
    page: index + 17,
    text: `${first}. official evidence`,
  }));
  const blocks = registry.questionBlockProfiles.tyt.questionBlocks;
  const defaultBlock = blocks.find((block) => block.id === 'tyt-sosyal-din-default')!;
  const alternativeBlock = blocks.find((block) => block.id === 'tyt-sosyal-felsefe-no-dkab')!;
  const derive = (block: typeof defaultBlock) =>
    deriveOfficialPageQuestionScopes({
      pages,
      sectionQuestionRange: { first: 1, last: 25 },
      blockQuestionRange: block.officialQuestionRange,
    });
  assert.deepEqual(
    derive(defaultBlock).flatMap((scope) => scope.blockQuestionNumbers),
    [16, 17, 18, 19, 20],
  );
  assert.deepEqual(
    derive(alternativeBlock).flatMap((scope) => scope.blockQuestionNumbers),
    [21, 22, 23, 24, 25],
  );
});

test('page-local scope fails closed on missing or nonmonotonic boundaries', () => {
  const input = {
    sectionQuestionRange: { first: 1, last: 5 },
    blockQuestionRange: { first: 1, last: 5 },
  };
  assert.throws(
    () =>
      deriveOfficialPageQuestionScopes({
        ...input,
        pages: [
          { page: 3, text: '1. official evidence' },
          { page: 4, text: 'boundary missing' },
        ],
      }),
    /missing an explicit question boundary/,
  );
  assert.throws(
    () =>
      deriveOfficialPageQuestionScopes({
        ...input,
        pages: [
          { page: 3, text: '1. official evidence\n4. official evidence' },
          { page: 4, text: '1. repeated page boundary' },
        ],
      }),
    /nonmonotonic|ambiguous/,
  );
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

test('prompt v2 and exact unit scope never reuse a legacy broad chunk cache', async () => {
  const { registry, catalog } = await loadFixtureData();
  const block = registry.questionBlockProfiles.tyt.questionBlocks.find(
    (candidate) => candidate.id === 'tyt-turkce-default',
  )!;
  const subject = catalog.exams
    .find((exam) => exam.id === 'tyt')!
    .sections.find((section) => section.id === block.sectionId)!
    .subjects.find((candidate) => candidate.id === 'tyt-turkce')!;
  const topicId = subject.topics[0]!.id;
  const booklet = registry.booklets.find(
    (candidate) => candidate.year === 2026 && candidate.session === 'tyt',
  )!;
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), 'annual-classifier-legacy-cache-'));
  const oldKey = {
    bookletSha256: booklet.sha256,
    taxonomySha256: stableSha256(classifierPromptCatalogSchema.parse(catalog)),
    model: ANNUAL_CLASSIFIER_TEXT_MODEL,
    promptVersion: 'annual-topic-v1',
    passId: 'text-primary',
    questionBlockId: block.id,
    unitId: 'pages-3-4-5-6',
  };
  await writeFile(
    path.join(cacheDirectory, `${stableSha256(oldKey)}.json`),
    JSON.stringify({
      schemaVersion: ANNUAL_CLASSIFIER_SCHEMA_VERSION,
      key: oldKey,
      response: classifications(
        block.id,
        topicId,
        Array.from({ length: 40 }, (_, index) => index + 1),
        0.95,
        'tyt-turkce',
      ),
    }),
  );
  const calls: ClassifierProviderRequest[] = [];
  const provider: AnnualClassifierProvider = {
    async classify(request) {
      calls.push(request);
      return classifications(
        block.id,
        topicId,
        requestedQuestionNumbers(request),
        0.95,
        'tyt-turkce',
      );
    },
  };
  const textPages = turkishTextPages();
  try {
    assert.equal(ANNUAL_CLASSIFIER_PROMPT_VERSION, 'annual-topic-v2');
    const result = await runAnnualClassifierBlock({
      year: 2026,
      exam: 'tyt',
      questionBlock: block,
      bookletRegistry: registry,
      topicCatalog: catalog,
      sources: { textPages, visionPages: visionPagesFor(textPages) },
      provider,
      cacheDirectory,
      reviewedAt: '2026-07-15',
    });
    assert.equal(calls.length, 11);
    assert.equal(result.report.execution.textCacheHits, 0);
    assert.equal(result.report.execution.visionCacheHits, 0);
    assert.equal(result.report.summary.agreed, 40);
    assert.equal((await readdir(cacheDirectory)).length, 12);
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

test('vision units run two at a time without completion order or isolated failures leaking', async () => {
  const { registry, catalog, block, topicIds } = await loadFixtureData();
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), 'annual-classifier-concurrency-'));
  const concurrentSources = {
    textPages: Array.from({ length: 6 }, (_, index) => ({
      page: index + 4,
      text: `${index + 1}. official evidence`,
    })),
    visionPages: Array.from({ length: 6 }, (_, index) => ({
      page: index + 4,
      imageDataUrl: 'data:image/jpeg;base64,UkFXX0lNQUdF',
    })),
  };
  const firstUnit = `${block.id}-vision-primary-pages-4-5-questions-1-2`;
  const failedUnit = `${block.id}-vision-primary-pages-6-7-questions-3-4`;
  const lastUnit = `${block.id}-vision-primary-pages-8-questions-5`;
  const retryUnit = `${block.id}-vision-retry-pages-6-7-questions-3-4`;
  let activeVisionCalls = 0;
  let maxActiveVisionCalls = 0;
  let resolveFirstUnitStarted!: () => void;
  const firstUnitStarted = new Promise<void>((resolve) => {
    resolveFirstUnitStarted = resolve;
  });
  const completionOrder: string[] = [];
  const responseAtPage = (page: number, questionNumbers: number[]) => {
    const response = classifications(block.id, topicIds[0]!, questionNumbers);
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
      const questionNumbers = requestedQuestionNumbers(request);
      if (request.mode === 'text') return responseAtPage(4, questionNumbers);
      activeVisionCalls += 1;
      maxActiveVisionCalls = Math.max(maxActiveVisionCalls, activeVisionCalls);
      try {
        if (request.requestId === firstUnit) {
          resolveFirstUnitStarted();
          await new Promise((resolve) => setTimeout(resolve, 100));
          completionOrder.push(request.requestId);
          return responseAtPage(4, questionNumbers);
        }
        if (request.requestId === failedUnit) {
          await firstUnitStarted;
          completionOrder.push(request.requestId);
          throw new Error('isolated vision unit failure');
        }
        assert.ok(request.requestId === lastUnit || request.requestId === retryUnit);
        await firstUnitStarted;
        completionOrder.push(request.requestId);
        return responseAtPage(request.requestId === lastUnit ? 8 : 6, questionNumbers);
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
    assert.deepEqual(completionOrder, [failedUnit, lastUnit, firstUnit, retryUnit]);
    assert.equal(result.report.execution.visionProviderCalls, 4);
    assert.equal(result.report.execution.visionRetryUsed, true);
    assert.equal(result.report.summary.agreed, 5);
    assert.deepEqual(
      result.visionReview.records.map((record) => record.page),
      [4, 4, 6, 6, 8],
    );
    assert.equal((await readdir(cacheDirectory)).length, 5);
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

test('page-local units reject an all-40 chunk hallucination and retry only its scope', async () => {
  const { registry, catalog } = await loadFixtureData();
  const block = registry.questionBlockProfiles.tyt.questionBlocks.find(
    (candidate) => candidate.id === 'tyt-turkce-default',
  )!;
  const subject = catalog.exams
    .find((exam) => exam.id === 'tyt')!
    .sections.find((section) => section.id === block.sectionId)!
    .subjects.find((candidate) => candidate.id === 'tyt-turkce')!;
  const topicId = subject.topics[0]!.id;
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), 'annual-classifier-chunks-'));
  const requests: ClassifierProviderRequest[] = [];
  const textPages = turkishTextPages();
  const largeSources = {
    textPages,
    visionPages: visionPagesFor(textPages),
  };
  const provider: AnnualClassifierProvider = {
    async classify(request) {
      requests.push(request);
      const questionNumbers = requestedQuestionNumbers(request);
      const maliciousFirstTextChunk =
        request.mode === 'text' &&
        request.requestId.includes('-text-primary-pages-3-4-5-6-questions-');
      return classifications(
        block.id,
        topicId,
        maliciousFirstTextChunk
          ? Array.from({ length: 40 }, (_, index) => index + 1)
          : questionNumbers,
        0.95,
        'tyt-turkce',
      );
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
    assert.equal(result.report.execution.textProviderCalls, 5);
    assert.equal(result.report.execution.visionProviderCalls, 7);
    assert.equal(result.report.execution.textRetryUsed, true);
    assert.equal(result.report.execution.visionRetryUsed, false);
    assert.equal(result.report.summary.agreed, 40);

    const textRequests = requests.filter((request) => request.mode === 'text');
    const visionRequests = requests.filter((request) => request.mode === 'vision');
    const primaryTextScopes = textRequests
      .filter((request) => request.requestId.includes('-text-primary-'))
      .map(requestedQuestionNumbers)
      .sort((left, right) => left[0]! - right[0]!);
    assert.deepEqual(primaryTextScopes, [
      Array.from({ length: 13 }, (_, index) => index + 1),
      Array.from({ length: 10 }, (_, index) => index + 14),
      Array.from({ length: 13 }, (_, index) => index + 24),
      [37, 38, 39, 40],
    ]);
    assert.deepEqual(
      visionRequests.map(requestedQuestionNumbers).sort((left, right) => left[0]! - right[0]!),
      [
        [1, 2, 3, 4, 5, 6],
        [7, 8, 9, 10, 11, 12, 13],
        [14, 15, 16, 17, 18, 19],
        [20, 21, 22, 23],
        [24, 25, 26, 27, 28, 29],
        [30, 31, 32, 33, 34, 35, 36],
        [37, 38, 39, 40],
      ],
    );
    assert.deepEqual(
      textRequests
        .filter((request) => request.requestId.includes('-text-retry-'))
        .map(requestedQuestionNumbers),
      [Array.from({ length: 13 }, (_, index) => index + 1)],
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
    assert.equal((await readdir(cacheDirectory)).length, 11);
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
    CLASSIFIER_RATE_LIMITER: { limit: async () => ({ success: true }) },
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
