# Security and Performance Review

Review date: 2026-07-18

## Scope

This review covers the Expo/React Native client, local SQLite/MMKV persistence, downloadable content-pack trust chain, YÖK Atlas ingestion, the Cloudflare annual-classifier Worker, GitHub Actions publication/release controls, dependencies, and high-volume client rendering/data paths.

The application is offline-first and has no end-user account backend. User study data remains on the device except for explicit backup sharing. The primary remote trust boundaries are the public content pack and the authenticated CI-only classifier endpoint.

## Baseline

### Quality and content gates

| Check                       | Baseline result                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| TypeScript                  | Passed                                                                                         |
| ESLint                      | Passed                                                                                         |
| Pack validation             | Passed: 591 topics, 660 official topic groups, 21,602 programs, 136,220 program-year rows      |
| Pack build                  | Passed                                                                                         |
| Annual publication ledger   | Passed                                                                                         |
| OGM source registry         | Passed: 7 included sources                                                                     |
| ÖSYM booklet registry       | Passed: 18 official TYT/AYT booklets                                                           |
| Cloudflare Wrangler dry-run | Passed; 7.63 KiB upload / 2.48 KiB gzip                                                        |
| Jest application suites     | 32 suites / 155 tests passed, but Jest exited non-zero after a late Expo native-logger warning |
| Node content suites         | 204 tests passed                                                                               |
| Expo Doctor                 | 19/20 checks passed; 8 Expo packages were one patch behind the SDK-recommended versions        |

The first unscoped Jest run also traversed `.claude/worktrees`, discovered many duplicate package/test trees, and exhausted a roughly 4 GiB Node heap. The project Jest configuration ignores `node_modules` and `scripts`, but not agent worktrees. This is a local developer/agent reliability issue; clean GitHub runners do not contain these worktrees.

The repository pins Node 22 in `.nvmrc`. The local shell default was Node 25.6.0; Node 22.23.1 was also exercised through `npx node@22`. The same late Expo logger warning remained, so the baseline records it separately from the 155 passing assertions.

### Dependency audit

| Population      | Info | Low | Moderate | High | Critical |
| --------------- | ---: | --: | -------: | ---: | -------: |
| Production tree |    0 |   0 |       12 |    0 |        0 |
| Complete tree   |    0 |   0 |       13 |    0 |        0 |

The moderate findings are concentrated in Expo CLI/config tooling and `uuid` through `xcode`/`exceljs`. `npm audit` proposes incompatible downgrades or broad major changes for several paths. No high or critical advisory was present at baseline. Findings must be remediated through compatible Expo patch releases or documented as build-time-only residual risk; broad forced audit fixes are not acceptable.

### Data and artifact size

| Artifact/table            |         Baseline |
| ------------------------- | ---------------: |
| `assets/pack/programs.db` | 50,978,816 bytes |
| `program`                 |      21,602 rows |
| `program_year`            |     136,220 rows |
| `program_condition`       |      50,316 rows |
| `program_quota_category`  |      49,128 rows |
| `program_net`             |      57,336 rows |

The representative latest-year/rank query uses `ix_program_score_type` and the `program_year` primary index, but performs correlated latest-year/availability lookups and a temporary B-tree sort. Query redesign remains measurement-gated because desktop timings were below the shell timer's resolution and do not represent physical-device SQLite behavior.

## Confirmed security findings

### S1 — Downloaded manifests are not authenticated

**Severity:** High integrity impact; no direct code execution in the current content model.

**Remediated.** The client now verifies a strict, canonical detached Ed25519 `manifest.sig` against an application-embedded public-key registry before version decisions, reuse, download, or activation, and it re-verifies stored downloaded manifests during startup resolution. Publishing signs only in the main-only `content-signing` GitHub environment; refresh/persistence jobs never receive the private key. Missing/invalid remote signatures force a repair publish. Rotation supports overlapping trusted keys and multi-signature envelopes.

### S2 — YÖK Atlas import redirects do not revalidate origin

**Severity:** Low to medium provenance risk.

**Remediated.** All four YÖK Atlas surfaces now share a manual redirect helper that permits only the exact official HTTPS origin, caps redirects, preserves POST only across 307/308, and rejects method-changing POST redirects. Tests cover the SPA document, bundle, program API, nets API, safe same-origin continuation, missing locations, and redirect loops.

### S3 — Classifier authentication lacks cost/rate containment

**Severity:** Medium if its bearer token is exposed or overused.

**Implemented and dry-run verified.** A Cloudflare-native binding limits the authenticated classifier principal to 60 requests per 60-second location-local window after bearer validation and before body allocation or `AI.run`. Missing/unavailable limiter configuration fails closed; exhaustion returns bounded `429`/`Retry-After`. Production Worker deployment remains an explicit outward-facing operation and has not been performed in this working-tree review.

### S4 — Release-native privacy/security policy is implicit

**Severity:** Conditional until production artifacts are inspected.

**Source/prebuild remediated; store artifacts pending EAS authentication.** `app.json` disables Android automatic backup and blocks `SYSTEM_ALERT_WINDOW` plus legacy external-storage permissions. A clean Expo prebuild emitted `tools:node="remove"` declarations, `allowBackup="false"`, no release cleartext/debug flag, and an explicitly exported launcher activity; CI now reproduces and validates this output. Fresh iOS prebuild kept ATS arbitrary loads disabled. Actual production AAB/IPA signing, effective merged policy, and entitlements still require authenticated EAS builds.

### S5 — No repeatable dependency/static-analysis gate

**Severity:** Medium process gap.

**Remediated.** Validation blocks high/critical production advisories, CodeQL uses least privilege and immutable action SHAs, and Dependabot reviews npm and GitHub Actions weekly without auto-merge. Expo packages were aligned to the SDK-recommended patch releases and Expo Doctor now passes 20/20 checks. The remaining audit population is 12 moderate production findings in Expo build/config tooling through `xcode`/`uuid`; npm's proposed fix is an incompatible Expo downgrade, so this remains documented build-time residual risk pending an upstream compatible release.

## Confirmed performance findings

### P1 — Normal hydration loads unbounded raw activity history

**Remediated.** Normal app hydration now queries one aggregate row per active day (question total plus distinct progressed-topic count); raw activity rows are loaded only through the provider's serialized explicit full-snapshot operation for export and pre-restore rollback. A 50,000-row SQLite test produced 200 bounded day summaries in about 56 ms while complete backup schemas/round trips remained unchanged.

### P2 — Exam history is not virtualized

**Remediated.** The progress route now uses `ScreenView`/`FlashList`, with filters, statistics, chart, breakdown, and add controls in the list header and swipeable exams as virtualized rows. The screen test verifies newest-first complete data plus open and accessibility-delete behavior.

### P3 — CI rebuilds the program database redundantly

**Remediated.** Validation and both publisher candidate paths now invoke only `build:pack`, which already builds the database and runs full source validation. A workflow contract test prevents reintroducing adjacent `validate:pack`/`build:pack` work. The local validated build completed in 3.72 seconds; the standalone `validate:pack` developer command remains available.

### P4 — Large catalog/update paths lack actionable timings

**Instrumented and benchmarked without speculative query changes.** Privacy-safe diagnostics now time catalog asset resolution/copy/hash/open/quick-check/prewarm, browse/search/favorites pages, content downloads, payload hashes/validation, and full backup snapshots without logging user values. The repeatable 30-iteration local benchmark measured p95 values of 10.466 ms (first browse page), 12.909 ms (normalized search), 1.586 ms (Ankara filter), and 13.237 ms (offset 1,200). Plans still show correlated latest-year lookups and a temporary sort, but measured desktop cost does not justify an index/FTS/materialization rewrite before physical-device evidence.

## Remediation verification to date

- Application Jest: 35 suites / 162 tests passed with 100% configured scoring coverage.
- Node content/security pipeline: 261 tests passed.
- TypeScript and ESLint: passed.
- Expo dependency compatibility: passed; Expo Doctor 20/20.
- Official content validation: annual publication ledger, 18 ÖSYM booklets, and 7 OGM sources passed.
- Content pack: built and fully validated once per candidate path; 21,602 programs / 136,220 program-year rows.
- Cloudflare: 13 focused Worker tests passed and Wrangler dry-run recognized the 60 requests/60 seconds binding (10.10 KiB upload, 3.11 KiB gzip).
- Pack signing: runtime and Node contract/tamper/rotation tests passed; Android Metro/Hermes export bundled the verifier (7.8 MiB HBC plus the 50,978,816-byte database asset); the main-only GitHub signing environment and secret were configured without retaining the private key locally.
- Formatting check remains a pre-existing repository gap: after excluding agent worktrees it reports 37 unrelated legacy files. Newly changed files were formatted; this review did not create a broad formatting-only diff.

## Accepted design decisions

- Android automatic backup will be disabled; user-controlled JSON export/import remains the supported migration path.
- Application-level SQLite/MMKV encryption is not being added. Current data sensitivity does not justify key recovery and migration failure modes beyond OS sandboxing plus disabled automatic backup.
- Expo web is a development/visual-preview target, not a supported production product surface. No unrelated hosting/CSP migration is included.
- Pack/database integrity, provenance validation, atomic staging, and rollback will not be weakened for performance.

## Follow-up remediation — 2026-07-19 (closure pass)

- **Classifier request limits are self-consistent at exact boundaries.** Base64 decoded size now subtracts standard padding, so an exact 5 MiB image is accepted and a one-byte oversize image is rejected. The transport ceiling is derived from two encoded images plus the worst-case JSON expansion of every accepted text/schema field, and request bodies are streamed under that ceiling instead of being allocated in full first: `infra/cloudflare/src/index.ts`, `scripts/__tests__/cloudflare-worker.test.ts`.
- **YÖK Atlas responses are read under a streaming byte ceiling.** `readBoundedText` cancels a response whose advertised `Content-Length` is oversized before reading, and cancels mid-stream once the cap is exceeded. The bounded reader covers the SPA document/bundle, program API, and nets API: `scripts/lib/yok-atlas-fetch.ts`, `scripts/lib/yok-atlas.ts`, `scripts/lib/yok-atlas-details.ts`, `scripts/import-yok-atlas-programs.ts`, `scripts/__tests__/yok-atlas-fetch.test.ts`.
- **CodeQL `js/bad-tag-filter` regexes were removed.** The four HTML→text consumers now use a shared `parse5` tree parser that omits script/style subtrees and comments, including browser-tolerated malformed closing tags, without treating regex output as sanitized HTML: `scripts/lib/html-text.ts`, `scripts/fetch-news.ts`, `scripts/lib/osym-preference-calendar.ts`, `scripts/lib/osym-booklet-discovery.ts`, `scripts/sync-calendar.ts`, `scripts/__tests__/html-text.test.ts`. Re-scan confirmation is pending the next CodeQL run on `main`.
- **Static-host signature MIME handling was corrected.** The publisher accepts `manifest.sig` under `application/pgp-signature` while continuing to JSON-parse and Ed25519-verify its bytes; `manifest.json` still requires a JSON Content-Type. A production-shaped regression test covers the GitHub Pages response.

Gates re-run after this pass: TypeScript, ESLint, Jest (162), Node content/security (238), production dependency audit, and Cloudflare dry-run — all passed.

## Follow-up remediation — 2026-07-19 (parser-migration hardening pass)

A 15-finding max-effort review of the previous closure pass, followed by a four-dimension impact analysis, drove these fixes:

- **Legacy ÖSYM pseudo-entities are decoded again.** The parse5 migration had silently dropped the hand-rolled `odot/Odot/udot/Udot → ö/Ö/ü/Ü` mappings (per HTML5, `&odot;` is U+2299 ⊙ and the other three are undefined), which could break the calendar label match, silently drop the preference-calendar event, and corrupt news titles. A single normalization now runs upstream of BOTH the text path (`htmlToText`) and the attribute path (`decodeHtmlEntities`), so the two paths can never diverge; parity is pinned by test. Standard entities now come from the full HTML5 table (`entities@6`, pinned as a direct devDependency to avoid the hoisted 4.x copy). `scripts/lib/html-text.ts`, `scripts/__tests__/html-text-hardening.test.ts`.
- **HTML traversal is iterative and complete.** The recursive walker crashed with `RangeError` at real-world-plausible nesting depths (reproduced at 5–10k) and silently dropped `<template>` content (parse5 stores it under `content`, not `childNodes`). The walker now uses an explicit stack (tested at 50,000 levels), traverses template content, and skips `noscript` (parse5 parses it as RAWTEXT, which would leak inner markup as literal text). parse5's exported types replaced the unchecked `as unknown as` cast. Known accepted parser semantic: foster-parenting hoists stray text out of malformed tables ahead of the table (source order changes); this is pinned by test, and the order-sensitive consumers fail closed on it.
- **Whitespace normalization and attribute parsing are single-sourced.** The three drifted per-file `decodeHtml` tables (16–31 entries, one with a case-insensitive fallback) and three `attributeValue` variants were deleted in favour of the shared module; the shared `attributeValue` uses the strictest of the three matchers (no `data-href` prefix matches) and a unified `string | undefined` return. Call-site `.replace(/\s+/g, ' ').trim()` wrappers were absorbed into `htmlToText`'s default mode.
- **"Cancel before throwing" is now an invariant across every official-source reader.** The previous pass fixed it in `yok-atlas-fetch` only; the same commit's sibling readers still leaked. A shared `scripts/lib/fetch-safety.ts` (`cancelBody`, `assertDeclaredContentLength`) is now used by `sync-calendar`, `osym-preference-calendar`, and `yok-atlas-fetch`; `osym-booklet-discovery` gained the missing cancel on its declared-length rejection; redirect-follow, non-OK, and content-type failure paths in the two calendar fetchers now cancel before throwing or continuing. `fetch-news` was already fully compliant and was intentionally left untouched. `cancelBody`'s swallowing catch is load-bearing (cancelling an already-locked stream throws) and documented as such.
- **Content-Length validation is strict and uniform.** Malformed headers (for example a merged `"12, 12"`, a request-smuggling signal per RFC 9112 §6.2) are now rejected before streaming in all readers and in the Worker, matching the pattern `fetch-news` already ran in production. A live probe of `www.osym.gov.tr` confirmed the real server emits plain-digit values (`content-length: 313` on the 302 hop), so the strict check is compatible with the production source.
- **The Worker's transport ceiling is provably generous and its input contract bans control characters.** The previous derivation undercounted the schema's wire cost (3 bytes/char vs the 6-byte `\uXXXX` reality) and assumed exactly-2-image vision requests (1 image + 6 text parts is valid). The ceiling is now `(2×450k + 7×80k + 32k)×6 + 64 KiB ≈ 9.02 MB` non-image + two encoded images ≈ 21.93 MiB total, with admission tests at the new boundaries (including an `ensure_ascii`-style fully escaped wire body). C0 control characters outside `\t\n\r` are rejected in message text (invisible-character prompt-manipulation and broken-PDF-extraction hygiene); the schema is exempt with documented rationale (raw C0 in the body is invalid JSON already, and the schema is static and code-authored). The same predicate is exported and reused by `splitPdfText`, which now strips stray C0 bytes from `pdftotext` output before they can 400 the annual classification pass — the worker ban and the client sanitizer cannot drift apart. `readJsonBody` streams under the cap and decodes via `Blob` (a legibility/reuse win — the peak-memory profile is unchanged, deliberately not claimed as a memory fix). Memory note documented in code: at ≈21.93 MiB per request and the orchestrator's concurrency of 2, peak isolate usage approaches but should not reach the 128 MiB limit; raising client concurrency must revisit the ceiling. A workerd-local memory smoke under 2 concurrent maximal requests was **not** run in this pass (documented gap).
- **Known accepted costs.** parse5 parsing measured ~7× slower than the removed regex chain (0.37→2.70 ms per 100 KB; super-linear on formatting-tag-dense inputs, ~4.6 s worst-case at the 2 MB response cap) — absolute impact on the 6-hourly scheduled jobs is sub-second to seconds and accepted; the byte caps bound it. The Worker and `scripts/lib` intentionally keep separate bounded-read implementations (deploy-boundary constraint); the shared-predicate export is the only cross-import, in the safe direction (scripts import the worker module, as its tests already did).

Gates re-run after this pass: TypeScript (clean), ESLint (clean), Node content/security **261 tests** (238 → 261; 23 added: 12 html-text hardening, 5 fetch-safety, 4 Worker contract, 1 YÖK Atlas malformed-header, 1 `splitPdfText` sanitization), Cloudflare dry-run (10.10 KiB upload / 3.11 KiB gzip, rate-limit binding recognized), live ÖSYM header probe — all passed. Dependabot version-update PRs were closed and disabled by policy (`open-pull-requests-limit: 0`; security updates remain active via repository settings), so `main` is the only branch.

## Verification still required

- Signed-pack publication is now **live** (closed): schema 3, key ID `pack-2026-01`, with `manifest.sig` served and deploy-time signature/size/SHA-256 verification passing.
- CodeQL re-scan on `main` to confirm the four `js/bad-tag-filter` alerts clear after the parser migration.
- Branch protection / ruleset on `main` (required status checks including CodeQL, no force-push/deletion) is not yet configured; open high alerts do not currently block merges.
- Production Cloudflare Worker deployment of the rate-limit binding — intentionally deferred to a separate outward-facing action.
- EAS production Android/iOS artifact creation and signing/manifest/entitlement inspection (interactive EAS authentication required).
- Native-device measurements for catalog first-open, changed-pack installation peak memory/battery, and large-history scrolling; repository-level instrumentation is in place.

This document will be updated with residual advisories and final pass/fail counts as the remaining outward-facing and on-device verifications are performed.
