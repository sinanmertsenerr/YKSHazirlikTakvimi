/**
 * Integration checks against the COMMITTED bundled pack (assets/pack/programs.db) —
 * the exact database EAS ships. Running the real query builders against it catches
 * two failure classes no string assertion can: (1) a committed pack that was not
 * regenerated after a schema change ("no such column" on every fresh install), and
 * (2) a materialized sort key whose order silently drifts from the legacy walk-back.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  latestPublishableRankSql,
  RANKLESS_SORT_SENTINEL,
} from '../../scripts/lib/program-sql';
import { buildLegacyProgramListQuery, buildProgramListQuery } from './programQueries';

// require (not static import): under jest-expo's Babel/CJS transform the experimental
// node:sqlite module does not resolve reliably via static import; the tsx-run scripts
// and node --test files use plain imports because they run on native Node ESM.
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const BUNDLED_DB_PATH = resolve(__dirname, '../../assets/pack/programs.db');

const describeWithDb = existsSync(BUNDLED_DB_PATH) ? describe : describe.skip;

describeWithDb('program list query against the committed bundled pack', () => {
  let database: InstanceType<typeof DatabaseSync>;

  beforeAll(() => {
    database = new DatabaseSync(BUNDLED_DB_PATH, { readOnly: true });
  });

  afterAll(() => {
    database.close();
  });

  function rows(query: { sql: string; parameters: (number | string)[] }): string[] {
    return (database.prepare(query.sql).all(...query.parameters) as { id: string }[]).map(
      (row) => row.id,
    );
  }

  it('serves the browse ORDER BY from ix_program_sort without a TEMP B-TREE', () => {
    const query = buildProgramListQuery({ scoreType: 'say', language: 'tr' }, 61, 0);
    const plan = database
      .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
      .all(...query.parameters) as { detail: string }[];

    const details = plan.map((row) => row.detail).join('\n');
    expect(details).toContain('ix_program_sort');
    expect(details).not.toContain('USE TEMP B-TREE FOR ORDER BY');
  });

  it.each([
    ['say', 0],
    ['say', 600],
    ['tyt', 0],
    ['ea', 120],
  ] as const)(
    'orders %s/offset=%d pages identically to the legacy walk-back query',
    (scoreType, offset) => {
      const filters = { scoreType, language: 'tr' as const };
      // Same page through both mechanisms: the materialized column (new) and the
      // correlated walk-back (legacy). Any divergence is a build-time parity bug.
      expect(rows(buildProgramListQuery(filters, 61, offset))).toEqual(
        rows(buildLegacyProgramListQuery(filters, 61, offset)),
      );
    },
  );

  it('stores a sort key that matches the publishable-year walk-back for every program', () => {
    const mismatches = database
      .prepare(
        `
      SELECT count(*) AS count FROM program p
      WHERE p.latest_min_rank_sort != COALESCE(
        (${latestPublishableRankSql('p.id')}
        ),
        ${RANKLESS_SORT_SENTINEL}
      )
    `,
      )
      .get() as { count: number };

    expect(mismatches.count).toBe(0);
  });
});
