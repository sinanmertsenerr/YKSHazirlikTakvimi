export type TopicStatLike = Readonly<{
  year: number;
  count: number | null;
  verified: boolean;
  source?: string | null;
}>;

export type TopicWithStats = Readonly<{
  yearlyStats: readonly TopicStatLike[];
}>;

export type VerifiedTopicStat = TopicStatLike & {
  count: number;
  verified: true;
  source: string;
};

type TopicProgressLike = Readonly<{
  percent: number;
}>;

export function getAverageTopicProgress(
  topicIds: readonly string[],
  progressByTopicId: ReadonlyMap<string, TopicProgressLike>,
): number {
  if (topicIds.length === 0) return 0;

  const totalPercent = topicIds.reduce((sum, topicId) => {
    const percent = progressByTopicId.get(topicId)?.percent ?? 0;
    return sum + Math.max(0, Math.min(100, percent));
  }, 0);

  return totalPercent / (topicIds.length * 100);
}

export function isVerifiedTopicStat(stat: TopicStatLike): stat is VerifiedTopicStat {
  return (
    stat.verified === true &&
    stat.count !== null &&
    Number.isInteger(stat.count) &&
    stat.count >= 0 &&
    typeof stat.source === 'string' &&
    stat.source.trim().length > 0
  );
}

export function getVerifiedTopicStats(stats: readonly TopicStatLike[]): VerifiedTopicStat[] {
  return stats.filter(isVerifiedTopicStat).sort((left, right) => left.year - right.year);
}

export function getComparableVerifiedYears(topics: readonly TopicWithStats[]): number[] {
  if (topics.length === 0) return [];

  const yearSets = topics.map((topic) => {
    const years = getVerifiedTopicStats(topic.yearlyStats).map((stat) => stat.year);
    return new Set(years).size === years.length ? years : [];
  });
  const expected = yearSets[0];
  if (!expected?.length) return [];

  return yearSets.every(
    (years) =>
      years.length === expected.length && years.every((year, index) => year === expected[index]),
  )
    ? expected
    : [];
}

export function getComparableFrequency(
  topic: TopicWithStats,
  comparableYears: readonly number[],
): number | null {
  if (comparableYears.length === 0 || new Set(comparableYears).size !== comparableYears.length) {
    return null;
  }

  const countsByYear = new Map(
    getVerifiedTopicStats(topic.yearlyStats).map((stat) => [stat.year, stat.count] as const),
  );
  let total = 0;
  for (const year of comparableYears) {
    const count = countsByYear.get(year);
    if (count === undefined) return null;
    total += count;
  }
  return total;
}
