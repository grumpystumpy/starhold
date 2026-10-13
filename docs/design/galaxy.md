# Design — Galaxy / system view

## Goal

Browse a system’s slots (occupied / empty / debris / moon / asteroids / deep space) and pick fleet targets without relying only on the roster list.

## Map bounds (universe contract v1)

- **10** galaxies × **399** systems × **15** planet slots
- Slot **16** = deep space (`DEEP_SPACE_SLOT` / `EXPEDITION_SLOT`) — expeditions only
- Join assigns the next free slot (prefer mid slots **4–12**)

## API

- `galaxyViewFor(universe, playerId, galaxy, system)` →
  - `slots[15]` with occupant, allianceTag (null until alliances), debris, hasMoon/moonId, activity
  - `deepSpace` coords (slot 16)
  - `asteroids[]` for the browsed system
  - `pirateBase` public stub (null until thread E)
- Player view includes `galaxy`; query `?galaxy=&system=` on `/api/state/:id`.

## Asteroids

- 0–2 per system (seeded at universe create)
- Mission `harvestAsteroid` with `asteroidId` (recyclers)

## Ties

- **Colonize / harvest** need empty or debris coords from this view.
- **Espionage / raid / deploy** can still use roster planets; galaxy is the spatial mental model.

## Completeness

**Have (A):** map constants, galaxy payload shapes, asteroid harvest hooks, KV schemaVersion reset.  
**Later (B):** classic 15-row + deep-space + asteroid/pirate UI layout.
