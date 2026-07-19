import { z } from 'zod';
import { create } from 'zustand';
import { File } from 'expo-file-system';

import { subjectOfficialStats, type SubjectOfficialStats } from '../features/topics/officialStats';
import { measureStartupPhaseSync } from '../utils/startupDiagnostics';

import calendarJson from '../../content/calendar.json';
import coefficientsJson from '../../content/coefficients.json';
import newsJson from '../../content/news.json';
import rankTablesJson from '../../content/rank-tables.json';
import topicGroupMappingsJson from '../../content/topic-group-mappings.json';
import topicGroupStatisticsJson from '../../content/topic-group-statistics.json';
import topicsJson from '../../content/topics.json';
import {
  calendarSchema,
  coefficientsSchema,
  CURRENT_SCHEMA_VERSION,
  localizedTextSchema,
  newsSchema,
  programsFixtureSchema,
  rankTablesSchema,
  topicGroupMappingsSchema,
  topicGroupStatisticsSchema,
  topicsSchema,
} from '../../scripts/lib/content-schemas';

/** Source-build and runtime validation deliberately share one fail-closed schema contract. */
export { localizedTextSchema };
export const topicsPackSchema = topicsSchema;
export const coefficientsPackSchema = coefficientsSchema;
export const rankTablesPackSchema = rankTablesSchema;
export const calendarPackSchema = calendarSchema;
export const newsPackSchema = newsSchema;
export const topicGroupStatisticsPackSchema = topicGroupStatisticsSchema;
export const topicGroupMappingsPackSchema = topicGroupMappingsSchema;

const programSchema = programsFixtureSchema.shape.programs.element;
export const programsPackSchema = z
  .object({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    programs: z.array(programSchema),
  })
  .strict();

export type RuntimeContentDocuments = {
  topics: z.infer<typeof topicsPackSchema>;
  coefficients: z.infer<typeof coefficientsPackSchema>;
  rankTables: z.infer<typeof rankTablesPackSchema>;
  calendar: z.infer<typeof calendarPackSchema>;
  news: z.infer<typeof newsPackSchema>;
  topicGroupStatistics: z.infer<typeof topicGroupStatisticsPackSchema>;
  topicGroupMappings: z.infer<typeof topicGroupMappingsPackSchema>;
};

export type RuntimeContentInput = {
  [Key in keyof RuntimeContentDocuments]: unknown;
};

/**
 * Parses every JSON document before any live reference is replaced. A single invalid v2 file
 * rejects the entire runtime transaction and leaves the previously active pack untouched.
 */
export function parseRuntimeContentTransaction(
  input: RuntimeContentInput,
): RuntimeContentDocuments {
  const parsed = {
    topics: topicsPackSchema.parse(input.topics),
    coefficients: coefficientsPackSchema.parse(input.coefficients),
    rankTables: rankTablesPackSchema.parse(input.rankTables),
    calendar: calendarPackSchema.parse(input.calendar),
    news: newsPackSchema.parse(input.news),
    topicGroupStatistics: topicGroupStatisticsPackSchema.parse(input.topicGroupStatistics),
    topicGroupMappings: topicGroupMappingsPackSchema.parse(input.topicGroupMappings),
  };
  if (parsed.topicGroupStatistics.availability === 'available') {
    const subjectExams = new Map(
      parsed.topics.exams.flatMap((exam) =>
        exam.sections.flatMap((section) =>
          section.subjects.map((subject) => [subject.id, exam.id] as const),
        ),
      ),
    );
    for (const group of parsed.topicGroupStatistics.groups) {
      if (subjectExams.get(group.displaySubjectId) !== group.exam) {
        throw new Error(
          `Official topic group ${group.id} references an unknown or mismatched display subject.`,
        );
      }
    }
  }
  if (parsed.topicGroupMappings.subjects.length) {
    if (parsed.topicGroupStatistics.availability !== 'available') {
      throw new Error(
        'Topic-group mappings cannot activate without available official statistics.',
      );
    }
    const topicIdsBySubject = new Map(
      parsed.topics.exams.flatMap((exam) =>
        exam.sections.flatMap((section) =>
          section.subjects.map(
            (subject) => [subject.id, new Set(subject.topics.map((topic) => topic.id))] as const,
          ),
        ),
      ),
    );
    const groups = parsed.topicGroupStatistics.groups;
    for (const subject of parsed.topicGroupMappings.subjects) {
      if (!topicIdsBySubject.has(subject.displaySubjectId)) {
        throw new Error(
          `Topic-group mapping references unknown subject ${subject.displaySubjectId}.`,
        );
      }
      const attributable = new Set(
        groups
          .filter(
            (group) =>
              group.displaySubjectId === subject.displaySubjectId &&
              group.countingPolicy !== 'cross-check-only',
          )
          .map((group) => group.id),
      );
      const mapped = new Set(subject.entries.map((entry) => entry.groupId));
      for (const entry of subject.entries) {
        if (!attributable.has(entry.groupId)) {
          throw new Error(
            `Topic-group mapping ${entry.groupId} is not attributable to ${subject.displaySubjectId}.`,
          );
        }
        const topicIds = topicIdsBySubject.get(entry.topicsSubjectId ?? subject.displaySubjectId);
        if (!topicIds) {
          throw new Error(`Topic-group mapping ${entry.groupId} targets an unknown subject.`);
        }
        for (const topicId of entry.topicIds) {
          if (!topicIds.has(topicId)) {
            throw new Error(
              `Topic-group mapping ${entry.groupId} references unknown topic ${topicId}.`,
            );
          }
        }
      }
      for (const groupId of attributable) {
        if (!mapped.has(groupId)) {
          throw new Error(
            `Topic-group mapping for ${subject.displaySubjectId} is incomplete: ${groupId}.`,
          );
        }
      }
    }
  }
  return parsed;
}

// Module-scope on purpose (consumers import the packs synchronously); the sync phase
// wrapper makes this first-render-blocking parse visible in the [startup] logs.
const bundledDocuments = measureStartupPhaseSync('content.parse-bundled', () =>
  parseRuntimeContentTransaction({
    topics: topicsJson,
    coefficients: coefficientsJson,
    rankTables: rankTablesJson,
    calendar: calendarJson,
    news: newsJson,
    topicGroupStatistics: topicGroupStatisticsJson,
    topicGroupMappings: topicGroupMappingsJson,
  }),
);

export let topicsPack = bundledDocuments.topics;
export let coefficientsPack = bundledDocuments.coefficients;
export let rankTablesPack = bundledDocuments.rankTables;
export let calendarPack = bundledDocuments.calendar;
export let newsPack = bundledDocuments.news;
export let topicGroupStatisticsPack = bundledDocuments.topicGroupStatistics;
export let topicGroupMappingsPack = bundledDocuments.topicGroupMappings;

// Full program data lives in the indexed SQLite pack. Keeping the 22+ MiB source fixture out of
// the JavaScript bundle avoids duplicate memory and guarantees a fail-closed empty fallback.
export const programsPack = programsPackSchema.parse({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  programs: [],
});

export const useContentRevisionStore = create<{ revision: number; bump: () => void }>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}));

export function commitRuntimeContentTransaction(next: RuntimeContentDocuments): void {
  topicsPack = next.topics;
  coefficientsPack = next.coefficients;
  rankTablesPack = next.rankTables;
  calendarPack = next.calendar;
  newsPack = next.news;
  topicGroupStatisticsPack = next.topicGroupStatistics;
  topicGroupMappingsPack = next.topicGroupMappings;
}

export function restoreBundledRuntimeContent(): boolean {
  const changed =
    topicsPack !== bundledDocuments.topics ||
    coefficientsPack !== bundledDocuments.coefficients ||
    rankTablesPack !== bundledDocuments.rankTables ||
    calendarPack !== bundledDocuments.calendar ||
    newsPack !== bundledDocuments.news ||
    topicGroupStatisticsPack !== bundledDocuments.topicGroupStatistics ||
    topicGroupMappingsPack !== bundledDocuments.topicGroupMappings;
  if (changed) commitRuntimeContentTransaction(bundledDocuments);
  return changed;
}

/** Loads a fully activated downloaded JSON pack as one in-memory transaction. */
export async function initializeActiveContent(attempt = 0): Promise<boolean> {
  const { getActivePackLocation, invalidateDownloadedPackVersion } = await import('./packUpdater');
  const active = await getActivePackLocation();
  if (active.source === 'bundled') return restoreBundledRuntimeContent();

  const file = (key: keyof RuntimeContentDocuments) =>
    new File(active.directory, active.manifest.files[key].path);
  try {
    const [
      topics,
      coefficients,
      rankTables,
      calendar,
      news,
      topicGroupStatistics,
      topicGroupMappings,
    ] = await Promise.all([
      file('topics').json(),
      file('coefficients').json(),
      file('rankTables').json(),
      file('calendar').json(),
      file('news').json(),
      file('topicGroupStatistics').json(),
      file('topicGroupMappings').json(),
    ]);
    const next = parseRuntimeContentTransaction({
      topics,
      coefficients,
      rankTables,
      calendar,
      news,
      topicGroupStatistics,
      topicGroupMappings,
    });
    commitRuntimeContentTransaction(next);
    return true;
  } catch (error) {
    await invalidateDownloadedPackVersion(active.version);
    if (attempt < 2) return initializeActiveContent(attempt + 1);
    throw error;
  }
}

export async function reloadActiveContent() {
  const loaded = await initializeActiveContent();
  if (loaded) useContentRevisionStore.getState().bump();
  return loaded;
}

export type Topic = z.infer<
  typeof topicsPackSchema
>['exams'][number]['sections'][number]['subjects'][number]['topics'][number];
export type Subject = z.infer<
  typeof topicsPackSchema
>['exams'][number]['sections'][number]['subjects'][number];
export type CalendarEvent = z.infer<typeof calendarPackSchema>['events'][number];
export type NewsItem = z.infer<typeof newsPackSchema>['items'][number];
export type TopicGroupStatistics = z.infer<typeof topicGroupStatisticsPackSchema>;
export type OfficialTopicGroup = Extract<
  TopicGroupStatistics,
  { availability: 'available' }
>['groups'][number];
export type Program = z.infer<typeof programsPackSchema>['programs'][number];

export function allSubjects(examId?: 'tyt' | 'ayt' | 'ydt') {
  return topicsPack.exams
    .filter((exam) => !examId || exam.id === examId)
    .flatMap((exam) => exam.sections.flatMap((section) => section.subjects));
}

export function findSubject(subjectId: string) {
  return allSubjects().find((subject) => subject.id === subjectId);
}

export function findTopic(subjectId: string, topicId: string) {
  return findSubject(subjectId)?.topics.find((topic) => topic.id === topicId);
}

export function findOfficialTopicGroup(groupId: string): OfficialTopicGroup | undefined {
  if (topicGroupStatisticsPack.availability !== 'available') return undefined;
  return topicGroupStatisticsPack.groups.find((group) => group.id === groupId);
}

export function findOfficialTopicGroupSource(sourceKey: string) {
  if (topicGroupStatisticsPack.availability !== 'available') return undefined;
  return topicGroupStatisticsPack.sources.find((source) => source.key === sourceKey);
}

/** Official per-topic yearly counts through the reviewed mapping; undefined until complete. */
export function officialStatsForSubject(subjectId: string): SubjectOfficialStats | undefined {
  return subjectOfficialStats(topicGroupStatisticsPack, topicGroupMappingsPack, subjectId);
}
