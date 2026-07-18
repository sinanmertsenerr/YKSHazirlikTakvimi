import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  ACTIVITY_DAY_SUMMARY_SQL,
  mapActivityDaySummaries,
  type ActivityDaySummaryRow,
} from '../../src/db/activitySummary.ts';

test('50,000 raw activities hydrate as one bounded summary row per active day', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(`
      CREATE TABLE activity_log (
        id TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        type TEXT NOT NULL,
        questions INTEGER NOT NULL,
        topic_id TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    const insert = database.prepare(
      'INSERT INTO activity_log (id,day,type,questions,topic_id,created_at) VALUES (?,?,?,?,?,?)',
    );
    database.exec('BEGIN');
    for (let index = 0; index < 50_000; index += 1) {
      const dayIndex = Math.floor(index / 250);
      const day = `2026-${String(Math.floor(dayIndex / 28) + 1).padStart(2, '0')}-${String(
        (dayIndex % 28) + 1,
      ).padStart(2, '0')}`;
      const progress = index % 2 === 0;
      insert.run(
        `activity-${index}`,
        day,
        progress ? 'progress' : 'exam',
        progress ? 0 : 10,
        progress ? `topic-${index % 50}` : null,
        index,
      );
    }
    database.exec('COMMIT');

    const rows = database.prepare(ACTIVITY_DAY_SUMMARY_SQL).all() as ActivityDaySummaryRow[];
    const summaries = mapActivityDaySummaries(rows);
    assert.equal(summaries.length, 200);
    assert.ok(summaries.every((summary) => summary.questions === 1_250));
    assert.ok(summaries.every((summary) => summary.topicCount === 25));
  } finally {
    database.close();
  }
});
