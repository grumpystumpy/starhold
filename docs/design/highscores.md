# Design — Highscores (P2)

## Goal

Empire-wide **points ranking** for every commander in the shared universe. Invented Starhold rules — genre-inspired only. Replaces home-only `roughPoints` on the roster.

## Points formula

Cost-based points (same unit as today: **total resource cost / 1000**, floored):

| Source | Rule |
|--------|------|
| Buildings | Sum upgrade costs for every level on **every owned planet** |
| Ships | Hull costs × count on every owned planet **and** ships in own fleets in flight |
| Defenses | Defense costs × count on every owned planet |
| Research | Sum upgrade costs for every tech level **once per empire** (not per planet) |

Helpers:

- `planetPoints(planet)` — buildings + docked ships + defenses (no research)
- `researchPoints(research)` — tech tree only
- `empirePoints(universe, player)` — all planets + in-flight fleets + research once
- `roughPoints(planet, research?)` — keep for single-planet / galaxy slot hints (`planetPoints` + optional research)

## Board

`HighscoreEntry` per player:

| Field | Meaning |
|-------|---------|
| `rank` | 1-based, dense; ties broken by `playerId` lexicographic |
| `playerId` / `name` | Commander |
| `points` | `empirePoints` |
| `coords` | Home planet coords |
| `planetCount` | Owned planets |

Sorted descending by points. Exposed on `PlayerView.highscores` (and roster `pointsHint` uses the same empire total).

Galaxy slot `pointsHint` stays **planet-local** (no research) so multi-colony systems do not inflate research N times.

## UI

- Panel **Highscores** (`data-testid="highscores"`): one row per commander, showing that commander's **home planet** name and coords. Colonies and moons are not separate rows. Points stay empire-wide.
- Mark the viewing player `(you)`
- Universe roster panel can remain as a compact alias or fold into highscores — v1: highscores is the ranked board; roster list shows the same empire `pointsHint`

## Tests

- Research counted once across two colonies
- In-flight ships add points
- Ranking order + tie-break
- `playerView.highscores` length / ranks
- Smoke: highscores panel visible after join

## Out of scope

Separate economy / fleet / research ladders, weekly resets, alliance scores, officers.
