# Fleets & raids (Starhold formulas)

Invented basics-first rules — **inspired** by the genre, not scraped from OGame or clones.

## Missions

| Mission | Behavior |
|---------|----------|
| **deploy** | Ships leave hangar, fly to another commander’s planet, then return intact (no combat). |
| **raid** | On arrival: resolve combat vs defender hangar; on attacker win, loot resources; survivors return with cargo. |

Cannot target your own planet. Fuel is paid up-front for the **outbound** leg only (return is free in v1).

## Distance

```
distance = |Δgalaxy|×100 + |Δsystem|×10 + |Δslot|
```

## Travel time (one-way)

Cruise speed = **slowest** ship in the fleet (`ShipDef.speed`).

```
seconds = max(8, ceil(distance × 1_000_000 / (cruiseSpeed × fleetSpeed)))
```

`fleetSpeed` mirrors universe economy speed in the prototype (currently **8×**).

## Fuel (deuterium)

```
fuel = max(1, ceil(Σ shipCount × fuelPerDistance × distance))
```

## Combat power

```
power = Σ count × (attack + 0.5×shield + 0.3×hull)
```

Resolution (deterministic):

- Defender power ≤ 0 and attacker > 0 → **attacker_win**, no attacker losses
- Attacker ≥ defender × 1.1 → **attacker_win** (attacker keeps 80%, defender 30%)
- Defender ≥ attacker × 1.1 → **defender_win** (attacker keeps 30%, defender 80%)
- Else → **draw** (both keep 60%)

Counts are floored after scaling. If the attacker fleet is wiped, nothing returns.

## Loot

Only on **attacker_win**:

```
eligible = floor(floor(stock) × 0.5)   // per resource
```

Fill cargo (surviving fleet capacity) in order **metal → crystal → deuterium**. Deduct from defender; cargo docks when the fleet returns home.

## Ship combat stats

See `catalog.ts` (`attack`, `shield`, `hull`, `speed`, `cargo`, `fuelPerDistance`).
