import {
  buildFavoriteProgramIdsQuery,
  buildLegacyProgramListQuery,
  buildProgramCitiesQuery,
  buildProgramLanguagesQuery,
  buildProgramListQuery,
  normalizeProgramSearch,
  orderRecordsByIds,
  publishableYearPredicate,
  uniqueFavoriteIds,
} from './programQueries';

describe('program SQLite query construction', () => {
  it('keeps every truth predicate in SQL and binds all user-controlled filters', () => {
    const query = buildProgramListQuery(
      {
        scoreType: 'ea',
        language: 'tr',
        city: 'ANKARA',
        instructionLanguage: 'İngilizce',
        type: 'vakif',
        scholarship: '%50',
        search: 'İŞ_%!',
      },
      61,
      120,
    );

    expect(query.sql).toContain('p.verified = 1');
    expect(query.sql).toContain('p.approximate = 0');
    expect(query.sql).toContain('p.sample = 0');
    expect(query.sql).toContain('py_exists.verified = 1');
    expect(query.sql).toContain('p.score_type = ?');
    expect(query.sql).toContain('p.city = ?');
    expect(query.sql).toContain('p.language = ?');
    expect(query.sql).toContain('p.type = ?');
    expect(query.sql).toContain('p.scholarship = ?');
    expect(query.sql).toContain("p.name || ' ' || p.university");
    expect(query.sql).not.toContain('ANKARA');
    expect(query.sql).not.toContain('İŞ_%!');
    expect(query.parameters).toEqual([
      'ea',
      'ANKARA',
      'İngilizce',
      'vakif',
      '%50',
      'is!_!%!!',
      61,
      120,
    ]);
  });

  it('normalizes Turkish search and escapes LIKE wildcards as literals', () => {
    expect(normalizeProgramSearch('  ÜNİVERSİTE_%!  ')).toBe('universite!_!%!!');
    expect(normalizeProgramSearch('KÂĞIT')).toBe('kagıt');
  });

  it('expands a Turkish abbreviation into one parenthesized OR group with bound parameters', () => {
    const query = buildProgramListQuery(
      { scoreType: 'say', language: 'tr', search: 'ODTÜ' },
      60,
      0,
    );

    // The OR group must stay one self-parenthesized AND-term: unparenthesized, SQL
    // operator precedence would let the second branch bypass the publishability and
    // score-type predicates entirely.
    expect(query.sql).toMatch(/\(\s*lower\([\s\S]+?ESCAPE '!' OR [\s\S]+?ESCAPE '!'\s*\)/);
    expect(query.parameters).toEqual(['say', 'odtu', 'orta dogu teknik universitesi', 60, 0]);
  });

  it('applies the same alias expansion to favorites-scoped search', () => {
    const query = buildFavoriteProgramIdsQuery(
      { scoreType: 'ea', language: 'tr', search: 'pdr' },
      ['3001'],
    );

    expect(query.parameters).toEqual(['ea', 'pdr', 'rehberlik ve psikolojik danısmanlık', '3001']);
  });

  it('keeps the EN search path single-pattern (aliases are TR-only)', () => {
    const query = buildProgramListQuery(
      { scoreType: 'say', language: 'en', search: 'ODTÜ' },
      60,
      0,
    );

    expect((query.sql.match(/LIKE/g) ?? []).length).toBe(1);
    expect(query.parameters).toEqual(['say', 'odtu', 60, 0]);
  });

  it('escapes LIKE metacharacters in every expanded pattern', () => {
    const query = buildProgramListQuery(
      { scoreType: 'say', language: 'tr', search: 'YBS_%' },
      60,
      0,
    );

    // Not an alias (suffix breaks the whole-query match) → single escaped literal.
    expect(query.parameters).toEqual(['say', 'ybs!_!%', 60, 0]);
  });

  it('orders by the materialized sort key with the id tiebreaker and no join', () => {
    const query = buildProgramListQuery({ scoreType: 'ea', language: 'tr' }, 60, 0);

    // The build-time column encodes the walk-back (newest publishable ranked year,
    // sentinel when none) as a plain column so ix_program_sort serves the ORDER BY.
    expect(query.sql).toContain('ORDER BY p.latest_min_rank_sort, p.id');
    expect(query.sql).not.toContain('LEFT JOIN');
  });

  it('keeps the legacy walk-back query verbatim for packs without the sort column', () => {
    const query = buildLegacyProgramListQuery({ scoreType: 'ea', language: 'tr' }, 60, 0);

    // The walk-back predicate is what keeps a program whose current-year cutoff is not
    // yet announced sorted by its newest ranked year instead of below every ranked row.
    expect(query.sql).toContain('py_latest.min_rank IS NOT NULL');
    expect(query.sql).toContain('ORDER BY latest.min_rank IS NULL, latest.min_rank, p.id');
    // Same filters, same bound parameters — only the ORDER BY mechanism differs.
    expect(query.parameters).toEqual(buildProgramListQuery({ scoreType: 'ea', language: 'tr' }, 60, 0).parameters);
  });

  it('uses only the selected locale column for city facets', () => {
    expect(buildProgramCitiesQuery('tr').sql).toContain('p.city AS city');
    expect(buildProgramCitiesQuery('en').sql).toContain('p.city_en AS city');
    expect(buildProgramLanguagesQuery('tr').sql).toContain('p.language AS instruction_language');
    expect(buildProgramLanguagesQuery('en').sql).toContain('p.language_en AS instruction_language');
  });

  it('chunks favorite IDs through bound parameters without changing filter semantics', () => {
    const query = buildFavoriteProgramIdsQuery(
      { scoreType: 'soz', language: 'tr', type: 'kibris' },
      ['3001', '3002'],
    );

    expect(query.sql).toContain('p.type = ?');
    expect(query.sql).toContain('p.id IN (?, ?)');
    expect(query.parameters).toEqual(['soz', 'kibris', '3001', '3002']);
  });

  it('preserves the stored favorite order and removes duplicate/blank IDs', () => {
    const ids = uniqueFavoriteIds(['c', 'a', 'c', '', 'b']);
    const ordered = orderRecordsByIds(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      ids,
    );

    expect(ids).toEqual(['c', 'a', 'b']);
    expect(ordered.map((record) => record.id)).toEqual(['c', 'a', 'b']);
  });

  it('rejects unsafe aliases and unbounded pages', () => {
    expect(() => publishableYearPredicate('py; DROP TABLE program')).toThrow('Unsafe SQL alias');
    expect(() => buildProgramListQuery({ scoreType: 'say', language: 'tr' }, 202, 0)).toThrow(
      'Program SQL limit',
    );
    expect(() => buildProgramListQuery({ scoreType: 'say', language: 'tr' }, 60, -1)).toThrow(
      'Program query offset',
    );
  });
});
