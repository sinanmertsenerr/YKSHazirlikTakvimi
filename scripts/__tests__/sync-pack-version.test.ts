import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertSourcePackVersionNewer,
  comparePackVersions,
  nextMonotonicPackVersion,
  syncSourcePackVersion,
} from '../sync-pack-version.ts';

const manifest = (packVersion: string) => ({
  schemaVersion: 2,
  packVersion,
  minAppVersion: '1.0.0',
  examYear: 2026,
  files: {
    topics: { path: 'topics.json' },
    coefficients: { path: 'coefficients.json' },
    rankTables: { path: 'rank-tables.json' },
    programs: { path: 'programs.db', buildFrom: 'programs.fixture.json' },
    calendar: { path: 'calendar.json' },
    news: { path: 'news.json' },
  },
});

test('pack revisions compare numerically and advance beyond a future floor', () => {
  assert.equal(comparePackVersions('2026.07.10', '2026.07.9'), 1);
  assert.equal(comparePackVersions('2027.01.1', '2026.12.999'), 1);
  assert.equal(nextMonotonicPackVersion('2026.07.20', '2026.07.30', '2026.07.40'), '2026.07.41');
  assert.equal(nextMonotonicPackVersion('2026.07.50', '2026.07.30', '2026.07.40'), '2026.07.50');
});

test('source version is persisted, adopts an equal-identity remote revision, and verifies ordering', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yks-pack-version-state-'));
  const manifestPath = join(directory, 'manifest.source.json');
  try {
    await writeFile(manifestPath, `${JSON.stringify(manifest('2026.07.3'), null, 2)}\n`);
    const published = await syncSourcePackVersion({
      manifestPath,
      candidateVersion: '2026.07.20',
      remoteVersion: '2026.07.10',
    });
    assert.deepEqual(published, { changed: true, packVersion: '2026.07.20' });
    assert.equal(
      (JSON.parse(await readFile(manifestPath, 'utf8')) as { packVersion: string }).packVersion,
      '2026.07.20',
    );
    assert.equal(await assertSourcePackVersionNewer(manifestPath, '2026.07.19'), '2026.07.20');
    await assert.rejects(assertSourcePackVersionNewer(manifestPath, '2026.07.20'), /must be newer/);

    const retry = await syncSourcePackVersion({
      manifestPath,
      candidateVersion: '2026.07.30',
      remoteVersion: '2026.07.10',
    });
    assert.deepEqual(retry, { changed: false, packVersion: '2026.07.20' });

    const adopted = await syncSourcePackVersion({
      manifestPath,
      remoteVersion: '2026.07.25',
    });
    assert.deepEqual(adopted, { changed: true, packVersion: '2026.07.25' });
    const unchanged = await syncSourcePackVersion({
      manifestPath,
      remoteVersion: '2026.07.24',
    });
    assert.deepEqual(unchanged, { changed: false, packVersion: '2026.07.25' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
