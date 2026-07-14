# Official ÖSYM booklet registry

`osym-booklets.json` currently pins the official TYT and AYT booklets for every exam year from
2018 through its declared `coverage.lastYear` (currently 2026). The schema requires a contiguous,
ordered TYT/AYT pair for every year and supports future coverage through 2100. It is a provenance
and booklet-structure registry, not a question bank.

The registry stores only:

- the official ÖSYM release page and direct PDF URL;
- exam year, session, and date;
- the last successful verification date, byte length, and SHA-256 digest;
- official session/section question counts; and
- exact, content-free question blocks read from official booklet headers.

It never stores question text, answer choices, figures, screenshots, summaries, answers, or other
question content. ÖSYM owns the booklet copyright. Application surfaces may link to the official
source but must not copy source material into this repository or the content pack.

## Exact question blocks

Registry schema v2 contains one normalized `questionBlockProfiles` entry for TYT and one for AYT.
The current profile was checked against all nine pinned official booklets for that session
(2018–2026), so all 18 current booklet-header checks agree. Every future pair must pass the same
structural-header verification before it can become a review candidate. Each block records:

- the app taxonomy `sectionId` and official `bookletSectionId`;
- inclusive `officialQuestionRange` values using that booklet section's printed numbering;
- the allowed taxonomy `subjectIds` union;
- the `default` or `no-dkab` answer set;
- whether it replaces a religion block; and
- whether it contributes to canonical default statistics.

The verified normalized structures are:

| Session / booklet section                    | Official blocks                                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| TYT Türkçe                                   | Türkçe 1–40                                                                                                      |
| TYT Sosyal Bilimler                          | Tarih 1–5; Coğrafya 6–10; Felsefe 11–15; Din Kültürü 16–20; `no-dkab` alternatif Felsefe 21–25                   |
| TYT Temel Matematik                          | Matematik + Geometri ortak taksonomi bloğu 1–40                                                                  |
| TYT Fen Bilimleri                            | Fizik 1–7; Kimya 8–14; Biyoloji 15–20                                                                            |
| AYT Türk Dili ve Edebiyatı–Sosyal Bilimler-1 | Edebiyat 1–24; Tarih-1 25–34; Coğrafya-1 35–40                                                                   |
| AYT Sosyal Bilimler-2                        | Tarih-2 1–11; Coğrafya-2 12–22; Felsefe Grubu 23–34; Din Kültürü 35–40; `no-dkab` alternatif Felsefe Grubu 41–46 |
| AYT Matematik                                | Matematik + Geometri ortak taksonomi bloğu 1–40                                                                  |
| AYT Fen Bilimleri                            | Fizik 1–14; Kimya 15–27; Biyoloji 28–40                                                                          |

The booklet headers do not publish a Mathematics/Geometry split. Consequently, the registry does
not invent one: each math question is classified against the full section taxonomy, and actual
per-subject totals are derived only from reviewed records.

## Count semantics

`questionsToAnswer` is the number a candidate is instructed to answer. `questionsPrinted` also
includes the alternative religion/philosophy blocks printed in the booklet. This is why TYT has
120 questions to answer but 125 printed, while AYT has 160 to answer but 166 printed.

For the affected social-sciences booklet section, both the normal and religion-exempt paths retain
the official answer total: 20 in TYT and 40 in AYT. Alternative `no-dkab` blocks are preserved as
evidence but have `countsTowardDefaultStats: false`, so they cannot be added to the corresponding
default religion block or inflate canonical totals.

These are booklet-structure counts, not post-objection scored-item counts. Cancellations or answer
key amendments require their own dated ÖSYM decision source and must not be inferred from a
booklet hash.

## Verification commands

Local schema validation does not access the network:

```sh
npm run validate:booklets
```

The live audit streams each allowlisted official PDF through SHA-256 without saving the PDF:

```sh
npm run check:booklets
```

`npm run sync:booklets` refreshes observed PDF metadata only when every byte length and hash still
matches. It explicitly preserves `questionBlockProfiles`; a network sync cannot silently re-attest
booklet structure. If ÖSYM changes a PDF, the command fails closed. After a human reviews the
official release, booklet headers, and any amendment, an intentional metadata update requires the
explicit command:

```sh
npx tsx scripts/sync-osym-booklets.ts --write --accept-changes
```

Every redirect is rechecked against the exact `dokuman.osym.gov.tr` / `cdn.osym.gov.tr` allowlist;
responses must be HTTPS PDFs with a valid PDF signature and remain below the configured size cap.
Writes use a same-directory temporary file and atomic rename.

## Future-year discovery

Future years do not require a mobile app version change. The discovery command follows only the
canonical ÖSYM YKS list, its single matching publication announcement, its single detail page, and
the canonical ÖSYM calendar. It requires exactly one allowlisted TYT PDF and one allowlisted AYT
PDF, streams each file to a private temporary path while computing byte length and SHA-256, and
uses Poppler to verify every expected official section header. Missing, duplicate, redirected, or
structurally changed sources fail closed.

```sh
npm run discover:booklets -- --year 2027 --output tmp/osym-booklet-discovery/2027-candidate.json
```

The command can write only a new direct-child JSON file in `tmp/osym-booklet-discovery/`; it cannot edit
`content/`, `assets/`, or the registry. The scheduled/manual GitHub workflow uploads this candidate
as a short-lived artifact with `contents: read` permission. It never commits, opens a pull request,
publishes a pack, or increments an app version. A human must compare the official announcement,
calendar dates, hashes, section evidence, and any later ÖSYM amendment before intentionally
promoting the two records.

## Topic classifications

ÖSYM booklets identify tests and question numbers but do not provide the app's topic taxonomy or
difficulty labels. Therefore, no topic mapping is represented as ÖSYM-authored data. Editorial
mappings live separately under `content/topic-annotations/`, identify their review method, and
require two documented independent reviews before a statistics report can be produced.
Related mappings are explicitly non-counting and limited to declared discipline families (for
example TYT Chemistry ↔ AYT Chemistry); unrelated cross-discipline tags fail validation.
