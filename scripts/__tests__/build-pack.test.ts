import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
    'topic-group-statistics.json',
    'topic-group-mappings.json',
    'ogm-yks-topic-sources.json',
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
    const sourceManifest = JSON.parse(after.toString('utf8')) as {
      packVersion: string;
      files: Record<string, { path: string }>;
    };
    const builtManifestRaw = await readFile(resolve(outputDir, 'manifest.json'), 'utf8');
    const builtManifest = JSON.parse(builtManifestRaw) as {
      packVersion: string;
      files: Record<string, { path: string; bytes: number; sha256: string }>;
    };
    assert.notEqual(sourceManifest.packVersion, override);
    assert.equal(builtManifest.packVersion, override);
    assert.equal(builtManifestRaw, `${JSON.stringify(builtManifest)}\n`);

    for (const [key, sourceDescriptor] of Object.entries(sourceManifest.files)) {
      if (!sourceDescriptor.path.endsWith('.json')) continue;
      const sourceDocument = JSON.parse(
        await readFile(resolve(contentDir, sourceDescriptor.path), 'utf8'),
      ) as unknown;
      const expected = Buffer.from(`${JSON.stringify(sourceDocument)}\n`);
      const published = await readFile(resolve(outputDir, sourceDescriptor.path));
      assert.deepEqual(published, expected, `${sourceDescriptor.path} should be minified`);
      assert.equal(builtManifest.files[key]?.bytes, published.byteLength);
      assert.equal(
        builtManifest.files[key]?.sha256,
        createHash('sha256').update(published).digest('hex'),
      );
    }

    await assert.rejects(
      buildPack({ contentDir, outputDir: join(temporaryRoot, 'invalid-pack'), packVersion: 'bad' }),
      /Invalid pack version override/,
    );
    assert.deepEqual(await readFile(sourceManifestPath), before);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
