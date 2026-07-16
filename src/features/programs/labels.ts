import type { Program } from '@/data/content';

export const PROGRAM_TYPE_LABEL_KEYS = {
  devlet: 'preference.state',
  vakif: 'preference.foundation',
  kibris: 'preference.trnc',
} as const satisfies Record<Program['type'], string>;

export const PROGRAM_SCHOLARSHIP_LABEL_KEYS = {
  burslu: 'preference.fullScholarship',
  '%25': 'preference.scholarship25',
  '%50': 'preference.scholarship50',
  ucretli: 'preference.tuitionPaid',
} as const satisfies Record<NonNullable<Program['scholarship']>, string>;

// Chip labels are compile-time exhaustive: adding a scoreType to the content schema
// without a label here is a type error, so a new category can never ship invisible
// in the browse chips or the detail screen.
export const PROGRAM_SCORE_TYPE_CHIP_LABELS = {
  tyt: { tr: 'TYT', en: 'TYT' },
  say: { tr: 'SAY', en: 'SAY' },
  ea: { tr: 'EA', en: 'EA' },
  soz: { tr: 'SÖZ', en: 'SÖZ' },
  dil: { tr: 'DİL', en: 'LANG' },
  yetenek: { tr: 'YETENEK', en: 'TALENT' },
} as const satisfies Record<Program['scoreType'], { tr: string; en: string }>;

/** Browse-chip order; keys of the exhaustive label map, so it can never miss a value. */
export const PROGRAM_SCORE_TYPES = Object.keys(
  PROGRAM_SCORE_TYPE_CHIP_LABELS,
) as (keyof typeof PROGRAM_SCORE_TYPE_CHIP_LABELS)[];

export function programScoreTypeChipLabel(
  scoreType: Program['scoreType'],
  language: 'tr' | 'en',
): string {
  return PROGRAM_SCORE_TYPE_CHIP_LABELS[scoreType][language];
}

export function programTypeLabelKey(type: Program['type']) {
  return PROGRAM_TYPE_LABEL_KEYS[type];
}

export function programScholarshipLabelKey(scholarship: NonNullable<Program['scholarship']>) {
  return PROGRAM_SCHOLARSHIP_LABEL_KEYS[scholarship];
}
