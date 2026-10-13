# Starhold process (Micah rules — effective now)

Canonical working agreements for agents on Starhold. Prefer this over older playtest/hosting habits.

## Hosting

- **No** trycloudflare tunnels, keepalive loops, or failover watchers.
- **One stable free URL** on a permanent free tier (no paid plans, no credit card).
- Prefer **Vercel Hobby (free)** for the frontend.
- **Vercel production branch = `main`.** Live: https://starhold-two.vercel.app
- Shared multiplayer state: Upstash KV via **`KV_REST_API_*`** (Vercel integration).
- If Micah must sign in, connect GitHub, or approve OAuth: **stop** and report exact URLs + clicks. Do not invent credentials.

Redeploy notes: [hosting.md](./hosting.md) · [vercel-deploy.md](./vercel-deploy.md).

## Git / PRs

- Default branch is **`main`**. **Never** push to `cursor/core-loop-prototype-1093` (retired after merge of PR #1).
- Each feature batch: branch off **`main`**, open a **small PR into `main`**, merge when **CI is green** (unit + Playwright required).
- Branch names: `cursor/<short-name>-####` when an agent suffix is required.
- Prefer Github MCP when `git push` is unavailable. Never leave `PLACEHOLDER` file contents.
- Large `api/[[...route]].js`: assemble via one-shot workflow or local `scripts/bundle-api.mjs` on the feature branch.
- If CI on `main` is red after a merge: open a CI-fix PR from `main` before the next feature batch.

## Parallel workstreams (post-contract)

Shared schema: **[design/universe-contract.md](./design/universe-contract.md)** (must follow). Vision: [vision.md](./vision.md).

1. Contract lands on `main`
2. **A** (universe + economy) merges first
3. **B–E** in parallel after A — rebase on `main`; stub only what the contract allows

## Testing

- Prefer **unit tests** (formulas / economy) + **Playwright e2e** (Upgrade, Shipyard, fleet missions).
- Run both in **GitHub Actions on every change** (free Actions). **CI required** before merge.
- **One agent playtest per merged milestone**, not per PR. Automated tests cover the batch.

## Batching

- One thread builds a **whole feature group** end-to-end, then tests.
- No tiny handoffs mid-system.

## Design first

- Before each system, write a short design doc under [`docs/design/`](./design/) covering costs, formulas, balance, and combat/system ties.
- Universe / economy / Starshards / pirates: obey **[universe-contract.md](./design/universe-contract.md)**.
- Then implement + unit/e2e; only then optional agent playtest.

## Reporting

- **No** self-wakes for health checks.
- Milestone reports only: feature batch merged, hosting cutover done, or a real blocker.
- Use `READY_FOR_USER_REPORT: yes` only at those milestones.

## Related

- [project-context.md](./project-context.md) — vision + status
- [vision.md](./vision.md) — Micah north star
- [design/universe-contract.md](./design/universe-contract.md) — shared schema contract
