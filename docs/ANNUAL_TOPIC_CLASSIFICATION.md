# Annual official-question classification

The annual classifier is a fail-closed editorial aid. GitHub Actions is the canonical control
plane: it validates the pinned ÖSYM registry, downloads the exact official PDF, verifies its byte
length and SHA-256, extracts temporary evidence with Poppler, runs two independent model passes,
validates every response locally, and uploads ID-only review/dispute files. It never publishes topic
statistics automatically.

Cloudflare is an optional private inference gateway, not the source of truth. The allowlist is
fixed to:

- text pass: `@cf/qwen/qwen3-30b-a3b-fp8`
- vision pass: `@cf/google/gemma-4-26b-a4b-it`

Cloudflare documents Workers AI bindings through `env.AI.run()` and OpenAI-compatible multimodal
message parts (`text` plus a data-URI `image_url`). The pinned model pages are:

- <https://developers.cloudflare.com/workers-ai/configuration/bindings/>
- <https://developers.cloudflare.com/ai/models/@cf/qwen/qwen3-30b-a3b-fp8/>
- <https://developers.cloudflare.com/ai/models/@cf/google/gemma-4-26b-a4b-it/>
- <https://developers.cloudflare.com/workers-ai/platform/data-usage/>

## Privacy boundary

Question text and rendered pages exist only in a random operating-system temporary directory and
in authenticated inference request bodies. The CLI removes the directory in a `finally` block.
Neither the CLI nor Worker logs request/model content. The Worker has no KV, R2, D1, Cache API, or
Analytics Engine binding and returns `Cache-Control: no-store`.

The local cache contains only:

- official booklet SHA-256
- taxonomy SHA-256
- exact model and prompt version
- pass/block/unit IDs
- schema-validated topic-ID decisions

Invalid model output is discarded in memory and is never cached. Output/cache writers also reject
content-like keys and embedded data URLs. GitHub uploads only the three JSON files per block:

- `*.text.review.json`
- `*.vision.review.json`
- `*.report.json`

The report records confidence and `agreed`, `needs-review`, or `disputed` consensus. A missing,
invalid, or conflicting first pass gets one independent retry wave; unresolved IDs become disputes.
Even fully agreed results require human adjudication before the existing topic publication pipeline
may consume them.

## Worker setup

Create a random token with at least 32 characters, then configure and deploy the Worker without
writing the token to a file:

```sh
npm ci
npm run validate:cloudflare
npm run secret:cloudflare
npm run deploy:cloudflare
```

Disable request-body observability/logging for this Worker. Add these GitHub Actions secrets:

- `CF_CLASSIFIER_ENDPOINT`: deployed HTTPS URL ending in `/v1/classify`
- `CF_CLASSIFIER_TOKEN`: the same private token

The Worker rejects unauthenticated requests, remote image URLs, unknown models, model/mode
mismatches, oversized bodies/images, extra request fields, and inference timeouts.

## Local dry run

Install Poppler (`pdftotext` and `pdftoppm`), export credentials from a private shell, and run an
exact registry block:

```sh
export CF_CLASSIFIER_ENDPOINT='https://classifier.example/v1/classify'
export CF_CLASSIFIER_TOKEN='replace-with-a-random-secret'
npm run classify:annual -- \
  --year 2026 \
  --exam tyt \
  --block-id tyt-sosyal-tarih-default \
  --dry-run
```

With no Cloudflare secrets, the same command with explicit `--dry-run` performs a credential-free
local preflight: it validates the registry, taxonomy, year/session, and selected official blocks,
then exits without downloading a PDF, calling a model, or writing an artifact. A real two-pass
classification run still requires both secrets.

Use `--all-blocks` instead of `--block-id` for a full session. Outputs are restricted to
`tmp/annual-topic-classifier/`; caches are restricted to `.cache/annual-topic-classifier/`. Both are
gitignored. `--publish` is deliberately rejected.

Validate a produced directory before it can become an artifact:

```sh
npm run validate:annual-artifacts -- tmp/annual-topic-classifier/2026-tyt
```

The validator cross-links the text review, vision review, and report question by question. Matching
filenames are insufficient: nested/outer official numbers, decisions, PDF hash, taxonomy hash,
models, scope, and consensus metadata must all agree.

## Human approval and deterministic apply

Classifier output is never an approval. Prepare a blank ID-only human decision file from one
validated report:

```sh
npm run review:annual -- --prepare \
  --report tmp/annual-topic-classifier/2026-tyt/2026-tyt-tyt-turkce-default.report.json \
  --output tmp/annual-topic-review/2026-tyt-turkce.approval.json
```

The template deliberately does not copy an AI answer into an approved field. A human editor must
inspect the official PDF and fill every exact official question number with `status: "approved"`,
one primary taxonomy ID, and zero or more non-counting related taxonomy IDs; then set the document
decision, a `human-...` editor pseudonym, and review date. The strict schema rejects question text, summaries,
descriptors, learning outcomes, difficulty labels, images, prompts, and extra fields. Validate it:

```sh
npm run review:annual -- --validate \
  --review tmp/annual-topic-review/2026-tyt-turkce.approval.json \
  --report tmp/annual-topic-classifier/2026-tyt/2026-tyt-tyt-turkce-default.report.json
```

Before publication, copy the final approval and matching report as a same-slug pair under
`content/topic-approvals/`. This checked-in ID-only ledger is permanent provenance; the 14-day
workflow artifact is not treated as durable approval. Then run every approval needed to complete a
whole canonical section in one transaction:

```sh
npm run apply:annual -- --dry-run \
  --review content/topic-approvals/2026-tyt-turkce.approval.json \
  --report content/topic-approvals/2026-tyt-turkce.report.json

npm run apply:annual -- --write \
  --review content/topic-approvals/2026-tyt-turkce.approval.json \
  --report content/topic-approvals/2026-tyt-turkce.report.json
```

The apply step requires complete default-block coverage for the section, checks the official PDF
URL/SHA and base topic semantic hash, and writes exact source identities plus verified yearly
counts. Primary mappings count exactly once. Related mappings and explicit `alternative` no-DKAB
mappings never count. Because the approval is content-free, descriptor, outcome, and difficulty
remain null; the app shows the official year/session/question number and opens the pinned PDF.

Existing exact output is a byte-level no-op. A differing published target fails closed. An
intentional correction additionally requires `--replace-existing
<target-key>=<expected-old-sha256>` using the old digest printed by the failed dry run, preventing a
stale or silent overwrite. Finally run:

```sh
npm run validate:annual-publication
npm run validate:pack
npm run build:pack
```

The publication validator reconstructs all question evidence from the durable ledger and requires
an exact semantic match with `content/topics.json`. The content workflow runs this gate but never
creates, approves, or applies a review automatically.

## Scheduled control plane

`.github/workflows/annual-topic-classification.yml` runs annually on July 15 and can also be started
manually for a pinned year/session/block. It gates on both secrets, installs Poppler, runs the
booklet/pack/classifier validators, builds the current pack and SQLite snapshot, performs both model
passes, validates the ID-only artifact directory, and retains dry-run artifacts for 14 days.

The registry must already pin the requested year. A new year therefore fails closed until its
official ÖSYM PDF metadata and SHA-256 have been reviewed and committed. No raw PDF, text, image,
prompt, model transcript, cache, or generated SQLite file is uploaded by this workflow.
