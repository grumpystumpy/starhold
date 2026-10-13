# Deploy Starhold on Vercel Hobby (Micah)

**Live:** https://starhold-two.vercel.app  
**Team:** Stumpy's Creations · **Project:** starhold · **Branch:** `cursor/core-loop-prototype-1093`  
Agents do **not** create accounts. No credit card.

API is serverless (`api/[[...route]].js`). Static UI is fine.  
**Multiplayer requires Upstash Redis env vars** — without them health shows `"storage":"memory"` and joins do not stick across cold starts / instances.

---

## STOP — Micah must add Upstash (required now)

Verified live: `/api/health` → **200** with `"storage":"memory"`. Shared multiplayer needs Redis.

### 1. Create free Upstash Redis

1. Open **https://console.upstash.com/**  
2. **Sign in with GitHub** (free tier — skip any paid upgrade)  
3. **Create database**  
   - Name: `starhold`  
   - Region: prefer **US East** (close to Vercel `iad1`)  
4. Open the DB → **REST API** (or Details)  
5. Copy:
   - `UPSTASH_REDIS_REST_URL` → like `https://xxxxx.upstash.io`  
   - `UPSTASH_REDIS_REST_TOKEN` → long secret  

No schema/migrations — one JSON key (`starhold:universe:v1`).

**Optional shortcut:** Vercel → project **starhold** → **Storage** / **Integrations** / Marketplace → **Upstash** → add Redis to this project (auto-fills the two env vars). Still free — decline paid plans.

### 2. Paste on Vercel

1. Vercel → **Stumpy's Creations** → **starhold**  
2. **Settings → Environment Variables**  
3. Add for **Production** and **Preview**:

| Name | Required | Example / paste |
|------|----------|-----------------|
| `UPSTASH_REDIS_REST_URL` | **YES** | `https://….upstash.io` from Upstash REST |
| `UPSTASH_REDIS_REST_TOKEN` | **YES** | REST token from Upstash |
| `STARHOLD_UNIVERSE_KEY` | no | `starhold:universe:v1` |
| `STARHOLD_UNIVERSE_NAME` | no | `Alpha Drift` |
| `STARHOLD_UNIVERSE_SPEED` | no | `8` |
| `ALLOWED_ORIGINS` | no | `https://starhold-two.vercel.app` |

4. **Save**  
5. **Deployments** → open latest Production → **⋯ → Redeploy**

### 3. Tell the agent when done

```bash
curl -s https://starhold-two.vercel.app/api/health
```

Expect `"storage":"upstash"`. Then the agent verifies two-commander multiplayer.

---

## Build settings (already configured)

| Setting | Value |
|---------|--------|
| Framework | Other |
| Root | `./` |
| Install | `npm install` |
| Build | `npm run build:vercel` (web + esbuild API bundle) |
| Output | `apps/web/dist` |
| API | `api/[[...route]].js` (catch-all `/api/*`) |

## Local

```bash
npm run build:vercel
PORT=3001 npm start   # memory unless Upstash env set
```
