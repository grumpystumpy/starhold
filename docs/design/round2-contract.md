# Starhold Round 2 contract (v1)

**Status:** shared schema + balance contract for Round 2 threads F–L.  
**Scope:** design and API shapes only — no feature implementation in this doc’s PR.  
**North star:** [vision.md](../vision.md) (Round 1 kept; Round 2 appended).  
**Prior contract:** [universe-contract.md](./universe-contract.md) remains in force for map, Starshards, A–E schemas. Round 2 **extends** it.  
**All numbers marked v1 tunable** unless noted otherwise.

---

## 0. Thread split & merge order

| ID | Area | Depends on | May parallel |
|----|------|------------|--------------|
| **F** | Rename audit (catalog display + id aliases) | contract on `main` | — (lands first) |
| **G** | Navigation / real routes | F preferred (copy) | H, I |
| **H** | Multi-item build queues | F preferred | G, I |
| **I** | Player levels / XP | F preferred | G, H |
| **J** | New ships + RF + combat tests | F (ids/names) | G, H, I |
| **K** | Mini planets | **J** (World Eater) | after J; with L after J |
| **L** | Pirates upgrade | **J** (full ship catalog) | after J; with K after J |

```
round2-contract ──► F (renames)
                      │
                      ├──► G (nav)
                      ├──► H (queues)
                      ├──► I (levels)
                      └──► J (ships) ──► K (mini planets)
                                      └► L (pirates upgrade)
```

**Hard rules:** Do not start feature threads until this contract is on `main`. Vercel production = `main` only (ignore preview). KV via `KV_REST_API_*`. CI green required; squash-merge docs PRs when green.

---

## 1. Rename map (OGame-identical → Starhold)

Audit of current catalogs on `main` @ Round 1 tip. **Display names** must change; **ids** may keep legacy keys with a display alias table, or migrate via schema v3 migrator (see §9). Prefer **alias table** for additive safety; UI always reads `def.name`.

### Buildings (must rename)

| Id (keep or alias) | Old display | **New display** | Flavor note |
|--------------------|-------------|-----------------|-------------|
| `lunarBase` | Lunar Base | **Crater Hab** | Moon field expander |
| `sensorArray` | Sensor Phalanx | **Horizon Scanner** | Fleet inbound intel |
| `jumpGate` | Jump Gate | **Fold Bridge** | Moon↔moon hop |

Already original (keep): Ore Extractor, Crystal Lattice, Deut Still, Solar Array, Metal Vault, Crystal Vault, Deut Tank, Shipyard, Research Lab.

### Ships (must rename)

| Id | Old display | **New display** |
|----|-------------|-----------------|
| `colonyShip` | Colony Ship | **Outpost Cradle** |
| `recycler` | Recycler | **Salvage Trawler** |
| `probe` | Spy Probe | **Whisper Probe** |

Already original (keep): Scout Skiff, Ore Hauler, Interceptor, Aegis Cruiser, Breach Bomber.

### Defenses (must rename)

| Id | Old display | **New display** |
|----|-------------|-----------------|
| `laserBattery` | Laser Battery | **Beam Emplacement** |
| `shieldDome` | Shield Dome | **Aegis Cupola** |

### Research (must rename — OGame-identical labels)

| Id | Old display | **New display** |
|----|-------------|-----------------|
| `energyTech` | Energy Tech | **Power Discipline** |
| `combustionDrive` | Combustion Drive | **Pulse Drive** |
| `weaponsTech` | Weapons Tech | **Ordnance Doctrine** |
| `armourTech` | Armour Tech | **Hull Weave** |
| `shieldingTech` | Shielding Tech | **Aegis Lattice** |
| `espionageTech` | Espionage Tech | **Shadow Optics** |
| `astrophysics` | Astrophysics | **Stellar Cartography** |
| `computerTech` | Computer Tech | **Fleet OS** |

### New research (Round 2)

| Id | Display | Effect |
|----|---------|--------|
| `swarmHold` | **Swarm Hold** | +15% of base (**2000**) Swarm Mothership capacity per level |
| `queueLogistics` | **Yard Logistics** | +1 building/ship/defense queue slot per 2 levels (see §2) |

### New building (Round 2)

| Id | Display | Effect |
|----|---------|--------|
| `chronoLathe` | **Chrono Lathe** | Build time × `0.1^level` for buildings/ships/defenses (not research); Shipyard 10 gate |

### Death Star / moon-killer

No Death Star id exists on `main` yet. Round 2 introduces:

| Id | Display | Role |
|----|---------|------|
| `voidforgeTitan` | **Void Titan** | 3rd largest — a bit faster than World Eater; very high attack+armor; low shields; large cargo |

### UI / docs copy

Replace user-facing strings “Lunar Base”, “Sensor Phalanx”, “Jump Gate”, “Death Star”, and research/defense names above across client, API errors, design docs that still say Round 1 names. Mission/error strings that mention old names update in **F**.

---

## 2. Build queues

### Current → Round 2

Today: single `buildQueue` / `shipQueue` / `defenseQueue` / research one-at-a-time.  
Round 2: **ordered multi-item arrays** per planet (research remains empire-scoped but multi-item).

### Data model

```ts
type QueueKind = "building" | "ship" | "defense" | "research";

interface QueueItemBase {
  id: string;              // uuid
  kind: QueueKind;
  enqueuedAt: number;
  /** Wall-clock ms when this item finishes if it were alone at front; recomputed on reorder. */
  completesAt: number;
  /** Seconds remaining snapshot for UI (optional; server is source of truth). */
  remainingSeconds?: number;
}

interface BuildingQueueItem extends QueueItemBase {
  kind: "building";
  buildingId: BuildingId;
  targetLevel: number;
}

interface ShipQueueItem extends QueueItemBase {
  kind: "ship";
  shipId: ShipId;
  count: number;
  unitSeconds: number;
}

interface DefenseQueueItem extends QueueItemBase {
  kind: "defense";
  defenseId: DefenseId;
  count: number;
  unitSeconds: number;
}

interface ResearchQueueItem extends QueueItemBase {
  kind: "research";
  researchId: ResearchId;
  targetLevel: number;
}

/** Per planet */
interface PlanetQueues {
  buildingQueue: BuildingQueueItem[];  // was single | null
  shipQueue: ShipQueueItem[];
  defenseQueue: DefenseQueueItem[];
}

/** Per player (empire research) */
interface PlayerQueues {
  researchQueue: ResearchQueueItem[];
}
```

### Caps (v1)

| Queue | Base length | Growth |
|-------|------------:|--------|
| Building | **2** | +1 per 2 levels `queueLogistics`; +1 if officer Quartermaster active; +1 skill `yardDepth` (D skill id TBD / new) |
| Ship | **2** | same as building |
| Defense | **2** | same as building |
| Research | **1** | +1 per 3 levels `queueLogistics`; +1 if officer Archivist active |

Hard cap per queue kind: **8** (v1).

### API shapes

```http
POST /api/queue/building   { playerId, planetId, buildingId }
POST /api/queue/ship       { playerId, planetId, shipId, count }
POST /api/queue/defense    { playerId, planetId, defenseId, count }
POST /api/queue/research   { playerId, researchId }

POST /api/queue/cancel     { playerId, planetId?, kind, itemId }
  → refund = 50% of unpaid remaining cost (v1: full cost refund if item not started; 50% if front item partially timed)

POST /api/queue/reorder    { playerId, planetId?, kind, orderedIds: string[] }
  → only non-started tail items freely reorder; front item locked unless cancel
```

`PlayerView` / planet payload exposes queues with `completesAt` + countdown fields. Tick advances front item only; on complete, pop and start next (recompute `completesAt`).

### Cancel / reorder rules

1. Cancel front → refund per table; next item starts immediately.
2. Cancel non-front → full resource refund; remove from array.
3. Reorder: permutation of ids; reject if front id changes without cancel.
4. Countdowns: UI polls existing tick/view; server stores absolute `completesAt`.

---

## 3. Navigation / routes

Top-left **dropdown** (or equivalent nav control) + **real client routes** (History API / router). No more single-panel-only for these:

| Route | Page |
|-------|------|
| `/` or `/overview` | Overview |
| `/buildings` | Buildings (was Facilities/Resources combined — Buildings focuses structures) |
| `/defenses` | Defenses |
| `/shipyard` | Shipyard |
| `/research` | Research |
| `/fleet` | Fleet |
| `/galaxy` | Galaxy |
| `/officers` | Officers |
| `/skills` | Skills |
| `/highscore` | Highscore |
| `/messages` | Messages |

Deep-link preserves `?playerId=` (existing) + optional `?planet=`. Shell (resource bar, planet rail, level bar) stays mounted across routes.

---

## 4. Player levels & XP

### Model

```ts
interface PlayerProgress {
  level: number;       // starts at 1; no max
  xp: number;          // xp into current level (0 .. xpToNext-1)
  xpTotal: number;     // lifetime
}

/** XP to go from level L → L+1 */
// xpToNext(L) = floor(100 * L^1.45)   // v1
```

### XP awards (v1.1 — Micah mix)

**Target mix** of a typical player's XP earnings (per ~100 XP): **combat 80% · pirates 8% · expeditions 8% · research 4% · buildings 0%**.  
`xpToNext(L) = floor(100 × L^1.45)` unchanged.

| Source | XP |
|--------|---:|
| Complete building upgrade | **0** (no XP) |
| Complete research level | `2 + targetLevel` |
| Win combat (raid / pirate fight / defense) | `19 + floor(destroyedEnemyCost / 500)` bonus capped `+56` (max 75) |
| Lose combat (participated) | `4` |
| Expedition resolve (any non-empty outcome) | `4` |
| Expedition mini-planet discovery | `10` (rare; outside typical pack) |
| Destroy pirate base | `4 + baseLevel` |
| Kill pirate ships (per 1000 ship cost destroyed) | `1` (stacking, cap `10` / battle) |

**Bucket rules:** combat-win/lose XP counts as **combat** even in pirate fights; pirate-only awards are base destroy + pirate ship kills. Buildings never grant XP.

**Reference earn pack (~100 XP):** 3× PvP win @19 + 1× lose @4 + 1× pirateRaid win (combat 19 + destroy tier-2 @6 + kills ~2) + 2× expedition @4 + 1× research targetLevel 2 @4 → combat 80 · pirates 8 · expeditions 8 · research 4 · buildings 0.

### Per-level bonuses (applied at level L; L starts 1 → bonuses use `(L - 1)`)

Let `n = level - 1`:

| Bonus | Formula (v1) |
|-------|----------------|
| Resource production | `× (1 + 0.005 * n)` (+0.5% per level) |
| Build time | `× (1 - 0.004 * n)`, floor **0.70×** (30% cap) |
| Research time | `× (1 - 0.004 * n)`, floor **0.70×** |
| Fleet flight time | `× (1 - 0.003 * n)`, floor **0.75×** |
| Shielding tech effective level | `+ floor(n / 5)` (virtual levels toward shield formula) |
| Weapons tech effective level | `+ floor(n / 5)` |
| Ship build speed | `× (1 - 0.005 * n)`, floor **0.65×** |

Bonuses stack **multiplicatively** with officers/skills/research (document order: base → research → level → officers → skills).

### UI

- Top bar: `Lv {level}` + XP bar (`xp / xpToNext`).
- Highscores: columns for level + XP total (sort option).

### API / view

```ts
interface PlayerView {
  // ...
  progress: { level: number; xp: number; xpToNext: number; xpTotal: number };
}
```

---

## 5. Pirates upgrade

Extends Round 1 `PirateBase` (`tier` → also expose as **base level**).

```ts
interface PirateBase {
  // existing fields...
  tier: number;              // = base level 0..N
  level: number;             // alias of tier for Round 2 clarity (keep both in sync)
  ships: FleetShips;         // may include ANY player ShipId once researched-equivalent unlock table says so
  techs: {
    weapons: number;         // hard-capped low
    armour: number;
    shielding: number;
  };
  lastFreeSpawnAt: number;   // 3h cadence
}
```

### Rules (v1)

| Rule | Value |
|------|------:|
| Base levels over time | Keep growth interval **6h → +1 level**, cap **12** (was 8; raise for Round 2) |
| Ship catalog | Bases may hold/build **every `ShipId` players can**, including Round 2 ships, scaled by level unlock table |
| Free ships every **3h** | Weak composition: mostly Scout Skiff + Interceptor; count = `10 + 5 * level` total hulls |
| Free-ship power | Each free ship uses pirate techs only (below) |
| Pirate weapons / armour / shielding | `min(2, floor(level / 4))` — **very low** vs players |
| Player destroy | unchanged Starshards; respawn elsewhere |

Unlock table (which ship types appear in pirate hangars by level): level 0–2 light hulls; 3–5 +cruiser/bomber; 6–8 +recycler/colony; 9+ may include World Eater / swarm in **tiny** counts (never Voidforge Titan free-spawn).

---

## 6. Mini planets

> **Micah revision (latest overrides).** Tunables in `packages/game/src/data/tuning.ts`.

### Spawning

- Outside normal slots **1–16**: synthetic coords with **`slot` in `20–29`**; stable planet id (coords may drift).
- Density (standard): ~1 mini per **`MINI_SYSTEMS_PER` (= 5)** systems. **Multiple minis OK in the same system** (different mini slots).
- Size: fields **`MINI_FIELDS_MIN`–`MINI_FIELDS_MAX`**; production × **`MINI_RICH_MINE_MULT`**.
- **Drift:** periodically shift system (same galaxy); ownership kept across moves.
- **Destroyed → rediscoverable immediately** (no respawn timer): a fresh unclaimed mini of the same kind is seeded into the pool at once.
- **Super-rares** (very low spawn): `ironwater` | `fortress` | `relic` via `planet.flags.miniKind`.

```ts
flags?: {
  mini?: boolean;
  miniKind?: "standard" | "ironwater" | "fortress" | "relic";
};
discoveredBy?: string[];
lastDriftAt?: number;
colonizedAt?: number;  // first successful colonize; drives 8h galaxy reveal
```

### Discovery & visibility

- Expedition outcome `miniPlanet`: reveals coords **only to finder** (`discoveredBy`).
- Galaxy UI: show mini if viewer discovered it, owns it, **or** `now >= colonizedAt + MINI_GALAXY_VISIBLE_AFTER_MS` (8h after first colonize → visible to **all**).
- Claim **unoccupied** mini: **Colonizer only** (`colonyShip`) via separate `colonize` mission; counts toward colony cap.

### Buildings

**Normal planet buildings allowed** + four specials as extras (moon-only still blocked):

| Id | Display | Effect (v1) |
|----|---------|-------------|
| `riftSiphon` | **Rift Siphon** | +15% all mine output on this body per level (max 5) |
| `echoVault` | **Echo Vault** | +25% storage caps per level (max 5) |
| `anomalyForge` | **Anomaly Forge** | −8% ship build time per level (max 5) |
| `driftBeacon` | **Drift Beacon** | +1 expedition slot at level 1 |

### Contested combat (after colonized)

| Outcome | Gate | Effect |
|---------|------|--------|
| **Vacate** | Any attacker **win** vs owner **without** Void Titan / Mothership / World Eater | Owner removed; mini **unoccupied**; buildings remain; **that same fleet cannot capture** — need a later Colonizer mission |
| **Capture** | Attacker win **and** fleet has ≥1 **Void Titan or Mothership or World Eater** | Ownership transfer (direct); one-MF / one-Relic per player still enforced |
| **Destroy** | Attacker win **and ≥1 World Eater** | Planet deleted; massive metal/crystal payout + debris (**never deut**); immediate reseed into discoverable pool |

```http
POST /api/mini-resolve { playerId, fleetId, choice: "capture" | "destroy" }
```

Default on return when pending: **capture** if fleet can direct-capture; else vacate already applied at combat.

### Super-rares

| Kind | Rules |
|------|--------|
| **Ironwater Rock** | Deut **`MINI_IRONWATER_DEUT_MULT`** (10× best normal slot) vs slot-8 baseline. |
| **Moving Fortress** | Jump: aim **current galaxy or ±1**; pay deut (`MINI_FORTRESS_RELOCATE_DEUT_*`); land random system within **±`MINI_FORTRESS_RELOCATE_ACCURACY` (10)** of aim (clamped 1–399), any free mini slot. UI shows landing window. Blank espionage; no hostile inbound warning; battlefield shields×3 / attack×2 / armor×0.25; **one per player**. |
| **Relic World** | +30% research speed, +25% expedition finds; pirate weight up; **one per player**. |

---

## 7. New ships

> **Micah amendments (Round 2):** Swarm costs/times ×0.25; Mothership cargo/combat/capacity raised (2nd largest); Voidforge Titan renamed **Void Titan** (3rd); World Eater = largest; Chrono Lathe build-speed building; sub-second batch production.

### 7.1 Void Titan (`voidforgeTitan`) — 3rd largest

**Role:** a bit faster than World Eater; very high attack + armor; low shields; large cargo. Display name **Void Titan**.

| Stat | v1 (amended) |
|------|---:|
| Cost | metal `1_500_000`, crystal `1_200_000`, deuterium `400_000` |
| Build seconds | `90_000` (before yard/Chrono Lathe) |
| Shipyard req | **11** |
| Research req | Ordnance Doctrine 10, Aegis Lattice 10, Hull Weave 10 |
| Cargo | `1_000_000` |
| Attack | `200_000` |
| Shield | `50_000` |
| Hull / armor | `1_000_000` |
| Speed | `100` |
| Fuel / distance | `5` |

**Moon destruction chance** (attacker won, target is moon, ≥1 Void Titan **or World Eater** survived):

```
chancePct = min(100,
  floor( (100 - sqrt(moonDiameterProxy)) * sqrt(titans) )
)
// moonDiameterProxy v1 =  max(1, fieldsCap)   // Crater Hab raises fields → harder
// roll: hash(reportId + ":moonkill") % 100 < chancePct
```

On success: moon deleted; parent `moonId` cleared; fleets on moon → debris 50% / rest destroyed; message all parties.

### 7.2 World Eater (`worldEater`) — LARGEST hull

**Role:** slowest; strongest across the board (attack/shield/hull); no cargo. Destroys mini planets **and moons**. Cannot collect debris.

| Stat | v1 (amended) |
|------|---:|
| Cost | metal `8_000_000`, crystal `6_500_000`, deuterium `2_500_000` |
| Build seconds | `200_000` |
| Shipyard | **15** |
| Research req | Ordnance Doctrine 14, Aegis Lattice 14, Hull Weave 14 |
| Cargo | `0` (**cannot collect debris**) |
| Attack | `300_000` (strongest) |
| Shield | `800_000` |
| Hull | `2_000_000` |
| Speed | `600` |
| Fuel / distance | `4` |

Can **destroy** mini planets (≥1 survived on win); capture no longer gates on World Eater count. Counts toward moon-kill chance with Void Titans.

### 7.3 Swarm Drone (`swarmDrone`)

| Stat | v1 (amended −75% cost & time) |
|------|---:|
| Cost | metal `50`, crystal `20`, deuterium `0` |
| Build seconds | `2` |
| Shipyard | **4** (or produced by mothership — see below) |
| Cargo | `0` |
| Attack | `6` |
| Shield | `40` |
| Hull | `8` |
| Speed | `20_000` |
| Fuel / distance | `0` (carried) |

- **Must be carried** by Swarm Mothership (not free-flying between systems alone).
- **Swarm numbers bonus:** when drones in battle ≥ 50, attack `× (1 + 0.002 * min(count, 2000))` (cap +400%).
- **Intercept:** 70% of damage targeted at mothership is redirected to drones (distributed).

### 7.4 Swarm Harvester (`swarmHarvester`)

| Stat | v1 (amended −75% cost & time) |
|------|---:|
| Cost | metal `100`, crystal `75`, deuterium `25` |
| Build seconds | `5` |
| Shipyard | **5** |
| Cargo | `0` (loot goes to **mothership** cargo) |
| Attack | `0` |
| Shield | `60` |
| Hull | `30` |
| Speed | `15_000` |
| Fuel / distance | `0` (carried) |

- Harvest debris + steal resources into mothership cargo on raid/recycle missions when attached.
- Intercepts mothership damage (50% share with drones if both present; drones priority first).
- **Kamikaze:** if mothership hull < 30% of max during combat, each harvester may suicide: deal `shieldDmg = 80`, `hullDmg = 40` to a random enemy combatant; harvester destroyed.

### 7.5 Swarm Mothership (`swarmMothership`) — 2nd largest

**Role:** very high shields; very low attack; okay armor. Carries **2,000** swarms (base). Can occupy **mini planets** (same occupation rules) and **harvest debris** (Salvage Trawler–equivalent for debris fields; asteroid harvest still requires a Trawler).

| Stat | v1 (amended) |
|------|---:|
| Cost | metal `2_500_000`, crystal `2_000_000`, deuterium `750_000` |
| Build seconds | `80_000` |
| Shipyard | **13** |
| Research req | Ordnance Doctrine 11, Aegis Lattice 11, Hull Weave 11 |
| Cargo | `150_050_000` (= 50_000 × 3001) |
| Attack | `3_000` (= 500 × 6) |
| Shield | `450_000` |
| Hull / armor | `100_000` |
| Speed | `2_500` |
| Fuel / distance | `2` |
| Base swarm capacity | **2000** |

**Capacity:** `floor(2000 * (1 + 0.15 * swarmHoldLevel))`. Research **Swarm Hold** +15% of base (2000) per level.

**Produce drones anywhere:** action `swarmProduce` from mothership fleet — costs from mothership cargo; builds into carried swarm with **batch production** when unit time < 1s.

### 7.5b Chrono Lathe (`chronoLathe`) — nanite-equivalent (original name)

| | |
|--|--|
| Display | **Chrono Lathe** |
| Gate | Shipyard **10** |
| Effect | Build time × `0.1^level` for **buildings, ships, defenses** — **not research** |
| Late-game | Expensive base cost; meant for high-end economies |

### 7.5c Batch production (ships / defenses / mothership drones)

If per-unit build time < 1s: each tick produces `batch = floor(elapsed / unitTime)` units (never floor unit time at 1s). When unit time ≥ 1s, complete-at semantics unchanged.

### 7.6 Occupation (Swarm Mothership)

After attacker destroys **all defenses** on enemy planet/moon and at least one Swarm Mothership remains on-site:

```ts
interface OccupationState {
  planetId: string;
  occupierPlayerId: string;
  mothershipFleetId: string;
  startedAt: number;
  endsAt: number;            // startedAt + 2 days
}
```

| Effect (v1) | Rule |
|-------------|------|
| Duration | **max 2 days**; then auto-end, fleets stay parked as normal deploy |
| Production | Occupier receives **30%** of mine output; owner receives **70%** |
| Build queues | Owner **blocked** from building/ship/defense queues while occupied |
| Research | Owner research unaffected (empire) |
| Recapture | Owner wins combat vs occupying fleet → occupation clears |
| Abandon | Occupier recalls mothership → clears |
| Moon | Same rules |

```http
POST /api/fleet/occupy   { playerId, fleetId }   // after eligible battle
POST /api/fleet/abandon-occupation { playerId, planetId }
```

### 7.7 Rapid-fire matrix additions (v1)

| Firer | Target | Factor |
|-------|--------|------:|
| `voidforgeTitan` | `swarmDrone` | 200 |
| `voidforgeTitan` | `probe` / Whisper Probe | 250 |
| `voidforgeTitan` | `scout` | 50 |
| `voidforgeTitan` | `laserBattery` / Beam Emplacement | 50 |
| `worldEater` | `laserBattery` | 20 |
| `worldEater` | `shieldDome` / Aegis Cupola | 10 |
| `cruiser` | `swarmDrone` | 8 |
| `interceptor` | `swarmDrone` | 5 |
| `swarmDrone` | `probe` | 3 |
| `bomber` | `swarmDrone` | 4 |
| `scout` | `swarmDrone` | 2 |

Existing RF table unchanged otherwise.

### 7.8 Tests required (J)

- Stat fixtures for all five ships
- RF lookups for new pairs
- Moon-kill chance monotonic in titan count; fieldsCap reduces chance
- Swarm capacity formula vs `swarmHold` (base **2000**)
- Intercept damage redirection
- Harvester kamikaze threshold
- Occupation start/expiry/recapture
- World Eater cannot recycle; mini **destroy** needs ≥1 WE; mini **capture** is any raid win (no WE gate)

---

## 8. API / view summary (Round 2 deltas)

```ts
interface UniverseState {
  schemaVersion: 3;                    // Round 2 bump
  // ...
  miniPlanetIds?: string[];
  occupations?: Record<string, OccupationState>;
}

interface PlayerState {
  // ...
  level: number;
  xp: number;
  xpTotal: number;
  researchQueue: ResearchQueueItem[];  // replaces single research slot
  discoveredMiniIds: string[];
}

interface PlanetState {
  buildingQueue: BuildingQueueItem[];  // array
  shipQueue: ShipQueueItem[];
  defenseQueue: DefenseQueueItem[];
  flags?: { mini?: boolean };
}
```

PlayerView adds: `progress`, full queues, `occupation` on active planet if any, nav-invariant shell fields.

---

## 9. Safe KV migration / schema version

| Version | Meaning |
|--------:|---------|
| 1 | Prototype 1×9×8 |
| 2 | Round 1 contract map 10×399 (current `UNIVERSE_SCHEMA_VERSION`) |
| **3** | Round 2 queues/levels/ships/mini/pirates fields |

### Rules

1. **Additive first:** migrator `2 → 3` runs on load:
   - Wrap legacy single queues into one-element arrays (or `[]` if null).
   - Set `level: 1`, `xp: 0`, `xpTotal: 0` if missing.
   - Init `researchQueue` from in-progress research if any.
   - Init `occupations: {}`, `discoveredMiniIds: []`, pirate `level = tier`, `techs` defaults, `lastFreeSpawnAt`.
   - Do **not** rename persisted building ids; display alias map handles F.
2. **Idempotent** — re-running migrator no-ops when `schemaVersion >= 3`.
3. **No silent map reset** for 2→3 (unlike 1→2). Archive only if blob corrupt.
4. **Partial deploy:** API must accept v2 blobs and migrate before write-back; clients ignore unknown ship ids until J ships deploy (filter in view).
5. **Feature flags (optional v1):** `ROUND2_SHIPS`, `ROUND2_MINI` — default on after merge; tests cover off path.
6. Env unchanged: `KV_REST_API_URL`, `KV_REST_API_TOKEN`, … Production = `main` → https://starhold-two.vercel.app

### Archive helper

Keep `archiveUniverseKey(universeId, ts)`; Round 2 migrator should not archive on success.

---

## 10. Process reminders

- Branch off **`main`**, small PR per thread, CI green, squash-merge OK for docs
- **Never** push `cursor/core-loop-prototype-1093`
- Ignore Vercel preview failures; main-only deploys
- One agent playtest per **merged milestone**
- Friend-group balance: prefer tunable constants in `catalog.ts`; document changes in PR body

See [vision.md](../vision.md) · [universe-contract.md](./universe-contract.md) · [process.md](../process.md)
