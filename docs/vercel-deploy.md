# Deploy Starhold on Vercel Hobby (Micah)

**You create the Vercel project and Upstash DB.** Agents do not open accounts for you. Hobby / free tiers — **do not add a credit card**.

Repo is wired for: static Vite UI + Node serverless `/api/*` + **Upstash Redis** JSON universe.

## 1. Create free Upstash Redis (required for multiplayer)

1. Open https://console.upstash.com/
2. **Sign in with GitHub** (free).
3. **Create database** → region near you → name e.g. `starhold`.
4. Open the DB → **REST API** tab → copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

No schema migrations: one JSON key (`STARHOLD_UNIVERSE_KEY`, default `starhold:universe:v1`) holds the whole universe. Optional lock key `${key}:lock`.

## 2. Import the GitHub repo on Vercel

1. Open https://vercel.com/new (sign in with GitHub on **Hobby** if needed).
2. **Import** `grumpystumpy/starhold`.
3. **Branch / production branch:** use `cursor/core-loop-prototype-1093` until merged to `main`, or `main` after merge.
4. **Root Directory:** leave `.` (repo root) — do not set to `apps/web`.
5. Framework preset: **Other** (or Vite). Vercel reads `vercel.json`:
   - Install: `npm install`
   - Build: `npm run build:vercel`
   - Output: `apps/web/dist`
6. **Do not** enable a paid plan.

## 3. Environment variables (paste in Vercel)

**Project → Settings → Environment Variables** — enable for **Production** and **Preview**:

| Name | Required | Example / value |
|------|----------|------------------|
| `UPSTASH_REDIS_REST_URL` | **Yes** | `https://….upstash.io` from Upstash REST API |
| `UPSTASH_REDIS_REST_TOKEN` | **Yes** | REST token from Upstash |
| `STARHOLD_UNIVERSE_KEY` | No | `starhold:universe:v1` |
| `STARHOLD_UNIVERSE_NAME` | No | `Alpha Drift` |
| `STARHOLD_UNIVERSE_SPEED` | No | `8` |
| `ALLOWED_ORIGINS` | No | `https://<your-deployment>.vercel.app` (only if you hit API cross-origin) |

`VERCEL_URL` is set automatically by Vercel (used for CORS).

Without the two Upstash vars, each serverless instance uses **empty in-memory** state (joins will not stick across requests).

## 4. Deploy and smoke-check

1. **Deploy** (or push a commit on the connected branch).
2. Open `https://<project>.vercel.app/api/health` — expect `"ok": true` and `"storage": "upstash"`.
3. Open the site root → join a commander → refresh → state should persist.
4. Paste the production URL into Project store `internal/playtest-host.txt` as `WEB=https://…`.

## 5. Redeploy later

Push to the connected branch, or Vercel dashboard → **Deployments → Redeploy**.

Local parity: `npm run build && PORT=3001 npm start` (memory store unless Upstash env is set).

## Related

- [`.env.example`](../.env.example)
- [process.md](./process.md) · [hosting.md](./hosting.md)
