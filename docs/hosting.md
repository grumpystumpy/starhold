# Starhold hosting

**Policy:** no trycloudflare / keepalive / failover. Free permanent URL. No paid plans / credit cards. See [process.md](./process.md).

## Live: Cloudflare Workers (free plan) + D1

- Live URL: https://starhold.stumpysgarage.workers.dev
- Static client: Workers static assets (`apps/web/dist`). API: `worker/index.ts` → the same Hono app as local dev.
- Saves and accounts: D1 database `starhold` (`wrangler.toml`, `migrations/`). Migrations are additive only.
- Free-plan limits every change must fit: 10 ms CPU per request and 50 D1 queries per request. See [AGENTS.md](../AGENTS.md) section 3 for our budgets.
- Details, setup and the Worker/D1 save model: [cloudflare.md](./cloudflare.md).

## Deploys

- Production deploys use `npm run deploy:prod` with Node 22. The script applies D1 migrations before deploying the Worker.
- Only Coding Bot runs production deploys, with Micah's approval. Other agents must not deploy.

## Legacy: Vercel + Upstash

Vercel (`starhold-two.vercel.app`) with Upstash Redis was the first host and is retired. `vercel.json`, `api/`, `npm run build:vercel` and [vercel-deploy.md](./vercel-deploy.md) are historical/legacy artifacts, not the live site or deploy target. Don't build new work on them.

## Local / CI

Without Upstash or D1 env the Node API uses **in-memory** state (fine for `npm run dev` and GitHub Actions e2e). Use Node 22 (Node 20 lacks `node:sqlite`).

```bash
npm run build && PORT=3001 npm start
```

Workers locally: see the "Local" block in [cloudflare.md](./cloudflare.md) (`npm run cf:dev`).
