/* eslint-disable import/first */

const mockPush = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      if (key === 'common.completedPercent') return `%${values?.percent} completed`;
      if (key === 'home.examActivity') return `${values?.exam} mock exam`;
      if (key === 'common.net') return 'net';
      return key;
    },
  }),
}));
jest.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      brand: '#00f',
      brandSoft: '#eef',
      label: '#111',
      secondaryLabel: '#555',
      tertiaryLabel: '#777',
      surface: '#fff',
    },
    radii: { button: 12, card: 16 },
    typography: { caption: {}, footnote: {}, headline: {} },
  }),
}));

import { fireEvent, render } from '@testing-library/react-native';

import { RecentActivityCard } from './RecentActivityCard';
import type { RecentActivity } from './recentActivity';

describe('RecentActivityCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens the resolved topic and exposes its current progress', async () => {
    const activity: RecentActivity = {
      kind: 'topic',
      createdAt: Date.now(),
      subject: {
        id: 'tyt-matematik',
        name: { tr: 'Matematik', en: 'Mathematics' },
        topics: [],
      },
      topic: { id: 'problemler', name: { tr: 'Problemler', en: 'Word Problems' } },
      progress: {
        topicId: 'tyt-matematik:problemler',
        status: 'working',
        confidence: null,
        percent: 60,
        updatedAt: Date.now(),
      },
    };
    const view = await render(<RecentActivityCard activity={activity} language="en" />);

    expect(view.getByText('Word Problems')).toBeTruthy();
    expect(view.getByText('Mathematics · %60 completed')).toBeTruthy();
    fireEvent.press(view.getByRole('button'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/konular/konu/[konuId]',
      params: { konuId: 'problemler', dersId: 'tyt-matematik' },
    });
  });

  it('opens the resolved exam while preserving publisher and net details', async () => {
    const activity: RecentActivity = {
      kind: 'exam',
      createdAt: Date.now(),
      exam: {
        id: 'exam-1',
        date: Date.now(),
        exam: 'tyt',
        publisher: 'Örnek Yayınları',
        notes: '',
        sections: [{ sectionId: 'tyt-turkce', correct: 30, wrong: 6, blank: 4 }],
      },
    };
    const view = await render(<RecentActivityCard activity={activity} language="en" />);

    expect(view.getByText('Örnek Yayınları')).toBeTruthy();
    expect(view.getByText(/TYT mock exam ·/)).toBeTruthy();
    fireEvent.press(view.getByRole('button'));
    expect(mockPush).toHaveBeenCalledWith('/gelisim/deneme/exam-1');
  });

  it('uses the empty state as an actionable route to topics', async () => {
    const view = await render(<RecentActivityCard activity={{ kind: 'empty' }} language="tr" />);

    expect(view.getByText('home.noRecentActivity')).toBeTruthy();
    fireEvent.press(view.getByRole('button'));
    expect(mockPush).toHaveBeenCalledWith('/konular');
  });

  it('keeps unresolved restored activity non-interactive', async () => {
    const view = await render(
      <RecentActivityCard activity={{ kind: 'unresolved', createdAt: Date.now() }} language="tr" />,
    );

    expect(view.getByText('home.activityUnavailable')).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
  });
});
