/* eslint-disable import/first */

const mockSaveExam = jest.fn();
const mockTheme = {
  colors: {
    background: '#fff',
    brand: '#00f',
    brandSoft: '#eef',
    danger: '#f00',
    label: '#111',
    onBrand: '#fff',
    secondaryLabel: '#555',
    separator: '#ddd',
    surface: '#fff',
    tertiaryLabel: '#777',
  },
  dark: false,
  radii: { button: 12, card: 16 },
  spacing: { sm: 8, md: 16, lg: 24 },
  typography: {
    body: {},
    caption: {},
    footnote: {},
    headline: {},
    largeTitle: {},
    subhead: {},
    title2: {},
  },
};

jest.mock('expo-crypto', () => ({ randomUUID: () => 'exam-id' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock('@/providers/AppDataProvider', () => ({
  useAppData: () => ({ saveExam: mockSaveExam }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      key === 'progress.sectionLimit' ? `D + Y + B, ${options?.count} soruyu aşamaz.` : key,
    i18n: { language: 'tr' },
  }),
}));
jest.mock('@/theme/useTheme', () => ({ useTheme: () => mockTheme }));

import { fireEvent, render } from '@testing-library/react-native';

import { ExamForm } from './ExamForm';

describe('ExamForm answer inputs', () => {
  it('allows empty fields and rejects totals above the section question count', async () => {
    const view = await render(<ExamForm />);
    const field = (key: 'correct' | 'wrong' | 'blank') => view.getByTestId(`tyt-turkce-${key}`);

    for (const key of ['correct', 'wrong', 'blank'] as const) {
      await fireEvent.changeText(field(key), '');
      expect(field(key)).toHaveProp('value', '');
    }

    await fireEvent.changeText(field('correct'), '40');
    await fireEvent.changeText(field('wrong'), '1');

    expect(field('correct')).toHaveProp('value', '40');
    expect(field('wrong')).toHaveProp('value', '');
    expect(view.getAllByText('D + Y + B, 40 soruyu aşamaz.')).toHaveLength(2);
  });
});
