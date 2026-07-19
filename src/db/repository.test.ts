/* eslint-disable import/first */

const mockTransaction = { execAsync: jest.fn(), runAsync: jest.fn() };
const mockSqlite = {
  closeSync: jest.fn(),
  execSync: jest.fn(),
  getAllAsync: jest.fn(),
  getFirstSync: jest.fn(() => null),
  runAsync: jest.fn(),
  withExclusiveTransactionAsync: jest.fn(
    async (operation: (value: typeof mockTransaction) => Promise<void>) =>
      operation(mockTransaction),
  ),
  transaction: mockTransaction,
};
let mockDbResults: unknown[][] = [];
const mockDbQueries: {
  from: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
}[] = [];
const mockDb = {
  select: jest.fn(() => {
    const result = mockDbResults.shift() ?? [];
    const promise = Promise.resolve(result);
    const query = {
      from: jest.fn(),
      orderBy: jest.fn(),
      limit: jest.fn().mockResolvedValue(result),
      then: promise.then.bind(promise),
    };
    query.from.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    mockDbQueries.push(query);
    return query;
  }),
};

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => mockSqlite),
}));
jest.mock('drizzle-orm/expo-sqlite', () => ({
  drizzle: () => mockDb,
}));

import { openDatabaseSync } from 'expo-sqlite';

import {
  groupExamSectionsByExamId,
  loadAppData,
  removeExam,
  replaceUserData,
  setFavorite,
  upsertTopicProgress,
} from './repository';

describe('lazy user database initialization', () => {
  it('does not open SQLite merely by importing the repository module', () => {
    expect(openDatabaseSync).not.toHaveBeenCalled();
  });

  it('surfaces initialization errors through the first async repository operation', async () => {
    jest.resetModules();
    const failure = new Error('database unavailable');
    const sqlite = require('expo-sqlite') as { openDatabaseSync: jest.Mock };
    sqlite.openDatabaseSync.mockImplementationOnce(() => {
      throw failure;
    });

    let imported: typeof import('./repository') | undefined;
    expect(() => {
      imported = require('./repository') as typeof import('./repository');
    }).not.toThrow();
    await expect(imported!.loadUserData()).rejects.toBe(failure);
  });
});

describe('user-data write atomicity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbQueries.length = 0;
    mockDbResults = [];
    mockTransaction.execAsync.mockResolvedValue(undefined);
    mockTransaction.runAsync.mockResolvedValue({});
    mockSqlite.runAsync.mockResolvedValue({});
    // Post-mutation targeted slice re-reads (activity summary + latest activity).
    mockSqlite.getAllAsync.mockResolvedValue([]);
  });

  it('writes topic progress and its activity inside one exclusive transaction', async () => {
    const patch = await upsertTopicProgress('tyt-turkce:paragraf', 100);

    expect(mockSqlite.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    expect(mockTransaction.runAsync).toHaveBeenCalledTimes(2);
    expect(mockTransaction.runAsync.mock.calls[0]?.[0]).toContain('INSERT INTO topic_progress');
    expect(mockTransaction.runAsync.mock.calls[1]?.[0]).toContain('INSERT INTO activity_log');
    // The mutation returns the written record plus the re-read derived slices.
    expect(patch.record).toMatchObject({
      topicId: 'tyt-turkce:paragraf',
      percent: 100,
      status: 'done',
    });
    expect(patch.activityDays).toEqual([]);
    expect(patch.latestActivity).toBeNull();
  });

  it('removes the matching activity in the same transaction when progress is reset', async () => {
    await upsertTopicProgress('tyt-turkce:paragraf', 0);

    expect(mockSqlite.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    expect(mockTransaction.runAsync.mock.calls[1]?.[0]).toContain('DELETE FROM activity_log');
  });

  it('allocates favorite order in the insert statement instead of a racy pre-read', async () => {
    mockDbResults = [[{ programId: 'program-1' }]];

    const patch = await setFavorite('program-1', true);

    expect(mockSqlite.runAsync).toHaveBeenCalledTimes(1);
    expect(mockSqlite.runAsync.mock.calls[0]?.[0]).toContain('COALESCE(MAX(sort_order), -1) + 1');
    // The authoritative favorites order comes from the post-write re-read, not from a
    // client-side guess about where SQLite placed the row.
    expect(patch.favorites).toEqual(['program-1']);
  });

  it('returns the re-read exam and activity slices after a removal', async () => {
    const secondNewest = {
      id: 'progress:tyt:2026-07-18',
      day: '2026-07-18',
      type: 'progress',
      questions: 0,
      topicId: 'tyt',
      createdAt: 1_752_800_000_000,
    };
    // Pop order: loadExamsSlice (exam rows, net rows) then loadActivitySlices (latest).
    mockDbResults = [
      [{ id: 'exam-2', date: 2, exam: 'tyt', publisher: null, notes: null }],
      [],
      [secondNewest],
    ];
    mockSqlite.getAllAsync.mockResolvedValue([
      { day: '2026-07-18', questions: 0, topic_count: 1 },
    ]);

    const patch = await removeExam('exam-1');

    expect(mockTransaction.runAsync.mock.calls[0]?.[0]).toContain('DELETE FROM deneme');
    expect(patch.exams.map((exam) => exam.id)).toEqual(['exam-2']);
    // latestActivity comes straight from the ORDER BY created_at DESC LIMIT 1 re-read,
    // so deleting the newest activity falls back to the database's second-newest row.
    expect(patch.latestActivity).toEqual(secondNewest);
    expect(patch.activityDays).toEqual([{ day: '2026-07-18', questions: 0, topicCount: 1 }]);
  });

  it('replaces every table atomically and reinserts the snapshot in dependency order', async () => {
    await replaceUserData({
      progress: [{ topicId: 't1', status: 'done', confidence: null, percent: 100, updatedAt: 1 }],
      exams: [
        {
          id: 'exam-1',
          date: 5,
          exam: 'tyt',
          publisher: '',
          notes: '',
          sections: [{ sectionId: 'tyt-turkce', correct: 30, wrong: 5, blank: 5 }],
        },
      ],
      favorites: ['program-1'],
      activities: [
        { id: 'exam:exam-1', day: '2026-07-19', type: 'exam', questions: 35, topicId: null, createdAt: 9 },
      ],
    });

    expect(mockSqlite.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    expect(mockTransaction.execAsync.mock.calls[0]?.[0]).toContain('DELETE FROM activity_log');
    const inserted = mockTransaction.runAsync.mock.calls.map((call) => String(call[0]));
    expect(inserted[0]).toContain('INSERT INTO topic_progress');
    expect(inserted[1]).toContain('INSERT INTO deneme ');
    expect(inserted[2]).toContain('INSERT INTO deneme_net');
    expect(inserted[3]).toContain('INSERT INTO favorite_program');
    expect(inserted[4]).toContain('INSERT INTO activity_log');
  });
});

describe('loadUserData helpers', () => {
  it('groups deneme net rows in one pass without rescanning all rows for every exam', () => {
    const grouped = groupExamSectionsByExamId([
      { examId: 'exam-1', sectionId: 'tyt-turkce', correct: 30, wrong: 5, blank: 5 },
      { examId: 'exam-2', sectionId: 'ayt-matematik', correct: 25, wrong: 10, blank: 5 },
      { examId: 'exam-1', sectionId: 'tyt-matematik', correct: 28, wrong: 8, blank: 4 },
    ]);

    expect(grouped.get('exam-1')?.map((row) => row.sectionId)).toEqual([
      'tyt-turkce',
      'tyt-matematik',
    ]);
    expect(grouped.get('exam-2')?.map((row) => row.sectionId)).toEqual(['ayt-matematik']);
  });
});

describe('loadAppData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbQueries.length = 0;
    mockSqlite.getAllAsync.mockResolvedValue([]);
  });

  it('hydrates only the newest raw activity alongside the daily summaries', async () => {
    const latestActivity = {
      id: 'exam:exam-1',
      day: '2026-07-19',
      type: 'exam',
      questions: 90,
      topicId: null,
      createdAt: 1_752_921_000_000,
    };
    mockDbResults = [[], [], [], [], [latestActivity]];
    mockSqlite.getAllAsync.mockResolvedValue([]);

    const snapshot = await loadAppData();

    expect(snapshot.latestActivity).toEqual(latestActivity);
    expect(snapshot.activityDays).toEqual([]);
    expect(mockDbQueries).toHaveLength(5);
    expect(mockDbQueries[4]?.orderBy).toHaveBeenCalledTimes(1);
    expect(mockDbQueries[4]?.limit).toHaveBeenCalledWith(1);
  });

  it('returns null when no activity has been recorded', async () => {
    mockDbResults = [[], [], [], [], []];

    const snapshot = await loadAppData();

    expect(snapshot.latestActivity).toBeNull();
  });
});

describe('migrateUserDatabase', () => {
  function importWithDatabase(getFirstSync: jest.Mock) {
    jest.resetModules();
    const execSync = jest.fn();
    const sqlite = require('expo-sqlite') as { openDatabaseSync: jest.Mock };
    sqlite.openDatabaseSync.mockReturnValueOnce({
      execSync,
      getFirstSync,
      closeSync: jest.fn(),
      runAsync: jest.fn(),
      withExclusiveTransactionAsync: jest.fn(),
      transaction: { runAsync: jest.fn() },
    });
    const repository = require('./repository') as typeof import('./repository');
    repository.initializeUserDatabase();
    return execSync;
  }

  it('rebuilds a legacy deneme table whose CHECK excludes ydt', () => {
    const getFirstSync = jest.fn().mockReturnValueOnce({ user_version: 0 }).mockReturnValueOnce({
      sql: "CREATE TABLE deneme (id TEXT PRIMARY KEY, exam TEXT NOT NULL CHECK(exam IN ('tyt','ayt')))",
    });
    const execSync = importWithDatabase(getFirstSync);
    const statements = execSync.mock.calls.map((call) => String(call[0]));
    expect(statements.some((sql) => sql.includes('deneme_migrated'))).toBe(true);
    expect(statements.some((sql) => sql.includes('PRAGMA user_version = 2'))).toBe(true);
  });

  it('adds the percent column and backfills it from status', () => {
    const getFirstSync = jest
      .fn()
      .mockReturnValueOnce({ user_version: 1 })
      .mockReturnValueOnce({
        sql: "CREATE TABLE deneme (id TEXT PRIMARY KEY, exam TEXT NOT NULL CHECK(exam IN ('tyt','ayt','ydt')))",
      })
      .mockReturnValueOnce({
        sql: 'CREATE TABLE topic_progress (topic_id TEXT PRIMARY KEY, status TEXT, confidence INTEGER, updated_at INTEGER)',
      });
    const execSync = importWithDatabase(getFirstSync);
    const statements = execSync.mock.calls.map((call) => String(call[0]));
    expect(statements.some((sql) => sql.includes('ADD COLUMN percent'))).toBe(true);
    expect(statements.some((sql) => sql.includes('PRAGMA user_version = 2'))).toBe(true);
  });

  it('is a no-op once user_version is current', () => {
    const getFirstSync = jest.fn().mockReturnValueOnce({ user_version: 2 });
    const execSync = importWithDatabase(getFirstSync);
    const statements = execSync.mock.calls.map((call) => String(call[0]));
    expect(statements.some((sql) => sql.includes('deneme_migrated'))).toBe(false);
    expect(statements.some((sql) => sql.includes('ADD COLUMN percent'))).toBe(false);
  });

  it('creates an index for the startup activity ordering query', () => {
    const getFirstSync = jest.fn().mockReturnValueOnce({ user_version: 2 });
    const execSync = importWithDatabase(getFirstSync);
    const statements = execSync.mock.calls.map((call) => String(call[0]));

    expect(
      statements.some((sql) =>
        sql.includes('ix_activity_created_at ON activity_log(created_at DESC)'),
      ),
    ).toBe(true);
  });
});
