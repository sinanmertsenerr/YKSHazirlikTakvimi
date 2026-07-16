/* eslint-disable import/first */

const mockTransaction = { runAsync: jest.fn() };
const mockSqlite = {
  closeSync: jest.fn(),
  execSync: jest.fn(),
  getFirstSync: jest.fn(() => null),
  runAsync: jest.fn(),
  withExclusiveTransactionAsync: jest.fn(
    async (operation: (value: typeof mockTransaction) => Promise<void>) =>
      operation(mockTransaction),
  ),
  transaction: mockTransaction,
};

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => mockSqlite),
}));
jest.mock('drizzle-orm/expo-sqlite', () => ({
  drizzle: () => ({}),
}));

import { openDatabaseSync } from 'expo-sqlite';

import { groupExamSectionsByExamId, setFavorite, upsertTopicProgress } from './repository';

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
    mockTransaction.runAsync.mockResolvedValue({});
    mockSqlite.runAsync.mockResolvedValue({});
  });

  it('writes topic progress and its activity inside one exclusive transaction', async () => {
    await upsertTopicProgress('tyt-turkce:paragraf', 100);

    expect(mockSqlite.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    expect(mockTransaction.runAsync).toHaveBeenCalledTimes(2);
    expect(mockTransaction.runAsync.mock.calls[0]?.[0]).toContain('INSERT INTO topic_progress');
    expect(mockTransaction.runAsync.mock.calls[1]?.[0]).toContain('INSERT INTO activity_log');
  });

  it('removes the matching activity in the same transaction when progress is reset', async () => {
    await upsertTopicProgress('tyt-turkce:paragraf', 0);

    expect(mockSqlite.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    expect(mockTransaction.runAsync.mock.calls[1]?.[0]).toContain('DELETE FROM activity_log');
  });

  it('allocates favorite order in the insert statement instead of a racy pre-read', async () => {
    await setFavorite('program-1', true);

    expect(mockSqlite.runAsync).toHaveBeenCalledTimes(1);
    expect(mockSqlite.runAsync.mock.calls[0]?.[0]).toContain('COALESCE(MAX(sort_order), -1) + 1');
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
