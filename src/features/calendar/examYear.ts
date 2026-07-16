export type ExamYearMode = 'automatic' | 'manual';

export type ExamYearCalendarEvent = {
  id: string;
  start: string;
  type: string;
  verified: boolean;
  approximate?: boolean;
  sample?: boolean;
};

const ISTANBUL_TIME_ZONE = 'Europe/Istanbul';
const TYT_ID = /(?:^|-)tyt(?:-|$)/i;

function istanbulDateParts(now: number | Date): { year: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ISTANBUL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const year = Number(value('year'));
  return { year, date: `${value('year')}-${value('month')}-${value('day')}` };
}

function verifiedTytEvents(events: readonly ExamYearCalendarEvent[]) {
  return events
    .filter(
      (event) =>
        event.type === 'sinav' &&
        event.verified &&
        !event.approximate &&
        !event.sample &&
        TYT_ID.test(event.id) &&
        /^\d{4}-\d{2}-\d{2}$/.test(event.start),
    )
    .sort((left, right) => left.start.localeCompare(right.start));
}

/**
 * Resolves the target year from exact, verified TYT dates only. Once the latest verified TYT has
 * passed, the target advances by one year without inventing a future exam date.
 */
export function automaticExamYear(
  events: readonly ExamYearCalendarEvent[],
  now: number | Date = Date.now(),
): number {
  const today = istanbulDateParts(now);
  const verified = verifiedTytEvents(events);
  const next = verified.find((event) => event.start >= today.date);
  if (next) return Number(next.start.slice(0, 4));

  const latestPast = verified.at(-1);
  if (latestPast) {
    return Math.max(today.year, Number(latestPast.start.slice(0, 4)) + 1);
  }
  return today.year;
}

export function resolveExamYear(
  selectedYear: number,
  mode: ExamYearMode,
  events: readonly ExamYearCalendarEvent[],
  now: number | Date = Date.now(),
): number {
  return mode === 'manual' ? selectedYear : automaticExamYear(events, now);
}

export function currentIstanbulYear(now: number | Date = Date.now()): number {
  return istanbulDateParts(now).year;
}
