/* eslint-disable import/first */

const mockReloadActiveContent = jest.fn();
const mockCheckForPackUpdate = jest.fn();
const mockHideSplash = jest.fn();
const mockSettingsState = {
  examYear: 2026,
  examYearMode: 'automatic' as const,
  language: 'system' as const,
  notificationPrefs: {
    dailyEnabled: false,
    dateAlertsEnabled: false,
    hour: 19,
    minute: 0,
  },
  setAutomaticExamYear: jest.fn(),
  setNotificationPrefs: jest.fn(),
};

jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');
  function MockStack({ children }: { children: import('react').ReactNode }) {
    return React.createElement(View, { testID: 'root-stack' }, children);
  }
  function MockStackScreen() {
    return null;
  }
  MockStack.Screen = MockStackScreen;
  return { Stack: MockStack };
});
jest.mock('expo-splash-screen', () => ({
  hideAsync: (...args: unknown[]) => mockHideSplash(...args),
  preventAutoHideAsync: jest.fn(),
}));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('@/data/content', () => ({
  calendarPack: { events: [] },
  reloadActiveContent: (...args: unknown[]) => mockReloadActiveContent(...args),
  useContentRevisionStore: (selector: (state: { revision: number }) => unknown) =>
    selector({ revision: 0 }),
}));
jest.mock('@/data/packUpdater', () => ({
  checkForPackUpdate: (...args: unknown[]) => mockCheckForPackUpdate(...args),
}));
jest.mock('@/features/calendar/examYear', () => ({
  resolveExamYear: (year: number) => year,
}));
jest.mock('@/i18n', () => ({
  __esModule: true,
  default: { changeLanguage: jest.fn() },
  resolveLanguage: () => 'tr',
}));
jest.mock('@/providers/AppDataProvider', () => ({
  AppDataProvider: ({ children }: { children: import('react').ReactNode }) => children,
}));
jest.mock('@/services/notifications', () => ({
  installLocalNotificationHandler: jest.fn(),
  rescheduleLocalNotificationsIfAuthorized: jest.fn(async () => ({ permission: 'granted' })),
}));
jest.mock('@/stores/settings', () => ({
  useSettingsStore: Object.assign(
    (selector: (state: typeof mockSettingsState) => unknown) => selector(mockSettingsState),
    { getState: () => mockSettingsState },
  ),
}));
jest.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    colors: { background: '#fff', label: '#111', surface: '#fff' },
    dark: false,
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { act, render } from '@testing-library/react-native';
import { AppState } from 'react-native';

import RootLayout from '../../app/_layout';

describe('RootLayout startup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
    mockCheckForPackUpdate.mockResolvedValue({
      status: 'throttled',
      active: { source: 'bundled', version: '2026.07.3' },
      checkedAt: 1,
    });
  });

  it('renders bundled application content while downloaded content hydration is pending', async () => {
    let resolveContent: (loaded: boolean) => void = () => undefined;
    mockReloadActiveContent.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveContent = resolve;
      }),
    );

    const view = await render(<RootLayout />);

    expect(view.getByTestId('root-stack')).toBeTruthy();
    expect(mockReloadActiveContent).toHaveBeenCalledTimes(1);
    expect(mockHideSplash).toHaveBeenCalled();

    await act(async () => {
      resolveContent(false);
      await Promise.resolve();
    });
  });
});
