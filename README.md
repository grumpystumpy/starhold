# Starhold

Inspired OGame-like browser space-strategy game for learning. **Original** names, numbers, and UI — not a clone of Gameforge assets or private APIs.

## Core loop (v1+)

1. **Mines** produce metal, crystal, and deuterium over time (energy can throttle output).
2. **Spend** resources to upgrade buildings (incl. Research Lab) and empire-wide **research**.
3. **Shipyard** builds ships + **static defenses** into hangar / garrison.
4. **Galaxy** browser + **fleets**: deploy, raid, espionage, transport, colonize, harvest debris.
5. Shared **in-memory universe** on a tiny Node API so multiple browser clients share one world.

Formulas: [`packages/game/FLEETS.md`](packages/game/FLEETS.md). UI art: [`apps/web/public/assets/README.md`](apps/web/public/assets/README.md) (original SVG only).

## How to run

```bash
npm install
npx playwright install chromium   # once, for smoke
npm test
npm run typecheck
npm run dev
# then: npm run smoke
```

- Web UI: http://localhost:5173  
- API: http://localhost:3001 (`GET /api/health`)

Automation joins: `/?commander=Name` or `window.starhold.join("Name")`.  
Fleet helpers: `window.starhold.launchFleet(planetId, "raid", { scout: 2 })` or `window.starhold.launch({ mission, ships, targetPlanetId | targetCoords, cargo? })`.

Open two tabs with different commander names to unlock raid / spy targets.

## Layout

| Path | Role |
|------|------|
| `packages/game` | Shared types, catalog, formulas, world sim (incl. fleets) |
| `apps/server` | In-memory universe + REST API (authoritative tick-on-read) |
| `apps/web` | Vite + TypeScript UI + original SVG assets |

## API (fleets)

| Method | Path | Body |
|--------|------|------|
| POST | `/api/launch-fleet` | `{ playerId, mission, ships, targetPlanetId?, targetCoords?, cargo? }` |
| POST | `/api/research` | `{ playerId, researchId }` |
| POST | `/api/build-defense` | `{ playerId, defenseId, count }` |
| POST | `/api/select-planet` | `{ playerId, planetId }` |

Player state (`/api/state/:id`) includes `fleets`, `reports`, `spyReports`, `galaxy`, `ownedPlanets`.

## Scripts

| Command | What it does |
|---------|----------------|
| `npm run dev` | Build shared package, then API + Vite together |
| `npm run build` | Production build of all workspaces |
| `npm run test` | Game package unit tests (production + fleets/raids) |
| `npm run typecheck` | Strict TypeScript across packages |
| `npm run smoke` | API + Playwright UI smoke (needs `npm run dev`) |

## Legal

Inspired fan learning project. Do not copy proprietary art, branding, or scrape live game APIs.
