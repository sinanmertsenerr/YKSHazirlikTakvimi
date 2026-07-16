import { automaticExamYear, resolveExamYear } from './examYear';

const event = (
  id: string,
  start: string,
  overrides: Partial<{
    type: string;
    verified: boolean;
    approximate: boolean;
    sample: boolean;
  }> = {},
) => ({
  id,
  start,
  type: 'sinav',
  verified: true,
  approximate: false,
  sample: false,
  ...overrides,
});

describe('exam year rollover', () => {
  it('selects the next exact verified TYT using the Istanbul calendar day', () => {
    expect(
      automaticExamYear(
        [event('yks-2026-tyt', '2026-06-20'), event('yks-2027-tyt', '2027-06-19')],
        Date.parse('2026-07-15T12:00:00+03:00'),
      ),
    ).toBe(2027);
  });

  it('rolls one year after the latest verified TYT without inventing a date', () => {
    expect(
      automaticExamYear(
        [event('yks-2026-tyt', '2026-06-20')],
        Date.parse('2026-07-15T12:00:00+03:00'),
      ),
    ).toBe(2027);
  });

  it('ignores approximate, sample, unverified, and non-TYT events', () => {
    expect(
      automaticExamYear(
        [
          event('yks-2030-tyt', '2030-06-22', { approximate: true }),
          event('sample-2031-tyt', '2031-06-21', { sample: true }),
          event('yks-2032-tyt', '2032-06-19', { verified: false }),
          event('yks-2033-ayt', '2033-06-20'),
        ],
        Date.parse('2028-01-01T00:00:00+03:00'),
      ),
    ).toBe(2028);
  });

  it('never changes an explicit manual selection', () => {
    expect(
      resolveExamYear(
        2026,
        'manual',
        [event('yks-2027-tyt', '2027-06-19')],
        Date.parse('2026-07-15T12:00:00+03:00'),
      ),
    ).toBe(2026);
  });
});
