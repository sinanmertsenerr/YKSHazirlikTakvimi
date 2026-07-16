import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  annualClassifierReportSchema,
  assertIdOnlyPayload,
  stableSha256,
} from './lib/annual-classifier-contract.ts';
import {
  annualTopicHumanReviewSchema,
  applyApprovedAnnualTopics,
  type AnnualTopicApplySummary,
  type ApprovedReviewWithReport,
} from './lib/annual-topic-publication.ts';
import { topicsSchema, type TopicsDocument } from './lib/content-schemas.ts';
import { osymBookletRegistrySchema } from './lib/osym-booklet-registry.ts';

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const ARTIFACT_FILE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.(approval|report)\.json$/;

async function readLimitedJson(filePath: string): Promise<unknown> {
  const metadata = await lstat(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size <= 0 ||
    metadata.size > MAX_INPUT_BYTES
  ) {
    throw new Error(`Unsafe or oversized annual publication input: ${filePath}`);
  }
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

function unpublishedBaseline(catalog: TopicsDocument): TopicsDocument {
  const baseline = structuredClone(catalog);
  for (const exam of baseline.exams) {
    for (const section of exam.sections) {
      for (const subject of section.subjects) {
        for (const topic of subject.topics) {
          topic.questions = [];
          topic.yearlyStats = topic.yearlyStats.map(({ year }) => ({
            year,
            count: null,
            verified: false,
            source: null,
            verificationMethod: null,
            verifiedAt: null,
          }));
        }
      }
    }
  }
  return topicsSchema.parse(baseline);
}

export async function validateAnnualTopicPublication(
  workspace = process.cwd(),
  currentDate = new Date().toISOString().slice(0, 10),
): Promise<AnnualTopicApplySummary> {
  const approvalDirectory = path.resolve(workspace, 'content/topic-approvals');
  const [registryInput, catalogInput, entries] = await Promise.all([
    readLimitedJson(path.resolve(workspace, 'content/osym-booklets.json')),
    readLimitedJson(path.resolve(workspace, 'content/topics.json')),
    readdir(approvalDirectory, { withFileTypes: true }),
  ]);
  const registry = osymBookletRegistrySchema.parse(registryInput);
  const catalog = topicsSchema.parse(catalogInput);
  const groups = new Map<string, { review?: unknown; report?: unknown }>();
  for (const entry of entries) {
    if (entry.name === 'README.md' || entry.name === '.gitkeep') continue;
    if (!entry.isFile())
      throw new Error(`Unsupported entry in topic approval ledger: ${entry.name}`);
    const match = ARTIFACT_FILE.exec(entry.name);
    if (!match) throw new Error(`Unsupported topic approval ledger filename: ${entry.name}`);
    const group = groups.get(match[1]!) ?? {};
    const payload = await readLimitedJson(path.join(approvalDirectory, entry.name));
    assertIdOnlyPayload(payload);
    if (match[2] === 'approval') {
      if (group.review) throw new Error(`Duplicate durable approval for ${match[1]}`);
      const review = annualTopicHumanReviewSchema.parse(payload);
      if (review.decision !== 'approved') {
        throw new Error(`Durable approval ${match[1]} is still pending`);
      }
      group.review = review;
    } else {
      if (group.report) throw new Error(`Duplicate durable classifier report for ${match[1]}`);
      group.report = annualClassifierReportSchema.parse(payload);
    }
    groups.set(match[1]!, group);
  }

  const approvals: ApprovedReviewWithReport[] = [];
  for (const [groupId, group] of groups) {
    if (!group.review || !group.report) {
      throw new Error(`Durable approval group ${groupId} requires one approval and one report`);
    }
    const review = annualTopicHumanReviewSchema.parse(group.review);
    const report = annualClassifierReportSchema.parse(group.report);
    if (review.provenance.classifierReportSha256 !== stableSha256(report)) {
      throw new Error(`Durable approval group ${groupId} report hash mismatch`);
    }
    approvals.push({ review, report });
  }

  const baseline = unpublishedBaseline(catalog);
  const emptySummary: AnnualTopicApplySummary = {
    approvedQuestionCount: 0,
    canonicalQuestionCount: 0,
    evidenceOnlyQuestionCount: 0,
    relatedQuestionCount: 0,
    sectionsUpdated: 0,
    sectionTotals: [],
  };
  const expected = approvals.length
    ? applyApprovedAnnualTopics({
        approvals,
        bookletRegistry: registry,
        topicCatalog: baseline,
        currentDate,
      })
    : { catalog: baseline, summary: emptySummary };
  if (stableSha256(expected.catalog) !== stableSha256(catalog)) {
    throw new Error(
      'content/topics.json question evidence does not exactly match the durable ID-only approval ledger',
    );
  }
  return expected.summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  validateAnnualTopicPublication()
    .then((summary) => {
      process.stdout.write(
        `Validated durable annual publication ledger: ${summary.canonicalQuestionCount} canonical, ${summary.evidenceOnlyQuestionCount} alternative questions.\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'Publication validation failed'}\n`,
      );
      process.exitCode = 1;
    });
}
