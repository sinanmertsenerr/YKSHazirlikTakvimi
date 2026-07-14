import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import type { ProgramsFixture, TopicsDocument } from '../lib/content-schemas.ts';
import {
  validateCoefficientsData,
  validateNewsData,
  validateProgramsFixtureData,
  validateRankTablesData,
  validateTopicsData,
} from '../validate-pack.ts';
import { isRelevantNewsTitle } from '../lib/news-relevance.ts';

const BOOKLET_2018_TYT = 'https://dokuman.osym.gov.tr/pdfdokuman/2018/YKS/TYT_01072018.pdf';
const BOOKLET_2018_AYT = 'https://dokuman.osym.gov.tr/pdfdokuman/2018/YKS/AYT_01072018.pdf';
const VERIFIED_AT = '2026-07-14T20:04:17Z';

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8')) as unknown;
}

test('the complete null-placeholder taxonomy passes', async () => {
  const report = validateTopicsData(await readJson('content/topics.json'));
  assert.deepEqual(report.errors, []);
  assert.equal(report.summary.topics, 359);
  assert.equal(report.summary.placeholderSectionYears, 72);
});

test('a section/year cannot mix unknown and verified numeric topic counts', async () => {
  const topics = (await readJson('content/topics.json')) as TopicsDocument;
  const stat = topics.exams[0]!.sections[0]!.subjects[0]!.topics[0]!.yearlyStats[0]!;
  stat.count = 1;
  stat.verified = true;
  stat.source = BOOKLET_2018_TYT;
  stat.bookletSha256 = 'a'.repeat(64);
  stat.verificationMethod = 'editorial-consensus';
  stat.verifiedAt = VERIFIED_AT;

  const report = validateTopicsData(topics);
  assert.ok(
    report.errors.some((error) => error.includes('must be wholly unknown or wholly verified')),
  );
});

test('numeric yearly data requires complete editorial provenance', async () => {
  const topics = (await readJson('content/topics.json')) as TopicsDocument;
  const stat = topics.exams[0]!.sections[0]!.subjects[0]!.topics[0]!.yearlyStats[0]!;
  stat.count = 1;

  const missingProvenance = validateTopicsData(topics);
  assert.ok(
    missingProvenance.errors.some((error) =>
      error.includes('numeric yearly counts require verified=true'),
    ),
  );

  stat.verified = true;
  stat.source = BOOKLET_2018_TYT;
  stat.bookletSha256 = 'a'.repeat(64);
  stat.verificationMethod = 'official-direct';
  stat.verifiedAt = VERIFIED_AT;
  const wrongMethod = validateTopicsData(topics);
  assert.ok(wrongMethod.errors.some((error) => error.includes('must use editorial-consensus')));

  stat.verificationMethod = 'editorial-consensus';
  stat.source = 'https://dokuman.osym.gov.tr/pdfdokuman/2018/YKS/AYT_01072018.pdf';
  const wrongSession = validateTopicsData(topics);
  assert.ok(wrongSession.errors.some((error) => error.includes('must match its year and TYT')));
});

test('a real zero is accepted only as a verified, sourced numeric row in a complete section', async () => {
  const topics = (await readJson('content/topics.json')) as TopicsDocument;
  const bookletRegistry = (await readJson('content/osym-booklets.json')) as {
    booklets: Array<{ year: number; session: string; sha256: string }>;
  };
  const bookletHash = bookletRegistry.booklets.find(
    (booklet) => booklet.year === 2018 && booklet.session === 'tyt',
  )!.sha256;
  const section = topics.exams[0]!.sections[0]!;
  const stats = section.subjects.flatMap((subject) =>
    subject.topics.map((topic) => topic.yearlyStats[0]!),
  );
  for (const [index, stat] of stats.entries()) {
    stat.count = index === 0 ? section.questionCount : 0;
    stat.verified = true;
    stat.source = BOOKLET_2018_TYT;
    stat.bookletSha256 = bookletHash;
    stat.verificationMethod = 'editorial-consensus';
    stat.verifiedAt = VERIFIED_AT;
  }
  const primaryTopic = section.subjects[0]!.topics[0]!;
  for (let officialQuestionNo = 1; officialQuestionNo <= 40; officialQuestionNo += 1) {
    primaryTopic.questions.push({
      year: 2018,
      sourceExam: 'tyt',
      sourceSectionId: 'tyt-turkce',
      sourceSubjectId: 'tyt-turkce',
      questionBlockId: 'tyt-turkce-default',
      officialQuestionNo,
      role: 'primary',
      countsTowardStats: true,
      crossExam: false,
      descriptor: null,
      kazanim: null,
      difficulty: null,
      sourceUrl: BOOKLET_2018_TYT,
      bookletSha256: bookletHash,
      verified: true,
      source: BOOKLET_2018_TYT,
      verificationMethod: 'editorial-consensus',
      verifiedAt: VERIFIED_AT,
    });
  }

  const report = validateTopicsData(topics, bookletRegistry);
  assert.deepEqual(report.errors, []);
  assert.equal(stats[1]!.count, 0);

  stats[0]!.bookletSha256 = 'f'.repeat(64);
  assert.ok(
    validateTopicsData(topics, bookletRegistry).errors.some((error) =>
      error.includes('URL/hash provenance must exactly match'),
    ),
  );
});

test('question metadata cannot exist while its yearly count is unknown', async () => {
  const topics = (await readJson('content/topics.json')) as TopicsDocument;
  topics.exams[0]!.sections[0]!.subjects[0]!.topics[0]!.questions.push({
    year: 2018,
    sourceExam: 'tyt',
    sourceSectionId: 'tyt-turkce',
    sourceSubjectId: 'tyt-turkce',
    questionBlockId: 'tyt-turkce-default',
    officialQuestionNo: 1,
    role: 'primary',
    countsTowardStats: true,
    crossExam: false,
    descriptor: { tr: 'Test kaydı', en: 'Test record' },
    kazanim: { tr: 'Test', en: 'Test' },
    difficulty: 'orta',
    sourceUrl: BOOKLET_2018_TYT,
    bookletSha256: 'a'.repeat(64),
    verified: true,
    source: BOOKLET_2018_TYT,
    verificationMethod: 'editorial-consensus',
    verifiedAt: VERIFIED_AT,
  });
  const report = validateTopicsData(topics);
  assert.ok(
    report.errors.some((error) => error.includes('requires a verified numeric yearly count')),
  );
});

test('cross-exam related metadata is visible but cannot inflate topic statistics', async () => {
  const topics = (await readJson('content/topics.json')) as TopicsDocument;
  const section = topics.exams
    .find((exam) => exam.id === 'ayt')!
    .sections.find((candidate) => candidate.id === 'ayt-fen')!;
  const chemistryTopic = section.subjects.find((subject) => subject.id === 'ayt-kimya')!.topics[0]!;
  chemistryTopic.questions.push({
    year: 2018,
    sourceExam: 'tyt',
    sourceSectionId: 'tyt-fen',
    sourceSubjectId: 'tyt-kimya',
    questionBlockId: 'tyt-fen-kimya-default',
    officialQuestionNo: 8,
    role: 'related',
    countsTowardStats: false,
    crossExam: true,
    descriptor: { tr: 'İlişkili TYT sorusu', en: 'Related TYT question' },
    kazanim: { tr: 'Kimya', en: 'Chemistry' },
    difficulty: 'orta',
    sourceUrl: BOOKLET_2018_TYT,
    bookletSha256: 'a'.repeat(64),
    verified: true,
    source: BOOKLET_2018_TYT,
    verificationMethod: 'editorial-consensus',
    verifiedAt: VERIFIED_AT,
  });

  assert.deepEqual(validateTopicsData(topics).errors, []);
  assert.equal(chemistryTopic.yearlyStats[0]!.count, null);

  const crossDiscipline = structuredClone(topics);
  const invalid = crossDiscipline.exams
    .find((exam) => exam.id === 'ayt')!
    .sections.find((candidate) => candidate.id === 'ayt-fen')!
    .subjects.find((subject) => subject.id === 'ayt-kimya')!.topics[0]!.questions[0]!;
  invalid.sourceSectionId = 'tyt-sosyal';
  invalid.sourceSubjectId = 'tyt-felsefe';
  invalid.questionBlockId = 'tyt-sosyal-felsefe-default';
  invalid.officialQuestionNo = 11;
  assert.ok(
    validateTopicsData(crossDiscipline).errors.some((error) =>
      error.includes('outside the explicit discipline family'),
    ),
  );
});

test('official coefficient rules pass while v1 synthetic and legacy keys fail closed', async () => {
  const official = await readJson('content/coefficients.json');
  assert.deepEqual(validateCoefficientsData(official).errors, []);

  const legacy = {
    schemaVersion: 1,
    year: 2026,
    base: 100,
    obpMultiplier: 0.12,
    rules: { aytWarningTytRawScoreBelow: 150, verified: false },
    scoreTypes: [{ id: 'tyt', netCoefficients: { 'tyt-turkce': 3.32 } }],
  };
  assert.notDeepEqual(validateCoefficientsData(legacy).errors, []);

  const extraLegacyKey = structuredClone(official) as Record<string, unknown>;
  extraLegacyKey.base = 100;
  assert.ok(
    validateCoefficientsData(extraLegacyKey).errors.some((error) =>
      error.includes('Unrecognized key'),
    ),
  );
});

test('coefficient components are exact positive percentages summing to 100', async () => {
  const coefficients = structuredClone(await readJson('content/coefficients.json')) as {
    officialRules: { weightsPercent: { tyt: { 'tyt-turkce': number } } };
  };
  coefficients.officialRules.weightsPercent.tyt['tyt-turkce'] = 0;
  const report = validateCoefficientsData(coefficients);
  assert.notDeepEqual(report.errors, []);
});

test('2026 rank data is unavailable and any synthetic point/table is rejected', async () => {
  assert.deepEqual(validateRankTablesData(await readJson('content/rank-tables.json')).errors, []);
  const report = validateRankTablesData(
    await readJson('scripts/__tests__/fixtures/broken-rank-tables.json'),
  );
  assert.notDeepEqual(report.errors, []);
});

test('program scores and ranks must be null or positive', async () => {
  const programs = (await readJson('content/programs.fixture.json')) as ProgramsFixture;
  programs.programs[0]!.years[0]!.minRank = 0;
  programs.programs[0]!.years[0]!.minScore = -1;
  const report = validateProgramsFixtureData(programs);
  assert.ok(report.errors.some((error) => error.includes('Too small')));
});

test('verified programs and years require a verification timestamp', async () => {
  const programs = (await readJson('content/programs.fixture.json')) as ProgramsFixture;
  programs.programs[0]!.verifiedAt = null;
  programs.programs[0]!.years[0]!.verifiedAt = null;
  const report = validateProgramsFixtureData(programs);
  assert.ok(
    report.errors.some((error) => error.includes('official source URL and verification time')),
  );
});

test('published news contains zero generic, sample, unverified, or unsourced records', async () => {
  const news = (await readJson('content/news.json')) as {
    dataStatus: { approximate: boolean; sample: boolean; source: string | null; verified: boolean };
    items: Array<{
      approximate: boolean;
      provenance?: { detailUrl?: string; listUrl?: string };
      sample: boolean;
      title: { tr: string };
      verified: boolean;
      verifiedAt?: string;
    }>;
  };
  assert.deepEqual(validateNewsData(news).errors, []);
  assert.deepEqual(
    {
      genericOrNonYks: news.items.filter((item) => !isRelevantNewsTitle(item.title.tr)).length,
      sampleUnverifiedOrUnsourced: news.items.filter(
        (item) =>
          item.sample ||
          item.approximate ||
          !item.verified ||
          !item.verifiedAt ||
          !item.provenance?.listUrl ||
          !item.provenance.detailUrl,
      ).length,
    },
    { genericOrNonYks: 0, sampleUnverifiedOrUnsourced: 0 },
  );
  assert.deepEqual(news.dataStatus, {
    ...news.dataStatus,
    verified: true,
    approximate: false,
    sample: false,
  });
  assert.ok(news.dataStatus.source);
});
