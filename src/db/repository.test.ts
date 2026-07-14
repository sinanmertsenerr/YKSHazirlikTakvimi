/* eslint-disable import/first */

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => {
    const transaction = { runAsync: jest.fn() };
    return {
      execSync: jest.fn(),
      runAsync: jest.fn(),
      withExclusiveTransactionAsync: jest.fn(
        async (operation: (value: typeof transaction) => Promise<void>) => operation(transaction),
      ),
      transaction,
    };
  }),
}));
jest.mock('drizzle-orm/expo-sqlite', () => ({
  drizzle: () => ({}),
}));

import { openDatabaseSync } from 'expo-sqlite';

import { setFavorite, upsertTopicProgress } from './repository';

const mockSqlite = (openDatabaseSync as jest.Mock).mock.results[0]?.value as {
  runAsync: jest.Mock;
  withExclusiveTransactionAsync: jest.Mock;
  transaction: { runAsync: jest.Mock };
};
const mockTransaction = mockSqlite.transaction;

describe('user-data write atomicity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.runAsync.mockResolvedValue({});
    mockSqlite.runAsync.mockResolvedValue({});
  });

  it('writes topic progress and its activity inside one exclusive transaction', async () => {
    await upsertTopicProgress('tyt-turkce:paragraf', 'done', 4);

    expect(mockSqlite.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    expect(mockTransaction.runAsync).toHaveBeenCalledTimes(2);
    expect(mockTransaction.runAsync.mock.calls[0]?.[0]).toContain('INSERT INTO topic_progress');
    expect(mockTransaction.runAsync.mock.calls[1]?.[0]).toContain('INSERT INTO activity_log');
  });

  it('removes the matching activity in the same transaction when progress is reset', async () => {
    await upsertTopicProgress('tyt-turkce:paragraf', 'none', null);

    expect(mockSqlite.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    expect(mockTransaction.runAsync.mock.calls[1]?.[0]).toContain('DELETE FROM activity_log');
  });

  it('allocates favorite order in the insert statement instead of a racy pre-read', async () => {
    await setFavorite('program-1', true);

    expect(mockSqlite.runAsync).toHaveBeenCalledTimes(1);
    expect(mockSqlite.runAsync.mock.calls[0]?.[0]).toContain('COALESCE(MAX(sort_order), -1) + 1');
  });
});
