import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { buildPack } from '../build-pack.ts';

test('pack-version override changes only the built manifest and preserves the source manifest', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'yks-pack-version-'));
  const contentDir = join(temporaryRoot, 'content');
  const outputDir = join(temporaryRoot, 'pack');
  const sourceDir = resolve(process.cwd(), 'content');
  const sourceFiles = [
    'manifest.source.json',
    'topics.json',
    'osym-booklets.json',
    'coefficients.json',
    'rank-tables.json',
    'programs.fixture.json',
    'calendar.json',
    'news.json',
  ];
  const override = '2026.07.150102030000101';

  try {
    await mkdir(contentDir, { recursive: true });
    await Promise.all(
      sourceFiles.map((file) => copyFile(resolve(sourceDir, file), resolve(contentDir, file))),
    );
    const sourceManifestPath = resolve(contentDir, 'manifest.source.json');
    const before = await readFile(sourceManifestPath);

    await buildPack({ contentDir, outputDir, packVersion: override });

    const after = await readFile(sourceManifestPath);
    assert.deepEqual(after, before);
    const sourceManifest = JSON.parse(after.toString('utf8')) as { packVersion: string };
    const builtManifest = JSON.parse(
      await readFile(resolve(outputDir, 'manifest.json'), 'utf8'),
    ) as { packVersion: string };
    assert.notEqual(sourceManifest.packVersion, override);
    assert.equal(builtManifest.packVersion, override);

    await assert.rejects(
      buildPack({ contentDir, outputDir: join(temporaryRoot, 'invalid-pack'), packVersion: 'bad' }),
      /Invalid pack version override/,
    );
    assert.deepEqual(await readFile(sourceManifestPath), before);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
