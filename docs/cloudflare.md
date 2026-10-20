# Cloudflare Workers

Cloudflare Workers on the free plan is the next host for Starhold. **Vercel stays the live site** (`https://starhold-two.vercel.app`) until the cut-over checklist at the bottom of this file is done. Do not merge this branch or deploy it until Micah says so. Do not delete the Vercel build before that checklist.

Nothing here uses Workers KV. Saves go to **D1** (5 million reads/day, 100,000 writes/day on the free plan). Workers KV’s free tier allows 1,000 writes a day.

## What runs where

| Piece | Vercel (live until cut-over) | Workers |
| --- | --- | --- |
| Static client | Vercel static | Workers static assets (`apps/web/dist`). `_headers` sets long cache on hashed JS/CSS and art. The Worker is not invoked for those files. |
| API | `api/index.js` Node bundle | `worker/index.ts` → same Hono app |
| Universe + accounts | Upstash / Vercel KV, one JSON document | D1 `save_*` rows (world, player, planet, fleet, message, system) once migrated. The old `kv` document stays beside them |
| Password | scrypt (`scrypt$…`) | PBKDF2-SHA-256, 10,000 iterations. Imported accounts set a new password with a claim code |
| Tick | Full catch-up | Per-request budgets in `packages/game/src/data/tuning.ts` (`WORKERS_TICK_*`) |
| Poll | 30 seconds, and the tab sleeps when it is hidden or idle | Same client |

Game rules are not forked. A request-local tick budget is installed only by the worker. Vercel never calls `bindTickBudget`.

This branch also contains the usage stack (30-second polling, idle sleep, ETag, delete-all messages, locked buttons, storage x3, skill and officer levels). Those behaviors run on Workers through the same Hono app.

## Saves

A GET or HEAD whose only changes are accrued resources and `lastTickAt` does not take the D1 lock and does not write. `/api/state` and `/api/auth/me` never wait on the lock. They may try it once when a poll finishes a build, fleet, or report. After the row migration they tick only the player's rows plus the open system, not a copy of the whole universe. A resource-only tick is not written. If a build, research job, fleet, report, debris field, asteroid, occupation, alliance, ACS group, or the seed cursor changes, the read tries the player lock once and saves those rows; if it cannot, it drops the change so the next write reloads D1 instead of saving a half-updated universe. Two players lock only their own rows, so one does not wait on the other. An attack, transport, or spy locks both, in id order. Highscores are a cached board rebuilt by the 30-minute cron (or the maintenance pass), never on a page load. A galaxy request loads that system. The first join seeds the home system immediately and continues the rest in small chunks. Vercel still stores one JSON document. Memory mode ticks the stored universe in place, so a polled fleet can finish its return.

The legacy `kv` universe rows stay beside `save_*`. Migration copies one slice per request, then copies every slice again before `save_meta` id `migration` reaches v1, so a write that landed on the old save in between is kept. While that last pass is open, a legacy write mirrors only the rows that changed, as one D1 batch, before the old save is committed. System order is galaxy, then system number. After v1, live writes go only to `save_*`, as one D1 batch. If any row version moved, the batch rolls back and the action runs again on a fresh load. Page loads do not run pirate or alien raids. Pirates raid every 90 minutes and aliens every hour, from the `*/10` cron, which loads bases and owned planets only. The `*/30` cron rebuilds the highscore cache and does not raid. To roll back onto main, set the Worker secret with `npx wrangler secret put STARHOLD_ADMIN_TOKEN`, then `POST /api/admin/rollback-rows` with header `x-starhold-admin` set to that secret. Repeat the POST until the body says `done: true`. Each request writes one page in a single atomic batch and stays under 50 D1 queries. That copies the rows back into the kv slices main already loads (`:world`, `:asteroids`, `:pirates`, `:aliens`, `:player:{id}`, `:ver`) and does not delete `save_*`. The version key is written only on the last page. Then set `STARHOLD_ROW_SAVE=legacy`, or redeploy main. Deleting the `save_meta` row `migration` starts a fresh copy; do not do that if the new tables are the ones you want to keep.

Hashed `/assets/*.js` and `/assets/*.css` are `public, max-age=31536000, immutable`. Planet art and SVG plates are 30 days. HTML stays `max-age=0, must-revalidate` (the assets default). Those rules live in [apps/web/public/_headers](../apps/web/public/_headers) because `run_worker_first` is only `/api/*` — a Worker `Cache-Control` would never be seen, and running the Worker for every asset would spend a request. `withStaticCache` still covers the case where the Worker fetches `ASSETS` itself.

## One-time setup

Micah does this once. D1 database `starhold` already exists. `wrangler.toml` has `account_id` `0de4d3787cea977fbe8952ba924adea7` and `database_id` `d3d8d52e-9272-40cd-b8ae-3012cef6c8ca`. Neither is a secret. The API token is not in the repo.

1. Install the CLI from the repo (`npm ci` brings in Wrangler 4).
2. `npx wrangler login` (or export `CLOUDFLARE_API_TOKEN` — see permissions below). Add that token as the GitHub secret `CLOUDFLARE_API_TOKEN` at deploy time. Do not commit it.
3. Apply the schema when the cut-over checklist says to. Do not run this as part of a normal PR:

   ```bash
   npx wrangler d1 migrations apply starhold --remote
   ```

4. Set a **new** session pepper (do not commit it). Do not reuse the Vercel `SESSION_SECRET`. That value is unrecoverable, and imported hashes were peppered with it, so they are dropped on import.

   ```bash
   openssl rand -base64 32
   npx wrangler secret put SESSION_SECRET
   ```

   Use this same new value when you run the import, so claim-code hashes match the Worker. Existing Vercel sessions are not copied.

5. Build the client. Deploy only through the GitHub Action on `main` after `CLOUDFLARE_DEPLOY_ENABLED=true`. Do not `wrangler deploy` from a laptop for a branch, and do not turn on Cloudflare’s Git integration (that creates preview URLs).

Local:

```bash
printf 'SESSION_SECRET=local-dev-secret\n' > .dev.vars
npx wrangler d1 migrations apply starhold --local
npm run build -w @starhold/game && npm run build -w @starhold/web
npm run cf:dev
```

`.dev.vars` and `.wrangler/` are gitignored. `[limits] cpu_ms = 10` makes local dev enforce the free-plan CPU cap. `preview_urls = false` so a deploy does not publish a branch preview.

## Secrets and token permissions

GitHub Actions secrets (repository, not in git):

| Name | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Deploy + D1 migrations. The only required GitHub secret. |

Optional GitHub secrets, all unset means the integration is skipped:

| Name | Purpose |
| --- | --- |
| `SENTRY_DSN` | Public DSN inlined into the web build. Also set the same value as a Worker secret so the Worker can report. |
| `SENTRY_AUTH_TOKEN` | Uploads source maps at build/deploy. Free plan. |
| `POSTHOG_KEY` | Inlined into the web build. US cloud. No session replay. |

Repository variables for source maps: `SENTRY_ORG`, `SENTRY_PROJECT`.

The account id is `account_id` in `wrangler.toml`. Wrangler reads it from that file. Do not also set `CLOUDFLARE_ACCOUNT_ID` in the Action, or an empty secret would override the file.

Repository variable (not a secret): `CLOUDFLARE_DEPLOY_ENABLED=true` is the approval switch. Leave it unset until cut-over.

Worker secret (Cloudflare, not GitHub): `SESSION_SECRET`. Generate a new one. It is not the Vercel pepper.

Optional Worker secret: `CLAIM_MAIL_URL`. When set, “Email me a code” POSTs `{ email, code, expiresInMinutes }` to that URL. When it is unset, the import script writes `claim-codes.txt` instead. Do not commit that file.

API token permissions, created under My Profile → API Tokens → Custom token:

- **Account / Workers Scripts / Edit**
- **Account / D1 / Edit**
- **Account / Account Settings / Read**

No other permissions. Do not use a global API key.

## GitHub Action

`.github/workflows/cloudflare-workers.yml` runs on **push to `main` only**. It does not run on pull requests, other branches, or `workflow_dispatch`.

The job does not start unless `github.ref` is `refs/heads/main` and `CLOUDFLARE_DEPLOY_ENABLED` is `true`. If `CLOUDFLARE_API_TOKEN` is missing, the job succeeds and skips deploy. The account id comes from `wrangler.toml`. There is no preview or branch deploy.

Vercel’s own deploy is unchanged and still follows `main` only, until the checklist below.

## Passwords

Workers free plan allows 10 ms of CPU per request. A full scrypt verify (N=16384, r=8, p=1) is about 30 ms in Node and does not fit in one request. PBKDF2-SHA-256 at **10,000** iterations is about 2 ms. OWASP’s 600,000 iterations do not fit in 10 ms.

New Workers accounts use PBKDF2. Vercel accounts stay scrypt. Imported accounts do not keep either hash: the Vercel pepper cannot be recovered, so the import sets `needsPasswordReset` and stores no password. The player enters their email and a one-time claim code, then sets a new PBKDF2 password.

The code is 8 characters, works once, and is rate-limited (10 attempts per email and IP per 15 minutes, same bucket as submitting a code). A code from `claim-codes.txt` lasts 7 days. A code sent by email lasts 30 minutes. D1 stores `sha256(SESSION_SECRET:code)` at `starhold:claim-code:{accountId}`. The plaintext is not stored.

If `CLAIM_MAIL_URL` is set, “Email me a code” sends the code there. If it is not set, that button does not mint a code (so it cannot replace the one Micah already has). The import script writes `claim-codes.txt` next to the SQL: one line per account, mode `0600`, valid for 7 days. Hand that file out privately. Do not commit it.

Re-running the import leaves an account alone once Workers has a password for it (`needsPasswordReset` is off and `passwordHash` is set). Accounts still waiting for a claim are refreshed, including a new 7-day code. `--force` replaces those passwords. Session rows are still deleted on every import.

`SESSION_SECRET` on Workers is a new pepper. Existing sessions are left out of the import, and the SQL deletes any `starhold:session:*` rows already in D1.

## Transfer (do not run against production yet)

Export is read-only (`SCAN`, `GET`, `TTL`) using `KV_REST_API_URL` and `KV_REST_API_TOKEN`. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are accepted aliases. Import writes a SQL file. Applying that file is a separate command. The SQL is idempotent: it replaces the same keys, and running it twice leaves the same rows. Players, planets, fleets, messages, alliances, and password hashes are kept. Lock and version keys are dropped. The universe blob is split into the D1 rows the worker reads.

The import drops scrypt and PBKDF2 password hashes, marks those accounts `needsPasswordReset`, and does not copy sessions. When `CLAIM_MAIL_URL` is unset, a real import also writes hashed claim codes into the SQL and the plaintext list to `claim-codes.txt`. A dry run only prints counts.

Dry run (prints counts, writes nothing, and the import dry run does not touch D1):

```bash
export KV_REST_API_URL="https://….upstash.io"
export KV_REST_API_TOKEN="…"

node --import tsx scripts/kv-to-d1.mjs export --dry-run
node --import tsx scripts/kv-to-d1.mjs export kv-export.json
node --import tsx scripts/kv-to-d1.mjs import --dry-run kv-export.json
```

When the checklist says to apply it:

```bash
node --import tsx scripts/kv-to-d1.mjs import kv-export.json kv-import.sql
npx wrangler d1 execute starhold --remote --file=kv-import.sql
```

`kv-export.json`, `kv-import.sql`, and `claim-codes.txt` are gitignored. Do not commit them. The counts line lists keys, accounts, players, planets, fleets, messages, alliances, scrypt hashes, pbkdf2 hashes, needsPasswordReset, sessions, and planned D1 rows. `needsPasswordReset` is how many imported accounts must set a new password. Sessions are counted in the export and are not copied. When claim codes are part of the import, `d1Rows` includes one claim-code row per reset account.

## CPU budget

Free plan: **10 ms CPU per request**. I/O wait (D1) does not count. `x-starhold-cpu-ms` on a Worker response is game work plus JSON parse/stringify, not D1 round trips.

Node `performance.now()` on the synchronous game work (one commander, Workers budgets), measured before this rebase:

| Work | Time |
| --- | --- |
| Worst `playerView` while the map is still seeding | 6.0 ms |
| That view plus `JSON.stringify` of the ~1.5 MB save | 8.7 ms |
| Settled `playerView` after warmup | 2.9–3.6 ms |
| 30-day catch-up, one budgeted slice | about 2.5–6 ms |
| PBKDF2-SHA-256, 10,000 iterations | about 2.2 ms |
| One combat resolution | about 0.15 ms |
| Highscores, 1 player | under 1 ms |
| Highscores, 200 players, cold / warm | 8.7 ms / 2.2 ms |
| `JSON.parse` of a full legacy save | about 4 ms |
| `JSON.stringify` of a full legacy save | about 5–6 ms |

`wrangler dev --local` with `cpu_ms = 10`, header `x-starhold-cpu-ms`, from the first pass on this branch:

| Request | Attributed CPU | Wall |
| --- | --- | --- |
| `GET /api/profile/pbkdf2` | 1 ms | 1 ms |
| `GET /api/profile/combat` | 1 ms | 1 ms |
| Signup | under 1 ms | — |
| Login (PBKDF2 verify + view) | 2 ms | — |
| First join (`playerView`) | 9 ms | — |
| Seed catch-up, ~900 slices | usually 2–8 ms, one slice 10 ms | 13–29 ms |
| `GET /api/state` after join | 1–3 ms | — |

A quiet poll no longer writes the universe or the lock. A 200-player cold highscore board (8.7 ms on Node) still does not fit beside a tick. The warm board (2.2 ms) does. Steady polls are the cheap path.

Budgets (per request, then the next request continues): 2 raids, 40 pirate level-ups, 2 fleets, 8 drift steps, 8 systems / 1 new mini of bootstrap, 4 pirate placements. Vercel does not use these caps.

`STARHOLD_E2E=1` is for local Playwright only. It is not in `wrangler.toml`. While it is set, `POST /api/e2e/prepare-password-claim` can mint a claim code for an account. Do not set it on the deployed Worker.

## Cut-over checklist

Do these in order. Stop if a dry-run count looks wrong. **Leave the Vercel project, `vercel.json`, `api/index.js`, and `npm run build:vercel` in place until the last step.**

1. D1 `database_id` and `account_id` are already in `wrangler.toml`.
2. Set the GitHub secret `CLOUDFLARE_API_TOKEN`, and a **new** Worker secret `SESSION_SECRET` (`openssl rand -base64 32`). Do not reuse the Vercel pepper.
3. `export --dry-run`, then `export`, then `import --dry-run`. Confirm players, planets, fleets, messages, alliances, and `needsPasswordReset` (imported accounts that must set a new password). Sessions are counted and are not copied.
4. Export `SESSION_SECRET` as that same new Worker secret, then `import` the SQL file and `wrangler d1 execute` it. This is the first write to D1. If email is not configured, `claim-codes.txt` is written beside the SQL. Hand it out privately. Those codes last 7 days. Re-running the import does not clear passwords already set on Workers. Pass `--force` only when those passwords should be replaced.
5. Set the repository variable `CLOUDFLARE_DEPLOY_ENABLED=true`. The next push to `main` deploys Workers. Pushes to other branches do not.
6. On the Workers host, open the join screen, enter the account email, the claim code, and a new password. Confirm a second login with that password and a refresh. The old password does not work.
7. Point players at the Workers URL only after that claim works.
8. **Only then** remove the Vercel deploy: disconnect the Vercel project (or set `git.deploymentEnabled` false for every branch, which is already the case off `main`), delete the Upstash / `KV_REST_API_*` env vars, and retire `api/index.js` plus `scripts/bundle-api.mjs` if nothing else calls them. Do not do this step in the same change as the Workers port.
