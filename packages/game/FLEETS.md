# Fleets & missions (Starhold formulas)

Invented basics-first rules — **inspired** by the genre, not scraped from OGame or clones.

## Missions

| Mission | Behavior |
|---------|----------|
| **deploy** | Rival: peaceful visit then return. **Own colony:** park — ships dock at destination (no cargo). |
| **raid** | On arrival: resolve combat vs defender hangar **+ defenses**; on attacker win, loot resources; debris from destroyed ships; survivors return with cargo. |
| **espionage** | Requires Spy Probe. Writes an espionage report (detail from Espionage Tech vs target lab). Probes return. |
| **transport** | Move cargo + ships to another **own** planet (docks there). |
| **colonize** | Requires Colony Ship + Astrophysics colony slot. Found colony on empty coords; colony ship consumed. |
| **harvest** | Requires Recycler + debris at coords. Scoop metal/crystal into cargo and return. |
| **expedition** | Deep space (`slot = EXPEDITION_SLOT`). Resolve find/pirates on arrival; return with cargo. Cap = `1 + Astrophysics`. |

Fuel is paid up-front for the **outbound** leg only (return is free in v1). Computer Tech limits simultaneous fleet missions (base 1). Astrophysics also gates concurrent expeditions. See [docs/design/expeditions.md](../../docs/design/expeditions.md).

## Distance

```
distance = |Δgalaxy|×100 + |Δsystem|×10 + |Δslot|
```

## Travel time (one-way)

Cruise speed = **slowest** ship in the fleet × (1 + 0.1 × Combustion Drive).

```
seconds = max(8, ceil(distance × 1_000_000 / (cruiseSpeed × fleetSpeed)))
```

`fleetSpeed` mirrors universe economy speed in the prototype (currently **8×**).

Resource income uses `universe.speed × PRODUCTION_MULT × (1 + 0.02 × Energy Tech)`. Build and fleet timers still use `universe.speed` / `fleetSpeed` only.

## Fuel (deuterium)

```
fuel = max(1, ceil(Σ shipCount × fuelPerDistance × distance))
```

## Combat (multi-round + rapid fire)

Raid fights run up to **6 simultaneous-fire rounds** (see [docs/design/combat-rounds.md](../../docs/design/combat-rounds.md)).

```
atk = attack×(1+0.08×Weapons)
hp  = shield×(1+0.08×Shielding) + hull×(1+0.08×Armour)
damage = count×atk×rapidFire(firer, focusTarget)
```

Focus = enemy type with highest remaining count. Rapid-fire table in `catalog-rapid-fire.ts`.

Outcomes: defender wiped → **attacker_win**; attacker wiped → **defender_win**; both alive after 6 rounds (or mutual wipe) → **draw**.

`fleetCombatPower` remains a rough UI score only.

## Debris

30% of destroyed ship metal/crystal costs become a debris field at the target coords. Recyclers harvest with the **harvest** mission.

Heavy debris can coalesce into a **moon** (see [docs/design/moons.md](../../docs/design/moons.md)): chance `% = min(20, floor((metal+crystal)/1000))` when total ≥ 5000 and the planet has no moon yet.

## Loot

Only on **attacker_win**:

```
eligible = floor(floor(stock) × 0.5)   // per resource
```

Fill cargo (surviving fleet capacity) in order **metal → crystal → deuterium**.

## Ship / defense / research catalogs

Combat ladder (P1): Scout → Interceptor → **Aegis Cruiser** (yard 4) → **Breach Bomber** (yard 5), plus utility Probe / Recycler / Colony Ship / Hauler. See `catalog-units.ts` and [docs/design/combat-hulls.md](../../docs/design/combat-hulls.md).
