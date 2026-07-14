# Topic annotation waves

This directory contains auditable editorial mappings from official ÖSYM booklet question numbers
to the app taxonomy. A mapping is **not** ÖSYM-authored data. It can produce a verified statistics
proposal only after two independent reviewers agree on every primary classification and the exact
official question block passes the fail-closed builder.

Never store question text, answer choices, answers, images, screenshots, summaries, quotations,
difficulty labels, or other copyrighted/derived question content. Reviewers inspect the official
PDF outside this repository; reviews store only provenance, official numbering, and taxonomy
references.

## Review schema v2

Use one review file per reviewer and exact official question block, not per assumed subject split.
`sectionId` identifies the app taxonomy wave; `bookletSectionId`, `questionRange`, and `answerSetId`
must match exactly one block in `content/osym-booklets.json`. Positive offsets are preserved: for
example, TYT Geography is officially 6–10, not a locally renumbered 1–5.

```json
{
  "schemaVersion": 2,
  "year": 2026,
  "exam": "tyt",
  "sectionId": "tyt-sosyal",
  "bookletSectionId": "sosyal-bilimler",
  "questionRange": { "first": 6, "last": 10 },
  "answerSetId": "default",
  "bookletId": "2026-tyt",
  "bookletSha256": "copy-the-exact-64-character-hash-from-osym-booklets-json",
  "reviewer": "reviewer-a",
  "reviewedAt": "2026-07-14",
  "records": [
    {
      "officialQuestionNo": 6,
      "primaryTopicRef": {
        "subjectId": "tyt-cografya",
        "topicId": "replace-with-a-scoped-topic-id",
        "countsTowardStats": true
      },
      "relatedTopicRefs": [
        {
          "exam": "ayt",
          "sectionId": "ayt-edebiyat-sosyal-1",
          "subjectId": "ayt-cografya-1",
          "topicId": "replace-with-a-related-topic-id",
          "crossExam": true,
          "countsTowardStats": false
        }
      ],
      "status": "classified",
      "page": 9
    }
  ]
}
```

The example shows one record for brevity; a real review must include every integer in the exact
registry range once. An equal-length shifted range, duplicate, missing number, wrong answer set,
wrong hash, or unknown taxonomy reference is rejected.

Each classified question has exactly one `primaryTopicRef`; only it counts toward statistics. A
question may also have unique `relatedTopicRefs` for discovery, but they never count and cannot
repeat the primary topic. The primary subject must belong to the official block's taxonomy union.
This permits question-level Mathematics/Geometry classification without inventing a fixed 31/9 or
30/10 split. The report derives the actual split from reviewed primary records.

A related reference in another exam must provide its full exam/section scope and set `crossExam`
to `true`. Draft shorthand containing only `subjectId` and `topicId` is deterministically scoped to
the current exam and section. Partially specified cross-taxonomy scope is ambiguous and rejected.
The normalizer adds the immutable counting flags but does not guess offsets or taxonomy. Existing
schema-v1 single-topic reviews migrate only when their ordered question numbers already equal one
exact, single-subject registry block.

Use `status: "needs-review"`, `primaryTopicRef: null`, and an empty `relatedTopicRefs` array when a
reviewer cannot classify a question. Do not shrink the range to bypass it.

## Consensus

Reviewer labels must be stable pseudonyms, and primary and secondary labels must differ. The
secondary reviewer classifies independently, without seeing the primary choice. Only after both
reviews are complete are they mechanically merged:

- matching primary subject/topic pairs become `consensusStatus: "agreed"`;
- a differing or null primary becomes `consensusStatus: "disputed"` with a null consensus primary;
- related topics use an explicit `intersection` policy by default or `union` when requested; and
- a related-topic policy never changes primary counts.

The comparator validates both reviews, their exact block/range/answer-set scope, and pinned hash,
then preserves both reviewer records in an atomic schema-v2 consensus output. It never chooses a
winner for a disagreement.

```sh
npx tsx scripts/compare-topic-reviews.ts --current-date 2026-07-14
```

For another wave, pass `--primary`, `--secondary`, `--output`, and `--wave-id`. Select related-topic
consensus explicitly with `--related-consensus intersection` or `--related-consensus union`.

## Dry-run statistics

Generate an isolated report after every primary question has consensus:

```sh
npx tsx scripts/build-topic-statistics.ts \
  --annotations content/topic-annotations/2026-tyt-turkce.json \
  --output tmp/2026-tyt-turkce.topic-statistics.json
```

Without `--output`, the report is printed to stdout. The command has no code path that writes to
`content/topics.json`. `questionMappings` contain the exactly-once primary assignments;
`relatedQuestionMappings` remain separate discovery evidence; and `topicStatPatches` are derived
only from primary mappings. This prevents multi-topic inflation.

Default blocks may propose canonical patches. Alternative `no-dkab` blocks retain mappings and
provenance but are `evidenceOnly`, contribute zero canonical questions, and always emit an empty
`topicStatPatches` array. Normal and religion-exempt answer paths therefore retain their official
TYT 20 / AYT 40 totals without double counting the printed alternative block.

The builder refuses an incomplete, duplicate, out-of-range, disputed, source/hash-mismatched,
taxonomy-invalid, or date-invalid wave. Any later integration into the shipped topic catalog is a
separate reviewed change.

The current 2026 TYT Turkish comparison remains 39/40 agreed (97.5%). A context-free third review
of question 20 differed from both earlier classifications, so no two-of-three majority exists. Its
strict metadata is stored under `reviews/`; the consensus wave deliberately fails closed and
produces no patch. Neither the comparator nor the maintainer selects among the three choices.
