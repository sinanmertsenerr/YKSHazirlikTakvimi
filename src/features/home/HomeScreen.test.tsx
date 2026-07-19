/* eslint-disable import/first */

const mockPush = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-linear-gradient', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    LinearGradient: ({ children, ...props }: React.ComponentProps<typeof View>) => (
      <View {...props}>{children}</View>
    ),
  };
});
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@/data/content', () => ({
  allSubjects: () => [],
  calendarPack: { events: [] },
  useContentRevisionStore: (selector: (state: { revision: number }) => unknown) =>
    selector({ revision: 0 }),
}));
jest.mock('@/db/repository', () => ({ istanbulDay: () => '2026-07-19' }));
jest.mock('@/providers/AppDataProvider', () => ({
  useAppData: () => ({
    activityDays: [],
    exams: [],
    latestActivity: null,
    progress: [],
  }),
}));
jest.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: { examYear: number }) => unknown) =>
    selector({ examYear: 2027 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'tr' },
  }),
}));
jest.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      ayt: '#70f',
      aytSoft: '#f0e',
      aytText: '#507',
      background: '#fff',
      brand: '#00f',
      brandSoft: '#eef',
      danger: '#f00',
      label: '#111',
      onBrand: '#fff',
      secondaryLabel: '#555',
      surface: '#fff',
      tertiaryLabel: '#777',
      tyt: '#0a8',
      tytSoft: '#eec',
      tytText: '#075',
      warningText: '#950',
      ydt: '#08c',
      ydtSoft: '#def',
      ydtText: '#057',
    },
    dark: false,
    radii: { button: 12, card: 16, hero: 20 },
    typography: {
      body: {},
      caption: {},
      footnote: {},
      headline: {},
      largeTitle: {},
      subhead: {},
      title2: {},
    },
  }),
}));

import { fireEvent, render } from '@testing-library/react-native';

import HomeScreen from '../../../app/(tabs)';

describe('HomeScreen recent activity strip replacement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the recent activity entry point without the removed stat labels', async () => {
    const view = await render(<HomeScreen />);

    expect(view.getByText('home.recentActivity')).toBeTruthy();
    expect(view.getByText('home.noRecentActivity')).toBeTruthy();
    expect(view.queryByText('home.todayQuestions')).toBeNull();
    expect(view.queryByText('home.topicsStudied')).toBeNull();
    expect(view.queryByText('home.lastTyt')).toBeNull();
    expect(view.getAllByText('home.firstExam')).toHaveLength(2);

    const recentActivityButton = view
      .getAllByRole('button')
      .find((node) => String(node.props.accessibilityLabel).includes('home.noRecentActivity'));
    expect(recentActivityButton).toBeTruthy();
    fireEvent.press(recentActivityButton!);
    expect(mockPush).toHaveBeenCalledWith('/konular');
  });
});
