import { subjectOfficialStats } from './officialStats';

const years = (counts: number[]) =>
  counts.map((count, index) => ({ year: 2018 + index, count }));

function group(id: string, subjectId: string, counts: number[], policy = 'canonical' as const) {
  return {
    id,
    displaySubjectId: subjectId,
    countingPolicy: policy,
    sourceLabelTr: id.toUpperCase(),
    yearlyCounts: years(counts),
    total: counts.reduce((sum, count) => sum + count, 0),
  };
}

const statistics = (groups: ReturnType<typeof group>[]) =>
  ({ availability: 'available', groups }) as const;

const mapping = (entries: { groupId: string; topicIds: string[] }[]) => ({
  subjects: [
    {
      displaySubjectId: 'ydt-ingilizce',
      entries: entries.map((entry) => ({
        groupId: entry.groupId,
        relation: 'exact' as const,
        topicIds: entry.topicIds,
        status: 'auto-exact' as const,
      })),
    },
  ],
});

describe('subjectOfficialStats', () => {
  it('aggregates official counts per topic and stays undefined for unmapped subjects', () => {
    const stats = subjectOfficialStats(
      statistics([group('g1', 'ydt-ingilizce', [1, 0, 0, 0, 0, 0, 0, 2])]),
      mapping([{ groupId: 'g1', topicIds: ['t1'] }]),
      'ydt-ingilizce',
    );
    expect(stats?.byTopic.get('t1')?.total).toBe(3);
    expect(stats?.byTopic.get('t1')?.yearly[7]).toEqual({ year: 2025, count: 2 });
    expect(
      subjectOfficialStats(statistics([]), mapping([]), 'tyt-matematik'),
    ).toBeUndefined();
  });

  it('fails closed (undefined, no throw) when official year axes diverge', () => {
    const shortAxis = {
      ...group('g2', 'ydt-ingilizce', [1, 1]),
      yearlyCounts: years([1, 1]).map((row, index) => ({ ...row, year: 2020 + index })),
    };
    const document = statistics([group('g1', 'ydt-ingilizce', [1, 0, 0, 0, 0, 0, 0, 0]), shortAxis]);
    const bridged = mapping([
      { groupId: 'g1', topicIds: ['t1'] },
      { groupId: 'g2', topicIds: ['t1'] },
    ]);
    expect(() => subjectOfficialStats(document, bridged, 'ydt-ingilizce')).not.toThrow();
    expect(subjectOfficialStats(document, bridged, 'ydt-ingilizce')).toBeUndefined();
  });

  it('never attributes cross-check-only groups', () => {
    const document = statistics([
      group('g1', 'ydt-ingilizce', [1, 0, 0, 0, 0, 0, 0, 0], 'cross-check-only' as never),
    ]);
    expect(
      subjectOfficialStats(document, mapping([{ groupId: 'g1', topicIds: ['t1'] }]), 'ydt-ingilizce'),
    ).toBeUndefined();
  });
});
