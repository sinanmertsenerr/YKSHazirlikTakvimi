import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { annualClassifierReportSchema, stableSha256 } from './lib/annual-classifier-contract.ts';
import {
  annualTopicHumanReviewSchema,
  applyApprovedAnnualTopics,
  type AnnualTopicApplySummary,
  type AnnualTopicReplacementAuthorization,
  type ApprovedReviewWithReport,
} from './lib/annual-topic-publication.ts';

const MAX_INPUT_BYTES = 10 * 1024 * 1024;

export type ApplyAnnualTopicsOptions = {
  mode: 'dry-run' | 'write';
  reviewPaths: string[];
  reportPaths: string[];
  registryPath: string;
  topicsPath: string;
  currentDate?: string;
  replacementAuthorizations: AnnualTopicReplacementAuthorization[];
};

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseApplyAnnualTopicsArgs(args: string[]): ApplyAnnualTopicsOptions {
  let mode: 'dry-run' | 'write' | undefined;
  const reviewPaths: string[] = [];
  const reportPaths: string[] = [];
  let registryPath = 'content/osym-booklets.json';
  let topicsPath = 'content/topics.json';
  let currentDate: string | undefined;
  const replacementAuthorizations: AnnualTopicReplacementAuthorization[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (flag === '--dry-run' || flag === '--write') {
      const nextMode = flag.slice(2) as 'dry-run' | 'write';
      if (mode && mode !== nextMode) throw new Error('Choose exactly one of --dry-run or --write');
      mode = nextMode;
    } else if (flag === '--review') {
      reviewPaths.push(requireValue(args, index, flag));
      index += 1;
    } else if (flag === '--report') {
      reportPaths.push(requireValue(args, index, flag));
      index += 1;
    } else if (flag === '--registry') {
      registryPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === '--topics') {
      topicsPath = requireValue(args, index, flag);
      index += 1;
    } else if (flag === '--current-date') {
      currentDate = requireValue(args, index, flag);
      index += 1;
    } else if (flag === '--replace-existing') {
      const value = requireValue(args, index, flag);
      const match = /^(.+)=([0-9a-f]{64})$/.exec(value);
      if (!match) throw new Error('--replace-existing must use <target-key>=<expected-old-sha256>');
      replacementAuthorizations.push({
        targetKey: match[1]!,
        expectedExistingSha256: match[2]!,
      });
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!mode) throw new Error('Choose exactly one of --dry-run or --write');
  if (!reviewPaths.length || !reportPaths.length) {
    throw new Error('At least one --review and one --report are required');
  }
  if (new Set(reviewPaths).size !== reviewPaths.length) throw new Error('Duplicate --review path');
  if (new Set(reportPaths).size !== reportPaths.length) throw new Error('Duplicate --report path');
  return {
    mode,
    reviewPaths,
    reportPaths,
    registryPath,
    topicsPath,
    replacementAuthorizations,
    ...(currentDate === undefined ? {} : { currentDate }),
  };
}

async function readLimitedJson(filePath: string): Promise<unknown> {
  const metadata = await lstat(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size <= 0 ||
    metadata.size > MAX_INPUT_BYTES
  ) {
    throw new Error(`Unsafe or oversized JSON input: ${filePath}`);
  }
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

async function readLimitedJsonDocument(
  filePath: string,
): Promise<{ value: unknown; bytes: Buffer; sha256: string }> {
  const metadata = await lstat(filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size <= 0 ||
    metadata.size > MAX_INPUT_BYTES
  ) {
    throw new Error(`Unsafe or oversized JSON input: ${filePath}`);
  }
  const bytes = await readFile(filePath);
  return {
    value: JSON.parse(bytes.toString('utf8')) as unknown,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function writeJsonAtomically(
  filePath: string,
  value: unknown,
  original: { bytes: Buffer; sha256: string },
): Promise<boolean> {
  const serialized = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (serialized.equals(original.bytes)) return false;
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, serialized, { mode: 0o644 });
  try {
    const current = await readFile(filePath);
    const currentSha256 = createHash('sha256').update(current).digest('hex');
    if (currentSha256 !== original.sha256) {
      throw new Error('topics.json changed after validation; refusing a stale replacement');
    }
    await rename(temporary, filePath);
    return true;
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function assertDurableApprovalPath(filePath: string, workspace: string, label: string): void {
  const root = path.resolve(workspace, 'content/topic-approvals');
  const resolved = path.resolve(workspace, filePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} must be stored under content/topic-approvals before --write`);
  }
}

export async function runApplyAnnualTopicsCli(
  args = process.argv.slice(2),
  workspace = process.cwd(),
): Promise<AnnualTopicApplySummary> {
  const options = parseApplyAnnualTopicsArgs(args);
  if (options.mode === 'write') {
    options.reviewPaths.forEach((filePath) =>
      assertDurableApprovalPath(filePath, workspace, 'Review'),
    );
    options.reportPaths.forEach((filePath) =>
      assertDurableApprovalPath(filePath, workspace, 'Report'),
    );
  }
  const topicsDocumentPath = path.resolve(workspace, options.topicsPath);
  const [registry, catalogDocument, reviewInputs, reportInputs] = await Promise.all([
    readLimitedJson(path.resolve(workspace, options.registryPath)),
    readLimitedJsonDocument(topicsDocumentPath),
    Promise.all(
      options.reviewPaths.map((filePath) => readLimitedJson(path.resolve(workspace, filePath))),
    ),
    Promise.all(
      options.reportPaths.map((filePath) => readLimitedJson(path.resolve(workspace, filePath))),
    ),
  ]);
  const catalog = catalogDocument.value;
  const reportsByHash = new Map<string, unknown>();
  for (const input of reportInputs) {
    const report = annualClassifierReportSchema.parse(input);
    const hash = stableSha256(report);
    if (reportsByHash.has(hash)) throw new Error(`Duplicate classifier report SHA-256 ${hash}`);
    reportsByHash.set(hash, report);
  }
  const approvals: ApprovedReviewWithReport[] = reviewInputs.map((input) => {
    const review = annualTopicHumanReviewSchema.parse(input);
    const report = reportsByHash.get(review.provenance.classifierReportSha256);
    if (!report) throw new Error('No supplied classifier report matches a human review SHA-256');
    return { review, report };
  });
  if (reportsByHash.size !== approvals.length) {
    throw new Error('Every supplied classifier report must match exactly one human review');
  }
  const result = applyApprovedAnnualTopics({
    approvals,
    bookletRegistry: registry,
    topicCatalog: catalog,
    replacementAuthorizations: options.replacementAuthorizations,
    ...(options.currentDate === undefined ? {} : { currentDate: options.currentDate }),
  });
  if (options.mode === 'write') {
    await writeJsonAtomically(topicsDocumentPath, result.catalog, catalogDocument);
  }
  return result.summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runApplyAnnualTopicsCli()
    .then((summary) => {
      process.stdout.write(
        `${summary.canonicalQuestionCount} canonical questions, ${summary.relatedQuestionCount} non-counting related mappings, ${summary.sectionsUpdated} complete sections ${process.argv.includes('--write') ? 'applied' : 'validated (dry run only)'}.\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'Annual topic apply failed'}\n`,
      );
      process.exitCode = 1;
    });
}
