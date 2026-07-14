import {
  daysUntil,
  displayDatePattern,
  formatDateOnly,
  formatInstantDate,
  formatNumber,
  localizeEmbeddedDateTokens,
  parseDisplayDate,
  relativeTime,
  trSearch,
} from './format';

describe('format utilities', () => {
  it('formats Turkish numbers', () => {
    expect(formatNumber(1234.5, 'tr')).toBe('1.234,5');
  });

  it('formats date-only values with fixed dotted locale order and leading zeros', () => {
    expect(formatDateOnly('2026-02-06', 'tr')).toBe('06.02.2026');
    expect(formatDateOnly('2026-02-06', 'en')).toBe('02.06.2026');
    expect(formatDateOnly('2024-02-29', 'en-US')).toBe('02.29.2024');
    expect(() => formatDateOnly('2026-02-31', 'tr')).toThrow(RangeError);
  });

  it('formats instants as Europe/Istanbul dates with explicit midnight semantics', () => {
    const crossingInstant = '2026-02-05T21:30:00.000Z';
    expect(formatInstantDate(crossingInstant, 'tr')).toBe('06.02.2026');
    expect(formatInstantDate(crossingInstant, 'en')).toBe('02.06.2026');
    expect(formatInstantDate(new Date(crossingInstant), 'tr')).toBe('06.02.2026');
    expect(() => formatInstantDate('2026-02-06', 'tr')).toThrow(/explicit time-zone offset/);
  });

  it('round-trips only the exact localized dotted input format', () => {
    expect(parseDisplayDate('06.02.2026', 'tr')).toBe('2026-02-06');
    expect(parseDisplayDate('02.06.2026', 'en')).toBe('2026-02-06');
    expect(parseDisplayDate('29.02.2024', 'tr')).toBe('2024-02-29');
    expect(parseDisplayDate('29.02.2026', 'tr')).toBeNull();
    expect(parseDisplayDate('6.2.2026', 'tr')).toBeNull();
    expect(parseDisplayDate('06/02/2026', 'tr')).toBeNull();
    expect(displayDatePattern('tr')).toBe('DD.MM.YYYY');
    expect(displayDatePattern('en-US')).toBe('MM.DD.YYYY');
  });

  it('localizes only valid embedded official date tokens without changing source text', () => {
    const source = 'YKS duyurusu (01.07.2026), geçersiz (31.02.2026).';
    expect(localizeEmbeddedDateTokens(source, 'en')).toBe(
      'YKS duyurusu (07.01.2026), geçersiz (31.02.2026).',
    );
    expect(localizeEmbeddedDateTokens(source, 'tr')).toBe(source);
  });

  it('calculates remaining days without including today', () => {
    expect(daysUntil('2027-06-19', new Date('2026-07-14T12:00:00+03:00'))).toBe(340);
    expect(daysUntil('2026-07-14', new Date('2026-07-14T01:00:00+03:00'))).toBe(0);
  });

  it('handles Turkish dotted and dotless i', () => {
    expect(trSearch('İSTANBUL')).toBe('istanbul');
    expect(trSearch('IĞDIR')).toContain('ı');
  });

  it('formats relative time when Hermes lacks RelativeTimeFormat', () => {
    const original = Intl.RelativeTimeFormat;
    Object.defineProperty(Intl, 'RelativeTimeFormat', { configurable: true, value: undefined });
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-14T12:00:00Z').getTime());
    try {
      expect(relativeTime(new Date('2026-07-14T10:00:00Z').getTime(), 'tr')).toBe('2 saat önce');
      expect(relativeTime(new Date('2026-07-15T12:00:00Z').getTime(), 'en')).toBe('in 1 day');
    } finally {
      Object.defineProperty(Intl, 'RelativeTimeFormat', { configurable: true, value: original });
      jest.restoreAllMocks();
    }
  });
});
