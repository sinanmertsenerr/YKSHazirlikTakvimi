/**
 * Single source for the publishable-year walk-back that materializes
 * `program.latest_min_rank_sort`. Three surfaces must agree bit-for-bit on this
 * business rule — the pack builder (backfill UPDATE), validate-pack (parity gate) and
 * the real-DB integration test — so they all render their SQL through this module
 * instead of keeping hand-synced copies. Guard-free on purpose: jest (Babel/CJS)
 * cannot import modules that use import.meta, which rules out build-programs.ts as
 * the shared home.
 */

/**
 * ORDER BY sentinel for programs with no publishable ranked year: real ÖSYM ranks stay
 * far below this value, so a plain ascending index walk puts rankless programs last —
 * the exact semantics of the legacy `latest.min_rank IS NULL, latest.min_rank` sort
 * without an expression the query planner cannot serve from an index.
 */
export const RANKLESS_SORT_SENTINEL = 99_999_999;

/**
 * Scalar subquery returning the min_rank of the most recent publishable year WITH a
 * published rank for the program row referenced by `programIdRef` (e.g. `program.id`
 * or `p.id`). Callers wrap it in COALESCE(..., RANKLESS_SORT_SENTINEL).
 */
export function latestPublishableRankSql(programIdRef: string): string {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/i.test(programIdRef)) {
    throw new Error('Unsafe SQL reference');
  }
  return `
      SELECT py.min_rank FROM program_year py
      WHERE py.program_id = ${programIdRef}
        AND py.min_rank IS NOT NULL
        AND py.verified = 1
        AND py.source IS NOT NULL
        AND length(trim(py.source)) > 0
        AND py.verified_at IS NOT NULL
        AND py.approximate = 0
        AND py.sample = 0
      ORDER BY py.year DESC
      LIMIT 1`;
}
