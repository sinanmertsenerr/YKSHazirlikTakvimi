/* eslint-disable import/first */

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; code?: string }) =>
      options?.count !== undefined || options?.code !== undefined
        ? `${key}:${options.count ?? options.code}`
        : key,
  }),
}));

jest.mock('@/theme/useTheme', () => ({
  useTheme: () => ({
    colors: {
      brand: '#00f',
      brandSoft: '#dde',
      label: '#111',
      onBrand: '#fff',
      secondaryLabel: '#666',
      separator: '#ddd',
      surface: '#fff',
    },
    typography: { headline: {}, footnote: {}, caption: {} },
  }),
}));

jest.mock('@/components/ui', () => {
  const { Pressable, Text, View } = jest.requireActual(
    'react-native',
  ) as typeof import('react-native');
  return {
    Card: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Chip: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => (
      <Pressable onPress={onPress}>
        <Text>{children}</Text>
      </Pressable>
    ),
    Footnote: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    SectionTitle: ({
      children,
      action,
    }: {
      children: React.ReactNode;
      action?: React.ReactNode;
    }) => (
      <View>
        <Text>{children}</Text>
        {action}
      </View>
    ),
  };
});

import { fireEvent, render } from '@testing-library/react-native';

import type { ProgramExtras } from '@/db/programRepository';
import {
  ProgramConditionsCard,
  ProgramFactsCard,
  ProgramNetsCard,
  ProgramStaffCard,
  QuotaCategoriesCard,
} from '@/features/programs/ProgramExtrasCards';

const extras: ProgramExtras = {
  faculty: 'Mühendislik Fakültesi',
  district: 'SARIYER',
  educationType: 'Örgün Öğretim',
  durationYears: 4,
  programGroup: 'Bilgisayar Mühendisliği',
  tuition: 950000,
  accreditation: 'ABET',
  accreditationNote: 'Accreditation Board',
  tyc: true,
  appliedEducationModel: null,
  minRankRequirement: 300000,
  minRankRequirementNote: 'Başarı sırası şartı metni.',
  staff: { professor: 13, docent: 1, doctorFaculty: 7, lecturer: 0, researchAssistant: 13 },
  conditions: [
    { code: '17', text: 'Birinci koşul metni.' },
    { code: '343', text: null },
  ],
  quotaCategories: [
    { category: 'genel', year: 2025, quota: 80, placed: 80 },
    { category: 'okul-birincisi', year: 2025, quota: 2, placed: 2 },
  ],
  nets: [
    {
      year: 2025,
      scoreType: 'say',
      coefficient: 0.12,
      minScore: 533.05,
      obp: 473.96,
      nets: { tytTurkce: 37.5, aytMatematik: 38.75 },
    },
    {
      year: 2024,
      scoreType: 'say',
      coefficient: 0.12,
      minScore: 539.32,
      obp: 490.88,
      nets: { tytTurkce: 36 },
    },
  ],
};

describe('ProgramExtrasCards', () => {
  it('renders official facts rows including tuition and the rank requirement note', async () => {
    const screen = await render(<ProgramFactsCard extras={extras} language="tr" />);
    expect(screen.getByText('Mühendislik Fakültesi')).toBeTruthy();
    expect(screen.getByText('950.000 TL')).toBeTruthy();
    expect(screen.getByText('Başarı sırası şartı metni.')).toBeTruthy();
  });

  it('renders the quota-category table with a full-occupancy chip', async () => {
    const screen = await render(<QuotaCategoriesCard extras={extras} language="tr" />);
    expect(screen.getByText('preference.quotaCategoryGenel')).toBeTruthy();
    expect(screen.getByText('preference.quotaCategoryOkulBirincisi')).toBeTruthy();
    expect(screen.getByText('preference.occupancyFull')).toBeTruthy();
  });

  it('switches nets between years and lists only the published subjects', async () => {
    const screen = await render(<ProgramNetsCard extras={extras} language="tr" />);
    expect(screen.getByText('preference.netAytMatematik')).toBeTruthy();
    await fireEvent.press(screen.getByText('2024'));
    expect(screen.queryByText('preference.netAytMatematik')).toBeNull();
    expect(screen.getByText('preference.netTytTurkce')).toBeTruthy();
  });

  it('renders condition texts and an honest placeholder for text-less codes', async () => {
    const screen = await render(<ProgramConditionsCard extras={extras} />);
    expect(screen.getByText('Birinci koşul metni.')).toBeTruthy();
    expect(screen.getByText('preference.conditionCode:343')).toBeTruthy();
    expect(screen.getByText('preference.conditionTextUnavailable')).toBeTruthy();
  });

  it('renders staff headcounts and hides cards without data', async () => {
    const screen = await render(<ProgramStaffCard extras={extras} language="tr" />);
    expect(screen.getByText('preference.staffProfessor')).toBeTruthy();

    const empty: ProgramExtras = {
      ...extras,
      staff: null,
      conditions: [],
      quotaCategories: [],
      nets: [],
    };
    expect((await render(<ProgramStaffCard extras={empty} language="tr" />)).toJSON()).toBeNull();
    expect((await render(<ProgramConditionsCard extras={empty} />)).toJSON()).toBeNull();
    expect((await render(<QuotaCategoriesCard extras={empty} language="tr" />)).toJSON()).toBeNull();
    expect((await render(<ProgramNetsCard extras={empty} language="tr" />)).toJSON()).toBeNull();
  });
});
