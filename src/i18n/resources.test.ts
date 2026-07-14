import { resources } from './resources';

function flattenTranslations(
  value: unknown,
  prefix = '',
  output = new Map<string, string>(),
): Map<string, string> {
  if (typeof value === 'string') {
    output.set(prefix, value);
    return output;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Translation value at ${prefix || '<root>'} must be an object or string`);
  }
  for (const [key, child] of Object.entries(value)) {
    flattenTranslations(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
}

function interpolationTokens(value: string): string[] {
  return [...value.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)].map((match) => match[1]!).sort();
}

describe('translation resources', () => {
  const turkish = flattenTranslations(resources.tr.translation);
  const english = flattenTranslations(resources.en.translation);

  it('keeps the Turkish and English key sets exactly aligned', () => {
    expect([...english.keys()].sort()).toEqual([...turkish.keys()].sort());
  });

  it('contains no blank values and preserves interpolation contracts across locales', () => {
    for (const [key, turkishValue] of turkish) {
      const englishValue = english.get(key);
      expect(turkishValue.trim()).not.toBe('');
      expect(englishValue?.trim()).not.toBe('');
      expect(interpolationTokens(englishValue!)).toEqual(interpolationTokens(turkishValue));
    }
  });
});
