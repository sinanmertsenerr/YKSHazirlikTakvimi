import type { Program } from '@/data/content';

// Web-fallback parity: Platform.OS === 'web' routes queryProgramPage through the
// in-memory fallbackPage, which must consume the SAME alias expansion as the SQL path.
// programsPack is hardcoded empty in production web builds today, so this fixture-backed
// mock is the only place the fallback's search semantics are actually exercised.
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));
jest.mock('expo-asset', () => ({ Asset: { fromModule: jest.fn() } }));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digest: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
jest.mock('expo-sqlite', () => ({
  defaultDatabaseDirectory: 'sqlite',
  openDatabaseAsync: jest.fn(),
}));
jest.mock('@/data/packUpdater', () => ({
  getActivePackLocation: jest.fn(),
  invalidateDownloadedPackVersion: jest.fn(),
}));

function makeProgram(overrides: Partial<Program> & { id: string }): Program {
  return {
    university: { tr: 'HACETTEPE ÜNİVERSİTESİ (ANKARA)', en: 'HACETTEPE UNIVERSITY' },
    name: {
      tr: 'Rehberlik ve Psikolojik Danışmanlık',
      en: 'Guidance and Psychological Counseling',
    },
    city: { tr: 'ANKARA', en: 'ANKARA' },
    type: 'devlet',
    scoreType: 'ea',
    scholarship: null,
    language: null,
    verified: true,
    verifiedAt: '2026-07-16T12:00:00.000Z',
    approximate: false,
    sample: false,
    source: 'https://yokatlas.yok.gov.tr/detay/1',
    years: [
      {
        year: 2025,
        quota: 60,
        placed: null,
        minScore: 400,
        minRank: 50_000,
        verified: true,
        verifiedAt: '2026-07-16T12:00:00.000Z',
        source: 'https://yokatlas.yok.gov.tr/detay/1',
        approximate: false,
        sample: false,
      },
    ],
    ...overrides,
  };
}

jest.mock('@/data/content', () => {
  const schemas = jest.requireActual<typeof import('../../scripts/lib/content-schemas')>(
    '../../scripts/lib/content-schemas',
  );
  return {
    programsPack: { programs: [] as unknown[] },
    programsPackSchema: schemas.programsFixtureSchema,
    reloadActiveContent: jest.fn(),
    useContentRevisionStore: Object.assign(
      (selector: (state: { revision: number }) => unknown) => selector({ revision: 0 }),
      { getState: () => ({ revision: 0 }) },
    ),
  };
});

describe('web fallback search parity with the SQL path', () => {
  beforeEach(() => {
    const content = jest.requireMock('@/data/content') as { programsPack: { programs: Program[] } };
    content.programsPack.programs = [
      makeProgram({ id: '1' }),
      makeProgram({
        id: '2',
        name: { tr: 'Bilgisayar Mühendisliği', en: 'Computer Engineering' },
      }),
    ];
  });

  it('finds programs through alias expansion on the web path', async () => {
    const { queryProgramPage } = require('./programRepository') as
      typeof import('./programRepository');
    const page = await queryProgramPage({ scoreType: 'ea', language: 'tr', search: 'pdr' });
    expect(page.programs.map((program) => program.id)).toEqual(['1']);
  });

  it('keeps the EN locale literal-only (aliases are TR-only)', async () => {
    const { queryProgramPage } = require('./programRepository') as
      typeof import('./programRepository');
    const page = await queryProgramPage({ scoreType: 'ea', language: 'en', search: 'pdr' });
    expect(page.programs).toEqual([]);
  });

  it('still matches literal substrings without an alias', async () => {
    const { queryProgramPage } = require('./programRepository') as
      typeof import('./programRepository');
    const page = await queryProgramPage({ scoreType: 'ea', language: 'tr', search: 'bilgisayar' });
    expect(page.programs.map((program) => program.id)).toEqual(['2']);
  });

  it('ranks by the most recent PUBLISHED rank, matching the SQL walk-back', async () => {
    const content = jest.requireMock('@/data/content') as { programsPack: { programs: Program[] } };
    const year = makeProgram({ id: 'template' }).years[0]!;
    content.programsPack.programs = [
      // Regression for the "3 of 4 BESYO programs sink past page 1" bug: a pending
      // current-year cutoff must fall back to the newest ranked year, not to the bottom.
      makeProgram({
        id: 'pending-2025',
        years: [
          { ...year, year: 2025, minScore: null, minRank: null },
          { ...year, year: 2024, minScore: 380, minRank: 30_000 },
        ],
      }),
      makeProgram({ id: 'ranked-2025', years: [{ ...year, year: 2025, minRank: 62_000 }] }),
      makeProgram({
        id: 'never-ranked',
        years: [{ ...year, year: 2025, minScore: null, minRank: null }],
      }),
    ];
    const { queryProgramPage } = require('./programRepository') as
      typeof import('./programRepository');
    const page = await queryProgramPage({ scoreType: 'ea', language: 'tr' });
    expect(page.programs.map((program) => program.id)).toEqual([
      'pending-2025',
      'ranked-2025',
      'never-ranked',
    ]);
  });
});
