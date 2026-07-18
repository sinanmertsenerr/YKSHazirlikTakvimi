/* eslint-disable import/first */

const mockLoadAppData = jest.fn();
const mockLoadUserData = jest.fn();

jest.mock('@/db/repository', () => ({
  loadAppData: (...args: unknown[]) => mockLoadAppData(...args),
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
import { Pressable, Text } from 'react-native';

import { AppDataProvider, useAppData } from './AppDataProvider';

const emptySnapshot = { progress: [], exams: [], favorites: [], activityDays: [] };
const emptyFullSnapshot = { progress: [], exams: [], favorites: [], activities: [] };

function ReadyState() {
  const { ready } = useAppData();
  return <Text>{ready ? 'ready' : 'hydrating'}</Text>;
}

function FullSnapshotReader() {
  const { readFullSnapshot } = useAppData();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void readFullSnapshot();
      }}
    >
      <Text>read-full</Text>
    </Pressable>
  );
}

describe('AppDataProvider startup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps children visible while initial user data is still hydrating', async () => {
    let resolveLoad: (snapshot: typeof emptySnapshot) => void = () => undefined;
    mockLoadAppData.mockReturnValueOnce(
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
    mockLoadAppData
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
    expect(mockLoadAppData).toHaveBeenCalledTimes(2);
  });

  it('loads complete raw history only when an explicit full snapshot is requested', async () => {
    mockLoadAppData.mockResolvedValueOnce(emptySnapshot);
    mockLoadUserData.mockResolvedValueOnce(emptyFullSnapshot);
    const view = await render(
      <AppDataProvider>
        <ReadyState />
        <FullSnapshotReader />
      </AppDataProvider>,
    );
    await view.findByText('ready');
    expect(mockLoadUserData).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(view.getByRole('button'));
      await Promise.resolve();
    });
    await waitFor(() => expect(mockLoadUserData).toHaveBeenCalledTimes(1));
  });
});
