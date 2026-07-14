export function calculateStreak(activityDays: string[], today: string) {
  const unique = [...new Set(activityDays)].sort().reverse();
  if (!unique.length) return 0;
  const toUtc = (value: string) => {
    const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  const oneDay = 86_400_000;
  const newestDelta = Math.round((toUtc(today) - toUtc(unique[0] ?? today)) / oneDay);
  if (newestDelta > 1 || newestDelta < 0) return 0;
  let streak = 1;
  for (let index = 1; index < unique.length; index += 1) {
    const previous = unique[index - 1];
    const current = unique[index];
    if (!previous || !current || toUtc(previous) - toUtc(current) !== oneDay) break;
    streak += 1;
  }
  return streak;
}
