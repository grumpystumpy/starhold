# Starhold

Inspired OGame-like browser space-strategy game for learning. **Original** names, numbers, and UI — not a clone of Gameforge assets or private APIs.

## Core loop (v1+)

1. **Mines** produce metal, crystal, and deuterium over time (energy can throttle output).
2. **Spend** resources to upgrade buildings (incl. Research Lab) and empire-wide **research**.
3. **Shipyard** builds ships + **static defenses** into hangar / garrison.
4. **Galaxy** browser + **fleets**: deploy, raid, espionage, transport, colonize, harvest debris.
5. Shared universe on a Hono API — **in-memory locally**, **Cloudflare D1** in production.
6. Optional **email + password** accounts + secure session cookie; guest `playerId` can be claimed — [`docs/design/accounts.md`](docs/design/accounts.md).

Formulas: [`packages/game/FLEETS.md`](packages/game/FLEETS.md). Hosting and deploy: [`docs/hosting.md`](docs/hosting.md). Designs: [`docs/design/`](docs/design/).

## How to run

```bash
npm install
npx playwright install chromium   # once, for e2e/smoke
npm test
npm run typecheck
npm run dev
# then: npm run e2e   # needs API+web up, or use CI which starts prod server
```

- Web UI: http://localhost:5173  
- API: http://localhost:3001 (`GET /api/health`)

Automation joins: `/?commander=Name` or `window.starhold.join("Name")`.

## Production hosting

Live on Cloudflare Workers Free with D1: https://starhold.stumpysgarage.workers.dev. Production deploys use `npm run deploy:prod` with Node 22 and are run only by Coding Bot with Micah's approval. See **[docs/hosting.md](docs/hosting.md)**. The retired Vercel deployment guide is preserved as historical reference at [docs/vercel-deploy.md](docs/vercel-deploy.md).

## Layout

| Path | Role |
|------|------|
| `packages/game` | Shared types, catalog, formulas, world sim |
| `apps/server` | Hono API (`app.ts`) + D1/memory store |
| `apps/web` | Vite + TypeScript UI + original SVG assets |
| `api/` | Legacy Vercel serverless path — committed `index.js` stub; not the production host |
| `AGENTS.md` | Short agent quality gate + doc pointers |
| `.github/workflows/ci.yml` | Unit + Playwright e2e on every change |

## Scripts

| Command | What it does |
|---------|----------------|
| `npm run dev` | API + Vite together |
| `npm run build` / `build:vercel` | Production build (game + server + web); `build:vercel` is legacy |
| `npm run test` | Game unit tests |
| `npm run typecheck` | Strict TypeScript |
| `npm run e2e` / `smoke` | Playwright UI smoke (Upgrade, Shipyard, fleets) |
| `npm start` | Serve API + `apps/web/dist` on `PORT` |

## Legal

Inspired fan learning project. Do not copy proprietary art, branding, or scrape live game APIs.
