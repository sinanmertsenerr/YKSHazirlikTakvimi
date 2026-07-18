import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

async function repositoryFile(path: string): Promise<string> {
  return readFile(resolve(process.cwd(), path), 'utf8');
}

test('Pages deployment verifies the expected revision and every declared payload hash', async () => {
  const workflow = await repositoryFile('.github/workflows/publish-content.yml');
  assert.match(workflow, /pack_version: \$\{\{ steps\.pack-metadata\.outputs\.pack_version \}\}/);
  assert.match(workflow, /EXPECTED_PACK_VERSION:/);
  assert.match(workflow, /\.packVersion == \$expected/);
  assert.match(workflow, /sha256sum "\$output"/);
  assert.match(workflow, /environment: content-signing/);
  assert.match(
    workflow,
    /PACK_SIGNING_PRIVATE_KEY_PEM: \$\{\{ secrets\.PACK_SIGNING_PRIVATE_KEY_PEM \}\}/,
  );
  assert.match(workflow, /npm run sign:pack/);
  assert.match(workflow, /scripts\/verify-pack-signature\.ts/);
  assert.match(workflow, /stat -c '%s' "\$output"/);
  assert.match(workflow, /notify-deploy-failure:/);
});

test('scheduled health checks cover Pages, news integrity, publisher recency, and alerting', async () => {
  const workflow = await repositoryFile('.github/workflows/content-health.yml');
  assert.match(workflow, /cron: '53 \*\/2 \* \* \*'/);
  assert.match(workflow, /"\$pack_base\/manifest\.json"/);
  assert.match(workflow, /"\$pack_base\/manifest\.sig"/);
  assert.match(workflow, /scripts\/verify-pack-signature\.ts/);
  assert.match(workflow, /\.files\.news\.sha256/);
  assert.match(workflow, /publish-content\.yml\/runs\?status=completed/);
  assert.match(workflow, /age_seconds.*36000/s);
  assert.match(workflow, /notify-health-failure:/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/notify-issue\.yml/);
});

test('scheduled health checks verify the published program pack independently of news', async () => {
  const workflow = await repositoryFile('.github/workflows/content-health.yml');
  assert.match(workflow, /\.files\.programs\.path/);
  assert.match(workflow, /\.files\.programs\.bytes/);
  assert.match(workflow, /\.files\.programs\.sha256/);
  assert.match(workflow, /"\$pack_base\/\$programs_path"/);
  assert.match(workflow, /sha256sum "\$programs"/);
});

test('CI builds and validates each candidate pack only once', async () => {
  const [validation, publishing] = await Promise.all([
    repositoryFile('.github/workflows/validate.yml'),
    repositoryFile('.github/workflows/publish-content.yml'),
  ]);
  assert.doesNotMatch(validation, /npm run validate:pack/);
  assert.doesNotMatch(publishing, /npm run validate:pack/);
  assert.match(validation, /npm run build:pack/);
  assert.ok((publishing.match(/npm run build:pack/g) ?? []).length >= 2);
});

test('validation regenerates and checks authoritative Android policy', async () => {
  const workflow = await repositoryFile('.github/workflows/validate.yml');
  assert.match(workflow, /expo prebuild --platform android --no-install --clean/);
  assert.match(workflow, /npm run validate:native-config/);
});

test('deployment runbook records the default-branch and independent-monitor prerequisites', async () => {
  const deployment = await repositoryFile('docs/DEPLOYMENT.md');
  assert.match(deployment, /must both exist on the repository's\s+default branch/);
  assert.match(deployment, /external uptime service/);
  assert.match(deployment, /SHA-256 and byte length match/);
  assert.match(deployment, /Ed25519/);
  assert.match(deployment, /PACK_SIGNING_PRIVATE_KEY_PEM/);
});
