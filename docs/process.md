# Starhold process (Micah rules — effective now)

## Hosting

- **No** trycloudflare tunnels, keepalive loops, or failover watchers.
- **One stable free URL** (Vercel Hobby + Upstash preferred). No paid plans / credit cards.
- **Vercel production branch = `main`.**
- Micah creates Vercel + Upstash accounts; agents wire the repo and document env vars. See [vercel-deploy.md](./vercel-deploy.md).

## Git / PRs

- Default branch is **`main`**. Never push to `cursor/core-loop-prototype-1093` (retired).
- Each feature batch: branch off **`main`**, open a **small PR into `main`**, merge when CI is green.
- Branch names: `cursor/<short-name>-####` (agent suffix when required).
- Prefer Github MCP `push_files` / PR tools when `git push` credentials are unavailable. Never leave `PLACEHOLDER` file contents on a branch.
- Large `api/[[...route]].js` bundles: one-shot assemble workflow or local `node scripts/bundle-api.mjs` committed on the feature branch.

## Testing

- Unit tests (formulas/economy) + Playwright e2e (Upgrade, Shipyard, fleets) in **GitHub Actions on every change**.
- At most **one** agent playtest per finished feature batch.
- If CI on `main` is red after a merge: fix first on a branch from `main`, open a CI-fix PR, then continue features.

## Batching

- One thread builds a whole feature group end-to-end, then tests. No tiny handoffs.

## Design first

- Before each system, write a short design doc under [`docs/design/`](./design/).

## Reporting

- Milestone only: feature batch merged, hosting cutover done, or real blocker.
- `READY_FOR_USER_REPORT: yes` only at those milestones.
