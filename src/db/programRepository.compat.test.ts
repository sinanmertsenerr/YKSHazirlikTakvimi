import { z } from 'zod';

import { programsFixtureSchema } from '../../scripts/lib/content-schemas';

// Forward-compat contract for the 'yetenek' score type (Content changelog 2026-07-16):
// already-shipped binaries validate every SQLite row against the 5-value enum compiled
// into them, so a talent-exam program must FAIL that validation (mapProgram returns
// null → the row is silently dropped, never rendered or crashed on) while passing the
// current schema. This is the mechanism that lets new packs ship to old binaries with
// no CURRENT_SCHEMA_VERSION bump; if it ever breaks, either old binaries would start
// showing talent programs as if they were centrally placed, or current binaries would
// drop them entirely.
const legacyScoreTypeSchema = z.enum(['say', 'ea', 'soz', 'tyt', 'dil']);
const programRuntimeSchema = programsFixtureSchema.shape.programs.element;

const talentProgram = {
  id: '300110477',
  university: { tr: 'GAZİ ÜNİVERSİTESİ (ANKARA)', en: 'GAZİ ÜNİVERSİTESİ (ANKARA)' },
  name: { tr: 'Beden Eğitimi ve Spor Öğretmenliği', en: 'Beden Eğitimi ve Spor Öğretmenliği' },
  city: { tr: 'ANKARA', en: 'ANKARA' },
  type: 'devlet',
  scoreType: 'yetenek',
  scholarship: null,
  language: null,
  verified: true,
  verifiedAt: '2026-07-16T12:00:00.000Z',
  approximate: false,
  sample: false,
  source: 'https://yokatlas.yok.gov.tr/detay/300110477',
  years: [
    {
      year: 2026,
      quota: 60,
      placed: null,
      minScore: null,
      minRank: null,
      verified: true,
      verifiedAt: '2026-07-16T12:00:00.000Z',
      source: 'https://yokatlas.yok.gov.tr/detay/300110477',
      approximate: false,
      sample: false,
    },
  ],
};

describe('old-binary forward compatibility for talent-exam programs', () => {
  it('current binaries accept a yetenek program with null central cutoffs', () => {
    const parsed = programRuntimeSchema.safeParse(talentProgram);
    expect(parsed.success).toBe(true);
  });

  it('pre-yetenek binaries reject the score type, dropping the row instead of crashing', () => {
    expect(legacyScoreTypeSchema.safeParse(talentProgram.scoreType).success).toBe(false);
  });

  it('merkezi programs keep passing both the legacy and the current schema', () => {
    const merkezi = { ...talentProgram, scoreType: 'ea' };
    expect(legacyScoreTypeSchema.safeParse(merkezi.scoreType).success).toBe(true);
    expect(programRuntimeSchema.safeParse(merkezi).success).toBe(true);
  });
});
