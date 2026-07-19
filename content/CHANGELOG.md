# Content changelog

## 2026-07-19 — Özel yetenek boş durumu dürüstleştirildi; cron kadansı yorumları düzeltildi

- YETENEK sekmesinin boş durumu artık geçmiş-veri beklentisini de yönetiyor (TR+EN): merkezî
  yerleştirme olmadığı için geçmiş yıllara ait taban puan verisinin bulunmadığı eklendi.
  Dış gerçek canlı doğrulandı (2026-07-19): YÖK Atlas search API'sinde yıl parametresi yok
  (yalnız güncel kılavuz snapshot'ı) ve ÖSYM, Tablo-5 için Tablo-3/4 benzeri arşiv dosyası
  yayımlamıyor — geriye dönük doldurulacak resmî kaynak mevcut değil.
- `validate:pack` ilk gerçek TABLO 5 import'unu artık aktif işaretliyor: `yetenek` satır
  sayısı 0'ın üzerine çıktığında, ERROR tabanı hâlâ 0 iken WARN üretiyor (pasif TODO →
  kendiliğinden tetiklenen sinyal; taban yükseltilince blok silinir).
- Beş yerde kalmış "haftalık cron" ifadesi "günlük"e düzeltildi (cron 2026-07-17'de
  `47 3 * * *`'a alınmıştı; davranış değişikliği yok, yalnız yorum/doküman):
  `programlar.tsx`, bu changelog'un 2026-07-16 girdisi, `content-health.yml`,
  `import-osym-archive.ts`, `build-programs.ts`.

## 2026-07-16 — Özel yetenek (TABLO 5) programları uçtan uca; sıralama ve BESYO araması düzeltildi

- Program şemasına 6. puan türü eklendi: `yetenek` (özel yetenek sınavı ile alan programlar,
  ÖSYM TABLO 5). Bilinçli tasarım: `admission` kolonu YERİNE enum değeri — eski uygulama
  binary'leri değeri runtime doğrulamasında düşürür ve bu satırları hiç göstermez (sızıntı yok),
  paylaşılan `CURRENT_SCHEMA_VERSION` hiç zıplamaz (zıplasaydı eski binary'ler tüm pack
  güncellemelerini sonsuza dek reddederdi).
- Importer artık YÖK Atlas'ın üçüncü sihirbaz seviyesini de tarıyor: `birimTuruId: 48`
  ("ÖZEL YETENEK", canlı doğrulandı 2026-07-16; SPA bundle canary token'ı sözleşme denetimine
  eklendi). Seviye şu an 0 satır dönüyor (`yil: 2026` — TABLO 5 her yılın kılavuzuyla yüklenir;
  2025 kılavuzu 30 Temmuz'da yayımlanmıştı) ve boş sweep bilinçli olarak başarı sayılıyor
  (`allowEmpty`). İlk gerçek veri geldiğinde günlük cron otomatik alır; ilk dolu import'un
  provenance artefaktını `workflow_dispatch` ile insan gözüyle denetlemek önerilir.
- Liste sıralaması düzeltildi: sıralama anahtarı artık "en son yılın sıralaması" değil "sıralaması
  YAYIMLANMIŞ en son yıl". Güncel yılı henüz açıklanmamış programlar (ör. 4 Beden Eğitimi ve Spor
  Öğretmenliği programının 3'ü) artık listenin dibine gömülmüyor; kart, sıralamayı kazanan yılın
  değerlerini o yılın etiketiyle gösteriyor, hiç verisi olmayanlar "henüz açıklanmadı" diyor.
- BESYO araması genişletildi: alias tavanı 3→5; `Antrenörlük` ve `Egzersiz ve Spor` eklendi
  (canlı fixture kanıtlı: 1 + 3 eşleşme).
- CI'ya §9.1 semantik kapsam eşikleri eklendi (`validate:pack`): toplam ve puan türü başına
  ERROR tabanları (2025 snapshot'ının ~%25-30 altı), spor ailesi ve güncel yıl doluluk WARN'ları;
  `yetenek` tabanı 0 (ilk gerçek TABLO 5 import'undan sonra yükseltilecek — TODO işaretli).
  `content-health` artık yayımlanan `programs.db`'nin bütünlüğünü de bağımsız doğruluyor.
- Geri alma tarifi: bozuk bir program yayını, önceki fixture'ın DAHA YENİ bir `packVersion` ile
  yeniden yayımlanmasıyla geri alınır (istemciler yalnız kesin-daha-yeni sürümü kurar; eski sürüm
  numarası tekrar servis edilemez).

## 2026-07-15 — Future MEB editions ingest without a code change; honest 2026 UI

- Loosened the OGM registry schema so a future MEB edition (same content ids, a 2018-2026 span,
  re-verified on any later date) passes audit with no code edit: `observedAt` is now date-shaped,
  `coverage.lastYear` is a 2025-2100 range, and each book title must state the registry's exact
  coverage span (fails closed on a title/coverage mismatch). Registry data itself is unchanged
  (still 2018-2025) — only the accepted shape widened.
- Per-topic screens now state "2026 dağılımı MEB OGM tarafından henüz yayımlanmadı" instead of
  silently omitting the year, matching the answer already shown on the official-groups screen.
- Deliberately NOT done this turn (YAGNI + §9.1): speculative widening of the extraction/build
  year axis to 2026 before MEB actually publishes that edition — it would be untestable against a
  format we haven't seen and risks the working 2018-2025 pipeline. It lands with real data the
  day MEB's new edition is detected by `check:ogm-new-editions`.

## 2026-07-15 — 2026 review corpus migrated to the official MEB taxonomy

- Migrated all 27 review/draft files under `content/topic-annotations/` from the pre-MEB topic
  ids to the official taxonomy via the reviewed `legacy-id-map.json` (121 mappings with
  editorial notes; hash-neutral — no stored hash covers topic ids). The consensus batch was
  regenerated with `compare-topic-reviews` (`--current-date 2026-07-14`), never hand-edited.
- TYT Turkish stays 39/40 agreed with question 20 disputed; under the coarser official taxonomy
  the third review now forms a documented 2/3 majority for `tyt-turkce-paragrafta-anlam` (see
  `topic-annotations/README.md`). The annual-classifier content-test backlog is closed: 167/167.

## 2026-07-15 — Official-source automation becomes alert-only and visible

- Added `check:ogm-new-editions` (scans the official MEB landing page for new/removed content
  ids against the pinned registry; alert-only, never writes) to the weekly OGM audit.
- Every official-source workflow now reports through a deduplicated GitHub issue instead of a
  silent red run: OGM audit failures, ÖSYM booklet audit failures, weekly content-refresh
  failures, and newly produced ÖSYM discovery candidates (success-path notification).

## 2026-07-15 — YDT (Yabancı Dil) exam added end-to-end

- Included MEB OGM source 176298 (YDT İngilizce, 2018-2025) in the audited registry with live
  API provenance (bookObjectId, SHA-256, 12 tests / 640 questions) and extracted its official
  "KONU BAZLI SORU DAĞILIM TABLOSU" (12 categories × 8 years, 80 questions per year).
- Added the `ydt` exam to the taxonomy (duration 120 min per the pinned 2026 guide line "YDT ...
  120 dakika sürecektir"; 80 questions per the official MEB table), subject `ydt-ingilizce`
  with the 12 official categories as study topics.
- Added the DİL score type: weightsPercent `dil` = TYT 40 / YDT 60 per guide Tablo 1E, and
  imported 664 DİL-scored programs from YÖK Atlas (total 12108 programs).
- UI notes that YDT data comes from the English booklet only; other language sessions have no
  published official distribution.

## 2026-07-15 — Study topics adopted from the official MEB OGM taxonomy

- Replaced the 359 hand-authored study topics with 591 topics generated 1:1 from the official
  MEB OGM topic groups (`scripts/build-topics-from-official.ts`); topic ids are now
  subject-prefixed official group ids. Yearly per-topic counts render from the official
  statistics bridge; `topics.json` yearlyStats remain null placeholders reserved for the
  ÖSYM-booklet editorial-consensus pipeline.
- KNOWN FOLLOW-UP: the 2026 topic-annotation review corpus (content/topic-annotations/) still
  references the pre-MEB topic ids and must be re-reviewed against the new taxonomy; until then
  the annual-classifier content tests stay red (13 failures) by design (fail-closed).

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
