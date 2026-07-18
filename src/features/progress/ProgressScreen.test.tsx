/* eslint-disable import/first */

const mockPush = jest.fn();
const mockRemoveExam = jest.fn();
const mockFlashListProps = jest.fn();
let mockExams = [
  {
    id: 'older',
    date: 1_700_000_000_000,
    exam: 'tyt' as const,
    publisher: 'Older Exam',
    notes: '',
    sections: [{ sectionId: 'tyt-turkce', correct: 20, wrong: 10, blank: 10 }],
  },
  {
    id: 'newer',
    date: 1_710_000_000_000,
    exam: 'tyt' as const,
    publisher: 'Newer Exam',
    notes: '',
    sections: [{ sectionId: 'tyt-turkce', correct: 30, wrong: 5, blank: 5 }],
  },
];

jest.mock('@shopify/flash-list', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    FlashList: (props: {
      data: typeof mockExams;
      ListEmptyComponent?: React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      renderItem: (input: { item: (typeof mockExams)[number]; index: number }) => React.ReactNode;
    }) => {
      mockFlashListProps(props);
      return React.createElement(
        View,
        { testID: 'exam-history-list' },
        props.ListHeaderComponent,
        ...props.data.map((item, index) =>
          React.createElement(React.Fragment, { key: item.id }, props.renderItem({ item, index })),
        ),
        props.data.length ? null : props.ListEmptyComponent,
      );
    },
  };
});

jest.mock('react-native-gesture-handler', () => {
  const React = require('react') as typeof import('react');
  return {
    Swipeable: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

jest.mock('@/components/charts', () => ({ NetLineChart: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/providers/AppDataProvider', () => ({
  useAppData: () => ({ exams: mockExams, removeExam: mockRemoveExam }),
}));
jest.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: { targetNet: number }) => unknown) =>
    selector({ targetNet: 100 }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));
jest.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      background: '#fff',
      brand: '#00f',
      danger: '#f00',
      label: '#111',
      onBrand: '#fff',
      secondaryLabel: '#555',
      tertiaryLabel: '#777',
      success: '#0a0',
      successText: '#080',
      warning: '#fa0',
      warningText: '#a60',
      tyt: '#00f',
      ayt: '#f0f',
      ydt: '#0aa',
      surface: '#fff',
      separator: '#ddd',
    },
    dark: false,
    radii: { button: 12, card: 16 },
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

import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ProgressScreen from '../../../app/(tabs)/gelisim';

describe('ProgressScreen exam history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExams = [...mockExams];
    mockRemoveExam.mockResolvedValue(undefined);
  });

  it('passes the complete newest-first history to FlashList and preserves open/delete actions', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const view = await render(<ProgressScreen />);
    const props = mockFlashListProps.mock.lastCall?.[0] as { data: typeof mockExams };
    expect(props.data.map((exam) => exam.id)).toEqual(['newer', 'older']);

    const examButton = view
      .getAllByRole('button')
      .find((node) => node.props.accessibilityHint === 'progress.examA11yHint');
    expect(examButton).toBeTruthy();
    await fireEvent.press(examButton!);
    expect(mockPush).toHaveBeenCalledWith('/gelisim/deneme/newer');

    await fireEvent(examButton!, 'accessibilityAction', {
      nativeEvent: { actionName: 'delete' },
    });
    const actions = alert.mock.lastCall?.[2];
    const destructive = actions?.find((action) => action.style === 'destructive');
    destructive?.onPress?.();
    await waitFor(() => expect(mockRemoveExam).toHaveBeenCalledWith('newer'));
  });
});
