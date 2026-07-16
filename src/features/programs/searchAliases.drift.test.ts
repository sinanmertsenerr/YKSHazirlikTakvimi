import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { programSearchAliasEntries } from './searchAliases';

import { trSearch } from '@/utils/format';

// Evidence gate: the alias table ships inside the app binary while program/university
// text refreshes with every YÖK Atlas re-import (weekly CI cron). This test pins every
// expansion phrase to the LIVE fixture so a rename in the source data fails the suite
// loudly instead of silently turning an abbreviation search into zero results.
describe('program search aliases stay evidence-bound to the live fixture', () => {
  const fixture = JSON.parse(
    readFileSync(join(__dirname, '../../../content/programs.fixture.json'), 'utf8'),
  ) as { programs: { name: { tr: string }; university: { tr: string } }[] };
  const haystacks = fixture.programs.map((program) =>
    trSearch(`${program.name.tr} ${program.university.tr}`),
  );

  it('matches every expansion phrase against at least one live program', () => {
    const stale: string[] = [];
    for (const [alias, phrases] of programSearchAliasEntries()) {
      for (const phrase of phrases) {
        const needle = trSearch(phrase);
        if (!haystacks.some((haystack) => haystack.includes(needle))) {
          stale.push(`${alias} → ${phrase}`);
        }
      }
    }
    expect(stale).toEqual([]);
  });
});
