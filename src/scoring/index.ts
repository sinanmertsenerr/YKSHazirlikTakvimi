export type SectionAnswers = { correct: number; wrong: number; blank: number };

export function calculateNet(answers: Pick<SectionAnswers, 'correct' | 'wrong'>): number {
  return answers.correct - answers.wrong / 4;
}

export function validateSectionAnswers(
  answers: SectionAnswers,
  questionCount: number,
): string | null {
  const values = [answers.correct, answers.wrong, answers.blank];
  if (values.some((value) => !Number.isInteger(value))) return 'integer';
  if (values.some((value) => value < 0)) return 'negative';
  if (answers.correct + answers.wrong + answers.blank > questionCount) return 'limit';
  return null;
}

export function comparePackVersions(left: string, right: string): number {
  const parse = (value: string) => value.split('.').map((segment) => Number(segment));
  const leftParts = parse(left);
  const rightParts = parse(right);
  const size = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < size; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (!Number.isFinite(leftPart) || !Number.isFinite(rightPart)) {
      return left.localeCompare(right);
    }
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}
