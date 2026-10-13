# Design — Research Lab + tree (P0)

## Goal

Empire-wide techs that gate flight, combat, espionage depth, colonies, and fleet slots. One research at a time; requires a Research Lab building.

## Costs / timers

| Piece | Rules |
|-------|--------|
| **Research Lab L0→L1** | Base `{ metal: 180, crystal: 120, deuterium: 0 }` so mines-first sessions unlock research before Deut Still. Growth ×2; ~18s base / universe speed. |
| **Techs** | Catalog in `packages/game` `RESEARCH`. Cost growth ~×2 (Astrophysics ×1.8). Lab level gate per tech (`labLevel`). |
| **Queue** | One empire-wide `researchQueue` on the player. Completing advances that tech level. |

## Formulas / ties

- **Energy Tech:** +2% mine output per level (income only).
- **Combustion Drive:** +10% fleet cruise speed per level.
- **Weapons / Armour / Shielding:** +8% to matching combat terms.
- **Espionage Tech:** spy report detail vs target lab (see [espionage.md](./espionage.md)).
- **Astrophysics:** colony count = 1 + level.
- **Computer Tech:** simultaneous fleet missions = 1 + level.

## Balance notes

- Lab must be reachable in a short playtest without deut farming.
- First techs (Energy, Espionage, Combustion) stay cheap vs Interceptor / Colony Ship.

## Completeness

**Have:** lab building, queue API/UI, full minimal tree, unit coverage.  
**Polish left:** session timing vs mines-first path (lab cost tweak). Research feeds empire highscores once (see [highscores.md](./highscores.md)).
