# Durable annual topic approvals

This directory is the permanent, ID-only publication ledger. A publishable group consists of
exactly two files with the same slug:

- `<slug>.report.json`: the validated two-pass classifier report; and
- `<slug>.approval.json`: the explicit human approval that pins the report, booklet, taxonomy,
  base topic semantics, official question IDs, primary/related topic IDs, reviewer, and date.

No question text, answer choices, answers, quotations, summaries, descriptors, learning outcomes,
difficulty guesses, images, prompts, or model transcripts may be stored here. A pending review must
remain under `tmp/`; only a completed human approval and its matching ID-only report belong here.

`npm run validate:annual-publication` reconstructs all published topic statistics and question
metadata from this ledger and requires an exact semantic match with `content/topics.json`. Empty
ledger means the published approved-question count must be exactly zero.
