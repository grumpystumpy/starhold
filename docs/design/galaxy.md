# Design — Galaxy / system view (P0)

## Goal

Browse a system’s slots (occupied / empty / debris) and pick fleet targets without relying only on the roster list.

## Map bounds (prototype)

- 1 galaxy × 5 systems × 8 slots (`MAP_*` in catalog).
- Join assigns the next free slot.

## UI / API

- `galaxyViewFor(universe, playerId, galaxy, system)` → 8 slots with occupant name, planetId, debris summary.
- Player view includes `galaxy`; query `?galaxy=&system=` on `/api/state/:id`.
- Panel: prev/next system, click slot → fleet draft target (planet or coords).

## Ties

- **Colonize / harvest** need empty or debris coords from this view.
- **Espionage / raid / deploy** can still use roster planets; galaxy is the spatial mental model.

## Completeness

**Have:** system list, nav, deep-link into fleet composer empty/debris options.  
**Later:** multi-galaxy scroll, vacation flags, phalanx (P2+).
