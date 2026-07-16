import { DatabaseSync } from 'node:sqlite';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

import {
  calendarSchema,
  coefficientsSchema,
  CURRENT_SCHEMA_VERSION,
  manifestSourceSchema,
  newsSchema,
  normalizeOfficialLabel,
  programsFixtureSchema,
  rankTablesSchema,
  topicGroupMappingsSchema,
  topicGroupStatisticsSchema,
  topicCoverageYears,
  topicsSchema,
  type TopicGroupMappings,
  type CoefficientsDocument,
  type ManifestSource,
  type ProgramsFixture,
  type RankTablesDocument,
  type TopicsDocument,
} from './lib/content-schemas.ts';
import { isRelevantNewsTitle } from './lib/news-relevance.ts';
import {
  osymBookletRegistrySchema,
  type OsymBookletRegistry,
} from './lib/osym-booklet-registry.ts';
import {
  includedOgmTopicSources,
  ogmTopicSourceRegistrySchema,
  type OgmTopicSourceRegistry,
} from './lib/ogm-topic-registry.ts';

export type ValidationReport = {
  errors: string[];
  warnings: string[];
  summary: {
    topics: number;
    placeholderSectionYears: number;
    programs: number;
    programYears: number;
    topicGroups: number;
    mappedSubjects: number;
  };
};

export type ValidatePackOptions = {
  contentDir?: string;
  programsDbPath?: string;
  skipProgramsDatabase?: boolean;
};

type MutableReport = ValidationReport;

function emptyReport(): MutableReport {
  return {
    errors: [],
    warnings: [],
    summary: {
      topics: 0,
      placeholderSectionYears: 0,
      programs: 0,
      programYears: 0,
      topicGroups: 0,
      mappedSubjects: 0,
    },
  };
}

function formatPath(path: PropertyKey[]): string {
  return path.length ? path.map(String).join('.') : '<root>';
}

function appendZodErrors(label: string, error: z.ZodError, report: MutableReport): void {
  for (const issue of error.issues) {
    report.errors.push(`${label}.${formatPath(issue.path)}: ${issue.message}`);
  }
}

async function readJson(
  path: string,
  label: string,
  report: MutableReport,
): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    report.errors.push(
      `${label}: could not read valid JSON at ${path} (${error instanceof Error ? error.message : String(error)})`,
    );
    return undefined;
  }
}

async function parseJson<T>(
  path: string,
  label: string,
  schema: z.ZodType<T>,
  report: MutableReport,
): Promise<T | undefined> {
  const raw = await readJson(path, label, report);
  if (raw === undefined) return undefined;
  const result = schema.safeParse(raw);
  if (!result.success) {
    appendZodErrors(label, result.error, report);
    return undefined;
  }
  return result.data;
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function checkTopics(
  topics: TopicsDocument,
  report: MutableReport,
  bookletRegistry?: OsymBookletRegistry,
): void {
  const examIds = topics.exams.map((exam) => exam.id);
  if (
    new Set(examIds).size !== examIds.length ||
    !examIds.includes('tyt') ||
    !examIds.includes('ayt')
  ) {
    report.errors.push(
      'topics.exams: exactly one TYT and one AYT exam are required; other exams at most once each',
    );
  }

  const sectionIds: string[] = [];
  const subjectIds: string[] = [];
  const topicIds: string[] = [];
  const allTopics = topics.exams.flatMap((exam) =>
    exam.sections.flatMap((section) => section.subjects.flatMap((subject) => subject.topics)),
  );
  const lastYear = allTopics[0]?.yearlyStats.at(-1)?.year;
  const coverageYears = lastYear === undefined ? [] : topicCoverageYears(lastYear);

  for (const exam of topics.exams) {
    const examSectionTotal = exam.sections.reduce(
      (total, section) => total + section.questionCount,
      0,
    );
    if (examSectionTotal !== exam.totalQuestions) {
      report.errors.push(
        `topics.${exam.id}: section questionCount total ${examSectionTotal} does not equal totalQuestions ${exam.totalQuestions}`,
      );
    }

    for (const section of exam.sections) {
      sectionIds.push(section.id);
      const subjectQuestionTotal = section.subjects.reduce(
        (total, subject) => total + subject.questionCount,
        0,
      );
      if (subjectQuestionTotal !== section.questionCount) {
        report.errors.push(
          `topics.${section.id}: subject questionCount total ${subjectQuestionTotal} does not equal section questionCount ${section.questionCount}`,
        );
      }

      const sectionTopics = section.subjects.flatMap((subject) => subject.topics);
      for (const subject of section.subjects) {
        subjectIds.push(subject.id);
        if (
          subject.altSubjectId &&
          !section.subjects.some((candidate) => candidate.id === subject.altSubjectId)
        ) {
          report.errors.push(
            `topics.${subject.id}.altSubjectId: ${subject.altSubjectId} is not in the same section`,
          );
        }

        for (const topic of subject.topics) {
          topicIds.push(topic.id);
          report.summary.topics += 1;

          const statYears = topic.yearlyStats.map((stat) => stat.year);
          if (
            statYears.length !== coverageYears.length ||
            statYears.some((year, index) => year !== coverageYears[index])
          ) {
            report.errors.push(
              `topics.${topic.id}.yearlyStats: must contain the common contiguous coverage ${coverageYears[0] ?? '<missing>'} through ${coverageYears.at(-1) ?? '<missing>'} exactly once and in order`,
            );
          }

          const questionsByYear = new Map<number, number>();
          if (bookletRegistry) {
            for (const stat of topic.yearlyStats) {
              if (stat.count === null) continue;
              const booklet = bookletRegistry.booklets.find(
                (candidate) => candidate.year === stat.year && candidate.session === exam.id,
              );
              if (
                !booklet ||
                booklet.pdfUrl !== stat.source ||
                booklet.sha256 !== stat.bookletSha256
              ) {
                report.errors.push(
                  `topics.${topic.id}.yearlyStats: ${stat.year}-${exam.id} URL/hash provenance must exactly match the official booklet registry`,
                );
              }
            }
            for (const question of topic.questions) {
              const booklet = bookletRegistry.booklets.find(
                (candidate) =>
                  candidate.year === question.year && candidate.session === question.sourceExam,
              );
              if (
                !booklet ||
                booklet.pdfUrl !== question.sourceUrl ||
                booklet.sha256 !== question.bookletSha256 ||
                question.verifiedAt.slice(0, 10) < booklet.examDate
              ) {
                report.errors.push(
                  `topics.${topic.id}.questions: ${question.year}-${question.sourceExam} URL/hash/date provenance must exactly match the official booklet registry`,
                );
              }
              const block = bookletRegistry.questionBlockProfiles[
                question.sourceExam
              ].questionBlocks.find((candidate) => candidate.id === question.questionBlockId);
              if (
                !block ||
                block.sectionId !== question.sourceSectionId ||
                !block.subjectIds.includes(question.sourceSubjectId) ||
                question.officialQuestionNo < block.officialQuestionRange.first ||
                question.officialQuestionNo > block.officialQuestionRange.last
              ) {
                report.errors.push(
                  `topics.${topic.id}.questions: official question identity must exactly match the registered question block`,
                );
              }
            }
          }
          for (const question of topic.questions.filter(
            (candidate) => candidate.countsTowardStats,
          )) {
            questionsByYear.set(question.year, (questionsByYear.get(question.year) ?? 0) + 1);
          }
          for (const [year] of questionsByYear) {
            const stat = topic.yearlyStats.find((candidate) => candidate.year === year);
            if (!stat) {
              report.errors.push(
                `topics.${topic.id}.questions: ${year} has questions but no yearlyStats row`,
              );
            } else if (stat.count === null) {
              report.errors.push(
                `topics.${topic.id}.questions: ${year} has primary question records but count is null`,
              );
            }
          }
          for (const stat of topic.yearlyStats) {
            if (stat.count === null) continue;
            const questionCount = questionsByYear.get(stat.year) ?? 0;
            if (questionCount !== stat.count) {
              report.errors.push(
                `topics.${topic.id}.questions: ${stat.year} has ${questionCount} primary question records but count is ${stat.count}`,
              );
            }
          }
        }
      }

      for (const year of coverageYears) {
        const stats = sectionTopics
          .map((topic) => topic.yearlyStats.find((stat) => stat.year === year))
          .filter((stat): stat is NonNullable<typeof stat> => Boolean(stat));
        if (stats.length !== sectionTopics.length) continue;

        const isWholeSectionPlaceholder = stats.every(
          (stat) =>
            stat.count === null &&
            stat.verified === false &&
            stat.source === null &&
            stat.verificationMethod === null &&
            stat.verifiedAt === null,
        );
        if (isWholeSectionPlaceholder) {
          report.summary.placeholderSectionYears += 1;
          continue;
        }

        if (stats.some((stat) => stat.count === null)) {
          report.errors.push(
            `topics.${section.id}.${year}: a section/year must be wholly null or wholly verified numeric`,
          );
          continue;
        }

        const countTotal = stats.reduce((total, stat) => total + (stat.count ?? 0), 0);
        if (countTotal !== section.questionCount) {
          report.errors.push(
            `topics.${section.id}.${year}: verified topic count total ${countTotal} does not equal section questionCount ${section.questionCount}; unknown years must use null for every row`,
          );
        }
      }
    }
  }

  for (const duplicate of duplicateValues(sectionIds)) {
    report.errors.push(`topics.sections: duplicate section id ${duplicate}`);
  }
  for (const duplicate of duplicateValues(subjectIds)) {
    report.errors.push(`topics.subjects: duplicate subject id ${duplicate}`);
  }
  for (const duplicate of duplicateValues(topicIds)) {
    report.errors.push(`topics.topics: duplicate topic id ${duplicate}`);
  }
}

function checkCoefficients(coefficients: CoefficientsDocument, report: MutableReport): void {
  for (const [scoreType, weights] of Object.entries(coefficients.officialRules.weightsPercent)) {
    const components = Object.values(weights);
    if (components.some((component) => component <= 0)) {
      report.errors.push(`coefficients.${scoreType}: every weight component must be positive`);
    }
    const total = components.reduce((sum, component) => sum + component, 0);
    if (total !== 100) {
      report.errors.push(`coefficients.${scoreType}: weights sum to ${total}, expected 100`);
    }
  }
}

function checkRankTables(rankTables: RankTablesDocument, report: MutableReport): void {
  if (rankTables.availability !== 'unavailable' || rankTables.tables.length !== 0) {
    report.errors.push('rankTables: 2026 rank estimation must remain unavailable with no points');
  }
}

// §9.1 semantic coverage gates — a silent upstream shrink (an entire category or level
// vanishing from a YÖK Atlas re-import) must fail the publish rather than ship. ERROR
// floors sit ~25-30% below the 2025 snapshot counts (say 5.6k, ea 3.9k, soz 1.9k,
// tyt 9.2k, dil 664) so ordinary yearly drift passes while a structural regression
// cannot. WARN thresholds surface softer coverage erosion without blocking the pipeline.
const PROGRAM_COUNT_ERROR_FLOORS = {
  say: 4000,
  ea: 3000,
  soz: 1400,
  tyt: 7000,
  dil: 400,
  // TODO(yetenek): raise above zero once the first real TABLO 5 import lands (the level
  // is empty until YÖK Atlas loads each year's kılavuz — cold-start floor by design).
  yetenek: 0,
} as const satisfies Record<ProgramsFixture['programs'][number]['scoreType'], number>;
const TOTAL_PROGRAM_ERROR_FLOOR = 15_000;
const SPORTS_FAMILY_WARN_FLOOR = 100;
// Matched against toLocaleLowerCase('tr-TR') output; no /i flag on purpose (Turkish İ/ı
// case folding makes ASCII-insensitive matching unreliable for these names).
const SPORTS_FAMILY_PATTERN = /beden eğitimi|spor|antrenör|rekreasyon|egzersiz/;
const CURRENT_YEAR_RANK_FILL_WARN_RATIO = 0.7;

function checkProgramsFixture(programs: ProgramsFixture, report: MutableReport): void {
  for (const duplicate of duplicateValues(programs.programs.map((program) => program.id))) {
    report.errors.push(`programsFixture.programs: duplicate program id ${duplicate}`);
  }
  for (const program of programs.programs) {
    if (program.verified && program.source) {
      const source = new URL(program.source);
      if (source.protocol !== 'https:' || !source.hostname.endsWith('yok.gov.tr')) {
        report.errors.push(
          `programsFixture.${program.id}.source: verified programs require an HTTPS YÖK source`,
        );
      }
    }
    const yearKeys = program.years.map((year) => String(year.year));
    for (const duplicate of duplicateValues(yearKeys)) {
      report.errors.push(`programsFixture.${program.id}: duplicate year ${duplicate}`);
    }
    for (const year of program.years) {
      if (year.verified && year.source) {
        const source = new URL(year.source);
        if (source.protocol !== 'https:' || !source.hostname.endsWith('yok.gov.tr')) {
          report.errors.push(
            `programsFixture.${program.id}.${year.year}.source: verified years require an HTTPS YÖK source`,
          );
        }
      }
      if (year.quota !== null && year.placed !== null && year.placed > year.quota) {
        report.errors.push(
          `programsFixture.${program.id}.${year.year}: placed ${year.placed} cannot exceed quota ${year.quota}`,
        );
      }
      // Talent-exam admission has no central cutoff; a populated one signals the source
      // started returning unexpected data for TABLO 5 rows (warn, human review decides).
      if (program.scoreType === 'yetenek' && (year.minScore !== null || year.minRank !== null)) {
        report.warnings.push(
          `programsFixture.${program.id}.${year.year}: talent-exam programs should not carry central cutoffs`,
        );
      }
    }
  }

  const countsByScoreType = new Map<string, number>();
  let sportsFamilyCount = 0;
  let latestYear = 0;
  for (const program of programs.programs) {
    countsByScoreType.set(program.scoreType, (countsByScoreType.get(program.scoreType) ?? 0) + 1);
    if (SPORTS_FAMILY_PATTERN.test(program.name.tr.toLocaleLowerCase('tr-TR'))) {
      sportsFamilyCount += 1;
    }
    for (const year of program.years) {
      if (year.year > latestYear) latestYear = year.year;
    }
  }

  if (programs.programs.length < TOTAL_PROGRAM_ERROR_FLOOR) {
    report.errors.push(
      `programsFixture: ${programs.programs.length} programs is below the ${TOTAL_PROGRAM_ERROR_FLOOR} coverage floor`,
    );
  }
  for (const [scoreType, floor] of Object.entries(PROGRAM_COUNT_ERROR_FLOORS)) {
    const count = countsByScoreType.get(scoreType) ?? 0;
    if (count < floor) {
      report.errors.push(
        `programsFixture: ${scoreType} has ${count} programs, below the ${floor} coverage floor`,
      );
    }
  }
  if (sportsFamilyCount < SPORTS_FAMILY_WARN_FLOOR) {
    report.warnings.push(
      `programsFixture: only ${sportsFamilyCount} sports-family programs (floor ${SPORTS_FAMILY_WARN_FLOOR}) — check whether a YÖK Atlas re-import dropped a category`,
    );
  }

  // Current-year cutoff fill among centrally-placed programs (talent rows are all-null
  // by design and would dilute the signal). 2025 baseline: ~84% filled.
  let currentYearPrograms = 0;
  let currentYearRanked = 0;
  for (const program of programs.programs) {
    if (program.scoreType === 'yetenek') continue;
    const row = program.years.find((year) => year.year === latestYear);
    if (!row) continue;
    currentYearPrograms += 1;
    if (row.minRank !== null) currentYearRanked += 1;
  }
  if (
    currentYearPrograms > 0 &&
    currentYearRanked / currentYearPrograms < CURRENT_YEAR_RANK_FILL_WARN_RATIO
  ) {
    report.warnings.push(
      `programsFixture: only ${currentYearRanked}/${currentYearPrograms} centrally-placed programs carry a ${latestYear} min_rank (< ${Math.round(CURRENT_YEAR_RANK_FILL_WARN_RATIO * 100)}%) — source may be mid-publication`,
    );
  }
}

function isAllowedOfficialHost(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase('en-US');
  return (
    host === 'osym.gov.tr' ||
    host.endsWith('.osym.gov.tr') ||
    host === 'yok.gov.tr' ||
    host.endsWith('.yok.gov.tr')
  );
}

function checkNews(news: z.infer<typeof newsSchema>, report: MutableReport): void {
  for (const duplicate of duplicateValues(news.items.map((item) => item.id))) {
    report.errors.push(`news.items: duplicate id ${duplicate}`);
  }
  for (const item of news.items) {
    if (!isRelevantNewsTitle(item.title.tr)) {
      report.errors.push(`news.${item.id}.title: generic or non-YKS announcement is forbidden`);
    }
    const url = new URL(item.url);
    if (url.protocol !== 'https:' || !isAllowedOfficialHost(url.hostname)) {
      report.errors.push(`news.${item.id}.url: only HTTPS ÖSYM/YÖK hosts are allowed`);
    }
    if (item.source === 'ÖSYM' && !url.hostname.endsWith('osym.gov.tr')) {
      report.errors.push(`news.${item.id}.source: ÖSYM label does not match URL host`);
    }
    if (item.source === 'YÖK' && !url.hostname.endsWith('yok.gov.tr')) {
      report.errors.push(`news.${item.id}.source: YÖK label does not match URL host`);
    }
  }
}

function checkManifest(manifest: ManifestSource, contentDir: string, report: MutableReport): void {
  const paths = Object.values(manifest.files).map((file) => file.path);
  for (const duplicate of duplicateValues(paths)) {
    report.errors.push(`manifest.files: duplicate output path ${duplicate}`);
  }
  for (const file of Object.values(manifest.files)) {
    const resolved = resolve(contentDir, file.path);
    if (!resolved.startsWith(`${resolve(contentDir)}/`)) {
      report.errors.push(`manifest.files: unsafe path ${file.path}`);
    }
  }
}

function checkTopicGroupStatistics(
  statistics: z.infer<typeof topicGroupStatisticsSchema>,
  report: MutableReport,
  topics?: TopicsDocument,
  registry?: OgmTopicSourceRegistry,
): void {
  if (statistics.availability === 'pending') return;
  report.summary.topicGroups = statistics.groups.length;

  const subjectExams = new Map<string, { exam: string }>();
  for (const exam of topics?.exams ?? []) {
    for (const section of exam.sections) {
      for (const subject of section.subjects) {
        subjectExams.set(subject.id, { exam: exam.id });
      }
    }
  }
  for (const group of statistics.groups) {
    const subject = subjectExams.get(group.displaySubjectId);
    if (topics && (!subject || subject.exam !== group.exam)) {
      report.errors.push(
        `topicGroupStatistics.${group.id}.displaySubjectId: unknown or mismatched subject ${group.displaySubjectId}`,
      );
    }
  }

  if (topics) {
    for (const [subjectId] of subjectExams) {
      const groups = statistics.groups.filter(
        (group) =>
          group.displaySubjectId === subjectId && group.countingPolicy !== 'cross-check-only',
      );
      if (!groups.length) continue;
      const orders = groups.map((group) => group.displayOrder);
      for (const duplicate of duplicateValues(orders.map(String))) {
        report.errors.push(
          `topicGroupStatistics.${subjectId}: duplicate displayOrder ${duplicate}`,
        );
      }
    }
  }

  if (registry) {
    if (
      statistics.coverage.firstYear !== registry.coverage.firstYear ||
      statistics.coverage.lastYear !== registry.coverage.lastYear ||
      statistics.landingPageUrl !== registry.landingPageUrl
    ) {
      report.errors.push(
        'topicGroupStatistics: coverage and landing page must match the pinned MEB OGM registry',
      );
    }
    const registeredSources = new Map(
      includedOgmTopicSources(registry).map((source) => [source.key, source] as const),
    );
    for (const source of statistics.sources) {
      const registered = registeredSources.get(source.key);
      if (
        !registered ||
        source.sourceId !== registered.sourceId ||
        source.apiBookId !== registered.api.bookObjectId ||
        source.titleTr !== registered.titleTr ||
        source.resolverUrl !== registered.resolverUrl ||
        source.bytes !== registered.expected.bytes ||
        source.sha256 !== registered.expected.sha256
      ) {
        report.errors.push(
          `topicGroupStatistics.sources.${source.key}: source metadata must exactly match the pinned MEB OGM registry`,
        );
      }
    }
  }
}

function checkTopicGroupMappings(
  mappings: TopicGroupMappings,
  report: MutableReport,
  statistics?: z.infer<typeof topicGroupStatisticsSchema>,
  topics?: TopicsDocument,
): void {
  if (!mappings.subjects.length) return;
  if (!statistics || statistics.availability !== 'available') {
    report.errors.push(
      'topicGroupMappings: mappings cannot exist before official topic-group statistics are available',
    );
    return;
  }

  const groupsById = new Map(statistics.groups.map((group) => [group.id, group] as const));
  const topicsBySubject = new Map<string, { exam: string; names: Map<string, string> }>();
  for (const exam of topics?.exams ?? []) {
    for (const section of exam.sections) {
      for (const subject of section.subjects) {
        topicsBySubject.set(subject.id, {
          exam: exam.id,
          names: new Map(subject.topics.map((topic) => [topic.id, topic.name.tr] as const)),
        });
      }
    }
  }

  for (const subject of mappings.subjects) {
    const label = `topicGroupMappings.${subject.displaySubjectId}`;
    if (topics && !topicsBySubject.has(subject.displaySubjectId)) {
      report.errors.push(`${label}: unknown study subject`);
      continue;
    }
    const attributableGroupIds = new Set(
      statistics.groups
        .filter(
          (group) =>
            group.displaySubjectId === subject.displaySubjectId &&
            group.countingPolicy !== 'cross-check-only',
        )
        .map((group) => group.id),
    );
    const mappedGroupIds = new Set<string>();
    for (const entry of subject.entries) {
      const group = groupsById.get(entry.groupId);
      mappedGroupIds.add(entry.groupId);
      if (!group || !attributableGroupIds.has(entry.groupId)) {
        report.errors.push(
          `${label}.${entry.groupId}: not an attributable official group of this subject`,
        );
        continue;
      }
      const targetSubjectId = entry.topicsSubjectId ?? subject.displaySubjectId;
      const target = topicsBySubject.get(targetSubjectId);
      if (topics && !target) {
        report.errors.push(`${label}.${entry.groupId}: unknown target subject ${targetSubjectId}`);
        continue;
      }
      if (target && target.exam !== group.exam) {
        report.errors.push(
          `${label}.${entry.groupId}: target subject ${targetSubjectId} belongs to another exam`,
        );
      }
      if (target) {
        for (const topicId of entry.topicIds) {
          if (!target.names.has(topicId)) {
            report.errors.push(`${label}.${entry.groupId}: unknown study topic ${topicId}`);
          }
        }
      }
      if (entry.status === 'auto-exact' && target) {
        const topicName = target.names.get(entry.topicIds[0] ?? '');
        if (
          topicName === undefined ||
          normalizeOfficialLabel(topicName) !== normalizeOfficialLabel(group.sourceLabelTr)
        ) {
          report.errors.push(
            `${label}.${entry.groupId}: auto-exact requires normalized label equality with the official label`,
          );
        }
      }
    }
    for (const groupId of attributableGroupIds) {
      if (!mappedGroupIds.has(groupId)) {
        report.errors.push(
          `${label}: incomplete coverage — official group ${groupId} is not mapped; ` +
            'a subject may only be published once every official group is attributed',
        );
      }
    }
    report.summary.mappedSubjects += 1;
  }
}

export function validateTopicGroupMappingsData(
  data: unknown,
  statistics?: unknown,
  topics?: unknown,
): ValidationReport {
  const report = emptyReport();
  const parsed = topicGroupMappingsSchema.safeParse(data);
  if (!parsed.success) appendZodErrors('topicGroupMappings', parsed.error, report);
  else {
    const parsedStatistics =
      statistics === undefined ? undefined : topicGroupStatisticsSchema.safeParse(statistics);
    const parsedTopics = topics === undefined ? undefined : topicsSchema.safeParse(topics);
    if (parsedStatistics && !parsedStatistics.success) {
      appendZodErrors('topicGroupStatistics', parsedStatistics.error, report);
    }
    if (parsedTopics && !parsedTopics.success) appendZodErrors('topics', parsedTopics.error, report);
    checkTopicGroupMappings(
      parsed.data,
      report,
      parsedStatistics?.success ? parsedStatistics.data : undefined,
      parsedTopics?.success ? parsedTopics.data : undefined,
    );
  }
  return report;
}

type SqliteRow = Record<string, string | number | bigint | null>;

function tableColumns(database: DatabaseSync, table: string): Set<string> {
  return new Set(
    (database.prepare(`PRAGMA table_info(${table})`).all() as SqliteRow[]).map((row) =>
      String(row.name),
    ),
  );
}

function validateProgramsDatabase(path: string, report: MutableReport): void {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    const integrity = database.prepare('PRAGMA integrity_check').get() as SqliteRow | undefined;
    if (!integrity || String(integrity.integrity_check) !== 'ok') {
      report.errors.push(
        `programs.db: SQLite integrity_check failed (${String(integrity?.integrity_check)})`,
      );
    }

    const requiredProgramColumns = [
      'id',
      'university',
      'university_en',
      'name',
      'name_en',
      'city',
      'city_en',
      'type',
      'score_type',
      'scholarship',
      'language',
      'language_en',
      'verified',
      'source',
      'verified_at',
      'approximate',
      'sample',
    ];
    const requiredYearColumns = [
      'program_id',
      'year',
      'quota',
      'placed',
      'min_score',
      'min_rank',
      'verified',
      'source',
      'verified_at',
      'approximate',
      'sample',
    ];
    const programColumns = tableColumns(database, 'program');
    const programYearColumns = tableColumns(database, 'program_year');
    for (const column of requiredProgramColumns) {
      if (!programColumns.has(column))
        report.errors.push(`programs.db.program: missing column ${column}`);
    }
    for (const column of requiredYearColumns) {
      if (!programYearColumns.has(column))
        report.errors.push(`programs.db.program_year: missing column ${column}`);
    }
    if (
      requiredProgramColumns.some((column) => !programColumns.has(column)) ||
      requiredYearColumns.some((column) => !programYearColumns.has(column))
    ) {
      return;
    }

    const schemaVersion = database
      .prepare("SELECT value FROM pack_metadata WHERE key = 'schemaVersion'")
      .get() as SqliteRow | undefined;
    if (Number(schemaVersion?.value) !== CURRENT_SCHEMA_VERSION) {
      report.errors.push(
        `programs.db.pack_metadata: unsupported schemaVersion ${String(schemaVersion?.value)}`,
      );
    }

    const invalidPrograms = database
      .prepare(
        `
      SELECT id FROM program
      WHERE length(trim(id)) = 0 OR length(trim(university)) = 0 OR length(trim(name)) = 0
         OR length(trim(city)) = 0 OR verified NOT IN (0, 1)
         OR (verified = 1 AND (source IS NULL OR length(trim(source)) = 0 OR verified_at IS NULL
             OR datetime(verified_at) IS NULL))
         OR (verified = 1 AND source NOT LIKE 'https://%.yok.gov.tr/%')
         OR (verified = 0 AND verified_at IS NOT NULL)
         OR approximate NOT IN (0, 1) OR sample NOT IN (0, 1)
      LIMIT 10
    `,
      )
      .all() as SqliteRow[];
    for (const row of invalidPrograms) {
      report.errors.push(
        `programs.db.program.${String(row.id)}: invalid text, flags, or verified/source pairing`,
      );
    }

    const invalidYears = database
      .prepare(
        `
      SELECT program_id, year FROM program_year
      WHERE year < 2018
         OR (quota IS NOT NULL AND quota < 0)
         OR (placed IS NOT NULL AND placed < 0)
         OR (quota IS NOT NULL AND placed IS NOT NULL AND placed > quota)
         OR (min_score IS NOT NULL AND min_score <= 0)
         OR (min_rank IS NOT NULL AND min_rank <= 0)
         OR verified NOT IN (0, 1)
         OR (verified = 1 AND (source IS NULL OR length(trim(source)) = 0 OR verified_at IS NULL
             OR datetime(verified_at) IS NULL))
         OR (verified = 1 AND source NOT LIKE 'https://%.yok.gov.tr/%')
         OR (verified = 0 AND verified_at IS NOT NULL)
         OR approximate NOT IN (0, 1) OR sample NOT IN (0, 1)
      LIMIT 10
    `,
      )
      .all() as SqliteRow[];
    for (const row of invalidYears) {
      report.errors.push(
        `programs.db.program_year.${String(row.program_id)}.${String(row.year)}: values must be null/nonnegative, scores and ranks null/positive, and verified rows sourced`,
      );
    }

    const foreignKeyErrors = database.prepare('PRAGMA foreign_key_check').all() as SqliteRow[];
    if (foreignKeyErrors.length)
      report.errors.push(`programs.db: ${foreignKeyErrors.length} foreign-key violation(s)`);

    const counts = database
      .prepare(
        `
      SELECT
        (SELECT count(*) FROM program) AS programs,
        (SELECT count(*) FROM program_year) AS program_years
    `,
      )
      .get() as SqliteRow | undefined;
    report.summary.programs = Number(counts?.programs ?? 0);
    report.summary.programYears = Number(counts?.program_years ?? 0);
    if (report.summary.programs <= 0)
      report.errors.push('programs.db: must contain at least one program');
    if (report.summary.programYears <= 0)
      report.errors.push('programs.db: must contain at least one program_year');
  } catch (error) {
    report.errors.push(
      `programs.db: could not validate ${path} (${error instanceof Error ? error.message : String(error)})`,
    );
  } finally {
    database?.close();
  }
}

export function validateTopicsData(data: unknown, bookletRegistry?: unknown): ValidationReport {
  const report = emptyReport();
  const parsed = topicsSchema.safeParse(data);
  if (!parsed.success) appendZodErrors('topics', parsed.error, report);
  else if (bookletRegistry === undefined) checkTopics(parsed.data, report);
  else {
    const registry = osymBookletRegistrySchema.safeParse(bookletRegistry);
    if (!registry.success) appendZodErrors('osymBooklets', registry.error, report);
    else checkTopics(parsed.data, report, registry.data);
  }
  return report;
}

export function validateRankTablesData(data: unknown): ValidationReport {
  const report = emptyReport();
  const parsed = rankTablesSchema.safeParse(data);
  if (!parsed.success) appendZodErrors('rankTables', parsed.error, report);
  else checkRankTables(parsed.data, report);
  return report;
}

export function validateCoefficientsData(data: unknown): ValidationReport {
  const report = emptyReport();
  const parsed = coefficientsSchema.safeParse(data);
  if (!parsed.success) appendZodErrors('coefficients', parsed.error, report);
  else checkCoefficients(parsed.data, report);
  return report;
}

export function validateProgramsFixtureData(data: unknown): ValidationReport {
  const report = emptyReport();
  const parsed = programsFixtureSchema.safeParse(data);
  if (!parsed.success) appendZodErrors('programsFixture', parsed.error, report);
  else checkProgramsFixture(parsed.data, report);
  return report;
}

export function validateNewsData(data: unknown): ValidationReport {
  const report = emptyReport();
  const parsed = newsSchema.safeParse(data);
  if (!parsed.success) appendZodErrors('news', parsed.error, report);
  else checkNews(parsed.data, report);
  return report;
}

export function validateTopicGroupStatisticsData(
  data: unknown,
  topics?: unknown,
  registry?: unknown,
): ValidationReport {
  const report = emptyReport();
  const parsed = topicGroupStatisticsSchema.safeParse(data);
  if (!parsed.success) appendZodErrors('topicGroupStatistics', parsed.error, report);
  else {
    const parsedTopics = topics === undefined ? undefined : topicsSchema.safeParse(topics);
    const parsedRegistry =
      registry === undefined ? undefined : ogmTopicSourceRegistrySchema.safeParse(registry);
    if (parsedTopics && !parsedTopics.success)
      appendZodErrors('topics', parsedTopics.error, report);
    if (parsedRegistry && !parsedRegistry.success) {
      appendZodErrors('ogmTopicSources', parsedRegistry.error, report);
    }
    checkTopicGroupStatistics(
      parsed.data,
      report,
      parsedTopics?.success ? parsedTopics.data : undefined,
      parsedRegistry?.success ? parsedRegistry.data : undefined,
    );
  }
  return report;
}

export async function validateSourcePack(
  options: ValidatePackOptions = {},
): Promise<ValidationReport> {
  const report = emptyReport();
  const contentDir = resolve(options.contentDir ?? resolve(process.cwd(), 'content'));

  const manifest = await parseJson(
    resolve(contentDir, 'manifest.source.json'),
    'manifest',
    manifestSourceSchema,
    report,
  );
  if (manifest) checkManifest(manifest, contentDir, report);

  const topics = await parseJson(
    resolve(contentDir, 'topics.json'),
    'topics',
    topicsSchema,
    report,
  );
  const bookletRegistry = await parseJson(
    resolve(contentDir, 'osym-booklets.json'),
    'osymBooklets',
    osymBookletRegistrySchema,
    report,
  );
  if (topics) checkTopics(topics, report, bookletRegistry);

  const ogmTopicSources = await parseJson(
    resolve(contentDir, 'ogm-yks-topic-sources.json'),
    'ogmTopicSources',
    ogmTopicSourceRegistrySchema,
    report,
  );
  const topicGroupStatistics = await parseJson(
    resolve(contentDir, 'topic-group-statistics.json'),
    'topicGroupStatistics',
    topicGroupStatisticsSchema,
    report,
  );
  if (topicGroupStatistics) {
    checkTopicGroupStatistics(topicGroupStatistics, report, topics, ogmTopicSources);
  }

  const topicGroupMappings = await parseJson(
    resolve(contentDir, 'topic-group-mappings.json'),
    'topicGroupMappings',
    topicGroupMappingsSchema,
    report,
  );
  if (topicGroupMappings) {
    checkTopicGroupMappings(topicGroupMappings, report, topicGroupStatistics, topics);
  }

  const coefficients = await parseJson(
    resolve(contentDir, 'coefficients.json'),
    'coefficients',
    coefficientsSchema,
    report,
  );
  if (coefficients) checkCoefficients(coefficients, report);

  const ranks = await parseJson(
    resolve(contentDir, 'rank-tables.json'),
    'rankTables',
    rankTablesSchema,
    report,
  );
  if (ranks) checkRankTables(ranks, report);

  if (manifest && coefficients && manifest.examYear !== coefficients.examYear) {
    report.errors.push(
      `manifest.examYear ${manifest.examYear} does not match coefficients.examYear ${coefficients.examYear}`,
    );
  }
  if (manifest && ranks && manifest.examYear !== ranks.examYear) {
    report.errors.push(
      `manifest.examYear ${manifest.examYear} does not match rankTables.examYear ${ranks.examYear}`,
    );
  }

  await parseJson(resolve(contentDir, 'calendar.json'), 'calendar', calendarSchema, report);
  const news = await parseJson(resolve(contentDir, 'news.json'), 'news', newsSchema, report);
  if (news) checkNews(news, report);

  const programsFixture = await parseJson(
    resolve(contentDir, 'programs.fixture.json'),
    'programsFixture',
    programsFixtureSchema,
    report,
  );
  if (programsFixture) checkProgramsFixture(programsFixture, report);

  if (!options.skipProgramsDatabase) {
    const databasePath = resolve(options.programsDbPath ?? resolve(contentDir, 'programs.db'));
    try {
      await access(databasePath);
      validateProgramsDatabase(databasePath, report);
    } catch {
      report.errors.push(
        `programs.db: missing at ${databasePath}; run scripts/build-programs.ts first`,
      );
    }
  }

  return report;
}

function parseOptions(args: string[]): ValidatePackOptions {
  const options: ValidatePackOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--content-dir' && value) {
      options.contentDir = value;
      index += 1;
    } else if (argument === '--programs-db' && value) {
      options.programsDbPath = value;
      index += 1;
    } else if (argument === '--skip-programs-db') {
      options.skipProgramsDatabase = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    }
  }
  return options;
}

function printReport(report: ValidationReport): void {
  for (const warning of report.warnings) console.warn(`WARN ${warning}`);
  for (const error of report.errors) console.error(`ERROR ${error}`);
  console.log(
    `Validated ${report.summary.topics} topics, ${report.summary.topicGroups} official topic groups (${report.summary.mappedSubjects} fully mapped subjects), ${report.summary.placeholderSectionYears} placeholder section-years, ` +
      `${report.summary.programs} programs, and ${report.summary.programYears} program-year rows.`,
  );
  console.log(
    report.errors.length
      ? `Pack validation failed with ${report.errors.length} error(s).`
      : 'Pack validation passed.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options: ValidatePackOptions;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    options = { skipProgramsDatabase: true, contentDir: resolve(process.cwd(), '__invalid__') };
  }

  if (process.exitCode !== 1) {
    validateSourcePack(options)
      .then((report) => {
        printReport(report);
        if (report.errors.length) process.exitCode = 1;
      })
      .catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
  }
}
