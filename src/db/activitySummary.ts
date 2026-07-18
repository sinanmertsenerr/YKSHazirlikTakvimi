import type { ActivityDaySummary } from './types';

export const ACTIVITY_DAY_SUMMARY_SQL = `
  SELECT
    day,
    SUM(CASE WHEN type = 'exam' THEN questions ELSE 0 END) AS questions,
    COUNT(DISTINCT CASE WHEN type = 'progress' THEN topic_id END) AS topic_count
  FROM activity_log
  GROUP BY day
  ORDER BY day DESC
`;

export type ActivityDaySummaryRow = {
  day: string;
  questions: number;
  topic_count: number;
};

export function mapActivityDaySummaries(rows: ActivityDaySummaryRow[]): ActivityDaySummary[] {
  return rows.map((row) => ({
    day: row.day,
    questions: row.questions,
    topicCount: row.topic_count,
  }));
}
