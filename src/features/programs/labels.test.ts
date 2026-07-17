import type { Program } from '@/data/content';

import {
  PROGRAM_SCHOLARSHIP_LABEL_KEYS,
  PROGRAM_TYPE_LABEL_KEYS,
  programScholarshipLabelKey,
  programTypeLabelKey,
} from './labels';

describe('official program label mappings', () => {
  it('maps every supported university type without a fallback', () => {
    const types: Program['type'][] = [
      'devlet',
      'vakif',
      'kibris',
      'vakif-myo',
      'yurtdisi-vakif',
      'yurtdisi-kamu',
    ];

    expect(Object.keys(PROGRAM_TYPE_LABEL_KEYS).sort()).toEqual([...types].sort());
    expect(types.map(programTypeLabelKey)).toEqual([
      'preference.state',
      'preference.foundation',
      'preference.trnc',
      'preference.foundationMyo',
      'preference.foreignFoundation',
      'preference.foreignPublic',
    ]);
  });

  it('maps every source scholarship category exactly', () => {
    const scholarships: NonNullable<Program['scholarship']>[] = ['burslu', '%25', '%50', 'ucretli'];

    expect(Object.keys(PROGRAM_SCHOLARSHIP_LABEL_KEYS).sort()).toEqual([...scholarships].sort());
    expect(scholarships.map(programScholarshipLabelKey)).toEqual([
      'preference.fullScholarship',
      'preference.scholarship25',
      'preference.scholarship50',
      'preference.tuitionPaid',
    ]);
  });
});
