export const lightColors = {
  brand: '#4F46E5',
  brandSoft: '#EEF0FF',
  tyt: '#0D9488',
  tytSoft: '#E6F5F3',
  tytText: '#07685F',
  ayt: '#7C3AED',
  aytSoft: '#F1EAFD',
  aytText: '#6630C7',
  success: '#16A34A',
  successText: '#0B7131',
  warning: '#D97706',
  warningText: '#985005',
  danger: '#DC2626',
  background: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceSecondary: '#F7F7FA',
  label: '#111113',
  secondaryLabel: '#6E6E73',
  tertiaryLabel: '#6E6E73',
  separator: 'rgba(60, 60, 67, 0.16)',
  glass: 'rgba(255, 255, 255, 0.68)',
  glassBorder: 'rgba(255, 255, 255, 0.82)',
  onBrand: '#FFFFFF',
  scrim: 'rgba(17, 17, 19, 0.45)',
} as const;

export const darkColors = {
  brand: '#818CF8',
  brandSoft: '#232448',
  tyt: '#2DD4BF',
  tytSoft: '#0E2A28',
  tytText: '#5EEAD4',
  ayt: '#A78BFA',
  aytSoft: '#26203B',
  aytText: '#C4B5FD',
  success: '#4ADE80',
  successText: '#86EFAC',
  warning: '#FBBF24',
  warningText: '#FCD34D',
  danger: '#F87171',
  background: '#000000',
  surface: '#1C1C1E',
  surfaceSecondary: '#2C2C2E',
  label: '#F2F2F7',
  secondaryLabel: '#A9A9B0',
  tertiaryLabel: '#A9A9B0',
  separator: 'rgba(84, 84, 88, 0.62)',
  glass: 'rgba(28, 28, 32, 0.68)',
  glassBorder: 'rgba(255, 255, 255, 0.16)',
  onBrand: '#FFFFFF',
  scrim: 'rgba(0, 0, 0, 0.65)',
} as const;

export type ThemeColors = {
  [Key in keyof typeof lightColors]: string;
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radii = { small: 8, button: 12, card: 16, hero: 20, sheet: 24, pill: 999 } as const;
export const typography = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '800' as const },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' as const },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: '600' as const },
} as const;
