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

See **[process.md](./process.md)** — branch off `main`, small PR per batch, never push retired `cursor/core-loop-prototype-1093`, Vercel production = `main` → https://starhold-two.vercel.app, Upstash `KV_REST_API_*`, CI required, one agent playtest per **merged milestone**.

## Status

- **Live:** https://starhold-two.vercel.app — `"storage":"kv"` (Vercel Upstash integration `KV_REST_API_*`); multiplayer verified
- **Tip:** track `main` — contract PR lands schema docs first; then thread A
- **Systems:** P0/P1 + combat rounds + expeditions + highscores + **moons** (design/code on main) — designs in [design/](./design/)
- **Hosting:** [vercel-deploy.md](./vercel-deploy.md)
- **Next:** Land universe contract on `main` → thread **A** (universe + economy) → B–E in parallel

## Stack

TypeScript + Vite client, shared `@starhold/game`, Hono API on Vercel serverless + Upstash/KV Redis.

## Doc index

| Doc | Purpose |
|-----|---------|
| [vision.md](./vision.md) | Micah north star |
| [design/universe-contract.md](./design/universe-contract.md) | Shared schema + balance contract |
| [process.md](./process.md) | Micah process rules |
| [vercel-deploy.md](./vercel-deploy.md) | Env vars + redeploy |
| [design/](./design/) | Per-system designs |
| [project-context.md](./project-context.md) | This file |
