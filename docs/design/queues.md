# Multi-item build queues (Round 2 / Thread H)

**Contract:** [round2-contract.md](./round2-contract.md) §2, §8–9.

## Shape

- Planet: `buildQueue`, `shipQueue`, `defenseQueue` — **arrays**
- Player: `researchQueue` — **array** (empire-scoped)
- Each item: `id`, `kind`, `enqueuedAt`, `completesAt`, `workSeconds`, `startedAt`, `paidCost`, optional `remainingSeconds`

## Caps (v1)

| Queue | Base | Growth | Hard cap |
|-------|-----:|--------|---------:|
| Building / ship / defense | 2 | +1 / 2 levels **Yard Logistics**; +1 Quartermaster; +1 skill **Yard Depth** | 8 |
| Research | 1 | +1 / 3 levels Yard Logistics; +1 Archivist | 8 |

## Tick

Only the front item runs. On complete → pop → start next (`startedAt = now`, recompute `completesAt`).

### Sub-second batching (Micah)

Ship / defense queues store fractional `unitSeconds` (no 1s/unit floor). Each tick:

`batch = min(remaining, floor(elapsed / unitSeconds))`

Deliver that many hulls, shrink `count`, advance `startedAt`. Buildings share the same timer path: multiple front completions can land in one tick when `workSeconds` is sub-second.

Research still floors at ≥1s (Nanite does not apply).

### Nanite Factory hook (Thread J)

`constructionTimeMultiplier(level) = 0.1^level` applied to building / ship / defense times via `naniteFactoryLevel(planet)` (reads `buildings.naniteFactory` when J lands; 0 until then). Research exempt. Contract update lands with J.

## Cancel / reorder

- Cancel non-front → **100%** `paidCost` refund
- Cancel front (started) → **50%** refund; next starts immediately
- Reorder: permutation of ids; **front id locked**

## API

Legacy `POST /api/upgrade`, `/api/build-ship`, `/api/build-defense`, `/api/research` unchanged.

Round 2 aliases: `/api/queue/{building,ship,defense,research}`, plus `/api/queue/cancel` and `/api/queue/reorder`.

## KV

`UNIVERSE_SCHEMA_VERSION = 3`. Migrator `2 → 3` wraps legacy single queues into one-element arrays (idempotent; no map reset).
