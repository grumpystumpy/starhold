# Starhold process (Micah rules — effective now)

## Hosting

- **No** trycloudflare tunnels, keepalive loops, or failover watchers.
- **One stable free URL** (Vercel Hobby + Upstash preferred). No paid plans / credit cards.
- Micah creates Vercel + Upstash accounts; agents wire the repo and document env vars. See [vercel-deploy.md](./vercel-deploy.md).

## Testing

- Unit tests (formulas/economy) + Playwright e2e (Upgrade, Shipyard, fleets) in **GitHub Actions on every change**.
- At most **one** agent playtest per finished feature batch.

## Batching

- One thread builds a whole feature group end-to-end, then tests. No tiny handoffs.

## Design first

- Before each system, write a short design doc under [`docs/design/`](./design/).

## Reporting

- Milestone only: feature batch merged, hosting cutover done, or real blocker.
- `READY_FOR_USER_REPORT: yes` only at those milestones.
