# Design — Buildable defenses (P0)

## Goal

Static planetary guns that queue like ships, sit on the planet, and add defender combat power on raids.

## Costs / queue

| Unit | Yard | Cost (each) | Role |
|------|------|-------------|------|
| Laser Battery | L1 | 150m / 50c | Primary static DPS |
| Shield Dome | L2 | 500m / 300c | Soak; low attack |

- One `defenseQueue` per planet (count batch). Completes → add to `planet.defenses`.
- UI: Defenses panel + `POST /api/build-defense`.

## Combat ties

Defenses use the same unit power formula as ships (`formulas-combat`):

`attack×(1+0.08×Weapons) + 0.5×shield×(1+0.08×Shielding) + 0.3×hull×(1+0.08×Armour)`

Raid resolution includes Σ defenses with hangar ships. Losses apply to defense counts on defender outcomes (same keep-% bands as ships). Debris is **ships only** (genre-like); defenses do not create debris.

## Balance

- 10× Laser should crush 1 Scout (unit test).
- Domes are expensive soak — optional early; Laser is the P0 must-have.

## Completeness

**Have:** build, combat inclusion, art, tests.  
**Later:** missile silo / interplanetary missiles (out of P0).
