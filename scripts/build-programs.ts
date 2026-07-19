import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { programsFixtureSchema, type ProgramsFixture } from './lib/content-schemas.ts';
import { mergeArchiveYears, osymArchiveFixtureSchema } from './lib/osym-archive.ts';
import {
  programsDetailsFixtureSchema,
  type ProgramsDetailsFixture,
} from './lib/yok-atlas-details.ts';

const projectRoot = resolve(process.cwd());

export type BuildProgramsOptions = {
  inputPath?: string;
  outputPath?: string;
  archivePath?: string;
  detailsPath?: string;
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

// Historical ÖSYM years (2018-2024) merge into the wizard fixture at BUILD time only:
// the daily wizard import never rewrites them, and a missing archive file simply means
// no historical enrichment (fresh clones before the one-time import still build).
async function applyArchiveYears(fixture: ProgramsFixture, archivePath: string): Promise<ProgramsFixture> {
  let raw: string;
  try {
    raw = await readFile(archivePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fixture;
    throw error;
  }
  const archive = osymArchiveFixtureSchema.parse(JSON.parse(raw) as unknown);
  const { programs, stats } = mergeArchiveYears(fixture.programs, archive);
  console.log(
    `Merged ÖSYM archive: +${stats.yearsAttached} years onto ${stats.programsEnriched} programs ` +
      `(code=${stats.matchedByCode}, nameKey=${stats.matchedByNameKey}, ` +
      `filled-fields=${stats.yearsFieldFilled}, unmatched=${stats.unmatchedRecords}, ` +
      `ambiguous-keys=${stats.ambiguousNameKeys}, placed>quota=${stats.placedOverQuotaYears})`,
  );
  return programsFixtureSchema.parse({ ...fixture, programs });
}

// The YÖK Atlas details fixture (quota categories, kosul texts, staff, tuition, nets)
// is a companion artifact of the same wizard sweep. A missing file only means no
// detail enrichment — the base catalog still builds (same policy as the archive).
async function readDetailsFixture(detailsPath: string): Promise<ProgramsDetailsFixture | null> {
  let raw: string;
  try {
    raw = await readFile(detailsPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return programsDetailsFixtureSchema.parse(JSON.parse(raw) as unknown);
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
      -- Nullable: foreign (yurtdisi-*) programs publish no il in YÖK Atlas.
      city TEXT,
      city_en TEXT,
      type TEXT NOT NULL CHECK (type IN ('devlet', 'vakif', 'kibris', 'vakif-myo', 'yurtdisi-vakif', 'yurtdisi-kamu')),
      score_type TEXT NOT NULL CHECK (score_type IN ('say', 'ea', 'soz', 'tyt', 'dil', 'yetenek')),
      scholarship TEXT CHECK (scholarship IS NULL OR scholarship IN ('burslu', '%25', '%50', 'ucretli')),
      language TEXT,
      language_en TEXT,
      -- Official YÖK Atlas detail fields (null when the details fixture is absent or
      -- the source publishes no value for the program).
      faculty TEXT,
      district TEXT,
      education_type TEXT,
      duration_years INTEGER CHECK (duration_years IS NULL OR duration_years > 0),
      program_group TEXT,
      tuition INTEGER CHECK (tuition IS NULL OR tuition > 0),
      accreditation TEXT,
      accreditation_note TEXT,
      tyc INTEGER NOT NULL DEFAULT 0 CHECK (tyc IN (0, 1)),
      applied_education_model TEXT,
      min_rank_requirement INTEGER CHECK (min_rank_requirement IS NULL OR min_rank_requirement > 0),
      min_rank_requirement_note TEXT,
      staff_professor INTEGER CHECK (staff_professor IS NULL OR staff_professor >= 0),
      staff_docent INTEGER CHECK (staff_docent IS NULL OR staff_docent >= 0),
      staff_doctor_faculty INTEGER CHECK (staff_doctor_faculty IS NULL OR staff_doctor_faculty >= 0),
      staff_lecturer INTEGER CHECK (staff_lecturer IS NULL OR staff_lecturer >= 0),
      staff_research_assistant INTEGER CHECK (staff_research_assistant IS NULL OR staff_research_assistant >= 0),
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
      -- No placed<=quota CHECK: official ÖSYM totals legitimately exceed the genel
      -- kontenjan via ek yerleştirme/okul birincisi placements (e.g. ODTÜ 108470124
      -- in 2024: quota 25, placed 26). validate-pack surfaces these as warnings.
      PRIMARY KEY (program_id, year)
    ) STRICT;
    -- Official kosul texts, stored once per code; programs reference them in the
    -- kılavuz order via position. No FK from program_condition: the source lists some
    -- codes (e.g. on foreign programs) WITHOUT publishing a text, and the code itself
    -- is still an official reference worth keeping — the app renders those code-only.
    CREATE TABLE condition_text (
      code TEXT PRIMARY KEY CHECK (code GLOB '[0-9]*' AND length(code) <= 4),
      text TEXT NOT NULL CHECK (length(trim(text)) > 0)
    ) STRICT;
    CREATE TABLE program_condition (
      program_id TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
      code TEXT NOT NULL CHECK (code GLOB '[0-9]*' AND length(code) <= 4),
      position INTEGER NOT NULL CHECK (position >= 0),
      PRIMARY KEY (program_id, code)
    ) STRICT;
    -- The official "Kontenjan ve Yerleşme" category table of the snapshot year.
    CREATE TABLE program_quota_category (
      program_id TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
      year INTEGER NOT NULL CHECK (year >= 2018),
      category TEXT NOT NULL CHECK (category IN ('genel', 'okul-birincisi', 'deprem', 'sehit-gazi', 'kadin-34')),
      quota INTEGER CHECK (quota IS NULL OR quota >= 0),
      placed INTEGER CHECK (placed IS NULL OR placed >= 0),
      PRIMARY KEY (program_id, year, category)
    ) STRICT;
    -- "Yerleşen Son Kişinin Netleri": per program-year nets of the last-placed
    -- candidate, archived from 2023 by YÖK Atlas. Nets can be negative (net = doğru
    -- − yanlış/4), so the subject columns carry no positivity CHECK on purpose.
    CREATE TABLE program_net (
      program_id TEXT NOT NULL REFERENCES program(id) ON DELETE CASCADE,
      year INTEGER NOT NULL CHECK (year >= 2018),
      score_type TEXT NOT NULL CHECK (score_type IN ('say', 'ea', 'soz', 'tyt', 'dil')),
      coefficient REAL CHECK (coefficient IS NULL OR (coefficient > 0 AND coefficient <= 1)),
      min_score REAL CHECK (min_score IS NULL OR min_score > 0),
      obp REAL CHECK (obp IS NULL OR obp > 0),
      tyt_turkce REAL,
      tyt_sosyal REAL,
      tyt_matematik REAL,
      tyt_fen REAL,
      ayt_matematik REAL,
      ayt_fizik REAL,
      ayt_kimya REAL,
      ayt_biyoloji REAL,
      ayt_edebiyat REAL,
      ayt_tarih1 REAL,
      ayt_cografya1 REAL,
      ayt_tarih2 REAL,
      ayt_cografya2 REAL,
      ayt_felsefe REAL,
      ayt_din REAL,
      ydt_dil REAL,
      source TEXT NOT NULL CHECK (length(trim(source)) > 0),
      verified_at TEXT NOT NULL CHECK (datetime(verified_at) IS NOT NULL),
      PRIMARY KEY (program_id, year)
    ) STRICT;
    CREATE INDEX ix_program_year_rank ON program_year(year, min_rank);
    CREATE INDEX ix_program_score_type ON program(score_type);
    CREATE INDEX ix_program_city ON program(city);
    CREATE INDEX ix_program_name ON program(name);
  `);
}

function populate(
  database: DatabaseSync,
  fixture: ProgramsFixture,
  details: ProgramsDetailsFixture | null,
): void {
  const detailsById = new Map(details?.programs.map((record) => [record.id, record]) ?? []);
  const insertMetadata = database.prepare('INSERT INTO pack_metadata(key, value) VALUES (?, ?)');
  const insertProgram = database.prepare(`
    INSERT INTO program(
      id, university, university_en, name, name_en, city, city_en, type, score_type,
      scholarship, language, language_en,
      faculty, district, education_type, duration_years, program_group, tuition,
      accreditation, accreditation_note, tyc, applied_education_model,
      min_rank_requirement, min_rank_requirement_note,
      staff_professor, staff_docent, staff_doctor_faculty, staff_lecturer, staff_research_assistant,
      verified, source, verified_at, approximate, sample
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertYear = database.prepare(`
    INSERT INTO program_year(
      program_id, year, quota, placed, min_score, min_rank, verified, source, verified_at,
      approximate, sample
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertConditionText = database.prepare(
    'INSERT INTO condition_text(code, text) VALUES (?, ?)',
  );
  const insertProgramCondition = database.prepare(
    'INSERT INTO program_condition(program_id, code, position) VALUES (?, ?, ?)',
  );
  const insertQuotaCategory = database.prepare(`
    INSERT INTO program_quota_category(program_id, year, category, quota, placed)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertNet = database.prepare(`
    INSERT INTO program_net(
      program_id, year, score_type, coefficient, min_score, obp,
      tyt_turkce, tyt_sosyal, tyt_matematik, tyt_fen,
      ayt_matematik, ayt_fizik, ayt_kimya, ayt_biyoloji,
      ayt_edebiyat, ayt_tarih1, ayt_cografya1, ayt_tarih2, ayt_cografya2, ayt_felsefe, ayt_din,
      ydt_dil, source, verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let attachedDetails = 0;
  let orphanDetails = 0;
  database.exec('BEGIN IMMEDIATE');
  try {
    insertMetadata.run('schemaVersion', String(fixture.schemaVersion));
    insertMetadata.run('verified', String(fixture.dataStatus.verified));
    insertMetadata.run('approximate', String(fixture.dataStatus.approximate));
    insertMetadata.run('sample', String(fixture.dataStatus.sample));
    insertMetadata.run('source', fixture.dataStatus.source ?? '');
    insertMetadata.run('verifiedAt', fixture.programs[0]?.verifiedAt ?? '');
    if (details) {
      insertMetadata.run('detailsSource', details.source.searchApiUrl);
      insertMetadata.run('detailsNetsSource', details.source.netsApiUrl);
      insertMetadata.run('detailsGeneratedAt', details.generatedAt);
      for (const [code, text] of Object.entries(details.conditions)) {
        insertConditionText.run(code, text);
      }
    }

    for (const program of fixture.programs) {
      const record = detailsById.get(program.id) ?? null;
      if (record) attachedDetails += 1;
      insertProgram.run(
        program.id,
        program.university.tr,
        program.university.en,
        program.name.tr,
        program.name.en,
        program.city?.tr ?? null,
        program.city?.en ?? null,
        program.type,
        program.scoreType,
        program.scholarship,
        program.language?.tr ?? null,
        program.language?.en ?? null,
        record?.faculty ?? null,
        record?.district ?? null,
        record?.educationType ?? null,
        record?.durationYears ?? null,
        record?.programGroup ?? null,
        record?.tuition ?? null,
        record?.accreditation ?? null,
        record?.accreditationNote ?? null,
        Number(record?.tyc ?? false),
        record?.appliedEducationModel ?? null,
        record?.minRankRequirement ?? null,
        record?.minRankRequirementNote ?? null,
        record?.staff?.professor ?? null,
        record?.staff?.docent ?? null,
        record?.staff?.doctorFaculty ?? null,
        record?.staff?.lecturer ?? null,
        record?.staff?.researchAssistant ?? null,
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

      if (record && details) {
        record.conditionCodes.forEach((code, position) => {
          insertProgramCondition.run(program.id, code, position);
        });
        for (const category of record.quotaCategories) {
          insertQuotaCategory.run(
            program.id,
            record.year,
            category.category,
            category.quota,
            category.placed,
          );
        }
        for (const net of record.nets) {
          insertNet.run(
            program.id,
            net.year,
            net.scoreType,
            net.coefficient,
            net.minScore,
            net.obp,
            net.nets.tytTurkce ?? null,
            net.nets.tytSosyal ?? null,
            net.nets.tytMatematik ?? null,
            net.nets.tytFen ?? null,
            net.nets.aytMatematik ?? null,
            net.nets.aytFizik ?? null,
            net.nets.aytKimya ?? null,
            net.nets.aytBiyoloji ?? null,
            net.nets.aytEdebiyat ?? null,
            net.nets.aytTarih1 ?? null,
            net.nets.aytCografya1 ?? null,
            net.nets.aytTarih2 ?? null,
            net.nets.aytCografya2 ?? null,
            net.nets.aytFelsefe ?? null,
            net.nets.aytDin ?? null,
            net.nets.ydtDil ?? null,
            details.source.netsApiUrl,
            details.generatedAt,
          );
        }
      }
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  database.exec('PRAGMA optimize');

  if (details) {
    orphanDetails = details.programs.length - attachedDetails;
    console.log(
      `Attached YÖK Atlas details to ${attachedDetails}/${fixture.programs.length} programs` +
        `${orphanDetails ? ` (${orphanDetails} detail records have no matching program and were dropped)` : ''}.`,
    );
  } else {
    console.log('No details fixture found; built the base catalog without detail enrichment.');
  }
}

export async function buildPrograms(options: BuildProgramsOptions = {}): Promise<string> {
  const inputPath = resolve(
    options.inputPath ?? resolve(projectRoot, 'content/programs.fixture.json'),
  );
  const archivePath = resolve(
    options.archivePath ?? resolve(projectRoot, 'content/programs-archive.fixture.json'),
  );
  const detailsPath = resolve(
    options.detailsPath ?? resolve(projectRoot, 'content/programs-details.fixture.json'),
  );
  const outputPath = resolve(options.outputPath ?? resolve(projectRoot, 'content/programs.db'));
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  const fixture = await applyArchiveYears(await readFixture(inputPath), archivePath);
  const details = await readDetailsFixture(detailsPath);

  await mkdir(dirname(outputPath), { recursive: true });
  await rm(temporaryPath, { force: true });

  const database = new DatabaseSync(temporaryPath);
  try {
    createSchema(database);
    populate(database, fixture, details);
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
    } else if (argument === '--archive' && value) {
      options.archivePath = value;
      index += 1;
    } else if (argument === '--details' && value) {
      options.detailsPath = value;
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
