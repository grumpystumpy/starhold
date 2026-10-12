# Starhold

Inspired OGame-like browser space-strategy game for learning. **Original** names, numbers, and UI — not a clone of Gameforge assets or private APIs.

## Core loop (v1)

1. **Mines** produce metal, crystal, and deuterium over time (energy can throttle output).
2. **Spend** resources to upgrade buildings.
3. **Shipyard** builds ships into your hangar.
4. Shared **in-memory universe** on a tiny Node API so multiple browser clients can join the same world (foundation for fleets/raids later).

## How to run

```bash
npm install
npm run dev
```

- Web UI: http://localhost:5173  
- API: http://localhost:3001 (`GET /api/health`)

Open two browser tabs, join with different commander names — you share one universe.

## Layout (beginner map)

| Path | Role |
|------|------|
| `packages/game` | Shared types, catalog, formulas, world sim (used by server; safe to preview on client later) |
| `apps/server` | In-memory universe + REST API (authoritative tick-on-read) |
| `apps/web` | Vite + TypeScript UI |

## Scripts

| Command | What it does |
|---------|----------------|
| `npm run dev` | Build shared package, then API + Vite together |
| `npm run build` | Production build of all workspaces |
| `npm run typecheck` | Strict TypeScript across packages |

## Legal

Inspired fan learning project. Do not copy proprietary art, branding, or scrape live game APIs.
