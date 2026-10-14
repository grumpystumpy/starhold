# Deploy Starhold on Vercel Hobby (Micah)

**Live:** https://starhold-two.vercel.app  
**Team:** Stumpy's Creations · **Project:** starhold · **Production branch:** `main`  
Agents do **not** create accounts. No credit card.

API is serverless (`api/index.js`, with `/api/*` rewritten to `/api`). Shared multiplayer needs Redis REST credentials.

**Deploys:** Only `main` deploys to Vercel (`git.deploymentEnabled`: `*` false, `main` true). PR checks run on GitHub Actions (`unit-and-e2e`); preview branches do not consume Hobby deploy quota.

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
