import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { ACTIVITY_DAY_SUMMARY_SQL } from '../../src/db/activitySummary.ts';

/**
 * Real-engine proof for the derived activity slices the partial-update design re-reads
 * after every write (see repository.ts loadActivitySlices): COUNT DISTINCT per day,
 * delete-on-reset falling back to the second-newest activity, and day moves on exam
 * edits — the exact semantics a client-side JS merge cannot reproduce.
 */

const LATEST_ACTIVITY_SQL = 'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 1';

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE activity_log (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('progress','exam')),
      questions INTEGER NOT NULL DEFAULT 0,
      topic_id TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return database;
}

function insert(
  database: DatabaseSync,
  row: { id: string; day: string; type: 'progress' | 'exam'; questions?: number; topicId?: string | null; createdAt: number },
): void {
  database
    .prepare(
      `INSERT INTO activity_log (id, day, type, questions, topic_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET day=excluded.day, questions=excluded.questions,
         topic_id=excluded.topic_id, created_at=excluded.created_at`,
    )
    .run(row.id, row.day, row.type, row.questions ?? 0, row.topicId ?? null, row.createdAt);
}

test('day summary counts DISTINCT topics, so re-touching a topic never double-counts', () => {
  const database = createDatabase();
  insert(database, { id: 'progress:t1:2026-07-19', day: '2026-07-19', type: 'progress', topicId: 't1', createdAt: 1 });
  // Same topic, same day, later touch — upserts onto the same id in the repository flow.
  insert(database, { id: 'progress:t1:2026-07-19', day: '2026-07-19', type: 'progress', topicId: 't1', createdAt: 2 });
  insert(database, { id: 'progress:t2:2026-07-19', day: '2026-07-19', type: 'progress', topicId: 't2', createdAt: 3 });
  insert(database, { id: 'exam:e1', day: '2026-07-19', type: 'exam', questions: 90, createdAt: 4 });

  const rows = (database.prepare(ACTIVITY_DAY_SUMMARY_SQL).all() as {
    day: string;
    questions: number;
    topic_count: number;
  }[]).map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ day: '2026-07-19', questions: 90, topic_count: 2 }]);
  database.close();
});

test('deleting the newest activity makes the latest-activity query fall back to the second-newest', () => {
  const database = createDatabase();
  insert(database, { id: 'progress:t1:2026-07-18', day: '2026-07-18', type: 'progress', topicId: 't1', createdAt: 10 });
  insert(database, { id: 'exam:e1', day: '2026-07-19', type: 'exam', questions: 80, createdAt: 20 });

  database.prepare('DELETE FROM activity_log WHERE id = ?').run('exam:e1');

  const latest = database.prepare(LATEST_ACTIVITY_SQL).get() as { id: string };
  assert.equal(latest.id, 'progress:t1:2026-07-18');
  database.close();
});

test('re-dating an exam moves its single activity row to the new day', () => {
  const database = createDatabase();
  insert(database, { id: 'exam:e1', day: '2026-07-18', type: 'exam', questions: 70, createdAt: 10 });
  // The repository upserts onto the same `exam:<id>` key when the exam is edited.
  insert(database, { id: 'exam:e1', day: '2026-07-19', type: 'exam', questions: 75, createdAt: 20 });

  const rows = (database.prepare(ACTIVITY_DAY_SUMMARY_SQL).all() as {
    day: string;
    questions: number;
    topic_count: number;
  }[]).map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ day: '2026-07-19', questions: 75, topic_count: 0 }]);
  database.close();
});
