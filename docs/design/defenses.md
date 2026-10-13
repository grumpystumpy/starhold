# Design — Buildable defenses (P0)

## Goal

Static planetary guns that queue like ships, sit on the planet, and add defender combat power on raids.

## Costs / queue

| Unit | Yard | Cost (each) | Role |
|------|------|-------------|------|
| Beam Emplacement | L1 | 150m / 50c | Primary static DPS |
| Aegis Cupola | L2 | 500m / 300c | Soak; low attack |

- One `defenseQueue` per planet (count batch). Completes → add to `planet.defenses`.
- UI: Defenses panel + `POST /api/build-defense`.

## Combat ties

Defenses use the same unit power formula as ships (`formulas-combat`):

`attack×(1+0.08×Ordnance) + 0.5×shield×(1+0.08×Aegis Lattice) + 0.3×hull×(1+0.08×Hull Weave)`

Raid resolution includes Σ defenses with hangar ships. Losses apply to defense counts on defender outcomes (same keep-% bands as ships). Debris is **ships only** (genre-like); defenses do not create debris.

## Balance

- 10× Beam Emplacement should crush 1 Scout (unit test).
- Cupolas are expensive soak — optional early; Beam Emplacement is the P0 must-have.

## Completeness

**Have:** build, combat inclusion, art, tests.  
**Later:** missile silo / interplanetary missiles (out of P0).
