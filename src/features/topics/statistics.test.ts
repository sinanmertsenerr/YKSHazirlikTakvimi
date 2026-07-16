import {
  getComparableFrequency,
  getComparableVerifiedYears,
  getVerifiedTopicStats,
  isVerifiedTopicStat,
  type TopicStatLike,
} from './statistics';

const source = 'https://www.osym.gov.tr/TR,33851/2026-yks-kilavuzu.html';

function stat(overrides: Partial<TopicStatLike> = {}): TopicStatLike {
  return { year: 2025, count: 1, verified: true, source, ...overrides };
}

describe('verified topic statistics', () => {
  it('requires a verified record, an official source reference, and a known count', () => {
    expect(isVerifiedTopicStat(stat({ count: 0 }))).toBe(true);
    expect(isVerifiedTopicStat(stat({ verified: false }))).toBe(false);
    expect(isVerifiedTopicStat(stat({ source: null }))).toBe(false);
    expect(isVerifiedTopicStat(stat({ source: '  ' }))).toBe(false);
    expect(isVerifiedTopicStat(stat({ count: null }))).toBe(false);
  });

  it('excludes unverified placeholder values and keeps a verified real zero', () => {
    expect(
      getVerifiedTopicStats([
        stat({ year: 2024, count: 9, verified: false, source: null }),
        stat({ year: 2023, count: null, verified: false, source: null }),
        stat({ year: 2025, count: 0 }),
      ]),
    ).toEqual([stat({ year: 2025, count: 0 })]);
  });

  it('allows frequency comparison only for the same complete verified year set', () => {
    const first = { yearlyStats: [stat({ year: 2024 }), stat({ year: 2025 })] };
    const second = {
      yearlyStats: [stat({ year: 2024, count: 2 }), stat({ year: 2025, count: 3 })],
    };

    expect(getComparableVerifiedYears([first, second])).toEqual([2024, 2025]);
    expect(
      getComparableVerifiedYears([first, { yearlyStats: [stat({ year: 2025, count: 3 })] }]),
    ).toEqual([]);
    expect(
      getComparableVerifiedYears([
        first,
        { yearlyStats: [stat({ count: 0, verified: false, source: null })] },
      ]),
    ).toEqual([]);
  });

  it('never treats an unverified value as zero while calculating frequency', () => {
    const topic = {
      yearlyStats: [
        stat({ year: 2024, count: 0 }),
        stat({ year: 2025, count: 12, verified: false, source: null }),
      ],
    };

    expect(getComparableFrequency(topic, [2024])).toBe(0);
    expect(getComparableFrequency(topic, [2024, 2025])).toBeNull();
    expect(getComparableFrequency(topic, [])).toBeNull();
  });
});
