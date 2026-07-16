/* eslint-disable import/first */

jest.mock('@/data/content', () => ({
  newsPack: { items: [{ id: 'old' }] },
  reloadActiveContent: jest.fn(),
}));
jest.mock('@/data/packUpdater', () => ({ checkForPackUpdate: jest.fn() }));

import * as contentModule from '@/data/content';
import * as packUpdaterModule from '@/data/packUpdater';
import { readCachedNews, refreshNews } from './newsCache';

const mockNewsDocument = contentModule.newsPack as unknown as { items: { id: string }[] };
const mockReloadActiveContent = contentModule.reloadActiveContent as jest.Mock;
const mockCheckForPackUpdate = packUpdaterModule.checkForPackUpdate as jest.Mock;

describe('news cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNewsDocument.items = [{ id: 'old' }];
    mockReloadActiveContent.mockImplementation(async () => {
      mockNewsDocument.items = [{ id: 'new' }];
      return true;
    });
  });

  it('uses the validated active pack as the only offline cache', () => {
    expect(readCachedNews()).toEqual([{ id: 'old' }]);
  });

  it('refreshes through the atomic pack updater and exposes the activated news', async () => {
    mockCheckForPackUpdate.mockResolvedValue({ status: 'updated' });

    await expect(refreshNews()).resolves.toEqual([{ id: 'new' }]);
    expect(mockCheckForPackUpdate).toHaveBeenCalledWith({ force: true });
    expect(mockReloadActiveContent).toHaveBeenCalledTimes(1);
  });

  it('keeps the last good pack when the remote transaction fails', async () => {
    const error = new Error('network failed');
    mockCheckForPackUpdate.mockResolvedValue({ status: 'failed', error });

    await expect(refreshNews()).rejects.toThrow('network failed');
    expect(mockReloadActiveContent).not.toHaveBeenCalled();
    expect(readCachedNews()).toEqual([{ id: 'old' }]);
  });
});
