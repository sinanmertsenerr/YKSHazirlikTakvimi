# Content source pack

`content/` is the editable source of the bundled/offline pack. `assets/pack/` is generated; do not
hand-edit it.

## Data status

Every shipped pack file uses schema v2. Documents that carry `dataStatus` mark development-only
values with `sample: true`, estimates with `approximate: true`, and unverified values with
`verified: false`. A record can only become `verified: true` when its `source` contains the exact
official source URL and the contract requires a `verifiedAt` timestamp.

The topic taxonomy follows `PROMPT.md` Appendix A. Every topic contains the same contiguous yearly
coverage from 2018 through the pack's current last year (currently 2026). A newly appended year
starts at `count: null`, `verified: false`, with null provenance. `null` means unknown; numeric zero
is accepted only as a real, verified zero with an official source, registered booklet SHA-256,
`verifiedAt`, and
`verificationMethod`. A section/year must be wholly null or wholly verified numeric, and numeric
rows must total the official section question count exactly. Because ÖSYM booklets do not publish
topic labels, topic-level counts must use `verificationMethod: "editorial-consensus"`; the schema
reserves `official-direct` for metadata the primary source labels directly.

Question mappings carry an exact source exam, source section/subject, registered question-block ID,
official question number, booklet URL/hash, and editorial verification time. `primary` mappings are
the only records with `countsTowardStats: true`. A `related` mapping is always non-counting, its
`crossExam` flag must match the source/target exams, and its source and target subjects must belong
to one explicit discipline family (for example TYT Chemistry ↔ AYT Chemistry). This permits a real
cross-exam relationship to appear under both relevant topics without double-counting or allowing
arbitrary combinations such as Philosophy ↔ Chemistry/Biology.

Annual classifier candidates cannot populate these fields directly. Final ID-only human approvals
and their matching reports are retained under `content/topic-approvals/`; every numeric topic row
and question mapping must be reproducible from that durable ledger. Content-free mappings keep
descriptor, learning-outcome, and difficulty metadata null rather than inventing it. Religion-
exempt questions use the explicit non-counting `alternative` role and remain visible without
inflating the default answer path.

Unknown grade mappings are empty arrays with `gradeVerified: false`, `gradeApproximate: false`, and
no source. The app does not fabricate broad grade ranges. TYT/AYT structure and duration metadata
are separately verified against the official 2026 guide and carry `structureVerifiedAt`.

`coefficients.json` stores only the official 2026 rules that can be stated directly: D−Y/4,
standard-score mean/deviation, 100–500 scale, OBP rules, calculation eligibility, and percentage
weights. It deliberately exposes `calculation.status: "unavailable"` and no estimator because the
candidate distribution required for a personal score is not yet published. `rank-tables.json`
likewise exposes `availability: "unavailable"` with an empty table until official 2026 results and a
verified personal-rank model exist. No points-per-net coefficients or synthetic rank points are
allowed by the strict v2 schema.

## Official-source workflow

1. Read the primary source: ÖSYM booklet/guide/report or YÖK Atlas, according to the data type.
2. Store the precise public URL in `source`, set `verified: true`, and record the decision in
   `CHANGELOG.md`. Topic classification additionally requires an independently reviewed editorial
   consensus record; a booklet URL alone does not make a topic mapping official-direct.
3. Run `npx tsx scripts/validate-pack.ts`.
4. Run `npx tsx scripts/build-pack.ts`; this rebuilds `programs.db`, validates everything, and writes
   the SHA-256 manifest and immutable pack files to `assets/pack/`.

The official YKS calendar is refreshed with `npm run sync:calendar`. The command accepts only the
HTTPS ÖSYM host, limits redirects, response size, and request duration, requires a mutually
consistent TYT/AYT/YDT trio, validates the result, and atomically replaces `calendar.json`. During
ÖSYM's annual rollover the page may briefly list two exam years (or an incomplete next year); the
newest year carrying a complete trio is selected so the transition needs no manual intervention.
If the source is unavailable, no year is complete, or the page changes shape, it exits
unsuccessfully and leaves the last verified file untouched. Transient network failures are retried
with backoff at the CLI entry before the run is reported as failed. Dates that ÖSYM has not published—especially future preference windows—are never
inferred. The main YKS preference period is discovered separately from ÖSYM's canonical YKS
announcement list and is emitted only when one exact current-year “Tercihlerin Alınması” detail
contains one explicit start and one explicit end. Its civil date/time values use the
`Europe/Istanbul` contract; before that announcement exists there is no `tercih` event. Each
verified event includes its exact `source` and a `verifiedAt` timestamp.

Official YKS announcements are refreshed with `npm run fetch:news`. ÖSYM's year-specific YKS list
is the required canonical feed; if it is unavailable, redirects outside the official authority, or
changes its expected structure, the command exits unsuccessfully and preserves the last-good file.
YÖK news and announcement pages are optional supplements, and an item is accepted only when its
detail title and unambiguous update date agree with the list record. Every item stores the exact
list URL, detail URL, date-evidence method, and `verifiedAt`; source-only Turkish text is retained in
both locale fields. Scheduled and manual content publishing run this sync before validation and
pack construction, so invalid, generic, sample, unverified, or unsourced records cannot ship.

Official undergraduate program data is refreshed with
`npm run import:programs -- --expected-year <year>`. The importer uses only the public YÖK Atlas
preference-guide API, pins the expected snapshot year, paginates sequentially with a delay, retries
transient failures, enforces response-size and record-count guards, and atomically replaces the
fixture only after the complete snapshot passes Zod validation. Besides the merkezi levels
(lisans 46, önlisans 47) it sweeps the özel yetenek level (birimTuruId 48, ÖSYM TABLO 5) into the
`yetenek` score type; that level legitimately returns zero rows until each year's kılavuz loads
(an empty sweep is audited in provenance, never treated as a failure), its snapshot year is
independent of the merkezi year, and talent rows never carry central cutoffs. `programs.provenance.json` records
the API and application-bundle hashes, field mappings, counts, skipped source categories, and the
verification timestamp. Program labels are not machine-translated; the official Turkish source
text is retained in both locales. Run `npm run build:programs` after importing.

The same sweep also produces `programs-details.fixture.json`: the official YÖK Atlas detail data of
every program — quota categories with placed counts (genel, okul birincisi, deprem, şehit-gazi,
34+ kadın), full kosul texts, academic staff headcounts, tuition, accreditation, TYÇ, faculty,
district, program group, and the "Yerleşen Son Kişinin Netleri" archive (per program-year subject
nets, OBP, katsayı, and taban puan; published from 2023). Field semantics are proven against the
YÖK Atlas SPA's own rendering and canary-pinned in the importer; API fields the official UI never
labels (`tustt*`, `kpss*`, `dus`) are deliberately excluded. The current-year `placed` in
`programs.fixture.json` also comes from this sweep (`gkY`, the genel-yerleşen field the official
doluluk chart renders); historical placed counts still come from the ÖSYM archive. Fixture,
details, and provenance are written atomically together, and validate-pack cross-checks the nets
taban puan against the wizard's per-year minScore in both the fixtures and the built database.

The large deterministic fixtures can be regenerated with
`npx tsx scripts/lib/generate-topics.ts` and
`npx tsx scripts/lib/generate-program-fixture.ts`. The latter is an explicitly synthetic developer
fallback and must never be shipped over an imported YÖK Atlas fixture.

Schema-v1 manifests and active pointers are not migrated in place: the runtime falls back to the
bundled v2 pack. Downloads are validated in a staging directory and the active pointer changes only
after every JSON document, hash, size, and the schema-v2 program database have passed.

Never copy remembered or secondary-source numbers into a verified record. Unknown values remain
null or unavailable rather than becoming synthetic fixtures.
