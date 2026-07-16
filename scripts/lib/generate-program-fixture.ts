/** Produces 100 deterministic, unmistakably synthetic program records for local development. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CURRENT_SCHEMA_VERSION } from './content-schemas.ts';

const scoreTypes = ['say', 'ea', 'soz', 'tyt'] as const;
const types = ['devlet', 'vakif', 'kibris'] as const;
const scholarships = [null, 'burslu', '%25', '%50', 'ucretli'] as const;
const disciplines = {
  say: { tr: 'Sayısal Örnek Program', en: 'Synthetic Science Program' },
  ea: { tr: 'Eşit Ağırlık Örnek Programı', en: 'Synthetic Equally Weighted Program' },
  soz: { tr: 'Sözel Örnek Program', en: 'Synthetic Verbal Program' },
  tyt: { tr: 'TYT Örnek Programı', en: 'Synthetic TYT Program' },
} as const;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function createProgramsFixture() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    dataStatus: {
      verified: false,
      approximate: true,
      sample: true,
      source: null,
      note: {
        tr: '100 programın tamamı yalnızca geliştirme için deterministik olarak üretilmiş sentetik fixture’dır; hiçbir kayıt gerçek bir kurum veya YÖK Atlas değeri değildir.',
        en: 'All 100 programs are deterministic synthetic development fixtures; no record represents a real institution or YÖK Atlas value.',
      },
    },
    programs: Array.from({ length: 100 }, (_, offset) => {
      const ordinal = offset + 1;
      const idNumber = String(ordinal).padStart(3, '0');
      const universityNumber = String((offset % 20) + 1).padStart(2, '0');
      const cityLetter = String.fromCharCode(65 + (offset % 10));
      const scoreType = scoreTypes[offset % scoreTypes.length] ?? 'say';
      const type = types[offset % types.length] ?? 'devlet';
      const scholarship =
        type === 'devlet' ? null : (scholarships[offset % scholarships.length] ?? null);
      const quota = 20 + (offset % 9) * 5;
      const baseScore = { say: 475, ea: 455, soz: 430, tyt: 410 }[scoreType];

      return {
        id: `sample-program-${idNumber}`,
        university: {
          tr: `Sentetik Örnek Üniversitesi ${universityNumber}`,
          en: `Synthetic Sample University ${universityNumber}`,
        },
        name: {
          tr: `${disciplines[scoreType].tr} ${idNumber} — GERÇEK DEĞİLDİR`,
          en: `${disciplines[scoreType].en} ${idNumber} — NOT REAL`,
        },
        city: { tr: `Örnek Şehir ${cityLetter}`, en: `Sample City ${cityLetter}` },
        type,
        scoreType,
        scholarship,
        language:
          offset % 3 === 0 ? { tr: 'İngilizce', en: 'English' } : { tr: 'Türkçe', en: 'Turkish' },
        verified: false,
        verifiedAt: null,
        approximate: true,
        sample: true,
        source: null,
        years: [2026, 2025, 2024, 2023].map((year, yearOffset) => ({
          year,
          quota,
          placed: Math.max(0, quota - ((offset + yearOffset) % 3)),
          minScore: round2(baseScore - offset * 1.15 - yearOffset * 2.25),
          minRank: 10_000 + offset * 3_500 + yearOffset * 2_000,
          verified: false,
          verifiedAt: null,
          approximate: true,
          sample: true,
          source: null,
        })),
      };
    }),
  };
}

export async function writeProgramsFixture(
  outputPath = resolve(process.cwd(), 'content/programs.fixture.json'),
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(createProgramsFixture(), null, 2)}\n`, 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  writeProgramsFixture(process.argv[2] ? resolve(process.argv[2]) : undefined)
    .then(() => console.log('Generated 100 explicitly synthetic program fixtures.'))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
