import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { programsFixtureSchema, type ProgramsFixture } from './lib/content-schemas.ts';

const projectRoot = resolve(process.cwd());

export type BuildProgramsOptions = {
  inputPath?: string;
  outputPath?: string;
};

async function readFixture(inputPath: string): Promise<ProgramsFixture> {
  const raw = JSON.parse(await readFile(inputPath, 'utf8')) as unknown;
  const parsed = programsFixtureSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid programs fixture (${inputPath}):\n${details}`);
  }
  return parsed.data;
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = DELETE;
    CREATE TABLE pack_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE program (
      id TEXT PRIMARY KEY,
      university TEXT NOT NULL,
      university_en TEXT NOT NULL,
      name TEXT NOT NULL,
      name_en TEXT NOT NULL,
      city TEXT NOT NULL,
      city_en TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('devlet', 'vakif', 'kibris')),
      score_type TEXT NOT NULL CHECK (score_type IN ('say', 'ea', 'soz', 'tyt', 'dil', 'yetenek')),
      scholarship TEXT CHECK (scholarship IS NULL OR scholarship IN ('burslu', '%25', '%50', 'ucretli')),
      language TEXT,
      language_en TEXT,
      verified INTEGER NOT NULL CHECK (verified IN (0, 1)),
      source TEXT,
      verified_at TEXT CHECK (verified_at IS NULL OR datetime(verified_at) IS NOT NULL),
      approximate INTEGER NOT NULL CHECK (approximate IN (0, 1)),
      sample INTEGER NOT NULL CHECK (sample IN (0, 1)),
      CHECK (
        (verified = 1 AND source IS NOT NULL AND length(trim(source)) > 0 AND verified_at IS NOT NULL)
        OR (verified = 0 AND verified_at IS NULL)
      )
    ) STRICT;
    CREATE TABLE program_year (
      program_id TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
      year INTEGER NOT NULL CHECK (year >= 2018),
      quota INTEGER CHECK (quota IS NULL OR quota >= 0),
      placed INTEGER CHECK (placed IS NULL OR placed >= 0),
      min_score REAL CHECK (min_score IS NULL OR min_score > 0),
      min_rank INTEGER CHECK (min_rank IS NULL OR min_rank > 0),
      verified INTEGER NOT NULL CHECK (verified IN (0, 1)),
      source TEXT,
      verified_at TEXT CHECK (verified_at IS NULL OR datetime(verified_at) IS NOT NULL),
      approximate INTEGER NOT NULL CHECK (approximate IN (0, 1)),
      sample INTEGER NOT NULL CHECK (sample IN (0, 1)),
      CHECK (
        (verified = 1 AND source IS NOT NULL AND length(trim(source)) > 0 AND verified_at IS NOT NULL)
        OR (verified = 0 AND verified_at IS NULL)
      ),
      CHECK (quota IS NULL OR placed IS NULL OR placed <= quota),
      PRIMARY KEY (program_id, year)
    ) STRICT;
    CREATE INDEX ix_program_year_rank ON program_year(year, min_rank);
    CREATE INDEX ix_program_score_type ON program(score_type);
    CREATE INDEX ix_program_city ON program(city);
    CREATE INDEX ix_program_name ON program(name);
  `);
}

function populate(database: DatabaseSync, fixture: ProgramsFixture): void {
  const insertMetadata = database.prepare('INSERT INTO pack_metadata(key, value) VALUES (?, ?)');
  const insertProgram = database.prepare(`
    INSERT INTO program(
      id, university, university_en, name, name_en, city, city_en, type, score_type,
      scholarship, language, language_en, verified, source, verified_at, approximate, sample
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertYear = database.prepare(`
    INSERT INTO program_year(
      program_id, year, quota, placed, min_score, min_rank, verified, source, verified_at,
      approximate, sample
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  database.exec('BEGIN IMMEDIATE');
  try {
    insertMetadata.run('schemaVersion', String(fixture.schemaVersion));
    insertMetadata.run('verified', String(fixture.dataStatus.verified));
    insertMetadata.run('approximate', String(fixture.dataStatus.approximate));
    insertMetadata.run('sample', String(fixture.dataStatus.sample));
    insertMetadata.run('source', fixture.dataStatus.source ?? '');
    insertMetadata.run('verifiedAt', fixture.programs[0]?.verifiedAt ?? '');

    for (const program of fixture.programs) {
      insertProgram.run(
        program.id,
        program.university.tr,
        program.university.en,
        program.name.tr,
        program.name.en,
        program.city.tr,
        program.city.en,
        program.type,
        program.scoreType,
        program.scholarship,
        program.language?.tr ?? null,
        program.language?.en ?? null,
        Number(program.verified),
        program.source,
        program.verifiedAt,
        Number(program.approximate),
        Number(program.sample),
      );

      for (const year of program.years) {
        insertYear.run(
          program.id,
          year.year,
          year.quota,
          year.placed,
          year.minScore,
          year.minRank,
          Number(year.verified),
          year.source,
          year.verifiedAt,
          Number(year.approximate),
          Number(year.sample),
        );
      }
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  database.exec('PRAGMA optimize');
}

export async function buildPrograms(options: BuildProgramsOptions = {}): Promise<string> {
  const inputPath = resolve(
    options.inputPath ?? resolve(projectRoot, 'content/programs.fixture.json'),
  );
  const outputPath = resolve(options.outputPath ?? resolve(projectRoot, 'content/programs.db'));
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  const fixture = await readFixture(inputPath);

  await mkdir(dirname(outputPath), { recursive: true });
  await rm(temporaryPath, { force: true });

  const database = new DatabaseSync(temporaryPath);
  try {
    createSchema(database);
    populate(database, fixture);
  } finally {
    database.close();
  }

  await rename(temporaryPath, outputPath);
  return outputPath;
}

function parseOptions(args: string[]): BuildProgramsOptions {
  const options: BuildProgramsOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--input' && value) {
      options.inputPath = value;
      index += 1;
    } else if (argument === '--output' && value) {
      options.outputPath = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    }
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildPrograms(parseOptions(process.argv.slice(2)))
    .then((outputPath) => console.log(`Built programs database: ${outputPath}`))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
