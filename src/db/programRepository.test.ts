/* eslint-disable import/first */

jest.mock('expo-sqlite', () => ({
  defaultDatabaseDirectory: 'sqlite',
  openDatabaseAsync: jest.fn(),
}));

jest.mock('expo-asset', () => ({
  Asset: { fromModule: jest.fn() },
}));

jest.mock('expo-file-system', () => ({
  File: jest.fn(),
}));

jest.mock('@/data/packUpdater', () => ({
  getActivePackLocation: jest.fn(),
  invalidateDownloadedPackVersion: jest.fn(),
}));

jest.mock('@/data/content', () => {
  const schemas = jest.requireActual<typeof import('../../scripts/lib/content-schemas')>(
    '../../scripts/lib/content-schemas',
  );
  return {
    programsPack: { programs: [] },
    programsPackSchema: schemas.programsFixtureSchema,
    reloadActiveContent: jest.fn(),
  };
});

import { openDatabaseAsync } from 'expo-sqlite';

import { reloadActiveContent } from '@/data/content';
import { getActivePackLocation, invalidateDownloadedPackVersion } from '@/data/packUpdater';

import { queryProgramPage } from './programRepository';

const downloadedLocation = (version: string) => ({
  source: 'downloaded' as const,
  version,
  directory: { uri: `downloaded/${version}` },
  manifest: { files: { programs: { path: 'programs.db' } } },
});

describe('program database runtime recovery', () => {
  it('invalidates a corrupt downloaded database and retries once with the rollback pack', async () => {
    const closeCorrupt = jest.fn(async () => undefined);
    const corruptDatabase = {
      getFirstAsync: jest.fn(async () => ({ quick_check: 'database disk image is malformed' })),
      getAllAsync: jest.fn(async () => []),
      closeAsync: closeCorrupt,
    };
    const rollbackDatabase = {
      getFirstAsync: jest.fn(async (sql: string) =>
        sql.startsWith('PRAGMA') ? { quick_check: 'ok' } : { value: '2' },
      ),
      getAllAsync: jest.fn(async () => []),
      closeAsync: jest.fn(async () => undefined),
    };
    jest
      .mocked(openDatabaseAsync)
      .mockResolvedValueOnce(corruptDatabase as never)
      .mockResolvedValueOnce(rollbackDatabase as never);
    jest
      .mocked(getActivePackLocation)
      .mockResolvedValueOnce(downloadedLocation('2026.07.2') as never)
      .mockResolvedValueOnce(downloadedLocation('2026.07.1') as never);
    jest.mocked(invalidateDownloadedPackVersion).mockResolvedValue(undefined);
    jest.mocked(reloadActiveContent).mockResolvedValue(true);

    await expect(
      queryProgramPage({ scoreType: 'say', language: 'tr', limit: 10, offset: 0 }),
    ).resolves.toEqual({ programs: [], hasMore: false });

    expect(invalidateDownloadedPackVersion).toHaveBeenCalledWith('2026.07.2');
    expect(reloadActiveContent).toHaveBeenCalledTimes(1);
    expect(openDatabaseAsync).toHaveBeenCalledTimes(2);
    expect(closeCorrupt).toHaveBeenCalledTimes(1);
    expect(rollbackDatabase.getAllAsync).toHaveBeenCalledTimes(1);
  });
});
