import type { Program } from '@/data/content';
import { expandProgramSearch } from '@/features/programs/searchAliases';
import { trSearch } from '@/utils/format';

export type ProgramQueryLanguage = 'tr' | 'en';

export type ProgramListFilters = {
  scoreType: Program['scoreType'];
  language: ProgramQueryLanguage;
  search?: string;
  city?: string | null;
  instructionLanguage?: string | null;
  type?: Program['type'];
  scholarship?: NonNullable<Program['scholarship']>;
};

export type SqlQuery = {
  sql: string;
  parameters: (number | string)[];
};

const PROGRAM_COLUMNS = `
  p.id, p.university, p.university_en, p.name, p.name_en, p.city, p.city_en,
  p.type, p.score_type, p.scholarship, p.language, p.language_en, p.verified,
  p.source, p.verified_at, p.approximate, p.sample
`;

export const PUBLISHABLE_PROGRAM_PREDICATE = `
  p.verified = 1
  AND p.source IS NOT NULL
  AND length(trim(p.source)) > 0
  AND p.verified_at IS NOT NULL
  AND p.approximate = 0
  AND p.sample = 0
`;

export function publishableYearPredicate(alias: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Unsafe SQL alias');
  return `
    ${alias}.verified = 1
    AND ${alias}.source IS NOT NULL
    AND length(trim(${alias}.source)) > 0
    AND ${alias}.verified_at IS NOT NULL
    AND ${alias}.approximate = 0
    AND ${alias}.sample = 0
  `;
}

const PUBLISHABLE_YEAR_EXISTS = `EXISTS (
  SELECT 1
  FROM program_year py_exists
  WHERE py_exists.program_id = p.id
    AND ${publishableYearPredicate('py_exists')}
)`;

/** Mirrors trSearch for the Turkish characters used by YÖK Atlas labels. */
function normalizedSqlColumn(column: string): string {
  return `lower(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      ${column},
      'İ', 'i'), 'I', 'ı'), 'Ş', 's'), 'ş', 's'), 'Ğ', 'g'), 'ğ', 'g'),
      'Ç', 'c'), 'ç', 'c'), 'Ö', 'o'), 'ö', 'o'), 'Ü', 'u'), 'ü', 'u'),
      'Â', 'a'), 'â', 'a')
  )`;
}

/** Escapes LIKE metacharacters so user input is always treated as literal text. */
export function escapeProgramLike(value: string): string {
  return value.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_');
}

export function normalizeProgramSearch(value: string): string {
  return escapeProgramLike(trSearch(value));
}

function filterWhere(filters: ProgramListFilters): {
  clauses: string[];
  parameters: (number | string)[];
} {
  const clauses = [PUBLISHABLE_PROGRAM_PREDICATE, PUBLISHABLE_YEAR_EXISTS, 'p.score_type = ?'];
  const parameters: (number | string)[] = [filters.scoreType];

  if (filters.city) {
    clauses.push(`${filters.language === 'en' ? 'p.city_en' : 'p.city'} = ?`);
    parameters.push(filters.city);
  }
  if (filters.instructionLanguage) {
    clauses.push(`${filters.language === 'en' ? 'p.language_en' : 'p.language'} = ?`);
    parameters.push(filters.instructionLanguage);
  }
  if (filters.type) {
    clauses.push('p.type = ?');
    parameters.push(filters.type);
  }
  if (filters.scholarship) {
    clauses.push('p.scholarship = ?');
    parameters.push(filters.scholarship);
  }

  // Alias expansion is TR-only (the abbreviations expand to Turkish official names) and
  // returns the literal term first; every pattern goes through escapeProgramLike exactly
  // like direct user input. The OR group is parenthesized into ONE clause — the clauses
  // array is joined with AND, and an unparenthesized OR would let its branches bypass
  // every other predicate (including the publishability gates) via operator precedence.
  const rawSearch = filters.search ?? '';
  const patterns =
    filters.language === 'tr'
      ? expandProgramSearch(rawSearch)
      : [trSearch(rawSearch)].filter(Boolean);
  if (patterns.length) {
    const nameColumn = filters.language === 'en' ? 'p.name_en' : 'p.name';
    const universityColumn = filters.language === 'en' ? 'p.university_en' : 'p.university';
    const likeClause = `${normalizedSqlColumn(`${nameColumn} || ' ' || ${universityColumn}`)} LIKE '%' || ? || '%' ESCAPE '!'`;
    clauses.push(
      patterns.length === 1 ? likeClause : `(${patterns.map(() => likeClause).join(' OR ')})`,
    );
    parameters.push(...patterns.map(escapeProgramLike));
  }

  return { clauses, parameters };
}

function assertPage(limit: number, offset: number): void {
  // The repository requests one look-ahead row on top of its public 200-row maximum.
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 201) {
    throw new RangeError('Program SQL limit must be between 1 and 201');
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError('Program query offset must be a nonnegative integer');
  }
}

export function buildProgramListQuery(
  filters: ProgramListFilters,
  limit: number,
  offset: number,
): SqlQuery {
  assertPage(limit, offset);
  const where = filterWhere(filters);
  return {
    sql: `
      SELECT ${PROGRAM_COLUMNS}
      FROM program p
      WHERE ${where.clauses.join('\n        AND ')}
      -- latest_min_rank_sort is materialized at pack build time: the min_rank of the
      -- most recent publishable year WITH a published rank (pending years never sink a
      -- program), sentinel for rankless programs so they stay last. The plain-column
      -- key lets ix_program_sort serve the ORDER BY without a per-page TEMP B-TREE.
      ORDER BY p.latest_min_rank_sort, p.id
      LIMIT ? OFFSET ?
    `,
    parameters: [...where.parameters, limit, offset],
  };
}

/**
 * Pre-`latest_min_rank_sort` list query, verbatim. Kept as the runtime fallback for
 * downloaded packs built before the materialized sort column existed: the repository
 * retries with this shape when the new ORDER BY hits "no such column".
 */
export function buildLegacyProgramListQuery(
  filters: ProgramListFilters,
  limit: number,
  offset: number,
): SqlQuery {
  assertPage(limit, offset);
  const where = filterWhere(filters);
  return {
    sql: `
      SELECT ${PROGRAM_COLUMNS}
      FROM program p
      LEFT JOIN program_year latest
        ON latest.program_id = p.id
       AND latest.year = (
         SELECT max(py_latest.year)
         FROM program_year py_latest
         WHERE py_latest.program_id = p.id
           AND py_latest.min_rank IS NOT NULL
           AND ${publishableYearPredicate('py_latest')}
       )
      WHERE ${where.clauses.join('\n        AND ')}
      -- "latest" is the most recent publishable year WITH a published rank: a program
      -- whose current-year cutoff is still unannounced sorts by its newest ranked year
      -- instead of sinking below every ranked program; rankless programs stay last.
      ORDER BY latest.min_rank IS NULL, latest.min_rank, p.id
      LIMIT ? OFFSET ?
    `,
    parameters: [...where.parameters, limit, offset],
  };
}

export function buildFavoriteProgramIdsQuery(
  filters: ProgramListFilters,
  favoriteIds: readonly string[],
): SqlQuery {
  if (!favoriteIds.length) throw new RangeError('Favorite ID query cannot be empty');
  const where = filterWhere(filters);
  return {
    sql: `
      SELECT p.id
      FROM program p
      WHERE ${where.clauses.join('\n        AND ')}
        AND p.id IN (${favoriteIds.map(() => '?').join(', ')})
    `,
    parameters: [...where.parameters, ...favoriteIds],
  };
}

export function buildProgramsByIdsQuery(ids: readonly string[]): SqlQuery {
  if (!ids.length) throw new RangeError('Program ID query cannot be empty');
  return {
    sql: `
      SELECT ${PROGRAM_COLUMNS}
      FROM program p
      WHERE ${PUBLISHABLE_PROGRAM_PREDICATE}
        AND ${PUBLISHABLE_YEAR_EXISTS}
        AND p.id IN (${ids.map(() => '?').join(', ')})
    `,
    parameters: [...ids],
  };
}

export function buildProgramDetailQuery(id: string): SqlQuery {
  return {
    sql: `
      SELECT ${PROGRAM_COLUMNS}
      FROM program p
      WHERE ${PUBLISHABLE_PROGRAM_PREDICATE}
        AND ${PUBLISHABLE_YEAR_EXISTS}
        AND p.id = ?
      LIMIT 1
    `,
    parameters: [id],
  };
}

export function buildProgramYearsQuery(ids: readonly string[]): SqlQuery {
  if (!ids.length) throw new RangeError('Program year query cannot be empty');
  return {
    sql: `
      SELECT program_id, year, quota, placed, min_score, min_rank, verified, source,
             verified_at, approximate, sample
      FROM program_year py
      WHERE py.program_id IN (${ids.map(() => '?').join(', ')})
        AND ${publishableYearPredicate('py')}
      ORDER BY py.program_id, py.year DESC
    `,
    parameters: [...ids],
  };
}

// --- Program extras (official YÖK Atlas detail data) ---------------------------------
// The four extras queries are only ever run against packs built with the detail schema;
// the repository catches "no such table/column" for older packs and degrades to null.

export function buildProgramExtrasQuery(id: string): SqlQuery {
  return {
    sql: `
      SELECT p.faculty, p.district, p.education_type, p.duration_years, p.program_group,
             p.tuition, p.accreditation, p.accreditation_note, p.tyc, p.applied_education_model,
             p.min_rank_requirement, p.min_rank_requirement_note,
             p.staff_professor, p.staff_docent, p.staff_doctor_faculty, p.staff_lecturer,
             p.staff_research_assistant
      FROM program p
      WHERE ${PUBLISHABLE_PROGRAM_PREDICATE}
        AND p.id = ?
      LIMIT 1
    `,
    parameters: [id],
  };
}

export function buildProgramConditionsQuery(id: string): SqlQuery {
  return {
    sql: `
      SELECT pc.code AS code, ct.text AS text
      FROM program_condition pc
      LEFT JOIN condition_text ct ON ct.code = pc.code
      WHERE pc.program_id = ?
      ORDER BY pc.position
    `,
    parameters: [id],
  };
}

export function buildProgramQuotaCategoriesQuery(id: string): SqlQuery {
  return {
    sql: `
      SELECT year, category, quota, placed
      FROM program_quota_category
      WHERE program_id = ?
      ORDER BY year DESC, category
    `,
    parameters: [id],
  };
}

export function buildProgramNetsQuery(id: string): SqlQuery {
  return {
    sql: `
      SELECT year, score_type, coefficient, min_score, obp,
             tyt_turkce, tyt_sosyal, tyt_matematik, tyt_fen,
             ayt_matematik, ayt_fizik, ayt_kimya, ayt_biyoloji,
             ayt_edebiyat, ayt_tarih1, ayt_cografya1, ayt_tarih2, ayt_cografya2,
             ayt_felsefe, ayt_din, ydt_dil
      FROM program_net
      WHERE program_id = ?
      ORDER BY year DESC
    `,
    parameters: [id],
  };
}

export function buildProgramCitiesQuery(language: ProgramQueryLanguage): SqlQuery {
  const cityColumn = language === 'en' ? 'p.city_en' : 'p.city';
  return {
    sql: `
      SELECT DISTINCT ${cityColumn} AS city
      FROM program p
      WHERE ${PUBLISHABLE_PROGRAM_PREDICATE}
        AND ${PUBLISHABLE_YEAR_EXISTS}
      ORDER BY ${cityColumn} COLLATE NOCASE, ${cityColumn}
    `,
    parameters: [],
  };
}

export function buildProgramLanguagesQuery(language: ProgramQueryLanguage): SqlQuery {
  const languageColumn = language === 'en' ? 'p.language_en' : 'p.language';
  return {
    sql: `
      SELECT DISTINCT ${languageColumn} AS instruction_language
      FROM program p
      WHERE ${PUBLISHABLE_PROGRAM_PREDICATE}
        AND ${PUBLISHABLE_YEAR_EXISTS}
        AND ${languageColumn} IS NOT NULL
        AND length(trim(${languageColumn})) > 0
      ORDER BY ${languageColumn} COLLATE NOCASE, ${languageColumn}
    `,
    parameters: [],
  };
}

export function uniqueFavoriteIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => id.trim().length > 0))];
}

export function orderRecordsByIds<T extends { id: string }>(
  records: readonly T[],
  ids: readonly string[],
): T[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  return ids.flatMap((id) => {
    const record = byId.get(id);
    return record ? [record] : [];
  });
}
