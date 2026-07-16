import { calculateStreak } from './metrics';

describe('calculateStreak', () => {
  it('counts unique consecutive days ending today', () => {
    expect(calculateStreak(['2026-07-14', '2026-07-14', '2026-07-13'], '2026-07-14')).toBe(2);
  });
  it('keeps a streak alive when latest activity was yesterday', () => {
    expect(calculateStreak(['2026-07-13', '2026-07-12'], '2026-07-14')).toBe(2);
  });
  it('returns zero for empty, stale, or future data', () => {
    expect(calculateStreak([], '2026-07-14')).toBe(0);
    expect(calculateStreak(['2026-07-11'], '2026-07-14')).toBe(0);
    expect(calculateStreak(['2026-07-15'], '2026-07-14')).toBe(0);
  });
  it('stops at a gap', () => {
    expect(calculateStreak(['2026-07-14', '2026-07-12'], '2026-07-14')).toBe(1);
  });
});
