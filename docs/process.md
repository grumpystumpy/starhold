# Starhold process (Micah rules — effective now)

Canonical working agreements for agents on Starhold. Prefer this over older playtest/hosting habits.

## Hosting

- **No** trycloudflare tunnels, keepalive loops, or failover watchers.
- **One stable free URL** on a permanent free tier (no paid plans, no credit card).
- Live: **Cloudflare Workers free plan + D1** at https://starhold.stumpysgarage.workers.dev
- Shared multiplayer state: the D1 database `starhold`. Vercel + Upstash is retired.
- Production deploys happen only by Coding Bot with Micah's approval, using `npm run deploy:prod` with Node 22. See [hosting.md](./hosting.md) and [cloudflare.md](./cloudflare.md).
- If Micah must sign in, connect GitHub, or approve OAuth: **stop** and report exact URLs + clicks. Do not invent credentials.

## Deploys and D1 migrations

`npm run deploy:prod` applies D1 migrations before deploying the Worker. Migrations must be additive and backward-compatible with live saves. Do not use `DROP`, destructive `ALTER`, or renames. Old code must still run against the new schema. Before every batch merge, check that a save from the current live build loads on the new build and keeps its progress.

## Git / PRs

- Default branch is **`main`**, protected by the `protect-main` ruleset: PR required, the `unit-and-e2e` CI check must pass, no force pushes, no deletion. **Never** push to `cursor/core-loop-prototype-1093` (retired after merge of PR #1).
- One GitHub issue = one small fix = one branch = one PR into `main` (see [AGENTS.md](../AGENTS.md)). Branch names: `agent/<tool>/<issue#>-<short-slug>`. Fill in the PR template (`Closes #N`, `Linear: STA-n`, tool used, tests run).
- Merge only when **CI is green** (unit + Playwright required) **and Micah approves**. No auto-merge.
- Prefer real `git push`. Never leave `PLACEHOLDER` file contents.
- Commit the small `api/index.js` **stub** (legacy Vercel bundle; CI still runs `npm run build:vercel`). Do not gitignore it and do not commit the generated bundle.
- No PR preview deploys. GitHub Actions must not call Vercel or deploy from a PR.
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

- Work is split into small GitHub issues (one fix, one branch, one PR each). The router (Coding Bot) assigns them so no two tools do the same work.
- Merges and deploys are batched: the router groups verified PRs into Micah's merge list, and deploys stay within Micah's daily cadence.

## Design first

- Before each system, write a short design doc under [`docs/design/`](./design/) covering costs, formulas, balance, and combat/system ties.
- Universe / economy / Starshards / pirates: obey **[universe-contract.md](./design/universe-contract.md)**.
- Then implement + unit/e2e; only then optional agent playtest.

## Reporting

- **No** self-wakes for health checks.
- Milestone reports only: feature batch merged, hosting cut-over complete, or a real blocker.
- Use `READY_FOR_USER_REPORT: yes` only at those milestones.

## Related

- [project-context.md](./project-context.md) — vision + status
- [vision.md](./vision.md) — Micah north star
- [design/universe-contract.md](./design/universe-contract.md) — shared schema contract
