import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  topicGroupMappingsSchema,
  topicGroupStatisticsSchema,
  topicsSchema,
  type TopicsDocument,
} from './lib/content-schemas.ts';
import { writeTextFileAtomicallyIfChanged } from './lib/semantic-stability.ts';

/**
 * MEB prints geometry rows inside the Matematik tables; the app keeps geometry as a separate
 * study subject. This pinned, reviewed split is the only editorial decision in the generation —
 * every unlisted group stays in its official display subject.
 */
const GEOMETRY_SPLIT: Readonly<Record<string, string>> = {
  'tyt-matematik-cokgenler-dortgenler-ve-ozellikleri': 'tyt-geometri',
  'tyt-matematik-dik-ucgen-ve-trigonometri': 'tyt-geometri',
  'tyt-matematik-kati-cisimler': 'tyt-geometri',
  'tyt-matematik-ozel-dortgenler': 'tyt-geometri',
  'tyt-matematik-ucgenin-alani-ucgenin-alani-ile-ilgili-uygulamalar': 'tyt-geometri',
  'tyt-matematik-ucgenin-yardimci-elemanlari': 'tyt-geometri',
  'tyt-matematik-ucgenlerde-eslik-ve-benzerlik': 'tyt-geometri',
  'tyt-matematik-ucgenlerde-temel-kavramlar': 'tyt-geometri',
  'ayt-say-matematik-cember-ve-daire': 'ayt-geometri',
  'ayt-say-matematik-cemberin-analitik-incelenmesi': 'ayt-geometri',
  'ayt-say-matematik-dogrunun-analitik-incelenmesi': 'ayt-geometri',
  'ayt-say-matematik-donusumler': 'ayt-geometri',
  'ayt-say-matematik-kati-cisimler': 'ayt-geometri',
  'ayt-say-matematik-ucgen-cokgen-dortgen-ozel-dortgenler': 'ayt-geometri',
};

type Statistics = ReturnType<typeof topicGroupStatisticsSchema.parse>;
type OfficialGroup = Extract<Statistics, { availability: 'available' }>['groups'][number];

function studySubjectIdFor(group: OfficialGroup): string {
  return GEOMETRY_SPLIT[group.id] ?? group.displaySubjectId;
}

export function buildOfficialTaxonomy(
  currentTopics: unknown,
  statisticsInput: unknown,
): { topics: TopicsDocument; mappings: ReturnType<typeof topicGroupMappingsSchema.parse> } {
  const topics = topicsSchema.parse(currentTopics);
  const statistics = topicGroupStatisticsSchema.parse(statisticsInput);
  if (statistics.availability !== 'available') {
    throw new Error('Official topic-group statistics must be available before adopting them.');
  }

  const attributable = statistics.groups.filter(
    (group) => group.countingPolicy !== 'cross-check-only',
  );
  for (const groupId of Object.keys(GEOMETRY_SPLIT)) {
    if (!attributable.some((group) => group.id === groupId)) {
      throw new Error(`Geometry split references an unknown official group: ${groupId}`);
    }
  }

  const groupsByStudySubject = new Map<string, OfficialGroup[]>();
  for (const group of attributable) {
    const subjectId = studySubjectIdFor(group);
    const list = groupsByStudySubject.get(subjectId) ?? [];
    list.push(group);
    groupsByStudySubject.set(subjectId, list);
  }

  const placeholderTemplate =
    topics.exams[0]?.sections[0]?.subjects[0]?.topics[0]?.yearlyStats.map((stat) => stat.year) ??
    [];
  if (!placeholderTemplate.length) throw new Error('Cannot derive the placeholder year axis.');
  const placeholderStats = () =>
    placeholderTemplate.map((year) => ({
      year,
      count: null,
      verified: false,
      source: null,
      verificationMethod: null,
      verifiedAt: null,
    }));

  const usedSubjectIds = new Set<string>();
  const nextTopics = {
    ...topics,
    exams: topics.exams.map((exam) => ({
      ...exam,
      sections: exam.sections.map((section) => ({
        ...section,
        subjects: section.subjects.map((subject) => {
          const groups = groupsByStudySubject.get(subject.id);
          if (!groups) {
            throw new Error(
              `Study subject ${subject.id} has no official MEB groups; refusing a silent empty subject.`,
            );
          }
          usedSubjectIds.add(subject.id);
          const ordered = [...groups].sort(
            (left, right) => left.displayOrder - right.displayOrder || left.id.localeCompare(right.id),
          );
          return {
            ...subject,
            topics: ordered.map((group) => ({
              id: group.id,
              name: { tr: group.sourceLabelTr, en: group.sourceLabelTr },
              grade: [],
              gradeVerified: false,
              gradeApproximate: false as const,
              gradeSource: null,
              yearlyStats: placeholderStats(),
              questions: [],
            })),
          };
        }),
      })),
    })),
  };
  for (const subjectId of groupsByStudySubject.keys()) {
    if (!usedSubjectIds.has(subjectId)) {
      throw new Error(`Official groups target a subject missing from topics.json: ${subjectId}`);
    }
  }

  const mappingSubjects = new Map<string, { groupId: string; target: string }[]>();
  for (const group of attributable) {
    const list = mappingSubjects.get(group.displaySubjectId) ?? [];
    list.push({ groupId: group.id, target: studySubjectIdFor(group) });
    mappingSubjects.set(group.displaySubjectId, list);
  }
  const mappings = topicGroupMappingsSchema.parse({
    schemaVersion: 1,
    authority: 'MEB OGM',
    method: 'official-group-to-study-topic-mapping',
    noteTr:
      'Çalışma konuları doğrudan resmî MEB OGM konu gruplarından üretilir; her konu tam olarak bir resmî gruptur. Tek editoryal karar, Matematik tablolarındaki geometri satırlarının ayrı geometri dersinde gösterilmesidir.',
    subjects: [...mappingSubjects.entries()].map(([displaySubjectId, entries]) => ({
      displaySubjectId,
      entries: entries.map(({ groupId, target }) => ({
        groupId,
        relation: 'exact',
        ...(target === displaySubjectId ? {} : { topicsSubjectId: target }),
        topicIds: [groupId],
        status: 'auto-exact',
      })),
    })),
  });

  return { topics: topicsSchema.parse(nextTopics), mappings };
}

async function main(): Promise<void> {
  const contentDir = resolve(process.cwd(), 'content');
  const [topicsRaw, statisticsRaw] = await Promise.all([
    readFile(resolve(contentDir, 'topics.json'), 'utf8'),
    readFile(resolve(contentDir, 'topic-group-statistics.json'), 'utf8'),
  ]);
  const { topics, mappings } = buildOfficialTaxonomy(
    JSON.parse(topicsRaw),
    JSON.parse(statisticsRaw),
  );
  await writeTextFileAtomicallyIfChanged(
    resolve(contentDir, 'topics.json'),
    `${JSON.stringify(topics, null, 2)}\n`,
  );
  await writeTextFileAtomicallyIfChanged(
    resolve(contentDir, 'topic-group-mappings.json'),
    `${JSON.stringify(mappings, null, 2)}\n`,
  );
  const topicCount = topics.exams.reduce(
    (sum, exam) =>
      sum +
      exam.sections.reduce(
        (sectionSum, section) =>
          sectionSum +
          section.subjects.reduce((subjectSum, subject) => subjectSum + subject.topics.length, 0),
        0,
      ),
    0,
  );
  console.log(
    `Adopted ${topicCount} official MEB topics across ${mappings.subjects.length} mapped subjects.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
