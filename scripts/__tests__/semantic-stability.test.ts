import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  preserveStableRecordVerificationTimes,
  writeTextFileAtomicallyIfChanged,
} from '../lib/semantic-stability.ts';

test('unchanged records retain timestamps while changed and new records use the fresh timestamp', () => {
  const oldTime = '2026-07-14T12:00:00.000Z';
  const freshTime = '2026-07-15T12:00:00.000Z';
  const previous = [
    { id: 'same', value: 1, verifiedAt: oldTime },
    { id: 'changed', value: 1, verifiedAt: oldTime },
  ];
  const candidates = [
    { id: 'same', value: 1, verifiedAt: freshTime },
    { id: 'changed', value: 2, verifiedAt: freshTime },
    { id: 'new', value: 1, verifiedAt: freshTime },
  ];

  const stable = preserveStableRecordVerificationTimes(candidates, previous, (item) => item.id);
  assert.deepEqual(
    stable.map(({ id, verifiedAt }) => ({ id, verifiedAt })),
    [
      { id: 'same', verifiedAt: oldTime },
      { id: 'changed', verifiedAt: freshTime },
      { id: 'new', verifiedAt: freshTime },
    ],
  );
});

test('identical bytes are not rewritten and changed bytes replace atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yks-semantic-stability-'));
  const path = join(directory, 'document.json');
  try {
    await writeFile(path, '{"stable":true}\n', 'utf8');
    const before = await stat(path);
    assert.equal(await writeTextFileAtomicallyIfChanged(path, '{"stable":true}\n'), false);
    const unchanged = await stat(path);
    assert.equal(unchanged.ino, before.ino);
    assert.equal(unchanged.mtimeMs, before.mtimeMs);

    assert.equal(await writeTextFileAtomicallyIfChanged(path, '{"stable":false}\n'), true);
    assert.equal(await readFile(path, 'utf8'), '{"stable":false}\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
