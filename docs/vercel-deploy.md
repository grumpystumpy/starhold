# Deploy Starhold on Vercel Hobby (Micah)

**Live:** https://starhold-two.vercel.app  
**Team:** Stumpy's Creations · **Project:** starhold · **Production branch:** `main`  
Agents do **not** create accounts. No credit card.

API is serverless (`api/index.js`, with `/api/*` rewritten to `/api`). Shared multiplayer needs Redis REST credentials.

**Deploys:** Only production builds of `main` deploy, and only when the commit changes the game.

- `git.deploymentEnabled`: `main` true, `*` false. Non-main branches never create a deployment (this does not spend the Hobby deploy quota).
- `ignoreCommand` (`node scripts/vercel-ignore-build.mjs`): exit 0 skips, exit 1 builds. Skips anything that is not `VERCEL_ENV=production` on `main`. On `main`, skips when the diff is only docs, markdown, `.github/`, tests, or `scripts/` (except `scripts/bundle-api.mjs`, which packages the function). If the diff cannot be read, it builds.
- GitHub Actions (`.github/workflows/ci.yml`) runs unit tests, typecheck, `build:vercel`, and Playwright against localhost. It must not call the Vercel CLI, a deploy hook, or a Vercel API token.

**Runtime:** Nothing on the server ticks by itself. There is no cron, no keep-alive loop, and `/api/health` does not touch KV. The universe advances only when a player request reads it. The client polls `GET /api/state` every 30s while the tab is visible and the player has used the page in the last 3 minutes. Hidden tabs and idle sessions do not poll. Quiet polls send `If-None-Match` and get back the clock and resource stocks instead of the full view. JSON is gzipped when the caller sends `Accept-Encoding: gzip`.

**Dashboard settings the repo cannot set** (Micah, project **starhold**):

| Setting | What to use |
|---------|-------------|
| **Settings → Git → Production Branch** | `main` |
| **Settings → Build and Deployment → Ignored Build Step** | Leave **Automatic**. `vercel.json` `ignoreCommand` overrides this field. Do not switch it to **Only build production** — that preset still builds every `main` commit, including docs-only ones, and a canceled ignore step can still count toward the daily deployment quota. `git.deploymentEnabled` is what stops non-main branches before a deployment is created. |
| **Settings → Functions → Function CPU** | Hobby is locked to **1 vCPU / 2 GB**. `memory` in `vercel.json` is ignored under Fluid compute and is not set. There is no lower size on Hobby. |
| **Settings → Cron Jobs** | None. Do not add one. AI ticks stay lazy on read. |
| **Analytics** (Web Analytics) and **Speed Insights** | Off. They are not in the repo. |
| **Image Optimization** | Off. Art is prebuilt WebP/SVG. There is no `images` key in `vercel.json`. |
| **Settings → Environment Variables** | No `VERCEL_TOKEN` for GitHub Actions. |
| **Deploy Hooks** | Delete any hook a test or CI job could call. |

**API bundle:** Git contains a small `api/index.js` stub. Vercel checks `functions` patterns against the git tree **before** the build and fails immediately when `api/index.js` is missing ([unmatched function pattern](https://vercel.com/docs/errors/error-list#unmatched-function-pattern)). `buildCommand` (`npm run build:vercel`) builds the static app and overwrites the stub. `@vercel/node` does not run that command for `api/` files; it runs root `vercel-build` (`node scripts/bundle-api.mjs`) after downloading the stub and before it traces the function, so production serves the generated bundle.

**Planned (not yet):** staging branch or second Vercel project + ~daily promote to production `main`. Until that lands, keep main-only production as above — do not enable preview deploys for every PR.

---

## Env vars the code accepts

Prefer whichever pair is already on the project — **do not rename**.

| Pair | When | Health `"storage"` |
|------|------|-------------------|
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Vercel ↔ Upstash integration (current) | `"kv"` |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Manual Upstash REST | `"upstash"` |

Also present from the integration (unused for writes): `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `REDIS_URL`.

Optional (universe):

| Name | Default |
|------|---------|
| `STARHOLD_UNIVERSE_KEY` | `starhold:universe:v3` |
| `STARHOLD_UNIVERSE_NAME` | `Alpha Drift` |
| `STARHOLD_UNIVERSE_SPEED` | `8` |
| `ALLOWED_ORIGINS` | includes `https://starhold-two.vercel.app` |

Universe state is one JSON document at `STARHOLD_UNIVERSE_KEY`. Accounts/sessions use additional KV keys (`starhold:account:*`, `starhold:session:*`, `starhold:email:*`, `starhold:ratelimit:auth:*`) — see [design/accounts.md](./design/accounts.md).

### Accounts / email + password (Micah)

No email provider. Sign up / log in with email + password; HttpOnly session cookie keeps progress after closing the tab.

1. Vercel → **starhold** → **Settings → Environment Variables** → add for **Production**:

| Name | Value |
|------|--------|
| `SESSION_SECRET` | **Required.** Long random string (e.g. `openssl rand -base64 32`). Without it, signup/login return HTTP 503 on Vercel. |
| `APP_URL` | optional — `https://starhold-two.vercel.app` |

2. **Remove** `RESEND_API_KEY` / `RESEND_FROM` if present (unused).
3. **Deployments → latest Production → … → Redeploy** (or wait for next `main` deploy) after setting `SESSION_SECRET`.

Local / CI use a fixed dev fallback secret when `SESSION_SECRET` is unset (never log it).

### If vars were just added

**Deployments → latest Production → Redeploy** so serverless functions pick them up.

### Smoke

```bash
curl -s https://starhold-two.vercel.app/api/health
```

Expect `"storage":"kv"` or `"storage":"upstash"` (not `"memory"`), and `auth.passwordAuth: true`.

Signup / login:

1. Open https://starhold-two.vercel.app/
2. Enter email + password (8+) → **Sign up** (or **Log in**)
3. Enter a commander name (or **Claim guest save**)
4. Close the tab → reopen → cookie session resumes via `GET /api/auth/me` (not localStorage alone)

### Hobby deploy rate limit

If `main` merge does not appear on production (Vercel Hobby monthly deploy cap):

1. Vercel → **starhold** → **Deployments**
2. Confirm latest Production commit SHA matches `main`
3. If stuck / rate-limited: wait for the Hobby quota reset, then **Redeploy** the latest Production deployment (or push an empty commit on `main` after the window clears)

**2026-10-14:** Hobby deploy window reopened — production redeploys on `main` merges.

---

## Build settings

| Setting | Value |
|---------|--------|
| Framework | Other |
| Root | `./` |
| Install | `npm install` |
| Build | `npm run build:vercel` |
| Output | `apps/web/dist` |
| API | `api/index.js` |

## Local

```bash
npm run build:vercel
PORT=3001 npm start   # memory unless KV_/UPSTASH_ env set
```
