# Cloudflare Workers

Cloudflare Workers on the free plan is the next host for Starhold. **Vercel stays the live site** (`https://starhold-two.vercel.app`) until the cut-over checklist at the bottom of this file is done. Do not merge this branch or deploy it until Micah says so. Do not delete the Vercel build before that checklist.

Nothing here uses Workers KV. Saves go to **D1** (5 million reads/day, 100,000 writes/day on the free plan). Workers KV’s free tier allows 1,000 writes a day.

## What runs where

| Piece | Vercel (live until cut-over) | Workers |
| --- | --- | --- |
| Static client | Vercel static | Workers static assets (`apps/web/dist`) |
| API | `api/index.js` Node bundle | `worker/index.ts` → same Hono app |
| Universe + accounts | Upstash / Vercel KV, one JSON document | D1 rows: world, asteroids, pirates, aliens, one document per player |
| Password | scrypt (`scrypt$…`) | PBKDF2-SHA-256, 10,000 iterations. Imported scrypt is verified once, then replaced |
| Tick | Full catch-up | Per-request budgets in `packages/game/src/data/tuning.ts` (`WORKERS_TICK_*`) |
| Poll | 30 seconds, and the tab sleeps when it is hidden or idle | Same client |

Game rules are not forked. A request-local tick budget is installed only by the worker. Vercel never calls `bindTickBudget`.

This branch also contains the usage stack (30-second polling, idle sleep, ETag, delete-all messages, locked buttons, storage x3, skill and officer levels). Those behaviors run on Workers through the same Hono app.

## Saves

A GET or HEAD whose only changes are accrued resources and `lastTickAt` does not take the D1 lock and does not write. The next cold load recomputes those stocks from the clocks. When something structural changes, D1 writes the dirty rows only: that player’s document, and the world, asteroid, pirate, or alien row if that part changed. Vercel still stores one JSON document, and it also skips the write on a quiet read.

## One-time setup

Micah does this once. D1 database `starhold` already exists. `wrangler.toml` has `account_id` `0de4d3787cea977fbe8952ba924adea7` and `database_id` `d3d8d52e-9272-40cd-b8ae-3012cef6c8ca`. Neither is a secret. The API token is not in the repo.

1. Install the CLI from the repo (`npm ci` brings in Wrangler 4).
2. `npx wrangler login` (or export `CLOUDFLARE_API_TOKEN` — see permissions below). Add that token as the GitHub secret `CLOUDFLARE_API_TOKEN` at deploy time. Do not commit it.
3. Apply the schema when the cut-over checklist says to. Do not run this as part of a normal PR:

   ```bash
   npx wrangler d1 migrations apply starhold --remote
   ```

4. Set the session pepper (do not commit it). Use the **same** value as Vercel or exported password hashes will not verify:

   ```bash
   npx wrangler secret put SESSION_SECRET
   ```

   Generate with `openssl rand -base64 32` only if this is a brand-new universe with no imported accounts.

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
| `CLOUDFLARE_API_TOKEN` | Deploy + D1 migrations. The only GitHub secret. |

The account id is `account_id` in `wrangler.toml`. Wrangler reads it from that file. Do not also set `CLOUDFLARE_ACCOUNT_ID` in the Action, or an empty secret would override the file.

Repository variable (not a secret): `CLOUDFLARE_DEPLOY_ENABLED=true` is the approval switch. Leave it unset until cut-over.

Worker secret (Cloudflare, not GitHub): `SESSION_SECRET`.

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

Workers free plan allows 10 ms of CPU per request. A full scrypt verify (N=16384, r=8, p=1) is about 30 ms in Node and about 170 ms in the sliced JavaScript implementation, so it cannot run inside one request. PBKDF2-SHA-256 at **10,000** iterations is about 2 ms. OWASP’s 600,000 iterations do not fit in 10 ms.

New Workers accounts use PBKDF2. Vercel accounts stay scrypt. A successful Vercel login also writes `passwordHashPbkdf2` (additive). After import, a scrypt-only account is checked by the `ScryptMigrate` Durable Object in slices of about 6 ms (about 30 requests, once). The client loops on HTTP 202. When the password matches, the account row is rewritten to PBKDF2 and later logins stay on that hash. The 16 MB SMix buffer stays in the Durable Object’s memory, not in D1.

`SESSION_SECRET` is the pepper. It must match Vercel for imported hashes.

## Transfer (do not run against production yet)

Export is read-only (`SCAN`, `GET`, `TTL`) using `KV_REST_API_URL` and `KV_REST_API_TOKEN`. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are accepted aliases. Import writes a SQL file. Applying that file is a separate command. The SQL is idempotent: it replaces the same keys, and running it twice leaves the same rows. Players, planets, fleets, messages, alliances, and password hashes are kept. Lock and version keys are dropped. The universe blob is split into the D1 rows the worker reads.

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

`kv-export.json` and `kv-import.sql` are gitignored. Do not commit them. The counts line lists keys, accounts, players, planets, fleets, messages, alliances, scrypt hashes, pbkdf2 hashes, sessions, and planned D1 rows.

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
| Scrypt verify, Node, N=16384 | about 34 ms (does not fit one request) |
| Scrypt verify, sliced JavaScript | about 170 ms across ~29 steps, each under 10 ms |

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

`STARHOLD_E2E=1` is for local Playwright only. It is not in `wrangler.toml`.

## Cut-over checklist

Do these in order. Stop if a dry-run count looks wrong. **Leave the Vercel project, `vercel.json`, `api/index.js`, and `npm run build:vercel` in place until the last step.**

1. D1 `database_id` and `account_id` are already in `wrangler.toml`.
2. Set the GitHub secret `CLOUDFLARE_API_TOKEN`, and the Worker secret `SESSION_SECRET` to the Vercel pepper.
3. `export --dry-run`, then `export`, then `import --dry-run`. Confirm players, planets, fleets, messages, alliances, and scrypt hashes match production.
4. `import` the SQL file and `wrangler d1 execute` it. This is the first write to D1.
5. Set the repository variable `CLOUDFLARE_DEPLOY_ENABLED=true`. The next push to `main` deploys Workers. Pushes to other branches do not.
6. Log in on the Workers host with an imported account. The first login rehashes scrypt to PBKDF2. Confirm a second login and a refresh.
7. Point players at the Workers URL only after that login works.
8. **Only then** remove the Vercel deploy: disconnect the Vercel project (or set `git.deploymentEnabled` false for every branch, which is already the case off `main`), delete the Upstash / `KV_REST_API_*` env vars, and retire `api/index.js` plus `scripts/bundle-api.mjs` if nothing else calls them. Do not do this step in the same change as the Workers port.
