# Deploy Starhold on Vercel Hobby (Micah)

**Live:** https://starhold-two.vercel.app  
**Team:** Stumpy's Creations · **Project:** starhold · **Production branch:** `main`  
Agents do **not** create accounts. No credit card.

API is serverless (`api/[[...route]].js`). Shared multiplayer needs Redis REST credentials.

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

Universe state is one JSON document at `STARHOLD_UNIVERSE_KEY`. Accounts/sessions use additional KV keys (`starhold:account:*`, `starhold:session:*`, `starhold:magic:*`, `starhold:email:*`) — see [design/accounts.md](./design/accounts.md).

### Accounts / magic-link email (Micah)

Agents do **not** create Resend accounts. Free tier only (no credit card).

1. Open https://resend.com → **Sign up** (GitHub/Google OK) → free plan.
2. **API Keys → Create API Key** → copy `re_…`.
3. Vercel → **starhold** → **Settings → Environment Variables** → add for **Production** (and Preview if you use it later):

| Name | Value |
|------|--------|
| `RESEND_API_KEY` | `re_…` from Resend |
| `RESEND_FROM` | `Starhold <onboarding@resend.dev>` (Resend test sender; replace after you verify a domain) |
| `SESSION_SECRET` | long random string (e.g. `openssl rand -base64 32`) |
| `APP_URL` | `https://starhold-two.vercel.app` |

4. **Deployments → latest Production → … → Redeploy** (or wait for next `main` deploy).

Without `RESEND_API_KEY`, the API still works: `POST /api/auth/request-link` returns `devMagicUrl` for local/CI. Production sign-in email needs the key.

### If vars were just added

**Deployments → latest Production → Redeploy** so serverless functions pick them up.

### Smoke

```bash
curl -s https://starhold-two.vercel.app/api/health
```

Expect `"storage":"kv"` or `"storage":"upstash"` (not `"memory"`).

Signup flow once Resend is set:

1. Open https://starhold-two.vercel.app/
2. Enter email → **Email link** → open the message from Resend
3. Cookie session resumes after closing the tab (`GET /api/auth/me`)
4. Guest → signed-in: join as guest first (saves `playerId`), then request magic link (sends `claimPlayerId`) or use **Claim guest save** after sign-in

### Hobby deploy rate limit

If `main` merge does not appear on production (Vercel Hobby monthly deploy cap):

1. Vercel → **starhold** → **Deployments**
2. Confirm latest Production commit SHA matches `main`
3. If stuck / rate-limited: wait for the Hobby quota reset, then **Redeploy** the latest Production deployment (or push an empty commit on `main` after the window clears)

---

## Build settings

| Setting | Value |
|---------|--------|
| Framework | Other |
| Root | `./` |
| Install | `npm install` |
| Build | `npm run build:vercel` |
| Output | `apps/web/dist` |
| API | `api/[[...route]].js` |

## Local

```bash
npm run build:vercel
PORT=3001 npm start   # memory unless KV_/UPSTASH_ env set
```
