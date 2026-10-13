# Deploy Starhold on Vercel Hobby (Micah)

**Live project:** [starhold](https://vercel.com) → Production URL **https://starhold-two.vercel.app**  
**Branch:** `cursor/core-loop-prototype-1093` (every push auto-deploys)  
**Agents do not create accounts.** Hobby only — no credit card.

Build: `npm run build:vercel` → static `apps/web/dist` + bundled serverless catch-all `api/[[...route]].js` (Node req/res → Fetch bridge; no path-stripping rewrites).  
Shared state: **Upstash Redis** (JSON universe document). Without Redis env vars, each API invoke uses empty in-memory state → multiplayer **will not work**.

---

## STOP — Micah must add Upstash (required for multiplayer)

### A. Create free Upstash Redis

1. Open **https://console.upstash.com/** → **Sign in with GitHub** (free).
2. **Create database**
   - Name: `starhold` (any name)
   - Type: Regional / free tier
   - Region: pick one close to `iad1` (US East) if unsure
3. Open the database → **Details** / **REST API**
4. Copy:
   - **UPSTASH_REDIS_REST_URL** — looks like `https://xxxxx.upstash.io`
   - **UPSTASH_REDIS_REST_TOKEN** — long secret string

No SQL schema. One key holds the universe JSON (`starhold:universe:v1` by default).

### B. Paste env vars on Vercel (this project)

1. Open Vercel → team **Stumpy's Creations** → project **starhold**
2. **Settings → Environment Variables**
3. Add for **Production** and **Preview** (and Development if you want):

| Name | Required | Example format | Where it comes from |
|------|----------|----------------|---------------------|
| `UPSTASH_REDIS_REST_URL` | **YES** | `https://us1-happy-name-12345.upstash.io` | Upstash → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | **YES** | `AXxxxx...` (long token) | Upstash → REST API |
| `STARHOLD_UNIVERSE_KEY` | No | `starhold:universe:v1` | optional override |
| `STARHOLD_UNIVERSE_NAME` | No | `Alpha Drift` | first-boot universe name |
| `STARHOLD_UNIVERSE_SPEED` | No | `8` | economy/fleet speed |
| `ALLOWED_ORIGINS` | No | `https://starhold-two.vercel.app` | only if CORS issues |

4. **Save**
5. **Deployments → … on latest → Redeploy** (or push any commit) so functions pick up env.

### C. Smoke after Redeploy

```bash
curl -s https://starhold-two.vercel.app/api/health
```

Expect JSON like: `"ok":true,"storage":"upstash",...`  
If `"storage":"memory"` → env vars missing or not applied to that deployment.

Then join two commanders in two browsers; both should appear on the same roster.

---

## Project settings (already set / confirm)

| Setting | Value |
|---------|--------|
| Framework preset | **Other** |
| Root Directory | `./` |
| Install Command | `npm install` (from `vercel.json`) |
| Build Command | `npm run build:vercel` |
| Output Directory | `apps/web/dist` |
| Production Branch | `cursor/core-loop-prototype-1093` |

Optional: Vercel Marketplace → search **Upstash** → integrate into project (auto-fills the two `UPSTASH_*` vars). Still free Hobby / Upstash free — skip any paid prompts.

---

## Local

```bash
npm install
npm run build:vercel   # also writes api/[[...route]].js
PORT=3001 npm start    # memory store unless Upstash env set
```

See also: [`.env.example`](../.env.example) · [process.md](./process.md) · [hosting.md](./hosting.md)
