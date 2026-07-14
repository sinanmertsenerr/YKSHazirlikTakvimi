import { publishablePrograms } from './publishablePrograms';

import type { Program } from '@/data/content';

const officialProgram: Program = {
  id: '123456789',
  university: { tr: 'Üniversite', en: 'University' },
  name: { tr: 'Program', en: 'Program' },
  city: { tr: 'Ankara', en: 'Ankara' },
  type: 'devlet',
  scoreType: 'say',
  scholarship: null,
  language: { tr: 'Türkçe', en: 'Turkish' },
  verified: true,
  verifiedAt: '2026-07-14T12:00:00.000Z',
  approximate: false,
  sample: false,
  source: 'https://yokatlas.yok.gov.tr/',
  years: [
    {
      year: 2025,
      quota: 10,
      placed: null,
      minScore: 500,
      minRank: 1000,
      verified: true,
      verifiedAt: '2026-07-14T12:00:00.000Z',
      source: 'https://yokatlas.yok.gov.tr/',
      approximate: false,
      sample: false,
    },
  ],
};

describe('publishablePrograms', () => {
  it('fails closed for synthetic, approximate, unverified, and unsourced records', () => {
    const records: Program[] = [
      { ...officialProgram, id: 'sample', sample: true },
      { ...officialProgram, id: 'approximate', approximate: true },
      { ...officialProgram, id: 'unverified', verified: false },
      { ...officialProgram, id: 'unsourced', source: null },
      { ...officialProgram, id: 'undated', verifiedAt: null },
    ];

    expect(publishablePrograms(records)).toEqual([]);
  });

  it('keeps only sourced and verified yearly rows', () => {
    const records = publishablePrograms([
      {
        ...officialProgram,
        years: [
          ...officialProgram.years,
          { ...officialProgram.years[0]!, year: 2024, verified: false },
          { ...officialProgram.years[0]!, year: 2023, verifiedAt: null },
        ],
      },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]?.years.map((year) => year.year)).toEqual([2025]);
  });
});
