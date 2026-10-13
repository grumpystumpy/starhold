# Deploy Starhold on Vercel Hobby (Micah)

**Live:** https://starhold-two.vercel.app  
**Team:** Stumpy's Creations · **Project:** starhold · **Production branch:** `main`  
Agents do **not** create accounts. No credit card.

API is serverless (`api/[[...route]].js`). Shared multiplayer needs Redis REST credentials.

**Deploys:** Only `main` deploys to Vercel (`git.deploymentEnabled`: `*` false, `main` true). PR checks run on GitHub Actions (`unit-and-e2e`); preview branches do not consume Hobby deploy quota.

---

## Env vars the code accepts

Prefer whichever pair is already on the project — **do not rename**.

| Pair | When | Health `"storage"` |
|------|------|-------------------|
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Vercel ↔ Upstash integration (current) | `"kv"` |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Manual Upstash REST | `"upstash"` |

Also present from the integration (unused for writes): `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `REDIS_URL`.

Optional:

| Name | Default |
|------|---------|
| `STARHOLD_UNIVERSE_KEY` | `starhold:universe:v1` |
| `STARHOLD_UNIVERSE_NAME` | `Alpha Drift` |
| `STARHOLD_UNIVERSE_SPEED` | `8` |
| `ALLOWED_ORIGINS` | includes `https://starhold-two.vercel.app` |

No schema/migrations — one JSON document at `STARHOLD_UNIVERSE_KEY`.

### If vars were just added

**Deployments → latest Production → Redeploy** so serverless functions pick them up.

### Smoke

```bash
curl -s https://starhold-two.vercel.app/api/health
```

Expect `"storage":"kv"` or `"storage":"upstash"` (not `"memory"`).

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
