# Design — Moons (Thread C)

## Goal

Planets can gain a **moon** after heavy combat debris — a second body at the same coordinates with moon-only buildings, fleet parking, Sensor Phalanx intel, and Jump Gate hops. Invented Starhold rules — genre-inspired only. Contract: [universe-contract.md](./universe-contract.md).

## Body model

| Field | Rule |
|-------|------|
| Storage | Moons are `PlanetState` with `kind: "moon"`, `parentPlanetId`, same `coords` as parent |
| Parent | Planet gets `moonId` when a moon exists |
| Ownership | Moon owned by the **planet owner** at formation |
| Slots | Moons do **not** consume galaxy slots; `planetAtCoords` / `nextCoords` ignore moons |
| Empire list | Moon ids are in `player.planetIds` (switcher / transport / deploy / jump) |
| Colony cap | `maxColonies` counts **planets only** (not moons) |

## Formation

After a **raid** resolves and debris is created at the target planet:

1. Skip if the planet already has a moon, or debris metal+crystal `< MOON_DEBRIS_MIN` (5000).
2. Chance `% = min(20, floor((metal + crystal) / 1000))`.
3. Deterministic roll: `hash(reportId) % 100`.
4. On success: create moon (`fieldsCap = MOON_FIELDS_BASE`), set links, append to owner `planetIds`, note on combat report (`moonFormed: true` + summary line).

No moon destruction / deathstar in v1.

## Moon economy

| Piece | Rule |
|-------|------|
| Mines / Research Lab | **Blocked** on moons |
| Allowed buildings | `lunarBase`, `sensorArray` (Sensor Phalanx), `jumpGate`, `solarPlant`, storages, `shipyard` |
| Defenses / ships | Allowed (same catalogs) |
| Fields | Cap = `MOON_FIELDS_BASE (1) + 3 × lunarBase level` |
| Points | Count via existing `empirePoints` (buildings/ships/defenses on the moon) |

## Sensor Phalanx (`sensorArray`)

At `sensorArray >= 1` on the **active** moon: `playerView.sensorContacts` lists outbound fleets (any commander) whose **target coords** are in the same galaxy and within **±level systems** of the moon (`inSensorPhalanxRange`). Read-only intel — no intercept.

Requires Lunar Base ≥ 1 to build.

## Jump Gate (`jumpGate`)

Mission type `jump`: near-instant hop (1s flight) between **two of your moons**, each with Jump Gate ≥ 1. Origin must be a moon with a gate. Fuel still uses normal one-way deuterium cost. Ships dock on the target moon (no return leg).

Requires Lunar Base ≥ 1 to build.

## UI

- Planet switcher: moons marked (“Moon”)
- Buildings panel: filter by allowed set for body kind
- Galaxy slot: `hasMoon` + `moonId`; fleet targets include rival moons when known (raid / deploy / spy)
- Jump mission lists own moons that have Jump Gate (when origin also has one)
- Combat report: show when a moon formed
- Sensor contacts list under fleets when present

## Tests

- Debris below threshold / existing moon → no formation
- Controlled seed → moon forms; parent/moon links; colony cap ignores moon
- Cannot queue mine / lab on moon; can queue lunarBase / jumpGate
- Sensor Phalanx lists outbound fleet in range (not only same system at level ≥ 2)
- Jump Gate docks ships on target moon; rejects planet origin / ungated moons
- `planetAtCoords` still returns the planet when a moon shares coords
- Galaxy slots expose `hasMoon` / `moonId`

## Out of scope

Moon destruction, ACS, multi-moon per planet.
