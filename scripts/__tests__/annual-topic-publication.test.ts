import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ANNUAL_CLASSIFIER_PROMPT_VERSION,
  ANNUAL_CLASSIFIER_SCHEMA_VERSION,
  ANNUAL_CLASSIFIER_TEXT_MODEL,
  ANNUAL_CLASSIFIER_VISION_MODEL,
  assertIdOnlyPayload,
  stableSha256,
  type AnnualClassifierReport,
} from '../lib/annual-classifier-contract.ts';
import { classifierPromptCatalogSchema } from '../lib/annual-classifier-orchestrator.ts';
import {
  annualTopicHumanReviewSchema,
  applyApprovedAnnualTopics,
  prepareAnnualTopicHumanReview,
  validateAnnualTopicHumanReview,
  type ApprovedAnnualTopicHumanReview,
} from '../lib/annual-topic-publication.ts';
import { extendTopicCoverage, topicsSchema, type TopicsDocument } from '../lib/content-schemas.ts';
import {
  osymBookletRegistrySchema,
  type OfficialQuestionBlock,
  type OsymBookletRegistry,
} from '../lib/osym-booklet-registry.ts';

async function fixture() {
  const registry = osymBookletRegistrySchema.parse(
    JSON.parse(await readFile('content/osym-booklets.json', 'utf8')) as unknown,
  );
  const catalog = topicsSchema.parse(
    JSON.parse(await readFile('content/topics.json', 'utf8')) as unknown,
  );
  return { registry, catalog };
}

function topicForBlock(catalog: TopicsDocument, block: OfficialQuestionBlock) {
  const section = catalog.exams
    .flatMap((exam) => exam.sections)
    .find((candidate) => candidate.id === block.sectionId)!;
  const subject = section.subjects.find((candidate) => candidate.id === block.subjectIds[0])!;
  return { subjectId: subject.id, topicId: subject.topics[0]!.id };
}

function classifierReport(
  registry: OsymBookletRegistry,
  catalog: TopicsDocument,
  block: OfficialQuestionBlock,
): AnnualClassifierReport {
  const booklet = registry.booklets.find(
    (candidate) => candidate.year === 2026 && candidate.session === 'tyt',
  )!;
  const topic = topicForBlock(catalog, block);
  const questions = Array.from(
    { length: block.officialQuestionRange.last - block.officialQuestionRange.first + 1 },
    (_, index) => block.officialQuestionRange.first + index,
  ).map((officialQuestionNo) => {
    const result = {
      officialQuestionNo,
      primaryTopicRef: { ...topic, countsTowardStats: true as const },
      relatedTopicRefs: [],
      status: 'classified' as const,
      confidence: 0.95,
      page: 3,
    };
    return {
      officialQuestionNo,
      text: result,
      vision: result,
      consensus: 'agreed' as const,
      consensusConfidence: 0.95,
    };
  });
  return {
    schemaVersion: ANNUAL_CLASSIFIER_SCHEMA_VERSION,
    kind: 'annual-topic-classification-dry-run',
    dryRun: true,
    scope: {
      year: 2026,
      exam: 'tyt',
      questionBlockId: block.id,
      sectionId: block.sectionId,
      bookletSectionId: block.bookletSectionId,
      questionRange: block.officialQuestionRange,
    },
    provenance: {
      bookletId: '2026-tyt',
      bookletSha256: booklet.sha256,
      taxonomySha256: stableSha256(classifierPromptCatalogSchema.parse(catalog)),
      promptVersion: ANNUAL_CLASSIFIER_PROMPT_VERSION,
      textModel: ANNUAL_CLASSIFIER_TEXT_MODEL,
      visionModel: ANNUAL_CLASSIFIER_VISION_MODEL,
    },
    execution: {
      textProviderCalls: 1,
      textCacheHits: 0,
      textRetryUsed: false,
      visionProviderCalls: 1,
      visionCacheHits: 0,
      visionRetryUsed: false,
    },
    questions,
    summary: {
      total: questions.length,
      agreed: questions.length,
      needsReview: 0,
      disputed: 0,
    },
    publication: { automatic: false, reason: 'human-adjudication-required' },
  };
}

function approve(
  pending: ReturnType<typeof prepareAnnualTopicHumanReview>,
  related?: ApprovedAnnualTopicHumanReview['records'][number]['relatedTopicRefs'][number],
): ApprovedAnnualTopicHumanReview {
  return annualTopicHumanReviewSchema.parse({
    ...pending,
    decision: 'approved',
    approvedBy: 'human-editor-a',
    reviewedAt: '2026-07-15',
    records: pending.records.map((record, index) => ({
      officialQuestionNo: record.officialQuestionNo,
      status: 'approved',
      primaryTopicRef: topicDecisionFromPending(pending),
      relatedTopicRefs: index === 0 && related ? [related] : [],
    })),
  }) as ApprovedAnnualTopicHumanReview;
}

function topicDecisionFromPending(pending: ReturnType<typeof prepareAnnualTopicHumanReview>) {
  const blockId = pending.scope.questionBlockId;
  if (blockId.includes('turkce')) {
    return { subjectId: 'tyt-turkce', topicId: 'sozcukte-anlam', countsTowardStats: true as const };
  }
  if (blockId.includes('tarih')) {
    return {
      subjectId: 'tyt-tarih',
      topicId: 'tarih-ve-zaman',
      countsTowardStats: true as const,
    };
  }
  if (blockId.includes('cografya')) {
    return {
      subjectId: 'tyt-cografya',
      topicId: 'doga-ve-insan',
      countsTowardStats: true as const,
    };
  }
  if (blockId.includes('din')) {
    return {
      subjectId: 'tyt-din-kulturu',
      topicId: 'bilgi-ve-inanc',
      countsTowardStats: true as const,
    };
  }
  return {
    subjectId: 'tyt-felsefe',
    topicId: 'felsefeyi-tanima',
    countsTowardStats: true as const,
  };
}

test('an ID-only human approval applies exact question metadata and primary-only yearly counts', async () => {
  const { registry, catalog } = await fixture();
  const block = registry.questionBlockProfiles.tyt.questionBlocks.find(
    (candidate) => candidate.id === 'tyt-turkce-default',
  )!;
  const report = classifierReport(registry, catalog, block);
  const pending = prepareAnnualTopicHumanReview({
    report,
    bookletRegistry: registry,
    topicCatalog: catalog,
  });
  assert.equal(pending.decision, 'pending');
  assert.throws(
    () =>
      applyApprovedAnnualTopics({
        approvals: [{ review: pending, report }],
        bookletRegistry: registry,
        topicCatalog: catalog,
        currentDate: '2026-07-15',
      }),
    /pending explicit human approval/,
  );

  const aytEdebiyat = catalog.exams
    .find((exam) => exam.id === 'ayt')!
    .sections.find((section) => section.id === 'ayt-edebiyat-sosyal-1')!
    .subjects.find((subject) => subject.id === 'ayt-edebiyat')!;
  const approval = approve(pending, {
    exam: 'ayt',
    sectionId: 'ayt-edebiyat-sosyal-1',
    subjectId: 'ayt-edebiyat',
    topicId: aytEdebiyat.topics[0]!.id,
    crossExam: true,
    countsTowardStats: false,
  });
  assert.doesNotThrow(() => assertIdOnlyPayload(approval));
  assert.doesNotMatch(JSON.stringify(approval), /descriptor|kazanim|difficulty|questionText|image/);

  const result = applyApprovedAnnualTopics({
    approvals: [{ review: approval, report }],
    bookletRegistry: registry,
    topicCatalog: catalog,
    currentDate: '2026-07-15',
  });
  assert.equal(result.summary.canonicalQuestionCount, 40);
  assert.equal(result.summary.relatedQuestionCount, 1);
  const turkishSection = result.catalog.exams
    .find((exam) => exam.id === 'tyt')!
    .sections.find((section) => section.id === 'tyt-turkce')!;
  const primaryQuestions = turkishSection.subjects.flatMap((subject) =>
    subject.topics.flatMap((topic) =>
      topic.questions.filter((question) => question.role === 'primary'),
    ),
  );
  assert.equal(primaryQuestions.length, 40);
  assert.equal(primaryQuestions[0]!.descriptor, null);
  assert.equal(primaryQuestions[0]!.kazanim, null);
  assert.equal(primaryQuestions[0]!.difficulty, null);
  assert.equal(primaryQuestions[0]!.sourceUrl, approval.provenance.pdfUrl);
  assert.equal(primaryQuestions[0]!.bookletSha256, approval.provenance.bookletSha256);
  assert.deepEqual(
    primaryQuestions.map((question) => question.officialQuestionNo),
    Array.from({ length: 40 }, (_, index) => index + 1),
  );
  const yearlyTotal = turkishSection.subjects
    .flatMap((subject) => subject.topics)
    .reduce(
      (total, topic) => total + (topic.yearlyStats.find((stat) => stat.year === 2026)!.count ?? 0),
      0,
    );
  assert.equal(yearlyTotal, 40);
  assert.doesNotThrow(() => topicsSchema.parse(result.catalog));

  const idempotent = applyApprovedAnnualTopics({
    approvals: [{ review: approval, report }],
    bookletRegistry: registry,
    topicCatalog: result.catalog,
    currentDate: '2026-07-15',
  });
  assert.equal(stableSha256(idempotent.catalog), stableSha256(result.catalog));

  const correctedApproval = structuredClone(approval);
  for (const record of correctedApproval.records) {
    record.primaryTopicRef.topicId = 'cumlede-anlam';
  }
  let replacementError: unknown;
  try {
    applyApprovedAnnualTopics({
      approvals: [{ review: correctedApproval, report }],
      bookletRegistry: registry,
      topicCatalog: result.catalog,
      currentDate: '2026-07-15',
    });
  } catch (error) {
    replacementError = error;
  }
  assert.ok(replacementError instanceof Error);
  const oldDigest = /old digest ([0-9a-f]{64})/.exec(replacementError.message)?.[1];
  assert.ok(oldDigest);
  const corrected = applyApprovedAnnualTopics({
    approvals: [{ review: correctedApproval, report }],
    bookletRegistry: registry,
    topicCatalog: result.catalog,
    currentDate: '2026-07-15',
    replacementAuthorizations: [
      {
        targetKey: '2026:tyt:tyt-turkce:default',
        expectedExistingSha256: oldDigest!,
      },
    ],
  });
  const correctedSection = corrected.catalog.exams
    .find((exam) => exam.id === 'tyt')!
    .sections.find((section) => section.id === 'tyt-turkce')!;
  assert.equal(
    correctedSection.subjects[0]!.topics.find(
      (topic) => topic.id === 'cumlede-anlam',
    )!.yearlyStats.find((stat) => stat.year === 2026)!.count,
    40,
  );
});

test('partial sections fail closed and no-DKAB approvals never emit counting questions', async () => {
  const { registry, catalog } = await fixture();
  const blockById = (id: string) =>
    registry.questionBlockProfiles.tyt.questionBlocks.find((block) => block.id === id)!;
  const historyBlock = blockById('tyt-sosyal-tarih-default');
  const historyReport = classifierReport(registry, catalog, historyBlock);
  const historyApproval = approve(
    prepareAnnualTopicHumanReview({
      report: historyReport,
      bookletRegistry: registry,
      topicCatalog: catalog,
    }),
  );
  assert.throws(
    () =>
      applyApprovedAnnualTopics({
        approvals: [{ review: historyApproval, report: historyReport }],
        bookletRegistry: registry,
        topicCatalog: catalog,
        currentDate: '2026-07-15',
      }),
    /must include every canonical section block/,
  );

  const blockIds = [
    'tyt-sosyal-tarih-default',
    'tyt-sosyal-cografya-default',
    'tyt-sosyal-felsefe-default',
    'tyt-sosyal-din-default',
    'tyt-sosyal-felsefe-no-dkab',
  ];
  const approvals = blockIds.map((id) => {
    const block = blockById(id);
    const report = classifierReport(registry, catalog, block);
    const review = approve(
      prepareAnnualTopicHumanReview({ report, bookletRegistry: registry, topicCatalog: catalog }),
    );
    return { review, report };
  });
  const result = applyApprovedAnnualTopics({
    approvals,
    bookletRegistry: registry,
    topicCatalog: catalog,
    currentDate: '2026-07-15',
  });
  assert.equal(result.summary.canonicalQuestionCount, 20);
  assert.equal(result.summary.evidenceOnlyQuestionCount, 5);
  const allQuestions = result.catalog.exams.flatMap((exam) =>
    exam.sections.flatMap((section) =>
      section.subjects.flatMap((subject) => subject.topics.flatMap((topic) => topic.questions)),
    ),
  );
  assert.equal(allQuestions.filter((question) => question.role === 'primary').length, 20);
  assert.equal(
    allQuestions.filter((question) => question.questionBlockId === 'tyt-sosyal-felsefe-no-dkab')
      .length,
    5,
  );
  assert.equal(allQuestions.filter((question) => question.role === 'alternative').length, 5);
  assert.equal(
    allQuestions
      .filter((question) => question.role === 'alternative')
      .every((question) => !question.countsTowardStats && !question.crossExam),
    true,
  );
});

test('approval provenance, forbidden metadata, and non-human approvers fail closed', async () => {
  const { registry, catalog } = await fixture();
  const block = registry.questionBlockProfiles.tyt.questionBlocks[0]!;
  const report = classifierReport(registry, catalog, block);
  const pending = prepareAnnualTopicHumanReview({
    report,
    bookletRegistry: registry,
    topicCatalog: catalog,
  });
  const approval = approve(pending);
  const catalogWithFuturePlaceholder = extendTopicCoverage(catalog, 2027);
  assert.doesNotThrow(() =>
    validateAnnualTopicHumanReview({
      review: approval,
      report,
      bookletRegistry: registry,
      topicCatalog: catalogWithFuturePlaceholder,
      currentDate: '2026-07-15',
    }),
  );
  assert.throws(
    () =>
      validateAnnualTopicHumanReview({
        review: {
          ...approval,
          provenance: { ...approval.provenance, classifierReportSha256: 'f'.repeat(64) },
        },
        report,
        bookletRegistry: registry,
        topicCatalog: catalog,
        currentDate: '2026-07-15',
      }),
    /provenance/,
  );
  assert.equal(
    annualTopicHumanReviewSchema.safeParse({
      ...approval,
      records: [{ ...approval.records[0], difficulty: 'orta' }, ...approval.records.slice(1)],
    }).success,
    false,
  );
  assert.throws(
    () =>
      validateAnnualTopicHumanReview({
        review: { ...approval, approvedBy: 'annual-model' },
        report,
        bookletRegistry: registry,
        topicCatalog: catalog,
        currentDate: '2026-07-15',
      }),
    /human-/,
  );

  const applied = applyApprovedAnnualTopics({
    approvals: [{ review: approval, report }],
    bookletRegistry: registry,
    topicCatalog: catalog,
    currentDate: '2026-07-15',
  }).catalog;
  const wrongExistingHash = structuredClone(applied);
  const publishedQuestion = wrongExistingHash.exams[0]!.sections[0]!.subjects[0]!.topics.flatMap(
    (topic) => topic.questions,
  ).find((question) => question.role === 'primary')!;
  publishedQuestion.bookletSha256 = 'f'.repeat(64);
  assert.throws(
    () =>
      applyApprovedAnnualTopics({
        approvals: [{ review: approval, report }],
        bookletRegistry: registry,
        topicCatalog: wrongExistingHash,
        currentDate: '2026-07-15',
      }),
    /does not match the official booklet registry/,
  );

  const changedTaxonomy = structuredClone(catalog);
  changedTaxonomy.exams[0]!.sections[0]!.subjects[0]!.topics[0]!.name.tr += ' değişti';
  assert.throws(
    () =>
      validateAnnualTopicHumanReview({
        review: approval,
        report,
        bookletRegistry: registry,
        topicCatalog: changedTaxonomy,
        currentDate: '2026-07-15',
      }),
    /provenance/,
  );
});
