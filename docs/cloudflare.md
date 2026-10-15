# Cloudflare Workers

Cloudflare Workers on the free plan is the next host for Starhold. **Vercel stays the live site** (`https://starhold-two.vercel.app`) until the cut-over checklist at the bottom of this file is done. Do not merge this branch or deploy it until Micah says so. Do not delete the Vercel build before that checklist.

Nothing here uses Workers KV. Saves go to **D1** (5 million reads/day, 100,000 writes/day on the free plan). Workers KV’s free tier allows 1,000 writes a day.

## What runs where

| Piece | Vercel (live until cut-over) | Workers |
| --- | --- | --- |
| Static client | Vercel static | Workers static assets (`apps/web/dist`) |
| API | `api/index.js` Node bundle | `worker/index.ts` → same Hono app |
| Universe + accounts | Upstash / Vercel KV, one JSON document | D1 rows: world, asteroids, pirates, aliens, one document per player |
| Password | scrypt (`scrypt$…`) | PBKDF2-SHA-256, 10,000 iterations. Imported accounts set a new password with a claim code |
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
| `CLOUDFLARE_API_TOKEN` | Deploy + D1 migrations. The only GitHub secret. |

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

The code is 8 characters, expires in 30 minutes, and works once. Asking for a code is rate-limited (10 attempts per email and IP per 15 minutes, same bucket as submitting a code). D1 stores `sha256(SESSION_SECRET:code)` at `starhold:claim-code:{accountId}`. The plaintext is not stored.

If `CLAIM_MAIL_URL` is set, “Email me a code” sends the code there. If it is not set, that button does not mint a code (so it cannot replace the one Micah already has). The import script writes `claim-codes.txt` next to the SQL: one line per account, mode `0600`. Hand that file out privately. Apply the SQL within 30 minutes of writing it. Running the import again rebuilds account rows from the Vercel export, which clears any passwords already set on Workers, so refresh codes only before anyone has claimed. Do not commit the file.

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
4. Export `SESSION_SECRET` as that same new Worker secret, then `import` the SQL file and `wrangler d1 execute` it. This is the first write to D1. If email is not configured, `claim-codes.txt` is written beside the SQL. Hand it out privately and apply the SQL within 30 minutes. Re-running the import later clears passwords that were already set on Workers.
5. Set the repository variable `CLOUDFLARE_DEPLOY_ENABLED=true`. The next push to `main` deploys Workers. Pushes to other branches do not.
6. On the Workers host, open the join screen, enter the account email, the claim code, and a new password. Confirm a second login with that password and a refresh. The old password does not work.
7. Point players at the Workers URL only after that claim works.
8. **Only then** remove the Vercel deploy: disconnect the Vercel project (or set `git.deploymentEnabled` false for every branch, which is already the case off `main`), delete the Upstash / `KV_REST_API_*` env vars, and retire `api/index.js` plus `scripts/bundle-api.mjs` if nothing else calls them. Do not do this step in the same change as the Workers port.
