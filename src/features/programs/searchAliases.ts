import { trSearch } from '@/utils/format';

// Common Turkish abbreviations → official YÖK Atlas phrasings. Evidence-bound per the
// project's data-accuracy protocol: every phrase below must keep matching ≥1 program in
// content/programs.fixture.json (enforced by searchAliases.drift.test.ts, which fails the
// suite the moment a YÖK re-import renames the underlying text). Values are raw official
// spellings; normalization happens once at module load.
//
// Evidence (2026-07-16, 2025 YÖK Atlas snapshot, 21,263 programs): each entry was
// cross-verified on the web (≥2 independent sources; official university/YÖK sites +
// tercih guides) AND counted in the live fixture — hit counts noted per line. 'AÜ' was
// deliberately excluded: ambiguous across ≥5 universities in real usage. BESYO is an
// institution type, not a program; it expands to its three largest centrally-placed
// program families (Antrenörlük=1 and Egzersiz ve Spor=3 hits dropped by the cap).
const RAW_ALIASES: Record<string, readonly string[]> = {
  // Bölümler
  BESYO: ['Spor Yöneticiliği', 'Rekreasyon', 'Beden Eğitimi'], // 112 + 27 + 4
  BÖTE: ['Bilgisayar ve Öğretim Teknolojileri'], // 14
  EEM: ['Elektrik-Elektronik Mühendisliği'], // 259
  MBG: ['Moleküler Biyoloji ve Genetik'], // 112
  PDR: ['Rehberlik ve Psikolojik Danışmanlık'], // 114
  YBS: ['Yönetim Bilişim Sistemleri'], // 207
  // Üniversiteler
  ASBÜ: ['Ankara Sosyal Bilimler Üniversitesi'], // 58
  AYBÜ: ['Ankara Yıldırım Beyazıt Üniversitesi'], // 83
  BOÜN: ['Boğaziçi Üniversitesi'], // 43
  ÇOMÜ: ['Çanakkale Onsekiz Mart Üniversitesi'], // 192
  DEÜ: ['Dokuz Eylül Üniversitesi'], // 154
  ESOGÜ: ['Eskişehir Osmangazi Üniversitesi'], // 73
  GTÜ: ['Gebze Teknik Üniversitesi'], // 26
  GÜ: ['Gazi Üniversitesi'], // 177
  HÜ: ['Hacettepe Üniversitesi'], // 117
  İTÜ: ['İstanbul Teknik Üniversitesi'], // 94
  İÜ: ['İstanbul Üniversitesi'], // 240 (Cerrahpaşa dahil)
  İYTE: ['İzmir Yüksek Teknoloji Enstitüsü'], // 22
  KOÜ: ['Kocaeli Üniversitesi'], // 229
  KTÜ: ['Karadeniz Teknik Üniversitesi'], // 99
  MSGSÜ: ['Mimar Sinan Güzel Sanatlar Üniversitesi'], // 18
  MÜ: ['Marmara Üniversitesi'], // 154
  ODTÜ: ['Orta Doğu Teknik Üniversitesi'], // 90
  OMÜ: ['Ondokuz Mayıs Üniversitesi'], // 175
  PAÜ: ['Pamukkale Üniversitesi'], // 169
  SBÜ: ['Sağlık Bilimleri Üniversitesi'], // 164
  SDÜ: ['Süleyman Demirel Üniversitesi'], // 84
  YTÜ: ['Yıldız Teknik Üniversitesi'], // 62
};

// 1 literal term + up to 3 expansions = at most 4 LIKE branches per query. Measured cost
// is ~17 ms per branch on the largest score-type partition (9,155 rows, desktop CPU), so
// 4 branches stays comfortably inside the 250 ms search debounce even on slower phones.
export const MAX_ALIAS_EXPANSIONS = 3;

// Alias KEYS additionally fold ı→i so ASCII typing matches: trSearch('IIBF') → 'ııbf'
// while trSearch('İİBF') → 'iibf'. The fold applies only to dictionary-key lookup —
// never to the actual column-search patterns, which must stay aligned with the SQL
// normalization in programQueries.normalizedSqlColumn.
function foldAliasKey(value: string): string {
  return trSearch(value).replace(/ı/g, 'i');
}

// Validated at module load, mirroring the fail-fast zod convention in src/data/content.ts:
// a broken alias table should crash the build/tests, not silently degrade searches (an
// empty pattern would turn into a match-everything LIKE '%%').
const aliasLookup: ReadonlyMap<string, readonly string[]> = (() => {
  const lookup = new Map<string, readonly string[]>();
  for (const [alias, phrases] of Object.entries(RAW_ALIASES)) {
    const key = foldAliasKey(alias);
    if (!key) throw new Error(`Program search alias '${alias}' normalizes to empty text`);
    if (lookup.has(key)) throw new Error(`Program search alias key collision on '${key}'`);
    if (phrases.length < 1 || phrases.length > MAX_ALIAS_EXPANSIONS) {
      throw new Error(`Alias '${alias}' must expand to 1-${MAX_ALIAS_EXPANSIONS} phrases`);
    }
    const normalized: string[] = [];
    for (const phrase of phrases) {
      const value = trSearch(phrase);
      if (!value) throw new Error(`Alias '${alias}' expansion '${phrase}' normalizes to empty`);
      if (normalized.includes(value)) throw new Error(`Alias '${alias}' has duplicate expansions`);
      normalized.push(value);
    }
    lookup.set(key, normalized);
  }
  return lookup;
})();

/**
 * Expands a free-text program search into 1-4 normalized match terms. The literal term is
 * always first and always kept — a stale alias may stop adding matches but can never
 * regress a working literal search. Expansions apply only when the WHOLE trimmed query is
 * a known abbreviation (v1 rule; "odtü bilgisayar" stays literal-only by design).
 *
 * Returns plain trSearch-normalized strings with no SQL escaping: the SQLite caller wraps
 * each in escapeProgramLike + LIKE, the web fallback matches with String.includes.
 */
export function expandProgramSearch(term: string): string[] {
  const base = trSearch(term);
  if (!base) return [];
  const expansions = aliasLookup.get(foldAliasKey(term)) ?? [];
  return [base, ...expansions.filter((phrase) => phrase !== base)];
}

/** Raw table entries, exposed for the fixture-evidence drift test. */
export function programSearchAliasEntries(): [string, readonly string[]][] {
  return Object.entries(RAW_ALIASES);
}
