import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import {
  activityLog,
  favoriteProgram,
  mockExam,
  mockExamNet,
  schema,
  topicProgress,
} from './schema';
import { countsAsProgressActivity, istanbulDay, percentToStatus } from './activity';
import type {
  ExamRecord,
  ExamSectionRecord,
  TopicProgressRecord,
  TopicStatus,
  UserDataSnapshot,
} from './types';

export { istanbulDay } from './activity';

/**
 * SQLite cannot ALTER a CHECK constraint in place, and `CREATE TABLE IF NOT EXISTS` never
 * re-runs on existing installs, so schema changes go through here. Every step guards itself on
 * the stored table SQL, so running from any prior version is safe.
 * - v1 rebuilds `deneme` so its exam CHECK admits 'ydt'.
 * - v2 adds the additive `percent` column to `topic_progress` (status is now derived from it)
 *   and backfills it from the existing status.
 */
const USER_DB_VERSION = 2;
function migrateUserDatabase(sqlite: SQLiteDatabase): void {
  const versionRow = sqlite.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  if ((versionRow?.user_version ?? 0) >= USER_DB_VERSION) return;
  const denemeTable = sqlite.getFirstSync<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='deneme'",
  );
  if (denemeTable && !denemeTable.sql.includes("'ydt'")) {
    sqlite.execSync(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE deneme_migrated (
        id TEXT PRIMARY KEY,
        date INTEGER NOT NULL,
        exam TEXT NOT NULL CHECK(exam IN ('tyt','ayt','ydt')),
        publisher TEXT,
        notes TEXT
      );
      INSERT INTO deneme_migrated SELECT id, date, exam, publisher, notes FROM deneme;
      DROP TABLE deneme;
      ALTER TABLE deneme_migrated RENAME TO deneme;
      COMMIT;
    `);
  }
  const progressTable = sqlite.getFirstSync<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='topic_progress'",
  );
  if (progressTable && !progressTable.sql.includes('percent')) {
    sqlite.execSync(`
      BEGIN;
      ALTER TABLE topic_progress
        ADD COLUMN percent INTEGER NOT NULL DEFAULT 0 CHECK(percent BETWEEN 0 AND 100);
      UPDATE topic_progress SET percent = CASE status
        WHEN 'done' THEN 100
        WHEN 'working' THEN 50
        ELSE 0
      END;
      COMMIT;
    `);
  } else if (progressTable) {
    // Repair pass for databases stranded by the pre-transactional version of this
    // migration: column added but backfill never ran (we only get here while
    // user_version < USER_DB_VERSION). status 'working'/'done' with percent 0 cannot
    // be produced by the percent-based writer, so the backfill is safe to re-apply.
    sqlite.execSync(`
      UPDATE topic_progress SET percent = CASE status
        WHEN 'done' THEN 100
        WHEN 'working' THEN 50
        ELSE 0
      END
      WHERE percent = 0 AND status != 'none';
    `);
  }
  sqlite.execSync(`PRAGMA user_version = ${USER_DB_VERSION};`);
}

function createUserRepository() {
  const sqlite = openDatabaseSync('yks-user.db');
  try {
    sqlite.execSync('PRAGMA journal_mode = WAL;');
    migrateUserDatabase(sqlite);
    sqlite.execSync(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS topic_progress (
        topic_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'none' CHECK(status IN ('none','working','done')),
        confidence INTEGER CHECK(confidence IS NULL OR confidence BETWEEN 1 AND 5),
        percent INTEGER NOT NULL DEFAULT 0 CHECK(percent BETWEEN 0 AND 100),
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deneme (
        id TEXT PRIMARY KEY,
        date INTEGER NOT NULL,
        exam TEXT NOT NULL CHECK(exam IN ('tyt','ayt','ydt')),
        publisher TEXT,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS deneme_net (
        deneme_id TEXT NOT NULL REFERENCES deneme(id) ON DELETE CASCADE,
        section_id TEXT NOT NULL,
        correct INTEGER NOT NULL CHECK(correct >= 0),
        wrong INTEGER NOT NULL CHECK(wrong >= 0),
        blank INTEGER NOT NULL CHECK(blank >= 0),
        PRIMARY KEY (deneme_id, section_id)
      );
      CREATE TABLE IF NOT EXISTS favorite_program (
        program_id TEXT PRIMARY KEY,
        sort_order INTEGER NOT NULL,
        added_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity_log (
        id TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('progress','exam')),
        questions INTEGER NOT NULL DEFAULT 0,
        topic_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_activity_day ON activity_log(day);
      CREATE INDEX IF NOT EXISTS ix_activity_created_at ON activity_log(created_at DESC);
    `);
    return { sqlite, db: drizzle(sqlite, { schema }) };
  } catch (error) {
    try {
      sqlite.closeSync();
    } catch {
      // The initialization error remains authoritative even if closing the failed handle also fails.
    }
    throw error;
  }
}

type UserRepository = ReturnType<typeof createUserRepository>;
let userRepository: UserRepository | null = null;

function getUserRepository(): UserRepository {
  if (!userRepository) userRepository = createUserRepository();
  return userRepository;
}

/** Explicit bootstrap hook; normal callers initialize lazily through their first operation. */
export function initializeUserDatabase(): void {
  getUserRepository();
}

export function groupExamSectionsByExamId(
  rows: (ExamSectionRecord & { examId: string })[],
): Map<string, (ExamSectionRecord & { examId: string })[]> {
  const grouped = new Map<string, (ExamSectionRecord & { examId: string })[]>();
  for (const row of rows) {
    const current = grouped.get(row.examId);
    if (current) current.push(row);
    else grouped.set(row.examId, [row]);
  }
  return grouped;
}

export async function loadUserData(): Promise<UserDataSnapshot> {
  const { db } = getUserRepository();
  const [progress, examRows, netRows, favoriteRows, activities] = await Promise.all([
    db.select().from(topicProgress),
    db.select().from(mockExam).orderBy(desc(mockExam.date)),
    db.select().from(mockExamNet),
    db.select().from(favoriteProgram).orderBy(asc(favoriteProgram.sortOrder)),
    db.select().from(activityLog).orderBy(desc(activityLog.createdAt)),
  ]);
  const sectionsByExamId = groupExamSectionsByExamId(netRows);
  const exams: ExamRecord[] = examRows.map((exam) => ({
    id: exam.id,
    date: exam.date,
    exam: exam.exam,
    publisher: exam.publisher ?? '',
    notes: exam.notes ?? '',
    sections: sectionsByExamId.get(exam.id) ?? [],
  }));
  return {
    progress,
    exams,
    favorites: favoriteRows.map((favorite) => favorite.programId),
    activities,
  };
}

export async function upsertTopicProgress(
  topicId: string,
  percent: number,
): Promise<TopicProgressRecord> {
  const { sqlite } = getUserRepository();
  const updatedAt = Date.now();
  const status = percentToStatus(percent);
  const record: TopicProgressRecord = { topicId, status, confidence: null, percent, updatedAt };
  const day = istanbulDay(updatedAt);
  const activityId = `progress:${topicId}:${day}`;
  await sqlite.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO topic_progress (topic_id, status, confidence, percent, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(topic_id) DO UPDATE SET status=excluded.status,
         confidence=excluded.confidence, percent=excluded.percent, updated_at=excluded.updated_at`,
      topicId,
      status,
      null,
      percent,
      updatedAt,
    );
    if (countsAsProgressActivity(status)) {
      await transaction.runAsync(
        `INSERT INTO activity_log (id, day, type, questions, topic_id, created_at)
         VALUES (?, ?, 'progress', 0, ?, ?)
         ON CONFLICT(id) DO UPDATE SET day=excluded.day, type=excluded.type,
           questions=excluded.questions, topic_id=excluded.topic_id, created_at=excluded.created_at`,
        activityId,
        day,
        topicId,
        updatedAt,
      );
    } else {
      await transaction.runAsync('DELETE FROM activity_log WHERE id = ?', activityId);
    }
  });
  return record;
}

export async function upsertExam(record: ExamRecord): Promise<void> {
  const { sqlite } = getUserRepository();
  const now = Date.now();
  await sqlite.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO deneme (id, date, exam, publisher, notes)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET date=excluded.date, exam=excluded.exam,
         publisher=excluded.publisher, notes=excluded.notes`,
      record.id,
      record.date,
      record.exam,
      record.publisher,
      record.notes,
    );
    await transaction.runAsync('DELETE FROM deneme_net WHERE deneme_id = ?', record.id);
    for (const section of record.sections) {
      await transaction.runAsync(
        `INSERT INTO deneme_net
          (deneme_id, section_id, correct, wrong, blank) VALUES (?, ?, ?, ?, ?)`,
        record.id,
        section.sectionId,
        section.correct,
        section.wrong,
        section.blank,
      );
    }
    const attempted = record.sections.reduce(
      (sum, section) => sum + section.correct + section.wrong,
      0,
    );
    const day = istanbulDay(record.date);
    await transaction.runAsync(
      `INSERT INTO activity_log (id, day, type, questions, topic_id, created_at)
       VALUES (?, ?, 'exam', ?, NULL, ?)
       ON CONFLICT(id) DO UPDATE SET day=excluded.day, questions=excluded.questions,
         created_at=excluded.created_at`,
      `exam:${record.id}`,
      day,
      attempted,
      now,
    );
  });
}

export async function removeExam(id: string): Promise<void> {
  const { sqlite } = getUserRepository();
  await sqlite.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync('DELETE FROM deneme WHERE id = ?', id);
    await transaction.runAsync('DELETE FROM activity_log WHERE id = ?', `exam:${id}`);
  });
}

export async function setFavorite(programId: string, favorite: boolean): Promise<void> {
  const { db, sqlite } = getUserRepository();
  if (!favorite) {
    await db.delete(favoriteProgram).where(eq(favoriteProgram.programId, programId));
    return;
  }
  // The subquery and insert are one SQLite statement, so concurrent taps cannot both reserve the
  // same order as they could with a separate count/read followed by an insert.
  await sqlite.runAsync(
    `INSERT INTO favorite_program (program_id, sort_order, added_at)
     SELECT ?, COALESCE(MAX(sort_order), -1) + 1, ? FROM favorite_program WHERE true
     ON CONFLICT(program_id) DO NOTHING`,
    programId,
    Date.now(),
  );
}

export async function reorderFavorites(ids: string[]): Promise<void> {
  const { sqlite } = getUserRepository();
  await sqlite.withExclusiveTransactionAsync(async (transaction) => {
    for (const [index, id] of ids.entries()) {
      await transaction.runAsync(
        'UPDATE favorite_program SET sort_order = ? WHERE program_id = ?',
        index,
        id,
      );
    }
  });
}

export async function replaceUserData(snapshot: UserDataSnapshot): Promise<void> {
  const { sqlite } = getUserRepository();
  await sqlite.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync(`
      DELETE FROM activity_log;
      DELETE FROM favorite_program;
      DELETE FROM deneme_net;
      DELETE FROM deneme;
      DELETE FROM topic_progress;
    `);
    for (const progress of snapshot.progress) {
      await transaction.runAsync(
        'INSERT INTO topic_progress (topic_id,status,confidence,percent,updated_at) VALUES (?,?,?,?,?)',
        progress.topicId,
        progress.status,
        progress.confidence,
        progress.percent,
        progress.updatedAt,
      );
    }
    for (const exam of snapshot.exams) {
      await transaction.runAsync(
        'INSERT INTO deneme (id,date,exam,publisher,notes) VALUES (?,?,?,?,?)',
        exam.id,
        exam.date,
        exam.exam,
        exam.publisher,
        exam.notes,
      );
      for (const section of exam.sections) {
        await transaction.runAsync(
          'INSERT INTO deneme_net (deneme_id,section_id,correct,wrong,blank) VALUES (?,?,?,?,?)',
          exam.id,
          section.sectionId,
          section.correct,
          section.wrong,
          section.blank,
        );
      }
    }
    for (const [index, id] of snapshot.favorites.entries()) {
      await transaction.runAsync(
        'INSERT INTO favorite_program (program_id,sort_order,added_at) VALUES (?,?,?)',
        id,
        index,
        Date.now(),
      );
    }
    for (const activity of snapshot.activities) {
      await transaction.runAsync(
        'INSERT INTO activity_log (id,day,type,questions,topic_id,created_at) VALUES (?,?,?,?,?,?)',
        activity.id,
        activity.day,
        activity.type,
        activity.questions,
        activity.topicId,
        activity.createdAt,
      );
    }
  });
}

export async function clearUserData() {
  await replaceUserData({ progress: [], exams: [], favorites: [], activities: [] });
}

export async function loadExamById(id: string): Promise<ExamRecord | null> {
  const { db } = getUserRepository();
  const rows = await db.select().from(mockExam).where(eq(mockExam.id, id)).limit(1);
  const exam = rows[0];
  if (!exam) return null;
  const sections = await db.select().from(mockExamNet).where(eq(mockExamNet.examId, id));
  return {
    id: exam.id,
    date: exam.date,
    exam: exam.exam,
    publisher: exam.publisher ?? '',
    notes: exam.notes ?? '',
    sections,
  };
}

export async function removeOrphanedFavorites(validProgramIds: string[]) {
  const { db } = getUserRepository();
  const favorites = await db.select().from(favoriteProgram);
  const orphaned = favorites
    .filter((favorite) => !validProgramIds.includes(favorite.programId))
    .map((favorite) => favorite.programId);
  if (orphaned.length) {
    await db.delete(favoriteProgram).where(inArray(favoriteProgram.programId, orphaned));
  }
}

export async function hasProgress(topicId: string, status: TopicStatus) {
  const { db } = getUserRepository();
  const result = await db
    .select({ topicId: topicProgress.topicId })
    .from(topicProgress)
    .where(and(eq(topicProgress.topicId, topicId), eq(topicProgress.status, status)))
    .limit(1);
  return result.length > 0;
}
