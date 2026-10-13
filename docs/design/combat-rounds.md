# Design — Multi-round combat + rapid fire (P2)

## Goal

Replace one-shot power-ratio raid resolution with a **deterministic multi-round** fight where **rapid fire** matchups matter — invented Starhold rules, genre-inspired only.

## Rounds

- Max **`MAX_COMBAT_ROUNDS = 6`**.
- Both sides fire **simultaneously** each round (damage computed from start-of-round counts, then applied).
- Fight ends early when attacker ships = 0 or defender ships+defenses = 0.
- After max rounds with both sides still alive → **draw**.

## Unit stats (unchanged catalogs)

Per living unit:

```
atk  = attack × (1 + 0.08 × Weapons)
hp   = shield × (1 + 0.08 × Shielding) + hull × (1 + 0.08 × Armour)
```

Defenses use the same formulas and fight on the defender side.

## Fire allocation (invented)

Each round, for each firer type with `count > 0`:

1. Pick a target type: highest remaining enemy **count**, tie-break `SHIP_ORDER` then `DEFENSE_ORDER`.
2. Deal  
   `damage = count × atk × rapidFire(firer, target)`  
   into that type’s HP pool (plus residual from prior rounds).
3. `kills = floor((residual + damage) / hp)`; reduce count; keep new residual.

Attacker only has ships; defender has ships + defenses.

## Rapid fire table (invented)

`rapidFire(A, T) = N` (default **1**). Multiplies damage when `A` focuses `T`.

| Firer → target | N | Note |
|----------------|---|------|
| Interceptor → Probe | 5 | Screens eat drones |
| Interceptor → Scout | 2 | |
| Cruiser → Hauler | 3 | Line ships punish freighters |
| Cruiser → Probe | 4 | |
| Bomber → Beam Emplacement | 4 | Breach guns |
| Bomber → Scout | 2 | |
| Scout → Probe | 2 | |
| Whisper Probe / Outpost Cradle | — | atk 0; never fire |

No mutual RF stacks beyond the single focus target per firer type per round.

## Outcomes

| Condition | Outcome |
|-----------|---------|
| Defender wiped, attacker has ships | `attacker_win` (+ loot path unchanged) |
| Attacker wiped | `defender_win` |
| Both alive after 6 rounds, or both wiped | `draw` |

Debris / loot / report wiring stay in `resolveRaidArrival`. Reports gain **`rounds`** and a summary that names round count + RF when relevant.

## Compatibility

- `fleetCombatPower` remains as a **UI / rough** score (not used for raid resolution).
- Yard / mission APIs unchanged.

## Tests

- Unopposed landing still `attacker_win` with full survivors.
- 5 Interceptors vs 1 Scout → `defender_win`.
- 10 Lasers vs 1 Scout → `defender_win`.
- 1 Cruiser vs 2 Interceptors → `attacker_win`.
- RF: Interceptors wipe many Probes in ≤2 rounds vs same without RF table (or explicit RF damage check).
- Report includes `rounds >= 1`.

## Out of scope

ACS, moon destruction, RNG seeds, per-unit animation, full OGame RF matrix clone.
