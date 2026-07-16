import { countsAsProgressActivity, istanbulDay } from './activity';

describe('activity semantics', () => {
  it('does not count a reset/unstarted topic as study activity', () => {
    expect(countsAsProgressActivity('none')).toBe(false);
    expect(countsAsProgressActivity('working')).toBe(true);
    expect(countsAsProgressActivity('done')).toBe(true);
  });

  it('attributes records to their Europe/Istanbul calendar day', () => {
    expect(istanbulDay(Date.parse('2026-07-14T21:30:00.000Z'))).toBe('2026-07-15');
  });
});
