# Cloudflare Workers test host

Parallel free-plan host for Starhold. **Vercel stays the live site** (`https://starhold-two.vercel.app`, `main` only). Do not point players here until Micah says so. Do not merge or deploy this doc’s workflow until the checks below are done.

Nothing in this setup uses Workers KV. Saves go to **D1** (5 million reads/day, 100,000 writes/day on the free plan). Workers KV’s free tier allows 1,000 writes a day, which a universe save would exhaust.

## What runs where

| Piece | Vercel (live) | Workers (test) |
| --- | --- | --- |
| Static client | Vercel static | Workers static assets (`apps/web/dist`) |
| API | `api/index.js` Node bundle | `worker/index.ts` → same Hono app |
| Universe + accounts | Upstash / Vercel KV | D1 table `kv` |
| Password | scrypt (`scrypt$…`) | PBKDF2-SHA-256, 10,000 iterations (`pbkdf2$…`) |
| Tick | Full catch-up | Per-request budgets in `packages/game/src/data/tuning.ts` (`WORKERS_TICK_*`) |

Game rules are not forked. A request-local tick budget is installed only by the worker. Vercel never calls `bindTickBudget`, so it still runs the full tick.

## Polling

30-second polling and idle sleep are **not on `main`**. The client still polls `/api/state` about once a second (`apps/web/src/main-actions-session.ts`). Those changes live in a separate PR; this host does not add them.

## One-time setup

Micah does this once. The placeholder `database_id` in `wrangler.toml` cannot deploy until the database exists.

1. Install the CLI from the repo (`npm ci` brings in Wrangler 4).
2. `npx wrangler login` (or export `CLOUDFLARE_API_TOKEN` — see permissions below).
3. Create the database and paste the id into `wrangler.toml` (`database_id`, not a secret):

   ```bash
   npx wrangler d1 create starhold
   ```

4. Apply the schema:

   ```bash
   npx wrangler d1 migrations apply starhold --remote
   ```

5. Set the session pepper (do not commit it):

   ```bash
   npx wrangler secret put SESSION_SECRET
   ```

   Generate with `openssl rand -base64 32`. The same value as Vercel lets a copied PBKDF2 hash verify. A different pepper means exported accounts cannot log in here.

6. Build the client and deploy **only when you mean to**:

   ```bash
   npm run build -w @starhold/game && npm run build -w @starhold/web
   npx wrangler deploy
   ```

Local:

```bash
printf 'SESSION_SECRET=local-dev-secret\n' > .dev.vars
npx wrangler d1 migrations apply starhold --local
npm run build -w @starhold/game && npm run build -w @starhold/web
npm run cf:dev
```

`.dev.vars` and `.wrangler/` are gitignored. `[limits] cpu_ms = 10` makes local dev enforce the free-plan CPU cap.

## Secrets and token permissions

GitHub Actions secrets (repository, not in git):

| Name | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Deploy + D1 migrations |
| `CLOUDFLARE_ACCOUNT_ID` | Account the token belongs to |

Worker secret (Cloudflare, not GitHub): `SESSION_SECRET`.

API token permissions, created under My Profile → API Tokens → Custom token:

- **Account / Workers Scripts / Edit**
- **Account / D1 / Edit**
- **Account / Account Settings / Read**

No other permissions. Do not use a global API key.

## GitHub Action

`.github/workflows/cloudflare-workers.yml` listens for `workflow_dispatch` and for pushes to `main`. It does **not** deploy on pull requests.

- Push to `main` deploys only when the repository variable `CLOUDFLARE_DEPLOY_ENABLED` is `true` **and** both secrets above are set. That variable is off until Micah sets it. That is the approval switch.
- `workflow_dispatch` on `main` deploys when the secrets exist, even before the variable is set, so a manual test is possible.
- If the token or account id is missing, the job succeeds and skips deploy.

Vercel’s own deploy is unchanged and still follows `main` only.

## Passwords

Workers free plan allows 10 ms of CPU per request. scrypt (N=16384) does not fit. PBKDF2-SHA-256 at **10,000** iterations is about 2 ms here. OWASP’s 600,000 iterations do not fit in 10 ms, so this host’s hashes are weaker than Vercel’s on purpose. Vercel accounts keep scrypt. A successful Vercel login also writes `passwordHashPbkdf2` on the account row (additive; old rows still load).

Workers refuse a scrypt-only hash with: log in once on the Vercel site, then try again. They verify `passwordHashPbkdf2` when it is present.

## KV → D1 (do not run until cutover)

`scripts/kv-to-d1.mjs` copies `starhold:*` keys. It is not part of deploy and was not run for this change.

```bash
# Export from Upstash / Vercel KV into a local file (password hashes).
KV_REST_API_URL=... KV_REST_API_TOKEN=... node --import tsx scripts/kv-to-d1.mjs export kv-export.json

# Write SQL using the same chunk codec as D1. Review it, then apply yourself.
node --import tsx scripts/kv-to-d1.mjs import kv-export.json kv-import.sql
npx wrangler d1 execute starhold --remote --file=kv-import.sql
```

`kv-export.json` and `kv-import.sql` are gitignored. Do not commit them.

## CPU budget

Free plan: **10 ms CPU per request**. I/O wait (D1) does not count. Numbers below are Node `performance.now()` around the synchronous work, which tracks that CPU. `x-starhold-cpu-ms` on a Worker response is the same kind of total (game work + JSON parse/stringify, not D1 round trips). Set `STARHOLD_CPU_PROFILE=1` and open `/api/profile/pbkdf2`, `/api/profile/combat`, or `/api/profile/tick` for one case per request.

Node `performance.now()` on the synchronous game work (one commander, Workers budgets):

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
| `JSON.parse` of the full save | about 4 ms |
| `JSON.stringify` of the full save | about 5–6 ms |

`wrangler dev --local` with `cpu_ms = 10`, header `x-starhold-cpu-ms` (game work + JSON parse/stringify, not D1 wait). Workerd’s clock here is about 1 ms resolution:

| Request | Attributed CPU | Wall |
| --- | --- | --- |
| `GET /api/profile/pbkdf2` | 1 ms | 1 ms |
| `GET /api/profile/combat` | 1 ms | 1 ms |
| Signup | under 1 ms | — |
| Login (PBKDF2 verify + view) | 2 ms | — |
| First join (`playerView`) | 9 ms | — |
| Seed catch-up, ~900 slices until the map matched a full seed | usually 2–8 ms, one slice 10 ms | 13–29 ms |
| `GET /api/state` after join | 1–3 ms | — |

No request was killed by the local CPU limit. D1 wait shows up in wall time and not in the header. A warm isolate caches the parsed universe (`${STARHOLD_UNIVERSE_KEY}:ver`). A GET whose queues, ship counts, raid clocks, and seed cursor did not change skips the write. A 200-player highscore board’s cold pass (8.7 ms on Node) does not fit beside a tick. This test host will not have that board on day one. The warm board (2.2 ms) does.

Budgets (per request, then the next request continues): 2 raids, 40 pirate level-ups, 2 fleets, 8 drift steps, 8 systems / 1 new mini of bootstrap, 4 pirate placements. The request that finishes the system scan does not also run the rest of the tick. A lazy seed matches a full seed (asteroid ids, mini ids, pirate coordinates). Vercel does not use these caps.

`STARHOLD_E2E=1` is for local Playwright only. It is not in `wrangler.toml`.
