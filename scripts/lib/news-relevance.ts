/**
 * Accepts only titles that explicitly identify the YKS exam family or an
 * unambiguous higher-education entrance/preference context.
 */
export function isRelevantNewsTitle(title: string): boolean {
  const normalized = title.replace(/\s+/g, ' ').trim();
  return (
    /\b(?:YKS|TYT|AYT|YDT)\b/iu.test(normalized) ||
    /yükseköğretim kurumları sınavı/iu.test(normalized) ||
    /üniversite(?:ye|lere)? (?:giriş sınavı|sınavı|tercih(?:leri)?|yerleştirme(?:leri)?)/iu.test(
      normalized,
    ) ||
    /yükseköğretim (?:tercih(?:leri)?|yerleştirme(?:leri)?|programları ve kontenjanları)/iu.test(
      normalized,
    )
  );
}
