# Design — Moons (P3)

## Goal

Planets can gain a **moon** after heavy combat debris — a second body at the same coordinates with moon-only buildings, fleet parking, and a simple sensor. Invented Starhold rules — genre-inspired only.

## Body model

| Field | Rule |
|-------|------|
| Storage | Moons are `PlanetState` with `kind: "moon"`, `parentPlanetId`, same `coords` as parent |
| Parent | Planet gets `moonId` when a moon exists |
| Ownership | Moon owned by the **planet owner** at formation |
|Slots | Moons do **not** consume galaxy slots; `planetAtCoords` / `nextCoords` ignore moons |
| Empire list | Moon ids are in `player.planetIds` (switcher / transport / deploy) |
| Colony cap | `maxColonies` counts **planets only** (not moons) |

## Formation

After a **raid** resolves and debris is created at the target planet:

1. Skip if the planet already has a moon, or debris metal+crystal `< MOON_DEBRIS_MIN` (5000).
2. Chance `% = min(20, floor((metal + crystal) / 1000))`.
3. Deterministic roll: `hash(reportId) % 100`.
4. On success: create moon, set links, append to owner `planetIds`, note on combat report (`moonFormed: true` + summary line).

No moon destruction / deathstar in v1.

## Moon economy

| Piece | Rule |
|-------|------|
| Mines / Research Lab | **Blocked** on moons |
| Allowed buildings | `lunarBase`, `sensorArray`, `solarPlant`, storages, `shipyard` |
| Defenses / ships | Allowed (same catalogs) |
| Fields | Cap = `MOON_FIELDS_BASE (1) + 3 × lunarBase level` |
| Points | Count via existing `empirePoints` (buildings/ships/defenses on the moon) |

## Sensor Array

At `sensorArray >= 1` on the **active** moon: `playerView.sensorContacts` lists outbound fleets (any commander) whose **target coords** are in the same galaxy+system as the moon. Read-only intel — no intercept.

## UI

- Planet switcher: moons marked (Moon / ☾ label via copy, not emoji spam — use “Moon”)
- Buildings panel: filter by allowed set for body kind
- Galaxy slot: `hasMoon` + `moonId`; fleet targets include rival/own moons when known
- Combat report: show when a moon formed
- Sensor contacts list under fleets when present

## Tests

- Debris below threshold / existing moon → no formation
- Controlled seed → moon forms; parent/moon links; colony cap ignores moon
- Cannot queue mine / lab on moon; can queue lunarBase
- Sensor lists outbound fleet in-system
- `planetAtCoords` still returns the planet when a moon shares coords

## Out of scope

Jump gate, moon destruction, phalanx range tech tree, ACS, multi-moon per planet.
