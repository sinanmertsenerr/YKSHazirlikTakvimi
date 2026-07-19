import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { emptyReport, validateProgramsDatabase } from './validate-pack.ts';

/**
 * Standalone gate for the COMMITTED bundled pack (assets/pack/programs.db) — the file
 * EAS ships inside the binary. build:pack deliberately skips this copy (it is about to
 * replace it), and no publish workflow commits it back, so a schema change merged
 * without regenerating the pack would strand every fresh install on "no such column".
 * This script runs the full structural validation (schema columns, sentinel parity,
 * integrity) against the committed file and fails loudly; it is wired into both
 * `npm run check` and the blocking CI workflow.
 */
export async function validateBundledPack(): Promise<void> {
  const bundledPath = resolve(process.cwd(), 'assets/pack/programs.db');
  try {
    await access(bundledPath);
  } catch (error) {
    throw new Error(
      `Bundled pack missing at ${bundledPath} (${
        error instanceof Error ? error.message : String(error)
      }); run build:pack before release.`,
    );
  }
  const report = emptyReport();
  validateProgramsDatabase(bundledPath, report);
  if (report.errors.length) {
    throw new Error(
      `Bundled pack validation failed:\n${report.errors.map((line) => `- ${line}`).join('\n')}`,
    );
  }
  console.log(`Bundled pack OK: ${bundledPath} (${report.warnings.length} warning(s))`);
  for (const warning of report.warnings) console.warn(`WARN ${warning}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  validateBundledPack().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
