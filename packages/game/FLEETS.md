# Fleets & missions (Starhold formulas)

Invented basics-first rules — **inspired** by the genre, not scraped from OGame or clones.

## Missions

| Mission | Behavior |
|---------|----------|
| **deploy** | Ships leave hangar, fly to another commander's planet, then return intact (no combat). |
| **raid** | On arrival: resolve combat vs defender hangar **+ defenses**; on attacker win, loot resources; debris from destroyed ships; survivors return with cargo. |
| **espionage** | Requires Spy Probe. Writes an espionage report (detail from Espionage Tech vs target lab). Probes return. |
| **transport** | Move cargo + ships to another **own** planet (docks there). |
| **colonize** | Requires Colony Ship + Astrophysics colony slot. Found colony on empty coords; colony ship consumed. |
| **harvest** | Requires Recycler + debris at coords. Scoop metal/crystal into cargo and return. |

Fuel is paid up-front for the **outbound** leg only (return is free in v1). Computer Tech limits simultaneous fleet missions (base 1).

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

## Combat power

```
unit = attack×(1+0.08×Weapons) + 0.5×shield×(1+0.08×Shielding) + 0.3×hull×(1+0.08×Armour)
power = Σ ships + Σ defenses
```

Resolution (deterministic):

- Defender power ≤ 0 and attacker > 0 → **attacker_win**, no attacker losses
- Attacker ≥ defender × 1.1 → **attacker_win** (attacker keeps 80%, defender ships/defenses 30%)
- Defender ≥ attacker × 1.1 → **defender_win** (attacker keeps 30%, defender 80%)
- Else → **draw** (both keep 60%)

## Debris

30% of destroyed ship metal/crystal costs become a debris field at the target coords. Recyclers harvest with the **harvest** mission.

## Loot

Only on **attacker_win**:

```
eligible = floor(floor(stock) × 0.5)   // per resource
```

Fill cargo (surviving fleet capacity) in order **metal → crystal → deuterium**.

## Ship / defense / research catalogs

See `catalog.ts`.
