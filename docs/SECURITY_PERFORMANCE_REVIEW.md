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
- Node content/security pipeline: 227 tests passed.
- TypeScript and ESLint: passed.
- Expo dependency compatibility: passed; Expo Doctor 20/20.
- Official content validation: annual publication ledger, 18 ÖSYM booklets, and 7 OGM sources passed.
- Content pack: built and fully validated once per candidate path; 21,602 programs / 136,220 program-year rows.
- Cloudflare: 6 focused Worker tests passed and Wrangler dry-run recognized the 60 requests/60 seconds binding (8.32 KiB upload, 2.66 KiB gzip).
- Pack signing: runtime and Node contract/tamper/rotation tests passed; Android Metro/Hermes export bundled the verifier (7.8 MiB HBC plus the 50,978,816-byte database asset); the main-only GitHub signing environment and secret were configured without retaining the private key locally.
- Formatting check remains a pre-existing repository gap: after excluding agent worktrees it reports 37 unrelated legacy files. Newly changed files were formatted; this review did not create a broad formatting-only diff.

## Accepted design decisions

- Android automatic backup will be disabled; user-controlled JSON export/import remains the supported migration path.
- Application-level SQLite/MMKV encryption is not being added. Current data sensitivity does not justify key recovery and migration failure modes beyond OS sandboxing plus disabled automatic backup.
- Expo web is a development/visual-preview target, not a supported production product surface. No unrelated hosting/CSP migration is included.
- Pack/database integrity, provenance validation, atomic staging, and rollback will not be weakened for performance.

## Verification still required

- EAS production Android/iOS artifact creation and signing/manifest/entitlement inspection (interactive EAS authentication is still required).
- Native-device measurements for catalog first-open, changed-pack installation peak memory/battery, and large-history scrolling; repository-level instrumentation is in place for collection.
- Signed-pack publication and deployed signature/hash smoke verification after the reviewed diff reaches `main`; the current public pack remains unsigned until that deployment.
- Production Cloudflare Worker deployment of the rate-limit binding, intentionally not performed without a separate outward-facing deployment action.
- CodeQL results after the new workflow reaches GitHub and runs.

This document will be updated with remediation commits/diffs, after measurements, residual advisories, and final pass/fail counts as implementation proceeds.
