# Starhold hosting

**Policy:** no trycloudflare / keepalive / failover. Free permanent URL. No paid plans / credit cards. See [process.md](./process.md).

## Preferred: Vercel Hobby + Upstash (Micah owns accounts)

Micah creates the Vercel project and imports `grumpystumpy/starhold`. Full checklist: **[vercel-deploy.md](./vercel-deploy.md)**.

Summary:

1. Free **Upstash Redis** → copy REST URL + token.
2. **Vercel Hobby** → Import GitHub repo (root `.`, branch of PR #1).
3. Set env vars (`UPSTASH_REDIS_REST_*`, optional `STARHOLD_*`).
4. Deploy → `WEB=https://….vercel.app` in Project `internal/playtest-host.txt`.

Repo pieces: `vercel.json`, `api/index.ts`, Upstash-backed `apps/server/src/store.ts`, `.env.example`.

**Cloudflare Workers + D1** will replace this host once the cut-over checklist in [cloudflare.md](./cloudflare.md) is done. Until that checklist is finished, Vercel stays the live site and `npm run build:vercel` must keep passing.

## Local / CI

Without Upstash env vars the API uses **in-memory** state (fine for `npm run dev` and GitHub Actions e2e).

```bash
npm run build && PORT=3001 npm start
```
