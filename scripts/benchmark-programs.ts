import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

import {
  buildProgramListQuery,
  type ProgramListFilters,
  type SqlQuery,
} from '../src/db/programQueries.ts';

type Scenario = {
  name: string;
  filters: ProgramListFilters;
  offset: number;
};

type BenchmarkResult = {
  name: string;
  rows: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  plan: string[];
};

const SCENARIOS: Scenario[] = [
  { name: 'browse-first-page', filters: { scoreType: 'say', language: 'tr' }, offset: 0 },
  {
    name: 'search-muhendislik',
    filters: { scoreType: 'say', language: 'tr', search: 'mühendislik' },
    offset: 0,
  },
  {
    name: 'filtered-ankara',
    filters: { scoreType: 'say', language: 'tr', city: 'ANKARA' },
    offset: 0,
  },
  { name: 'browse-deep-page', filters: { scoreType: 'say', language: 'tr' }, offset: 1_200 },
];

function percentile(sorted: number[], quantile: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function queryPlan(database: DatabaseSync, query: SqlQuery): string[] {
  const rows = database.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.parameters) as {
    detail: string;
  }[];
  return rows.map((row) => row.detail);
}

function benchmarkScenario(
  database: DatabaseSync,
  scenario: Scenario,
  iterations: number,
): BenchmarkResult {
  const query = buildProgramListQuery(scenario.filters, 61, scenario.offset);
  const statement = database.prepare(query.sql);
  for (let index = 0; index < 5; index += 1) statement.all(...query.parameters);

  const timings: number[] = [];
  let rows = 0;
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    rows = statement.all(...query.parameters).length;
    timings.push(performance.now() - startedAt);
  }
  timings.sort((left, right) => left - right);
  return {
    name: scenario.name,
    rows,
    p50Ms: round(percentile(timings, 0.5)),
    p95Ms: round(percentile(timings, 0.95)),
    maxMs: round(timings.at(-1) ?? 0),
    plan: queryPlan(database, query),
  };
}

export async function benchmarkPrograms(options: {
  databasePath: string;
  iterations: number;
}): Promise<{ databaseBytes: number; iterations: number; results: BenchmarkResult[] }> {
  if (
    !Number.isSafeInteger(options.iterations) ||
    options.iterations < 5 ||
    options.iterations > 500
  ) {
    throw new Error('iterations must be an integer from 5 through 500.');
  }
  const metadata = await stat(options.databasePath);
  if (!metadata.isFile() || metadata.size < 1) throw new Error('Program database is unavailable.');
  const database = new DatabaseSync(options.databasePath, { readOnly: true });
  try {
    return {
      databaseBytes: metadata.size,
      iterations: options.iterations,
      results: SCENARIOS.map((scenario) =>
        benchmarkScenario(database, scenario, options.iterations),
      ),
    };
  } finally {
    database.close();
  }
}

function parseOptions(args: string[]): { databasePath: string; iterations: number } {
  let databasePath = resolve(process.cwd(), 'assets/pack/programs.db');
  let iterations = 30;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--database' && value) databasePath = resolve(value);
    else if (argument === '--iterations' && value) iterations = Number(value);
    else throw new Error(`Unknown or incomplete argument: ${argument ?? '<empty>'}`);
    index += 1;
  }
  return { databasePath, iterations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options: ReturnType<typeof parseOptions>;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    options = { databasePath: '', iterations: 0 };
  }
  if (process.exitCode !== 1) {
    benchmarkPrograms(options)
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
