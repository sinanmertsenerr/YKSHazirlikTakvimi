import {
  expandProgramSearch,
  MAX_ALIAS_EXPANSIONS,
  programSearchAliasEntries,
} from './searchAliases';

describe('program search alias expansion', () => {
  it('returns the literal normalized term first and always keeps it', () => {
    expect(expandProgramSearch('ODTÜ')[0]).toBe('odtu');
    expect(expandProgramSearch('  Tıp  ')).toEqual(['tıp']);
  });

  it('matches alias keys across Turkish and ASCII typings', () => {
    const expected = ['odtu', 'orta dogu teknik universitesi'];
    expect(expandProgramSearch('ODTÜ')).toEqual(expected);
    expect(expandProgramSearch('odtü')).toEqual(expected);
    expect(expandProgramSearch('ODTU')).toEqual(expected);
    // ASCII capital I folds to dotless ı in tr-TR; the alias-key fold still resolves
    // the entry while the literal term stays exactly as the user typed it.
    expect(expandProgramSearch('ITU')).toEqual(['ıtu', 'istanbul teknik universitesi']);
    expect(expandProgramSearch('İTÜ')).toEqual(['itu', 'istanbul teknik universitesi']);
  });

  it('keeps multi-word queries literal (v1 whole-query rule)', () => {
    expect(expandProgramSearch('odtü bilgisayar')).toEqual(['odtu bilgisayar']);
  });

  it('returns no patterns for blank input', () => {
    expect(expandProgramSearch('')).toEqual([]);
    expect(expandProgramSearch('   ')).toEqual([]);
  });

  it('bounds every entry to the expansion cap with non-empty patterns', () => {
    expect(programSearchAliasEntries().length).toBeGreaterThan(0);
    for (const [alias, phrases] of programSearchAliasEntries()) {
      expect(phrases.length).toBeGreaterThanOrEqual(1);
      expect(phrases.length).toBeLessThanOrEqual(MAX_ALIAS_EXPANSIONS);
      const expanded = expandProgramSearch(alias);
      expect(expanded.length).toBeLessThanOrEqual(1 + MAX_ALIAS_EXPANSIONS);
      for (const pattern of expanded) {
        expect(pattern.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
