export type OfficialYearCount = Readonly<{ year: number; count: number }>;

type OfficialGroupLike = Readonly<{
  id: string;
  displaySubjectId: string;
  countingPolicy: 'canonical' | 'alternative-included' | 'cross-check-only';
  sourceLabelTr: string;
  yearlyCounts: readonly OfficialYearCount[];
  total: number;
}>;

type StatisticsLike =
  | Readonly<{ availability: 'pending' }>
  | Readonly<{ availability: 'available'; groups: readonly OfficialGroupLike[] }>;

type MappingEntryLike = Readonly<{
  groupId: string;
  relation: 'exact' | 'aggregate-into-topic' | 'group-spans-topics';
  topicsSubjectId?: string;
  topicIds: readonly string[];
  status: 'auto-exact' | 'editorial';
}>;

type MappingsLike = Readonly<{
  subjects: readonly Readonly<{
    displaySubjectId: string;
    entries: readonly MappingEntryLike[];
  }>[];
}>;

export type OfficialTopicStat = {
  topicId: string;
  yearly: OfficialYearCount[];
  total: number;
  editorial: boolean;
  alternativeIncluded: boolean;
  groupLabels: string[];
  /** True when part of this topic's questions sit in a shared multi-topic group. */
  partial: boolean;
};

export type SpanningOfficialGroup = {
  groupId: string;
  sourceLabelTr: string;
  topicIds: readonly string[];
  yearly: OfficialYearCount[];
  total: number;
};

export type SubjectOfficialStats = {
  byTopic: ReadonlyMap<string, OfficialTopicStat>;
  spanning: SpanningOfficialGroup[];
};

/**
 * Distributes official MEB OGM group counts onto study topics through the reviewed mapping.
 * Only complete subject mappings are activated upstream, so every attributed number is the
 * exact official count; topics touched by a multi-topic group are flagged as partial instead
 * of receiving guessed splits.
 */
export function subjectOfficialStats(
  statistics: StatisticsLike,
  mappings: MappingsLike,
  subjectId: string,
): SubjectOfficialStats | undefined {
  if (statistics.availability !== 'available') return undefined;
  const relevant = mappings.subjects.flatMap((subject) =>
    subject.entries
      .filter((entry) => (entry.topicsSubjectId ?? subject.displaySubjectId) === subjectId)
      .map((entry) => ({ entry, sourceSubjectId: subject.displaySubjectId })),
  );
  if (!relevant.length) return undefined;

  const groupsById = new Map(statistics.groups.map((group) => [group.id, group] as const));
  const byTopic = new Map<string, OfficialTopicStat>();
  const spanning: SpanningOfficialGroup[] = [];

  for (const { entry, sourceSubjectId } of relevant) {
    const group = groupsById.get(entry.groupId);
    if (
      !group ||
      group.displaySubjectId !== sourceSubjectId ||
      group.countingPolicy === 'cross-check-only'
    ) {
      return undefined;
    }
    if (entry.relation === 'group-spans-topics') {
      spanning.push({
        groupId: group.id,
        sourceLabelTr: group.sourceLabelTr,
        topicIds: entry.topicIds,
        yearly: [...group.yearlyCounts],
        total: group.total,
      });
      continue;
    }
    const topicId = entry.topicIds[0];
    if (topicId === undefined) return undefined;
    const existing = byTopic.get(topicId) ?? {
      topicId,
      yearly: group.yearlyCounts.map((row) => ({ year: row.year, count: 0 })),
      total: 0,
      editorial: false,
      alternativeIncluded: false,
      groupLabels: [],
      partial: false,
    };
    if (existing.yearly.length !== group.yearlyCounts.length) return undefined;
    const merged: OfficialYearCount[] = [];
    for (const [index, row] of existing.yearly.entries()) {
      const added = group.yearlyCounts[index];
      if (!added || added.year !== row.year) return undefined;
      merged.push({ year: row.year, count: row.count + added.count });
    }
    existing.yearly = merged;
    existing.total += group.total;
    existing.editorial ||= entry.status === 'editorial';
    existing.alternativeIncluded ||= group.countingPolicy === 'alternative-included';
    existing.groupLabels.push(group.sourceLabelTr);
    byTopic.set(topicId, existing);
  }

  for (const shared of spanning) {
    for (const topicId of shared.topicIds) {
      const stat = byTopic.get(topicId);
      if (stat) stat.partial = true;
    }
  }

  return { byTopic, spanning };
}
