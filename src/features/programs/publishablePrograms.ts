import type { Program } from '@/data/content';

/** Returns only records whose program identity and every exposed yearly value passed verification. */
export function publishablePrograms(programs: Program[]): Program[] {
  return programs.flatMap((program) => {
    if (
      !program.verified ||
      !program.verifiedAt ||
      program.approximate ||
      program.sample ||
      !program.source
    )
      return [];
    const years = program.years.filter(
      (year) =>
        year.verified &&
        Boolean(year.verifiedAt) &&
        !year.approximate &&
        !year.sample &&
        Boolean(year.source),
    );
    return years.length ? [{ ...program, years }] : [];
  });
}
