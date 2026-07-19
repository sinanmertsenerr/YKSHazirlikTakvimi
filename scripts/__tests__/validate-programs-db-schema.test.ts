import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { RANKLESS_SORT_SENTINEL } from '../build-programs.ts';
import { emptyReport, validateProgramsDatabase } from '../validate-pack.ts';

const BUNDLED_DB_PATH = resolve(import.meta.dirname, '../../assets/pack/programs.db');

function withMutatedCopy(mutate: (database: DatabaseSync) => void): string[] {
  const directory = mkdtempSync(join(tmpdir(), 'yks-validate-db-'));
  const path = join(directory, 'programs.db');
  copyFileSync(BUNDLED_DB_PATH, path);
  try {
    const database = new DatabaseSync(path);
    try {
      mutate(database);
    } finally {
      database.close();
    }
    const report = emptyReport();
    validateProgramsDatabase(path, report);
    return report.errors;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('validate-pack fails a pack whose program table lost latest_min_rank_sort', {
  skip: !existsSync(BUNDLED_DB_PATH),
}, () => {
  const errors = withMutatedCopy((database) => {
    // Recreate the table without the column (CREATE..AS drops constraints too — fine,
    // the validator only needs the column set to differ from the required list).
    database.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE program_stripped AS
        SELECT id, university, university_en, name, name_en, city, city_en, type,
               score_type, scholarship, language, language_en, faculty, district,
               education_type, duration_years, program_group, tuition, accreditation,
               accreditation_note, tyc, applied_education_model, min_rank_requirement,
               min_rank_requirement_note, staff_professor, staff_docent,
               staff_doctor_faculty, staff_lecturer, staff_research_assistant,
               verified, source, verified_at, approximate, sample
        FROM program;
      DROP TABLE program;
      ALTER TABLE program_stripped RENAME TO program;
      COMMIT;
    `);
  });

  assert.ok(
    errors.some((error) => error.includes('missing column latest_min_rank_sort')),
    `expected a missing-column error, got: ${errors.join(' | ')}`,
  );
});

test('validate-pack fails a pack whose sort key disagrees with the walk-back', {
  skip: !existsSync(BUNDLED_DB_PATH),
}, () => {
  const errors = withMutatedCopy((database) => {
    database.exec(`
      UPDATE program SET latest_min_rank_sort = 1
      WHERE id = (SELECT id FROM program WHERE latest_min_rank_sort = ${RANKLESS_SORT_SENTINEL} LIMIT 1);
    `);
  });

  assert.ok(
    errors.some((error) => error.includes('disagrees with the publishable-year walk-back')),
    `expected a walk-back parity error, got: ${errors.join(' | ')}`,
  );
});
