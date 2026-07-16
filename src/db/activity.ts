import type { TopicStatus } from './types';

export function istanbulDay(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function countsAsProgressActivity(status: TopicStatus): boolean {
  return status === 'working' || status === 'done';
}

// Status is derived from the single 0–100 percent: 100 = done, any progress = working, 0 = none.
export function percentToStatus(percent: number): TopicStatus {
  if (percent >= 100) return 'done';
  if (percent > 0) return 'working';
  return 'none';
}
