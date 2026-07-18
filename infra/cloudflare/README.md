# Annual classifier Worker

This private Worker is an authenticated, storage-free Workers AI gateway for the annual
topic-classification dry run. It accepts only `POST /v1/classify`, only the two pinned models, and
only bounded text or embedded JPEG/PNG inputs. It does not use KV, R2, D1, Cache API, Analytics
Engine, request logging, or `console` output. After bearer authentication and before allocating the
request body, a Cloudflare rate-limit binding permits 60 requests per 60-second location-local
window for the single CI principal. Missing/unavailable limiter configuration fails closed.

Set a random token of at least 32 characters without putting it in source control:

Wrangler is an exact, lockfile-backed root development dependency. From the repository root, first
run the dry-run bundle check, then configure the secret and deploy intentionally:

```sh
npm ci
npm run validate:cloudflare
npm run secret:cloudflare
npm run deploy:cloudflare
```

Do not replace these scripts with a bare `npx wrangler` command: when Wrangler is absent locally,
that command downloads the mutable latest release instead of the reviewed lockfile version.

Store the deployed `https://.../v1/classify` URL as the GitHub secret
`CF_CLASSIFIER_ENDPOINT`, and the same token as `CF_CLASSIFIER_TOKEN`. Keep Workers observability
request logs disabled because the request body temporarily contains official booklet evidence.
The checked-in config explicitly disables observability and enables the authenticated
`workers.dev` endpoint; replace it with a locked-down custom route later if desired.

The gateway returns model output to the caller but never persists it. The GitHub-side orchestrator
performs the authoritative Zod validation, retries once, and writes only ID-only dry-run reports.
Configure an account-level Workers AI spend alert/cap in Cloudflare, and rotate both the Worker secret
and matching GitHub token after suspected exposure or a change in maintainers. The binding is abuse
containment, not exact billing accounting; Cloudflare documents its counters as eventually consistent
and location-local.
