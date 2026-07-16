import type { Program } from '@/data/content';

export type ProgramFilters = {
  type: 'all' | Program['type'];
  scholarship: 'all' | NonNullable<Program['scholarship']>;
  city: string | null;
  instructionLanguage: string | null;
  favoritesOnly: boolean;
};

export const defaultProgramFilters: ProgramFilters = {
  type: 'all',
  scholarship: 'all',
  city: null,
  instructionLanguage: null,
  favoritesOnly: false,
};
