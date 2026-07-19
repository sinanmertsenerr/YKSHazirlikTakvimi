/* eslint-disable import/first */

/**
 * Closes the third leg of the sort parity triangle: the SQL-vs-SQL leg lives in
 * programQueries.integration.test.ts; this file runs the JS web-fallback ordering
 * (fallbackProgram + latestRankedMinRank, the exact functions fallbackPage sorts with)
 * against the SAME committed bundled pack and asserts it produces the identical first
 * page as the materialized-column SQL query.
 */

jest.mock('expo-sqlite', () => ({
  defaultDatabaseDirectory: 'sqlite',
  openDatabaseAsync: jest.fn(),
}));
jest.mock('expo-asset', () => ({ Asset: { fromModule: jest.fn() } }));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digest: jest.fn(),
}));
jest.mock('expo-file-system', () => ({ File: class MockFile {} }));
jest.mock('@/data/packUpdater', () => ({
  getActivePackLocation: jest.fn(),
  invalidateDownloadedPackVersion: jest.fn(),
}));
jest.mock('@/data/content', () => {
  const schemas = jest.requireActual<typeof import('../../scripts/lib/content-schemas')>(
    '../../scripts/lib/content-schemas',
  );
  return {
    programsPack: { programs: [] },
    programsPackSchema: schemas.programsFixtureSchema,
    reloadActiveContent: jest.fn(),
    useContentRevisionStore: Object.assign(() => 0, { getState: () => ({ revision: 0 }) }),
  };
});

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Program } from '@/data/content';

import { buildProgramListQuery } from './programQueries';
import { fallbackProgram, latestRankedMinRank } from './programRepository';

// See programQueries.integration.test.ts for why this is a require.
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const BUNDLED_DB_PATH = resolve(__dirname, '../../assets/pack/programs.db');

const describeWithDb = existsSync(BUNDLED_DB_PATH) ? describe : describe.skip;

type ProgramRow = {
  id: string;
  university: string;
  university_en: string;
  name: string;
  name_en: string;
  city: string | null;
  city_en: string | null;
  type: Program['type'];
  score_type: Program['scoreType'];
  scholarship: Program['scholarship'];
  language: string | null;
  language_en: string | null;
  verified: number;
  source: string | null;
  verified_at: string | null;
  approximate: number;
  sample: number;
};

type YearRow = {
  program_id: string;
  year: number;
  quota: number | null;
  placed: number | null;
  min_score: number | null;
  min_rank: number | null;
  verified: number;
  source: string | null;
  verified_at: string | null;
  approximate: number;
  sample: number;
};

describeWithDb('JS fallback ordering parity against the committed bundled pack', () => {
  it('orders the first browse page identically to the materialized-column SQL query', () => {
    const database = new DatabaseSync(BUNDLED_DB_PATH, { readOnly: true });
    try {
      const programRows = database
        .prepare(
          `SELECT id, university, university_en, name, name_en, city, city_en, type,
                  score_type, scholarship, language, language_en, verified, source,
                  verified_at, approximate, sample
           FROM program WHERE score_type = 'say'`,
        )
        .all() as ProgramRow[];
      const yearRows = database
        .prepare(
          `SELECT py.program_id, py.year, py.quota, py.placed, py.min_score, py.min_rank,
                  py.verified, py.source, py.verified_at, py.approximate, py.sample
           FROM program_year py
           JOIN program p ON p.id = py.program_id
           WHERE p.score_type = 'say'`,
        )
        .all() as YearRow[];

      const yearsByProgram = new Map<string, Program['years']>();
      for (const year of yearRows) {
        const list = yearsByProgram.get(year.program_id) ?? [];
        list.push({
          year: year.year,
          quota: year.quota,
          placed: year.placed,
          minScore: year.min_score,
          minRank: year.min_rank,
          verified: Boolean(year.verified),
          verifiedAt: year.verified_at,
          source: year.source,
          approximate: Boolean(year.approximate),
          sample: Boolean(year.sample),
        });
        yearsByProgram.set(year.program_id, list);
      }

      const programs: Program[] = programRows.map((row) => ({
        id: row.id,
        university: { tr: row.university, en: row.university_en },
        name: { tr: row.name, en: row.name_en },
        city:
          row.city === null && row.city_en === null
            ? null
            : { tr: row.city ?? '', en: row.city_en ?? '' },
        type: row.type,
        scoreType: row.score_type,
        scholarship: row.scholarship,
        language:
          row.language === null && row.language_en === null
            ? null
            : { tr: row.language ?? '', en: row.language_en ?? '' },
        verified: Boolean(row.verified),
        verifiedAt: row.verified_at,
        source: row.source,
        approximate: Boolean(row.approximate),
        sample: Boolean(row.sample),
        years: yearsByProgram.get(row.id) ?? [],
      }));

      // Exact fallbackPage semantics: publishability via fallbackProgram, then the
      // walk-back rank with the id tiebreaker.
      const jsOrder = programs
        .flatMap((program) => {
          const publishable = fallbackProgram(program);
          return publishable ? [publishable] : [];
        })
        .sort(
          (left, right) =>
            latestRankedMinRank(left) - latestRankedMinRank(right) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, 61)
        .map((program) => program.id);

      const query = buildProgramListQuery({ scoreType: 'say', language: 'tr' }, 61, 0);
      const sqlOrder = (database.prepare(query.sql).all(...query.parameters) as { id: string }[]).map(
        (row) => row.id,
      );

      expect(jsOrder).toEqual(sqlOrder);
    } finally {
      database.close();
    }
  });
});
