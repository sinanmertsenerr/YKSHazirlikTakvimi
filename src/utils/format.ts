export function formatNumber(value: number, language = 'tr', maximumFractionDigits = 2) {
  return new Intl.NumberFormat(language === 'en' ? 'en-US' : 'tr-TR', {
    maximumFractionDigits,
    minimumFractionDigits: Number.isInteger(value) ? 0 : Math.min(1, maximumFractionDigits),
  }).format(value);
}

type DateParts = { year: number; month: number; day: number };

const DISPLAY_TIME_ZONE = 'Europe/Istanbul';

function displayLanguage(language: string): 'tr' | 'en' {
  return language.toLocaleLowerCase('en-US').startsWith('en') ? 'en' : 'tr';
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidDateParts({ year, month, day }: DateParts): boolean {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return Number.isInteger(day) && day >= 1 && day <= daysInMonth[month - 1]!;
}

function parseDateOnly(value: string): DateParts | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return isValidDateParts(parts) ? parts : null;
}

function formatDateParts(parts: DateParts, language: string): string {
  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return displayLanguage(language) === 'en' ? `${month}.${day}.${year}` : `${day}.${month}.${year}`;
}

/**
 * Formats a calendar date without constructing a Date, so YYYY-MM-DD never
 * moves to the previous or next day because of a device time zone.
 */
export function formatDateOnly(value: string, language = 'tr'): string {
  const parts = parseDateOnly(value);
  if (!parts) throw new RangeError(`Invalid YYYY-MM-DD calendar date: ${value}`);
  return formatDateParts(parts, language);
}

/**
 * Formats an absolute instant as its Europe/Istanbul calendar date. ISO string
 * inputs must contain an explicit Z/offset; date-only strings belong in
 * formatDateOnly instead.
 */
export function formatInstantDate(value: number | string | Date, language = 'tr'): string {
  if (typeof value === 'string' && !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new RangeError('ISO instant strings must include an explicit time-zone offset');
  }
  const instant = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(instant.valueOf())) throw new RangeError('Invalid date instant');

  const formattedParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(formattedParts.find((item) => item.type === type)?.value ?? Number.NaN);
  const parts = { year: part('year'), month: part('month'), day: part('day') };
  if (!isValidDateParts(parts)) throw new RangeError('Could not resolve instant calendar date');
  return formatDateParts(parts, language);
}

/** Parses the exact user-facing dotted format back into a date-only ISO value. */
export function parseDisplayDate(value: string, language = 'tr'): string | null {
  const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const english = displayLanguage(language) === 'en';
  const parts = {
    year: Number(match[3]),
    month: Number(english ? match[1] : match[2]),
    day: Number(english ? match[2] : match[1]),
  };
  if (!isValidDateParts(parts)) return null;
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function displayDatePattern(language = 'tr'): 'DD.MM.YYYY' | 'MM.DD.YYYY' {
  return displayLanguage(language) === 'en' ? 'MM.DD.YYYY' : 'DD.MM.YYYY';
}

/** Localizes valid date tokens embedded in immutable official source text at render time. */
export function localizeEmbeddedDateTokens(value: string, language = 'tr'): string {
  if (displayLanguage(language) !== 'en') return value;
  return value.replace(
    /\b(\d{2})\.(\d{2})\.(\d{4})\b/g,
    (token, day: string, month: string, year: string) => {
      const parts = { year: Number(year), month: Number(month), day: Number(day) };
      return isValidDateParts(parts) ? `${month}.${day}.${year}` : token;
    },
  );
}

export function daysUntil(date: string, now = new Date()) {
  const target = parseDateOnly(date);
  if (!target) throw new RangeError(`Invalid YYYY-MM-DD calendar date: ${date}`);
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(todayParts.find((item) => item.type === type)?.value ?? 0);
  const todayUtc = Date.UTC(part('year'), part('month') - 1, part('day'));
  const targetUtc = Date.UTC(target.year, target.month - 1, target.day);
  return Math.ceil((targetUtc - todayUtc) / 86_400_000);
}

export function relativeTime(timestamp: number, language = 'tr') {
  const deltaSeconds = Math.round((timestamp - Date.now()) / 1000);
  const unit =
    Math.abs(deltaSeconds) < 3600
      ? ('minute' as const)
      : Math.abs(deltaSeconds) < 86_400
        ? ('hour' as const)
        : ('day' as const);
  const divisor = unit === 'minute' ? 60 : unit === 'hour' ? 3600 : 86_400;
  const value = Math.round(deltaSeconds / divisor);

  // Some Hermes builds do not ship Intl.RelativeTimeFormat even though NumberFormat and
  // DateTimeFormat are available. Keep the news screen usable without an Intl polyfill.
  if (typeof Intl.RelativeTimeFormat === 'function') {
    return new Intl.RelativeTimeFormat(language === 'en' ? 'en' : 'tr', {
      numeric: 'auto',
    }).format(value, unit);
  }

  if (value === 0) return language === 'en' ? 'now' : 'şimdi';
  const absolute = Math.abs(value);
  const label =
    language === 'en'
      ? `${absolute} ${unit}${absolute === 1 ? '' : 's'}`
      : `${absolute} ${unit === 'minute' ? 'dakika' : unit === 'hour' ? 'saat' : 'gün'}`;
  if (language === 'en') return value < 0 ? `${label} ago` : `in ${label}`;
  return value < 0 ? `${label} önce` : `${label} içinde`;
}

export function trSearch(value: string) {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}
