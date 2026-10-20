# Project context — Game programming

Durable goals and boundaries for this Project. Update when direction changes; keep this file short.

## Vision

Build an **inspired OGame-like** browser space-strategy game: empire building with resources, buildings, research, fleets, and a galaxy map — our own names, numbers, and presentation.

Friends-only multiplayer north star: **[vision.md](./vision.md)**.

## Shared contract (required reading)

**[design/universe-contract.md](./design/universe-contract.md)** — schema, Starshards currency, map `10×399` / slots 1–15 + 16 deep space, fields curve, position production, API shapes, KV migration, A→B–E dependency order. All parallel threads must follow it.

## Micah’s goal (current)

Bring **Starhold** (default branch **`main`**) to the friends-multiplayer vision.

## Process (effective now)

See **[process.md](./process.md)** and root **[AGENTS.md](../AGENTS.md)** — branch off `main`, small PR per batch, never push retired `cursor/core-loop-prototype-1093`, Cloudflare Workers Free + D1 is production, CI required (`api/index.js` stub is a legacy Vercel artifact; `build:vercel` overwrites it with the bundle), one agent playtest per **merged milestone**.

## Status

- **Live:** https://starhold.stumpysgarage.workers.dev — Cloudflare Workers Free + D1
- **Tip:** track `main` — contract PR lands schema docs first; then thread A
- **Systems:** P0/P1 + combat rounds + expeditions + highscores + **moons** (design/code on main) — designs in [design/](./design/)
- **Hosting:** [hosting.md](./hosting.md); [vercel-deploy.md](./vercel-deploy.md) is historical
- **Next:** Land universe contract on `main` → thread **A** (universe + economy) → B–E in parallel

## Stack

TypeScript + Vite client, shared `@starhold/game`, Hono API on Cloudflare Workers + D1.

## Doc index

| Doc | Purpose |
|-----|---------|
| [vision.md](./vision.md) | Micah north star |
| [design/universe-contract.md](./design/universe-contract.md) | Shared schema + balance contract |
| [process.md](./process.md) | Micah process rules |
| [hosting.md](./hosting.md) | Current hosting and deploy process |
| [vercel-deploy.md](./vercel-deploy.md) | Historical Vercel deployment reference |
| [design/](./design/) | Per-system designs |
| [project-context.md](./project-context.md) | This file |
