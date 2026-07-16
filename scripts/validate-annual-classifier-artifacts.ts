import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  annualClassifierReportSchema,
  assertIdOnlyPayload,
  type AnnualClassifierReport,
} from './lib/annual-classifier-contract.ts';
import { validateAnnualClassifierReportForPublication } from './lib/annual-topic-publication.ts';
import {
  BOOKLET_FIRST_YEAR,
  BOOKLET_MAX_YEAR,
  osymBookletRegistrySchema,
} from './lib/osym-booklet-registry.ts';
import {
  validateCanonicalTopicReview,
  type CanonicalTopicReview,
} from './lib/topic-review-contract.ts';

const FILE_NAME =
  /^((\d{4})-(?:tyt|ayt)-[a-z0-9]+(?:-[a-z0-9]+)*)\.(text\.review|vision\.review|report)\.json$/;

export function parseAnnualClassifierArtifactFileName(fileName: string): {
  group: string;
  kind: string;
  year: number;
} {
  const match = FILE_NAME.exec(fileName);
  if (!match) throw new Error(`Unsupported annual classifier artifact filename: ${fileName}`);
  const year = Number(match[2]);
  if (year < BOOKLET_FIRST_YEAR || year > BOOKLET_MAX_YEAR) {
    throw new Error(
      `Artifact year must be from ${BOOKLET_FIRST_YEAR} through ${BOOKLET_MAX_YEAR}: ${fileName}`,
    );
  }
  return { group: match[1]!, kind: match[3]!, year };
}

async function parseJson(filePath: string): Promise<unknown> {
  const stats = await lstat(filePath);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size <= 0 ||
    stats.size > 5 * 1024 * 1024
  ) {
    throw new Error(`Unsafe annual classifier artifact: ${path.basename(filePath)}`);
  }
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

export async function validateAnnualClassifierArtifacts(
  directory: string,
  workspace = process.cwd(),
): Promise<number> {
  const resolvedDirectory = path.resolve(workspace, directory);
  const allowedRoot = path.resolve(workspace, 'tmp/annual-topic-classifier');
  if (
    resolvedDirectory !== allowedRoot &&
    !resolvedDirectory.startsWith(`${allowedRoot}${path.sep}`)
  ) {
    throw new Error('Annual classifier artifacts must stay inside tmp/annual-topic-classifier');
  }
  const registry = osymBookletRegistrySchema.parse(
    await parseJson(path.resolve(workspace, 'content/osym-booklets.json')),
  );
  const catalog = await parseJson(path.resolve(workspace, 'content/topics.json'));
  const entries = await readdir(resolvedDirectory, { withFileTypes: true });
  if (!entries.length || entries.some((entry) => !entry.isFile())) {
    throw new Error('Artifact directory contains a missing or unsupported file');
  }

  type ArtifactGroup = {
    kinds: Set<string>;
    report?: AnnualClassifierReport;
    textReview?: CanonicalTopicReview;
    visionReview?: CanonicalTopicReview;
  };
  const groups = new Map<string, ArtifactGroup>();
  for (const entry of entries) {
    const { group, kind } = parseAnnualClassifierArtifactFileName(entry.name);
    const artifacts = groups.get(group) ?? { kinds: new Set<string>() };
    if (artifacts.kinds.has(kind)) {
      throw new Error(`Duplicate annual classifier artifact kind for ${group}`);
    }
    artifacts.kinds.add(kind);
    groups.set(group, artifacts);
    const payload = await parseJson(path.join(resolvedDirectory, entry.name));
    assertIdOnlyPayload(payload);
    if (kind === 'report') {
      const report = validateAnnualClassifierReportForPublication({
        report: payload,
        bookletRegistry: registry,
        topicCatalog: catalog,
      }).report;
      if (`${report.scope.year}-${report.scope.exam}-${report.scope.questionBlockId}` !== group) {
        throw new Error(`Report scope does not match artifact filename ${entry.name}`);
      }
      artifacts.report = report;
    } else {
      const expectedReviewer =
        kind === 'text.review' ? 'annual-text-qwen-v1' : 'annual-vision-gemma-v1';
      const review = validateCanonicalTopicReview({
        review: payload,
        bookletRegistry: registry,
        topicCatalog: catalog,
        expectedReviewer,
        reviewLabel: kind === 'text.review' ? 'Primary' : 'Secondary',
      }).review;
      const block = registry.questionBlockProfiles[review.exam].questionBlocks.find(
        (candidate) =>
          candidate.sectionId === review.sectionId &&
          candidate.bookletSectionId === review.bookletSectionId &&
          candidate.answerSetId === review.answerSetId &&
          candidate.officialQuestionRange.first === review.questionRange.first &&
          candidate.officialQuestionRange.last === review.questionRange.last,
      );
      if (!block || `${review.year}-${review.exam}-${block.id}` !== group) {
        throw new Error(`Review scope does not match artifact filename ${entry.name}`);
      }
      if (kind === 'text.review') artifacts.textReview = review;
      else artifacts.visionReview = review;
    }
  }
  for (const [group, artifacts] of groups) {
    const { kinds } = artifacts;
    if (
      kinds.size !== 3 ||
      !kinds.has('text.review') ||
      !kinds.has('vision.review') ||
      !kinds.has('report')
    ) {
      throw new Error(`Artifact group ${group} must contain exactly three ID-only files`);
    }
    if (!artifacts.report || !artifacts.textReview || !artifacts.visionReview) {
      throw new Error(`Artifact group ${group} did not parse into one complete artifact trio`);
    }
    const recordFromResult = (
      result: AnnualClassifierReport['questions'][number]['text'],
    ): CanonicalTopicReview['records'][number] =>
      result.status === 'classified'
        ? {
            officialQuestionNo: result.officialQuestionNo,
            primaryTopicRef: result.primaryTopicRef,
            relatedTopicRefs: result.relatedTopicRefs,
            status: 'classified',
            ...(result.page === undefined ? {} : { page: result.page }),
          }
        : {
            officialQuestionNo: result.officialQuestionNo,
            primaryTopicRef: null,
            relatedTopicRefs: [],
            status: 'needs-review',
            ...(result.page === undefined ? {} : { page: result.page }),
          };
    const textRecords = artifacts.report.questions.map(({ text }) => recordFromResult(text));
    const visionRecords = artifacts.report.questions.map(({ vision }) => recordFromResult(vision));
    if (JSON.stringify(textRecords) !== JSON.stringify(artifacts.textReview.records)) {
      throw new Error(`Artifact group ${group} text review does not match its classifier report`);
    }
    if (JSON.stringify(visionRecords) !== JSON.stringify(artifacts.visionReview.records)) {
      throw new Error(`Artifact group ${group} vision review does not match its classifier report`);
    }
    for (const review of [artifacts.textReview, artifacts.visionReview]) {
      if (
        review.bookletId !== artifacts.report.provenance.bookletId ||
        review.bookletSha256 !== artifacts.report.provenance.bookletSha256
      ) {
        throw new Error(`Artifact group ${group} review/report booklet provenance mismatch`);
      }
    }
  }
  return entries.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  if (!directory) {
    process.stderr.write('Usage: validate-annual-classifier-artifacts <directory>\n');
    process.exitCode = 1;
  } else {
    validateAnnualClassifierArtifacts(directory)
      .then((count) => process.stdout.write(`Validated ${count} ID-only artifact files.\n`))
      .catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : 'Validation failed'}\n`);
        process.exitCode = 1;
      });
  }
}
