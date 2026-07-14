/* eslint-disable import/first */

const mockLoadUserData = jest.fn();

jest.mock('@/db/repository', () => ({
  loadUserData: (...args: unknown[]) => mockLoadUserData(...args),
  removeExam: jest.fn(),
  reorderFavorites: jest.fn(),
  replaceUserData: jest.fn(),
  setFavorite: jest.fn(),
  upsertExam: jest.fn(),
  upsertTopicProgress: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    colors: { background: '#fff', brand: '#00f', label: '#111', onBrand: '#fff' },
    radii: { button: 12 },
    typography: { body: {}, headline: {} },
  }),
}));

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AppDataProvider } from './AppDataProvider';

const emptySnapshot = { progress: [], exams: [], favorites: [], activities: [] };

describe('AppDataProvider startup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a retry state after an initial database read failure and recovers', async () => {
    mockLoadUserData
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(emptySnapshot);

    const view = await render(
      <AppDataProvider>
        <Text>child-ready</Text>
      </AppDataProvider>,
    );

    expect(await view.findByText('common.dataLoadFailed')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'common.retry' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText('child-ready')).toBeTruthy());
    expect(mockLoadUserData).toHaveBeenCalledTimes(2);
  });
});
