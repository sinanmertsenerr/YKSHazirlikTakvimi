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

export function programTypeLabelKey(type: Program['type']) {
  return PROGRAM_TYPE_LABEL_KEYS[type];
}

export function programScholarshipLabelKey(scholarship: NonNullable<Program['scholarship']>) {
  return PROGRAM_SCHOLARSHIP_LABEL_KEYS[scholarship];
}
