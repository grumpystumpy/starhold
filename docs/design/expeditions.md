# Design — Expeditions (P2)

## Goal

Send a fleet into **deep space** for a timed probe of the void: return with resources, salvage ships, nothing, or pirate losses. Invented Starhold rules — genre-inspired only.

## Mission

| Field | Rule |
|-------|------|
| Type | `expedition` |
| Target | Deep-space coords: same galaxy/system as selected, **`slot = EXPEDITION_SLOT`** (`MAP_SLOTS + 1` = 9). Not a planet. |
| Ships | ≥1 any hull (haulers raise resource finds via cargo). |
| Fuel | Outbound leg only (same as other missions). |
| Caps | Concurrent expeditions per empire: **`maxExpeditions(astro) = 1 + astrophysics`**. Also bound by Computer Tech fleet slots. |

Astrophysics copy updates to mention colony **and** expedition slots.

## Timeline

1. Outbound flight (distance uses deep-space slot).
2. On arrival: **resolve immediately** (no separate hold phase in v1).
3. Return leg with cargo / remaining ships.
4. Dock at origin (existing return path).

## Outcomes (deterministic)

Seed = hash(`fleetId`, `arrivesAt`). Roll `0–99`:

| Roll | Kind | Effect |
|------|------|--------|
| 0–39 | `resources` | Fill cargo with metal/crystal/deut (scaled by cargo cap + light combat power). |
| 40–54 | `ships` | Gain 1–3 Scouts **or** 1 Hauler (if cargo free enough conceptually — just add ships). |
| 55–74 | `nothing` | Empty hold; ships intact. |
| 75–99 | `pirates` | Lose ~30% of ships (floor); tiny consolation resources if any cargo left. |

No dark-matter currency. No ACS / pathfinder.

## Reports

`ExpeditionReport`: kind, summary, cargo gained, ships gained/lost, coords, at. Listed in fleets panel (separate from combat/spy).

## UI

- Mission radio: **Expedition (deep space)**
- Target list: deep space for the **currently browsed** galaxy system (and origin system if different).
- Hint when expedition slot cap reached.

## Tests

- Launch to slot 9; reject occupied planet targets / bad slots.
- Cap: second expedition blocked at Astrophysics 0.
- Resource / pirate / nothing rolls via controlled timestamps.
- Arrival writes report; ships return with cargo.

## Out of scope

Highscores (next batch), hold-phase events, expedition tech beyond Astrophysics, moon finds.
