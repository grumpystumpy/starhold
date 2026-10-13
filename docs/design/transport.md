# Design — Transport mission (P0)

## Goal

Move cargo (and ships) between **own** planets. Full value requires colonies (Astrophysics + Colony Ship) — also landed as vertical slice.

## Rules

- Mission `transport` only if target planet is owned by the same player and ≠ origin.
- Cargo paid from origin stocks up to fleet cargo capacity; ships leave hangar and **dock** at destination (no return leg).
- Fuel: outbound only (same as other missions).

## Interim / teaching path

If the player has only a home world, UI still exposes transport but API rejects same-planet / non-owned targets with a clear error. Colonize empty galaxy slots to unlock real transfers.

## Ties

- **Colonize** creates the second planet; planet switcher selects origin.
- Hauler is the natural cargo hull; any ships with cargo capacity work.
- Computer Tech still limits concurrent missions.

## Completeness

**Have:** API validation, dock-on-arrival, UI cargo fields, colonize + transport unit test.  
**Polish:** clearer empty-state copy when `ownedPlanets.length < 2`; deploy retarget to own colonies (gap note).
