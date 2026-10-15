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
| `colonyShip` | Colony Ship | **Colonizer** (was Outpost Cradle) |
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
| `swarmHold` | **Swarm Hold** | +15% of base (**2,000**) Mothership capacity per level |
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

## 5. Pirates upgrade — Micah redesign (2026-10-14)

**Supersedes** Round 2 v1 cap-12 / “every ship including titans” / ~100-base density, and open PR **#44**. Vision: [vision.md — Pirates + Aliens redesign](../vision.md#pirates--aliens-redesign-2026-10-14). Implementer handoff: Project store `internal/pirates-aliens-redesign.md`.

Extends Round 1 `PirateBase` (`tier` → **base level**). All numbers below are **tuning.ts knobs** (names fixed; magnitudes v1 placeholders until Micah retunes).

```ts
interface PirateBase {
  // existing fields...
  tier: number;              // = base level; keep in sync with level
  level: number;             // 0..PIRATE_MAX_LEVEL
  ships: FleetShips;         // every ShipId except PIRATE_EXCLUDED_SHIP_IDS
  defenses: Partial<Record<DefenseId, number>>; // accumulates forever
  techs: {
    weapons: number;
    armour: number;
    shielding: number;
  };
  lastFreeSpawnAt: number;   // 3h ship + defense spawn
  lastRaidAt: number;        // last fired raid
  nextRaidAt: number;        // random time within current/next hour window
  lastGrewAt: number;        // level growth interval
  /** Split lineage: same root never raid each other (coalition). */
  coalitionId: string;       // = id of split root (self until first split)
  splitDone: boolean;        // true after the one-time level-25 split
  destroyedAt: number | null;
}
```

### Rules (redesign)

| Rule | Value | `tuning.ts` constant(s) |
|------|------:|-------------------------|
| Max level | **100** | `PIRATE_MAX_LEVEL` |
| Level growth | **6h → +1** (unchanged cadence) | `PIRATE_LEVEL_GROWTH_INTERVAL_MS` |
| Level-up defenses | Every level grants defenses; **higher levels grant more** | `PIRATE_LEVEL_DEFENSE_BASE`, `PIRATE_LEVEL_DEFENSE_PER_LEVEL`, `PIRATE_LEVEL_DEFENSE_COMPOSITION` |
| Free spawn interval | **3h** | `PIRATE_FREE_SPAWN_INTERVAL_MS` |
| Free ships (3h) | Weak hulls; count scales with level | `PIRATE_FREE_SHIP_BASE`, `PIRATE_FREE_SHIP_PER_LEVEL`, `PIRATE_FREE_SHIP_COMPOSITION` |
| Free defenses (3h) | **Also** added each spawn period; **accumulate forever**; amount scales with level | `PIRATE_FREE_DEFENSE_BASE`, `PIRATE_FREE_DEFENSE_PER_LEVEL`, `PIRATE_FREE_DEFENSE_COMPOSITION` |
| Ship catalog | All non-class, non-stationary ships **except** World Eater, Mothership, Void Titan | `PIRATE_EXCLUDED_SHIP_IDS` |
| Pirate techs | Stay low vs players (legacy formula OK until retuned) | `PIRATE_TECH_WEAPONS_CAP` / formula helpers |
| Raid schedule (vs players) | **Once per hour**, at a **random time within that hour** | `PIRATE_RAID_PERIOD_MS`; store `nextRaidAt` |
| Raid schedule (vs pirates) | Same hourly window model; slightly **less often** than vs players | `PIRATE_VS_PIRATE_RAID_PERIOD_MULT` (stretch / skip) |
| Target density | **200** bases / universe | `PIRATE_TARGET_BASE_COUNT` |
| Seed / migrate | New universe seeds to 200; existing tops up to 200 **without wiping players** | migrator + `PIRATE_TARGET_BASE_COUNT` |
| Split | **Once**, at exactly **level 25**: original unchanged + **2** new L1 bases nearby | `PIRATE_SPLIT_LEVEL`, `PIRATE_SPLIT_CHILD_COUNT`, `PIRATE_SPLIT_CHILD_LEVEL`, `PIRATE_SPLIT_NEARBY_SYSTEM_RADIUS` |
| Coalition | Same `coalitionId` (split family) **never** attack each other | schema field; no numeric knob |
| Player destroy | Starshards + destroy/respawn behavior retained unless Micah says otherwise | existing Starshard keys |
| **Fairness (queued 2026-10-14)** | Targets under **100k** points: each pirate raid that calendar day reduces remaining raid chance by **−1% of the original** chance (stacks per raid/day). **Pirates only — not aliens.** | `PIRATE_FAIRNESS_POINTS_THRESHOLD`, `PIRATE_FAIRNESS_CHANCE_DECAY_PER_RAID` |

**Raid scheduling:** each period of `PIRATE_RAID_PERIOD_MS` (1h), assign `nextRaidAt = periodStart + floor(rng × period)`. After firing, advance to the next period and roll a new offset. Pirate-vs-pirate uses the same model with period stretched by `PIRATE_VS_PIRATE_RAID_PERIOD_MULT` (or equivalent skip chance).

Unlock table (hangar by level): light → mid → heavy through common warships; **never** field `worldEater`, `swarmMothership`, `voidforgeTitan` (ids). Class-exclusive and stationary hulls stay out.

### Tuning constant names (must exist in `tuning.ts` before/with implementation)

```ts
export const PIRATE_MAX_LEVEL = 100;
export const PIRATE_LEVEL_GROWTH_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const PIRATE_TARGET_BASE_COUNT = 200;
export const PIRATE_RAID_PERIOD_MS = 60 * 60 * 1000; // once per hour, random offset within hour
export const PIRATE_VS_PIRATE_RAID_PERIOD_MULT = 1.25; // slightly less often
export const PIRATE_FREE_SPAWN_INTERVAL_MS = 3 * 60 * 60 * 1000;
export const PIRATE_FREE_SHIP_BASE = 10;          // v1 placeholder
export const PIRATE_FREE_SHIP_PER_LEVEL = 5;      // v1 placeholder
export const PIRATE_FREE_DEFENSE_BASE = 5;        // v1 placeholder
export const PIRATE_FREE_DEFENSE_PER_LEVEL = 2;   // v1 placeholder
export const PIRATE_LEVEL_DEFENSE_BASE = 3;       // v1 placeholder
export const PIRATE_LEVEL_DEFENSE_PER_LEVEL = 1;  // higher levels → more
export const PIRATE_SPLIT_LEVEL = 25;
export const PIRATE_SPLIT_CHILD_COUNT = 2;
export const PIRATE_SPLIT_CHILD_LEVEL = 1;
export const PIRATE_SPLIT_NEARBY_SYSTEM_RADIUS = 5; // v1 placeholder
export const PIRATE_EXCLUDED_SHIP_IDS = [
  "worldEater",
  "swarmMothership",
  "voidforgeTitan",
] as const;
// Queued Micah 2026-10-14 (not implemented until backlog reaches CHANGE #9):
export const PIRATE_FAIRNESS_POINTS_THRESHOLD = 100_000;
export const PIRATE_FAIRNESS_CHANCE_DECAY_PER_RAID = 0.01; // −1% of original chance per raid/day
```

Composition maps (`PIRATE_FREE_SHIP_COMPOSITION`, `PIRATE_FREE_DEFENSE_COMPOSITION`, `PIRATE_LEVEL_DEFENSE_COMPOSITION`) are also tuning-owned. **Do not** use a fixed 30‑minute `PIRATE_RAID_INTERVAL_MS` — superseded by `PIRATE_RAID_PERIOD_MS`.

---

## 5b. Aliens faction (new — 2026-10-14)

Original faction name **Aliens** (no OGame terms). Hidden NPC bases found only via expedition.

```ts
interface AlienBase {
  id: string;
  coords: Coordinates;       // settled on a real slot-1 planet body / claim
  level: number;             // 0..ALIEN_MAX_LEVEL
  ships: FleetShips;
  defenses: Partial<Record<DefenseId, number>>;
  techs: Record<ResearchId, number>; // or combat subset; always topPlayer+1
  lastFreeSpawnAt: number;
  lastRaidAt: number;
  nextRaidAt: number;        // same hourly random schedule as pirates
  lastGrewAt: number;
  coalitionId: string;
  splitDone: boolean;
  /** Wall-clock when buildup ends; raids locked until then. */
  buildupEndsAt: number;
  foundAt: number;
  foundByPlayerId: string;
  destroyedAt: number | null;
}

// UniverseState additions:
alienBases: Record<string, AlienBase>; // starts EMPTY — no seed aliens
alienDailyFindSeed: number;     // resets each UTC day
alienFoundCountToday: number;   // optional telemetry
```

### Rules

| Rule | Value | `tuning.ts` constant(s) |
|------|------:|-------------------------|
| Initial density | **Zero** — no alien bases at universe create | `ALIEN_INITIAL_BASE_COUNT = 0` |
| Find chance | **0.001%** per expedition (`0.00001`) | `ALIEN_EXPEDITION_FIND_CHANCE` |
| Daily reset | Universe daily find window/roll resets each day | `ALIEN_DAILY_FIND_RESET_TZ` / day-key helper |
| Settle | Nearest **open slot-1** planet vs finder’s expedition origin | `ALIEN_SETTLE_SLOT` (= `1`) |
| Buildup | **4 hours** before first raid | `ALIEN_BUILDUP_MS` |
| Max level | **100** (same path as pirates) | `ALIEN_MAX_LEVEL` |
| Split | Once at **level 50** (original + 2× L1 nearby) | `ALIEN_SPLIT_LEVEL`, `ALIEN_SPLIT_CHILD_COUNT`, `ALIEN_SPLIT_CHILD_LEVEL`, `ALIEN_SPLIT_NEARBY_SYSTEM_RADIUS` |
| Raids | **Same as pirates:** once per hour, random time within the hour (after buildup); coalition rules like pirates | `ALIEN_RAID_PERIOD_MS` (= pirate period), `ALIEN_VS_ALIEN_RAID_PERIOD_MULT` |
| Free spawn | 3h ships **and** defenses; **stronger / more** than pirates | `ALIEN_FREE_SPAWN_INTERVAL_MS`, `ALIEN_FREE_SHIP_*`, `ALIEN_FREE_DEFENSE_*`, `ALIEN_STRENGTH_MULT` |
| Cap | **Few** bases (found only; hard cap) | `ALIEN_MAX_BASE_COUNT` |
| Tech | Always **top player tech + 1** per research | `ALIEN_TECH_ABOVE_TOP_PLAYER` |
| Ships | Same exclusions as pirates unless Micah expands | reuse `PIRATE_EXCLUDED_SHIP_IDS` or `ALIEN_EXCLUDED_SHIP_IDS` |

```ts
export const ALIEN_INITIAL_BASE_COUNT = 0; // universe never seeds aliens
export const ALIEN_EXPEDITION_FIND_CHANCE = 0.00001; // 0.001%
export const ALIEN_SETTLE_SLOT = 1;
export const ALIEN_BUILDUP_MS = 4 * 60 * 60 * 1000;
export const ALIEN_MAX_LEVEL = 100;
export const ALIEN_SPLIT_LEVEL = 50;
export const ALIEN_SPLIT_CHILD_COUNT = 2;
export const ALIEN_SPLIT_CHILD_LEVEL = 1;
export const ALIEN_SPLIT_NEARBY_SYSTEM_RADIUS = 5; // v1 placeholder
export const ALIEN_RAID_PERIOD_MS = 60 * 60 * 1000; // same schedule as pirates
export const ALIEN_VS_ALIEN_RAID_PERIOD_MULT = 1.25;
export const ALIEN_FREE_SPAWN_INTERVAL_MS = 3 * 60 * 60 * 1000;
export const ALIEN_STRENGTH_MULT = 1.5;           // ships/defenses vs pirate tables
export const ALIEN_FREE_SHIP_BASE = 15;           // v1 placeholder
export const ALIEN_FREE_SHIP_PER_LEVEL = 8;       // v1 placeholder
export const ALIEN_FREE_DEFENSE_BASE = 8;         // v1 placeholder
export const ALIEN_FREE_DEFENSE_PER_LEVEL = 3;    // v1 placeholder
export const ALIEN_LEVEL_DEFENSE_BASE = 5;        // v1 placeholder
export const ALIEN_LEVEL_DEFENSE_PER_LEVEL = 2;   // v1 placeholder
export const ALIEN_MAX_BASE_COUNT = 12;           // "few"; v1 placeholder
export const ALIEN_TECH_ABOVE_TOP_PLAYER = 1;
```

More expedition runners → more independent `ALIEN_EXPEDITION_FIND_CHANCE` rolls (no shared single-finder lock beyond daily seed/cap policy). Migrators must **not** top up aliens — only pirates use `PIRATE_TARGET_BASE_COUNT`.

### Performance (required)

Universe blob is **one** Upstash/KV document. **~200** pirate bases + rare aliens + **hourly** random raids must not explode command count or latency.

| Approach | Hobby fit |
|----------|-----------|
| Per-base cron / per-raid write | **Reject** — blows Upstash free commands + serverless |
| Vercel Hobby cron every hour | **Reject** — Hobby cron is **daily-only**; would also RMW the whole universe ~24×/day |
| **Lazy catch-up on read** (galaxy / tick / mission resolve) | **Recommended** — batch elapsed hour-windows for all AI in one in-memory pass, single write-back |
| Optional daily cron | OK for alien day-key reset + pirate count top-up only |

**Recommendation:** implement AI with **lazy/batched simulation on universe load or player-driven tick**. Do **not** add hourly Vercel crons on Hobby. Treat frequent full-document RMW as a free-tier risk; keep AI updates coalesced.

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
| Speed | `600` → **queued −50% → `300`** (Micah 2026-10-14; apply in `tuning.ts` when backlog CHANGE #10 lands) |
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

- **Must be carried** by Mothership (not free-flying between systems alone).
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

### 7.5 Mothership (`swarmMothership`) — 2nd largest

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

### 7.6 Occupation (Mothership)

After attacker destroys **all defenses** on enemy planet/moon and at least one Mothership remains on-site:

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
