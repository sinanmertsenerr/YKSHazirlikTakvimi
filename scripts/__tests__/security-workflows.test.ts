import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

async function repositoryFile(path: string): Promise<string> {
  return readFile(resolve(process.cwd(), path), 'utf8');
}

test('validation blocks high and critical production dependency advisories', async () => {
  const [packageJson, workflow] = await Promise.all([
    repositoryFile('package.json'),
    repositoryFile('.github/workflows/validate.yml'),
  ]);
  assert.match(packageJson, /"audit:production": "npm audit --omit=dev --audit-level=high"/);
  assert.match(workflow, /npm run audit:production/);
});

test('CodeQL uses least privilege and immutable action revisions', async () => {
  const workflow = await repositoryFile('.github/workflows/codeql.yml');
  assert.match(workflow, /security-events: write/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /languages: javascript-typescript/);
  const uses = [...workflow.matchAll(/uses: ([^\s]+)@([^\s#]+)/g)];
  assert.ok(uses.length >= 3);
  for (const [, _action, revision] of uses) {
    assert.match(revision!, /^[a-f0-9]{40}$/);
  }
});

test('Dependabot reviews npm and GitHub Actions weekly without auto-merge policy', async () => {
  const config = await repositoryFile('.github/dependabot.yml');
  assert.match(config, /package-ecosystem: npm/);
  assert.match(config, /package-ecosystem: github-actions/);
  assert.equal((config.match(/interval: weekly/g) ?? []).length, 2);
  assert.doesNotMatch(config, /auto-merge|automerge/i);
});
