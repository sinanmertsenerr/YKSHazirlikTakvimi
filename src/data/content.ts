import { z } from 'zod';
import { create } from 'zustand';
import { File } from 'expo-file-system';

import calendarJson from '../../content/calendar.json';
import coefficientsJson from '../../content/coefficients.json';
import newsJson from '../../content/news.json';
import rankTablesJson from '../../content/rank-tables.json';
import topicsJson from '../../content/topics.json';
import {
  calendarSchema,
  coefficientsSchema,
  CURRENT_SCHEMA_VERSION,
  localizedTextSchema,
  newsSchema,
  programsFixtureSchema,
  rankTablesSchema,
  topicsSchema,
} from '../../scripts/lib/content-schemas';

/** Source-build and runtime validation deliberately share one fail-closed schema contract. */
export { localizedTextSchema };
export const topicsPackSchema = topicsSchema;
export const coefficientsPackSchema = coefficientsSchema;
export const rankTablesPackSchema = rankTablesSchema;
export const calendarPackSchema = calendarSchema;
export const newsPackSchema = newsSchema;

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
  return {
    topics: topicsPackSchema.parse(input.topics),
    coefficients: coefficientsPackSchema.parse(input.coefficients),
    rankTables: rankTablesPackSchema.parse(input.rankTables),
    calendar: calendarPackSchema.parse(input.calendar),
    news: newsPackSchema.parse(input.news),
  };
}

const bundledDocuments = parseRuntimeContentTransaction({
  topics: topicsJson,
  coefficients: coefficientsJson,
  rankTables: rankTablesJson,
  calendar: calendarJson,
  news: newsJson,
});

export let topicsPack = bundledDocuments.topics;
export let coefficientsPack = bundledDocuments.coefficients;
export let rankTablesPack = bundledDocuments.rankTables;
export let calendarPack = bundledDocuments.calendar;
export let newsPack = bundledDocuments.news;

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
}

export function restoreBundledRuntimeContent(): boolean {
  const changed =
    topicsPack !== bundledDocuments.topics ||
    coefficientsPack !== bundledDocuments.coefficients ||
    rankTablesPack !== bundledDocuments.rankTables ||
    calendarPack !== bundledDocuments.calendar ||
    newsPack !== bundledDocuments.news;
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
    const [topics, coefficients, rankTables, calendar, news] = await Promise.all([
      file('topics').json(),
      file('coefficients').json(),
      file('rankTables').json(),
      file('calendar').json(),
      file('news').json(),
    ]);
    const next = parseRuntimeContentTransaction({
      topics,
      coefficients,
      rankTables,
      calendar,
      news,
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
export type Program = z.infer<typeof programsPackSchema>['programs'][number];

export function allSubjects(examId?: 'tyt' | 'ayt') {
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
