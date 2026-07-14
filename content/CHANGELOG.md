# Content changelog

## 2026-07-14 — Exact official question-block pipeline

- Verified the printed section headers in all 18 pinned 2018–2026 TYT/AYT booklets and added exact
  official ranges, taxonomy unions, answer sets, and alternative-block semantics to registry v2.
- Replaced local subject numbering and assumed Mathematics/Geometry splits with exact official
  numbering and question-level primary classifications; actual mixed-section totals are derived.
- Added strict schema-v2 primary/secondary review normalization, independent consensus, and
  explicit non-counting related-topic discovery with cross-exam scope validation.
- Kept `no-dkab` alternative blocks as evidence-only mappings so default and exempt answer paths
  remain TYT 20 / AYT 40 without canonical-stat double counting.
- Preserved the existing 2026 TYT Turkish 39/40 consensus and unresolved question 20. No topic
  catalog statistic was written by this structural migration.

## 2026-07-14 — Official 2026 YKS announcements

- Replaced the sample news fixture with eight verified announcements from the official 2026 ÖSYM
  YKS list. The current strict sync found no qualifying YÖK supplement, so the published split is
  ÖSYM 8 / YÖK 0.
- Added a required verification timestamp and exact list URL, detail URL, and published-date
  evidence provenance to every item. Source-language Turkish is retained identically in both
  locale fields instead of fabricating translations.
- Made the production news contract fail closed: generic/non-YKS, sample, approximate, unverified,
  unsourced, authority-mismatched, duplicate, or malformed records are rejected before pack build.
- Added the official refresh to scheduled/manual publishing; an ÖSYM failure preserves the
  last-good file and fails the workflow.

## 2026-07-14 — Fail-closed schema v2

- Bumped every shipped pack document, the manifest, and the program database metadata to schema v2;
  schema-v1 manifests and active pointers are rejected instead of being interpreted under new
  semantics.
- Replaced 3,231 synthetic topic-count zeros with `null`. Numeric rows now require a source,
  `verifiedAt`, and `verificationMethod`; an entire section/year must be wholly null or wholly
  verified numeric and must total its official question count exactly.
- Reset unknown grade mappings to empty arrays and recorded the TYT/AYT structure against the
  official 2026 YKS guide with a verification timestamp.
- Removed points-per-net fixtures and the obsolete 150 threshold. Stored only the official D−Y/4,
  standard-score, 100–500 scale, OBP, eligibility, and exact percentage-weight rules while keeping
  personal score estimation unavailable.
- Removed every synthetic score-rank point. The 2026 rank document remains unavailable with an
  empty table until the scheduled 2026-07-22 results and a verified model are published.
- Kept the official calendar and YÖK Atlas program snapshot unchanged apart from their schema
  migration. The sample news fixture was superseded by the official-announcement sync above.

## 2026-07-14 — Official 2025 YÖK Atlas undergraduate programs

- Imported the public YÖK Atlas `snapshot` through its official preference-guide API: 5,653 SAY,
  3,987 EA, and 1,948 SÖZ source rows.
- Published 11,444 representable DEVLET/VAKIF/KKTC programs and 41,130 current/previous-three-year
  rows with program-level source links and `verifiedAt` timestamps.
- Mapped only the fields proven by the current YÖK Atlas application: current `kontenjan`,
  `minPuan`, `basariSirasi` and historical `gk1..3`, `minPuan1..3`, `basariSirasi1..3`.
- Kept `placed` null because no proven year-by-year placed-count field was imported.
- Preserved `%25`, `%50`, burslu, and ücretli categories without coercion. Kept official Turkish
  names as source-only labels instead of fabricating English translations.
- Excluded 144 `YURTDISI KAMU`/`YURTDISI VAKIF` rows because the program type contract cannot
  represent them faithfully; exact counts and the application bundle SHA-256 are recorded in
  `programs.provenance.json`.

## 2026-07-14 — Official 2026-YKS calendar

- Replaced speculative 2027 calendar fixtures with the six dates currently published in the
  [ÖSYM exam calendar](https://www.osym.gov.tr/TR,8797/takvim.html?category_id=1): application,
  late application, TYT, AYT, YDT, and result dates.
- Preserved published start/end times where ÖSYM provides them and attached `source` plus
  `verifiedAt` to every event.
- Did not add a 2026 preference window because ÖSYM currently displays no preference dates.
- Added a fail-closed, allow-listed and atomic calendar sync used by scheduled content builds.

## 2026-07-14 — Initial source pack

- Added the complete TYT/AYT Appendix A taxonomy with TR/EN names.
- Added zero, unverified yearly placeholders for 2018–2026.
- Normalized the repeated TYT Biology entries (“Madde Geçişleri” through “Kalıtım”) to one unique
  topic each; the repetition in Appendix A is treated as an editorial duplicate, not extra topics.
- Added clearly marked synthetic coefficient, rank, calendar, news, and 100-program fixtures.
- No official statistics, dates, coefficients, ranks, scores, or programs were marked verified.
