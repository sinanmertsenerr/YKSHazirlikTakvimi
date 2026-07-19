import {
  calculateNet,
  comparePackVersions,
  updateSectionAnswer,
  validateSectionAnswers,
} from './index';

describe('scoring engine', () => {
  it('calculates positive and negative net values', () => {
    expect(calculateNet({ correct: 30, wrong: 8 })).toBe(28);
    expect(calculateNet({ correct: 0, wrong: 4 })).toBe(-1);
  });

  it.each([
    [{ correct: 1.5, wrong: 0, blank: 0 }, 10, 'integer'],
    [{ correct: -1, wrong: 0, blank: 0 }, 10, 'negative'],
    [{ correct: 8, wrong: 2, blank: 1 }, 10, 'limit'],
    [{ correct: 8, wrong: 2, blank: 0 }, 10, null],
  ])('validates section answers %#', (answers, limit, expected) => {
    expect(validateSectionAnswers(answers, limit)).toBe(expected);
  });

  it('rejects answer updates that would exceed the section question count', () => {
    const answers = { correct: 30, wrong: 5, blank: 5 };

    expect(updateSectionAnswer(answers, 'correct', 31, 40)).toBeNull();
    expect(updateSectionAnswer(answers, 'wrong', 4, 40)).toEqual({
      correct: 30,
      wrong: 4,
      blank: 5,
    });
    expect(answers).toEqual({ correct: 30, wrong: 5, blank: 5 });
  });

  it('compares segmented pack versions and invalid fallbacks', () => {
    expect(comparePackVersions('2026.07.10', '2026.07.9')).toBe(1);
    expect(comparePackVersions('2026.7', '2026.07.0')).toBe(0);
    expect(comparePackVersions('2026.07.0', '2026.7')).toBe(0);
    expect(comparePackVersions('2025.12.9', '2026.1.0')).toBe(-1);
    expect(comparePackVersions('2026.beta', '2026.alpha')).toBeGreaterThan(0);
    expect(comparePackVersions('2026.1', '2026.alpha')).toBeLessThan(0);
  });
});
