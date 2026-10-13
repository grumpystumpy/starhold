# Design — P1 combat hulls

## Goal

Widen the raid ladder past Scout / Interceptor with two mid–late combat hulls so fleet composition matters without adding rapid-fire yet.

## New ships

| Id | Name | Yard | Cost (m/c/d) | Role |
|----|------|------|--------------|------|
| `cruiser` | **Aegis Cruiser** | L4 | 2400 / 1000 / 200 | Mid-weight striker; tankier than Interceptor |
| `bomber` | **Breach Bomber** | L5 | 3200 / 1800 / 400 | Heavy gunship; high attack, slow, costly deut |

### Stats (invented)

| Hull | Atk | Shield | Hull | Cargo | Speed | Fuel/dist |
|------|-----|--------|------|-------|-------|-----------|
| Interceptor (ref) | 40 | 16 | 50 | 100 | 9 000 | 0.5 |
| Aegis Cruiser | 90 | 50 | 180 | 400 | 5 000 | 1.5 |
| Breach Bomber | 160 | 20 | 90 | 80 | 3 500 | 2.0 |

Build times: Cruiser ~70s base, Bomber ~95s base (scaled by universe speed like other hulls).

## Combat / system ties

- Same power formula as today (`formulas-combat`) — no rapid-fire this batch (P2).
- Debris still from destroyed ship metal/crystal costs.
- Cruise speed = fleet slowest hull → Bombers drag ETA (intentional).
- Yard gates: L4 / L5 encourage mid-session Shipyard investment.
- Fields soft-cap unchanged (ships do not consume fields).

## Balance checks (unit)

- Cruiser combat power ≫ Interceptor.
- 1 Cruiser beats 2 Interceptors (attacker_win).
- Bomber power > Cruiser; Bomber build requires yard L5.
- Existing Laser-vs-Scout and debris tests stay green.

## UI / art

- Hull bay + fleet composer pick up `SHIP_ORDER` automatically.
- Original SVG plates under `public/assets/ships/{cruiser,bomber}.svg`.

## Out of scope (later)

Rapid-fire tables, multi-round combat, true capital (battleship-class), deathstar analogues.
