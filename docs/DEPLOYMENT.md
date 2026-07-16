# Deployment operations

## One-time GitHub Pages enablement

The content workflow cannot create the repository's Pages site with its job token. Before the first
publish, an administrator must open **Settings → Pages → Build and deployment** and select
**GitHub Actions** as the source. Confirm that `GET /repos/sinanmertsenerr/YKSHazirlikTakvimi/pages`
returns a Pages site and that the configured pack URL no longer returns the generic GitHub 404.
The application and `.github/workflows/publish-content.yml` must both exist on the repository's
default branch; scheduled workflows are not a deployment mechanism while they live only on a
feature branch.

GitHub documents this prerequisite in
[Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
and
[Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Persisted content state

`.github/workflows/publish-content.yml` deliberately separates four trust boundaries:

1. `refresh` has read-only repository access. It fetches official sources, validates and builds the
   candidate, compares its content identity with the published manifest, and uploads an allowlisted
   state artifact. No credential used to write Git history or deploy Pages is available here.
2. `persist-state` has `contents: write`, but runs no package scripts and receives no application or
   Cloudflare secret. It accepts only the manifest, calendar, news, and an atomic program
   fixture/provenance pair. It rejects unsafe artifact entries, unexpected files, oversized JSON,
   and any branch movement before pushing a normal fast-forward bot commit.
3. `build-pages` checks out the exact persisted commit with read-only permissions and builds the
   Pages artifact. An unchanged content identity creates no Pages artifact or deployment.
4. `deploy` is the only job with `pages: write` and `id-token: write`, and it is the only job attached
   to the `github-pages` environment. After Pages reports success, the job waits for the expected
   pack revision to become visible and verifies every published file's byte length and SHA-256.

The source `content/manifest.source.json` pack revision is persisted with actual pack changes. App
versioning remains in `app.json`/`package.json`; pack revisioning identifies the independently
published content bytes. Persisting the revision ensures that a later binary bundling those same
bytes does not download an identical remote pack merely because its bundled revision is stale.

A provenance-only YÖK Atlas audit does not create a source commit. Its JSON is retained as a
14-day workflow artifact. If the program fixture changes, the fixture and matching provenance are
committed together or the workflow fails.

Commits pushed with the repository `GITHUB_TOKEN` do not recursively start another workflow run.
The active run therefore validates, rebuilds, and deploys the exact commit it created. GitHub
documents the token event behavior in
[GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token).

## Branch protection

State persistence is intentionally fail-closed. If `main` advances during a run, or a ruleset rejects
the bot's fast-forward push, no artifact is deployed. If branch protection is enabled, grant the
GitHub Actions app only the narrow ability needed to push this generated-state allowlist, or change
the design to use a reviewed generated-state pull request. Do not give a blanket ruleset bypass.

After any protection change, manually dispatch the workflow and verify both cases:

- unchanged official data produces no commit and no Pages deployment;
- a fixture-based test change persists first, then the build checks out that commit and deploys it.

## Scheduler limitations

Schedules use UTC unless a `timezone` is explicitly configured. GitHub can delay scheduled jobs and
can drop them during high load; the workflows use off-hour minutes to reduce this risk. More
importantly, GitHub automatically disables scheduled workflows in a public repository after 60 days
without repository activity. Scheduled runs themselves must not be treated as a permanent external
scheduler or health signal.

`.github/workflows/content-health.yml` runs every two hours and verifies the public manifest, the
manifest-addressed news payload, and that the latest completed publisher run succeeded within ten
hours. It opens or updates a visible issue through the alert-only notification workflow when any
check fails. Re-enable an inactive workflow in GitHub and use `workflow_dispatch` for recovery.

This repository-local health job is a second signal, not an independent scheduler: GitHub can
disable both scheduled workflows together. Monitor the public manifest URL and the health workflow
from an external uptime service as well. The annual classifier has a single yearly cron, so its
result also needs an explicit completion check and manual retry path.
See GitHub's
[schedule event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Runtime transfer behavior

Published JSON files are minified while the reviewable `content/*.json` sources remain formatted.
The manifest records hashes and byte lengths for the exact minified bytes. On-device updates reuse
files from the already validated active pack only when both SHA-256 and byte length match the new
manifest, download changed files with bounded concurrency, and atomically activate the candidate
after all changed payloads pass validation. A manual refresh is queued behind an automatic check
when necessary, so its forced network check is never silently downgraded.

## Workflow artifact visibility

This repository is public. GitHub workflow artifacts are downloadable by signed-in users with read
access, so the annual classifier artifacts and YÖK provenance audit are not confidential storage.
The classifier workflow validates an ID-only contract and excludes raw question text/images before
upload. If review decisions themselves must remain private, encrypt them before upload or use
private storage with an explicit reviewer ACL. GitHub documents artifact access in
[Downloading workflow artifacts](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts).

## Cloudflare Worker

Wrangler is an exact lockfile dependency. Validate and deploy only through the root scripts:

```sh
npm ci
npm run validate:cloudflare
npm run secret:cloudflare
npm run deploy:cloudflare
```

The current deployment is intentionally manual. If it moves to CI, put `CLOUDFLARE_ACCOUNT_ID` and
an account-scoped `CLOUDFLARE_API_TOKEN` in a protected `cloudflare-production` environment, expose
them only to the deploy step, keep repository permissions read-only, and require the dry-run bundle
and Worker tests first. Cloudflare recommends an account-restricted **Edit Cloudflare Workers** API
token in its
[GitHub Actions deployment guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
