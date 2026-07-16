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
    colors: {
      background: '#fff',
      brand: '#00f',
      danger: '#f00',
      label: '#111',
      onBrand: '#fff',
      surface: '#fff',
    },
    radii: { button: 12 },
    typography: { body: {}, headline: {} },
  }),
}));

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AppDataProvider, useAppData } from './AppDataProvider';

const emptySnapshot = { progress: [], exams: [], favorites: [], activities: [] };

function ReadyState() {
  const { ready } = useAppData();
  return <Text>{ready ? 'ready' : 'hydrating'}</Text>;
}

describe('AppDataProvider startup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps children visible while initial user data is still hydrating', async () => {
    let resolveLoad: (snapshot: typeof emptySnapshot) => void = () => undefined;
    mockLoadUserData.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const view = await render(
      <AppDataProvider>
        <Text>child-visible</Text>
        <ReadyState />
      </AppDataProvider>,
    );

    expect(view.getByText('child-visible')).toBeTruthy();
    expect(view.getByText('hydrating')).toBeTruthy();

    await act(async () => {
      resolveLoad(emptySnapshot);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText('ready')).toBeTruthy());
  });

  it('shows a non-blocking retry banner after an initial database read failure and recovers', async () => {
    mockLoadUserData
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(emptySnapshot);

    const view = await render(
      <AppDataProvider>
        <Text>child-ready</Text>
        <ReadyState />
      </AppDataProvider>,
    );

    expect(view.getByText('child-ready')).toBeTruthy();
    expect(view.getByText('hydrating')).toBeTruthy();
    expect(await view.findByText('common.dataLoadFailed')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'common.retry' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText('ready')).toBeTruthy());
    expect(view.queryByText('common.dataLoadFailed')).toBeNull();
    expect(mockLoadUserData).toHaveBeenCalledTimes(2);
  });
});
