import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * One-time deterministic migration of the 2026 review corpus from pre-MEB topic ids to the
 * official MEB taxonomy, driven entirely by the reviewed mapping in
 * content/topic-annotations/legacy-id-map.json. Hash-neutral by design: no stored hash in the
 * corpus covers topic ids (they pin ÖSYM booklet PDF bytes). The derived consensus batch
 * (2026-tyt-turkce.json) is NOT touched here — regenerate it with compare-topic-reviews.
 */
type LegacyIdMap = {
  subjects: Record<string, Record<string, string>>;
};

function mapId(map: LegacyIdMap, subjectId: string, topicId: string, context: string): string {
  const subject = map.subjects[subjectId];
  if (!subject) throw new Error(`No legacy mapping block for subject ${subjectId} (${context})`);
  const next = subject[topicId];
  if (next) return next;
  if (Object.values(subject).includes(topicId)) return topicId; // already migrated (idempotent)
  throw new Error(`No legacy mapping for ${subjectId}/${topicId} (${context})`);
}

function migrateRecord(map: LegacyIdMap, fallbackSubject: string, record: unknown, context: string): boolean {
  if (typeof record !== 'object' || record === null) return false;
  const value = record as Record<string, unknown>;
  let changed = false;
  if (typeof value.topicId === 'string') {
    const next = mapId(map, fallbackSubject, value.topicId, context);
    if (next !== value.topicId) {
      value.topicId = next;
      changed = true;
    }
  }
  const primary = value.primaryTopicRef;
  if (typeof primary === 'object' && primary !== null) {
    const ref = primary as Record<string, unknown>;
    if (typeof ref.topicId === 'string') {
      const subjectId = typeof ref.subjectId === 'string' ? ref.subjectId : fallbackSubject;
      const next = mapId(map, subjectId, ref.topicId, context);
      if (next !== ref.topicId) {
        ref.topicId = next;
        changed = true;
      }
    }
  }
  if (Array.isArray(value.relatedTopicRefs)) {
    for (const related of value.relatedTopicRefs) {
      if (typeof related === 'object' && related !== null) {
        const ref = related as Record<string, unknown>;
        if (typeof ref.topicId === 'string' && typeof ref.subjectId === 'string') {
          const next = mapId(map, ref.subjectId, ref.topicId, `${context} relatedTopicRefs`);
          if (next !== ref.topicId) {
            ref.topicId = next;
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}

async function main(): Promise<void> {
  const root = resolve(process.cwd(), 'content/topic-annotations');
  const map = JSON.parse(
    await readFile(join(root, 'legacy-id-map.json'), 'utf8'),
  ) as LegacyIdMap;

  const targets: string[] = [];
  for (const directory of ['reviews', 'reviews-v2-draft']) {
    for (const name of await readdir(join(root, directory))) {
      if (name.endsWith('.json')) targets.push(join(root, directory, name));
    }
  }

  let migratedFiles = 0;
  for (const path of targets.sort()) {
    const document = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    const fallbackSubject = typeof document.subjectId === 'string' ? document.subjectId : '';
    let changed = migrateRecord(map, fallbackSubject, document, path);
    if (Array.isArray(document.records)) {
      for (const [index, record] of document.records.entries()) {
        if (migrateRecord(map, fallbackSubject, record, `${path}#${index}`)) changed = true;
      }
    }
    if (changed) {
      await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
      migratedFiles += 1;
    }
  }
  console.log(`Migrated topic ids in ${migratedFiles}/${targets.length} corpus file(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
