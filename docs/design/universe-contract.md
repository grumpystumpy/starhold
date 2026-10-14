# Starhold universe contract (v1)

**Status:** shared schema + balance contract for parallel threads A–E.  
**Scope:** design and API shapes only — no feature implementation in this doc’s PR.  
**North star:** [vision.md](../vision.md).  
**All numbers marked v1 tunable** unless noted otherwise.

This is the single source of truth for map bounds, position economy, premium currency, and the TypeScript-shaped payloads parallel teams may assume after **A** lands.

---

## 1. Premium currency — Starshards

| | |
|--|--|
| **Name** | **Starshards** (original; not Dark Matter / not real money) |
| **Id** | `starshards` |
| **Storage** | Per-player balance on `PlayerState` (integer ≥ 0) |
| **Purchases** | **None.** Friends-only multiplayer; no IAP, no shop cash-out |

### Earn (sources)

| Source | v1 rule |
|--------|---------|
| Daily login | `+15` once per UTC day per player |
| Expedition find | `+5–25` on rare expedition roll (see balance table; kind `starshards`) |
| Pirate base destroy | `+40` base + `+5` per pirate growth tier destroyed |
| Pirate fleet kill (in-system raid by pirates that player wins) | `+10` |
| Highscore milestone (optional v1) | First time reaching top 3 in a universe: `+50` (once) |

### Spend (sinks)

| Sink | v1 rule |
|------|---------|
| Officers | Hire / renew duration with Starshards |
| Skills | Unlock nodes permanently with Starshards |
| *(reserved)* | No other sinks in v1 without a contract amend |

---

## 2. Universe schema

### Map bounds (replaces prototype `1×9×8`)

| Constant | Value | Notes |
|----------|------:|-------|
| `MAP_GALAXIES` | **10** | Galaxies `1…10` |
| `MAP_SYSTEMS` | **399** | Systems `1…399` per galaxy |
| `MAP_SLOTS` | **15** | Planet slots `1…15` |
| `DEEP_SPACE_SLOT` / `EXPEDITION_SLOT` | **16** | Deep space — not colonizable |
| Coord address | `galaxy:system:slot` | e.g. `3:142:8` |

### Per-system contents

| Entity | Where | Notes |
|--------|-------|-------|
| Planets | Slots 1–15 | Empty until colonized / assigned at join |
| Deep space | Slot 16 | Expeditions target this slot; no planet body |
| Debris | Keyed `g:s:slot` | Metal + crystal only (existing pattern) |
| Moons | Same coords as parent planet | Do **not** consume a slot; `hasMoon` / `moonId` on galaxy row |
| Asteroids | 0–2 per system (v1) | Mineable via `harvestAsteroid` mission; not a planet |
| Pirate bases | 0–1 per system typically | NPC; see pirates section |

### Coordinates

```ts
interface Coordinates {
  galaxy: number; // 1..MAP_GALAXIES
  system: number; // 1..MAP_SYSTEMS
  slot: number;   // 1..MAP_SLOTS (planets) | DEEP_SPACE_SLOT | asteroid slots use same address space via AsteroidRef
}
```

Asteroids and pirate bases use **stable string ids** plus optional display coords (system-local). They are **not** `PlanetState` rows.

### Asteroid

```ts
interface AsteroidField {
  id: string;              // e.g. "ast:3:142:a0"
  coords: Coordinates;     // slot may be a reserved local index; UI shows system row
  metal: number;
  crystal: number;
  deuterium: number;
  /** Remaining harvest cycles before despawn (v1). */
  richness: number;
}
```

### Debris (unchanged shape; larger map)

```ts
interface DebrisField {
  coords: Coordinates; // planet slot only
  metal: number;
  crystal: number;
}
```

### Moon (extends existing body model)

- `PlanetState.kind: "moon"`, `parentPlanetId`, parent `moonId`
- Same `coords` as parent; ignored by `planetAtCoords` / colonization
- Moon-only buildings remain: `lunarBase`, `sensorArray`, (+ jump gate later)

### Pirate base

```ts
interface PirateBase {
  id: string;
  coords: Coordinates;     // occupies a system; slot may be empty planet slot or dedicated NPC marker
  name: string;
  /** Growth tier 0..N; drives fleet size + Starshard payout */
  tier: number;
  ships: FleetShips;
  resources: Resources;
  lastGrewAt: number;
  lastRaidAt: number;
  /** When destroyed by a player, set; respawn scheduler uses this */
  destroyedAt: number | null;
}
```

---

## 3. Planet fields curve

Fields replace flat `PLANET_FIELDS = 200`. Cap is **per planet**, rolled at creation (home + colonize).

### Design rules

- Slots **1** and **15**: smallest — **minimum 250** after band roll
- Slot **8**: largest (peak)
- Slots **7** and **9**: slightly below peak
- Smooth curve 1→8 and 8→15
- Each slot rolls uniformly in `[center − band, center + band]`, then clamp

### v1 centers and band

`FIELD_BAND = 15` (v1 tunable)

| Slot | Center | Effective range (pre-clamp) |
|-----:|-------:|-----------------------------|
| 1 | 265 | 250–280 (floor 250) |
| 2 | 290 | 275–305 |
| 3 | 315 | 300–330 |
| 4 | 335 | 320–350 |
| 5 | 350 | 335–365 |
| 6 | 362 | 347–377 |
| 7 | 372 | 357–387 |
| **8** | **385** | **370–400** (peak) |
| 9 | 372 | 357–387 |
| 10 | 362 | 347–377 |
| 11 | 350 | 335–365 |
| 12 | 335 | 320–350 |
| 13 | 315 | 300–330 |
| 14 | 290 | 275–305 |
| 15 | 265 | 250–280 (floor 250) |

```ts
function rollPlanetFields(slot: number, seed: string): number
// deterministic from universe seed + coords; store on PlanetState.fieldsCap
```

`fields.used` = sum of building levels (unchanged). Moons keep `MOON_FIELDS_BASE + MOON_FIELDS_PER_LUNAR_BASE * lunarBase`.

---

## 4. Position production multipliers

Applied **after** mine level / energy factor / `PRODUCTION_MULT`. Slot **8** is neutral **1.0×** on all four axes.

### Intent

- Closer to sun (low slot) → **more crystal**, **more energy**
- Further from sun (high slot) → **more deuterium**, **less energy**
- Metal stays near-flat (mild mid-boost optional)

### v1 table (smooth; tunable)

| Slot | Metal | Crystal | Deuterium | Energy |
|-----:|------:|--------:|----------:|-------:|
| 1 | 1.00 | 1.30 | 0.70 | 1.30 |
| 2 | 1.00 | 1.25 | 0.75 | 1.25 |
| 3 | 1.00 | 1.20 | 0.80 | 1.20 |
| 4 | 1.00 | 1.15 | 0.85 | 1.15 |
| 5 | 1.00 | 1.10 | 0.90 | 1.10 |
| 6 | 1.00 | 1.05 | 0.95 | 1.05 |
| 7 | 1.00 | 1.02 | 0.98 | 1.02 |
| **8** | **1.00** | **1.00** | **1.00** | **1.00** |
| 9 | 1.00 | 0.98 | 1.02 | 0.98 |
| 10 | 1.00 | 0.95 | 1.05 | 0.95 |
| 11 | 1.00 | 0.90 | 1.10 | 0.90 |
| 12 | 1.00 | 0.85 | 1.15 | 0.85 |
| 13 | 1.00 | 0.80 | 1.20 | 0.80 |
| 14 | 1.00 | 0.75 | 1.25 | 0.75 |
| 15 | 1.00 | 0.70 | 1.30 | 0.70 |

```ts
interface SlotProductionMult {
  metal: number;
  crystal: number;
  deuterium: number;
  energy: number;
}

function productionMultForSlot(slot: number): SlotProductionMult
```

Energy multiplier scales **solar / energy production** used in the energy factor (not mine base alone). Moons: use parent slot multipliers for solar; mines remain blocked on moons.

---

## 5. API shapes (parallel-team contract)

Extend existing `@starhold/game` types; keep REST under `/api/*` as today (`PlayerView` is the primary client payload).

### 5.1 Map / galaxy

```ts
// Constants exported from catalog
MAP_GALAXIES = 10
MAP_SYSTEMS = 399
MAP_SLOTS = 15
DEEP_SPACE_SLOT = 16

interface GalaxySlot {
  coords: Coordinates;
  planetId: string | null;
  playerId: string | null;
  playerName: string | null;
  allianceTag: string | null; // null until alliances land
  pointsHint: number;
  debris: { metal: number; crystal: number } | null;
  isOwn: boolean;
  hasMoon: boolean;
  moonId: string | null;
  /** Empty | occupied | npc markers for UI */
  activity: "empty" | "planet" | "pirate" | null;
}

interface GalaxyView {
  galaxy: number;
  system: number;
  slots: GalaxySlot[];           // length MAP_SLOTS (1..15)
  deepSpace: { coords: Coordinates }; // always slot 16
  asteroids: AsteroidField[];
  pirateBase: PirateBasePublic | null;
}

interface PirateBasePublic {
  id: string;
  coords: Coordinates;
  name: string;
  tier: number;
  /** Coarse threat for UI — not full ship list until espionage */
  threatHint: "low" | "medium" | "high";
}
```

`GET` via existing state view: `PlayerView.galaxy` (+ query `?galaxy=&system=`).

### 5.2 Planets

```ts
interface PlanetState {
  // ...existing fields...
  kind?: BodyKind;
  parentPlanetId?: string | null;
  moonId?: string | null;
  /** Rolled field cap for this body (planets); moons compute from lunarBase */
  fieldsCap: number;
  /** Slot at creation — drives production mult */
  // coords.slot already implies this
}

interface EconomySnapshot {
  productionPerHour: Resources;
  energy: { produced: number; used: number; factor: number };
  storage: Resources;
  fields: { used: number; cap: number; remaining: number };
  /** Echo position mults for UI tooltips */
  positionMult: SlotProductionMult;
}
```

### 5.3 Moons

Unchanged formation rules from [moons.md](./moons.md) unless A bumps debris thresholds. Contract additions:

- Galaxy row always exposes `hasMoon` / `moonId`
- Jump gate / phalanx-range buildings: stub ids reserved (`jumpGate`) — **C** implements

### 5.4 Officers + Starshards (thread D)

```ts
type OfficerId =
  | "quartermaster"  // mining
  | "archivist"      // research speed
  | "navigator"      // fleet slots / speed
  | "warden"         // defense
  | "engineer"       // energy
  | "spymaster";     // espionage

interface OfficerDef {
  id: OfficerId;
  name: string;
  description: string;
  /** Starshard cost to activate */
  cost: number;
  /** Duration ms; null = permanent until dismissed (v1: all timed) */
  durationMs: number;
  effects: OfficerEffect[];
}

interface OfficerEffect {
  kind:
    | "mineOutput"
    | "researchSpeed"
    | "fleetSpeed"
    | "fleetSlots"
    | "defensePower"
    | "energyOutput"
    | "espionageLevel";
  /** Multiplier or flat add — see balance table */
  value: number;
}

interface OfficerState {
  officerId: OfficerId;
  activatedAt: number;
  expiresAt: number;
}

// On PlayerState:
starshards: number;
officers: OfficerState[];
```

API actions (names indicative):

- `POST /api/officers/activate` `{ playerId, officerId }`
- PlayerView includes `starshards`, `officers`, `officerCatalog`

### 5.5 Skills (thread D)

```ts
type SkillBranch = "economy" | "military" | "exploration";

interface SkillNodeDef {
  id: string;
  branch: SkillBranch;
  name: string;
  description: string;
  cost: number;          // Starshards
  requires: string[];    // other node ids
  effects: OfficerEffect[]; // reuse effect shape
}

// On PlayerState:
skillsUnlocked: string[];
```

- `POST /api/skills/unlock` `{ playerId, skillId }`

### 5.6 Pirates (thread E)

```ts
// UniverseState additions:
pirateBases: Record<string, PirateBase>;

// Missions: extend MissionType with "pirateRaid" (attack pirate base)
// On destroy: remove base, grant Starshards, schedule respawn elsewhere
```

Public tick rules (v1):

- Bases grow tier on interval
- Bases may launch NPC raids at players / other bases
- Player successful `pirateRaid` → `destroyedAt` set; loot partial resources; Starshard grant
- Respawn: new empty system after delay (see balance)

### 5.7 Asteroids / harvest

```ts
// MissionType += "harvestAsteroid" (or overload harvest with targetKind)
type HarvestTarget =
  | { kind: "debris"; coords: Coordinates }
  | { kind: "asteroid"; asteroidId: string };

// Existing harvest keeps debris; asteroid harvest requires recycler (v1)
```

`UniverseState.asteroids: Record<string, AsteroidField>`  
Galaxy view lists asteroids for the browsed system.

### 5.8 PlayerView extensions (summary)

```ts
interface PlayerView {
  // ...existing...
  galaxy: GalaxyView;           // expanded
  starshards: number;           // D; A may stub 0
  officers: OfficerState[];     // D; stub []
  skillsUnlocked: string[];     // D; stub []
  // economy.positionMult from A
}
```

---

## 6. Balance numbers (v1 tunable)

### Economy / map

| Key | v1 |
|-----|---:|
| `PRODUCTION_MULT` | keep playtest `4` until friends economy retune |
| `STARTING_RESOURCES` | metal/crystal `500`, deuterium `100` |
| Home slot preference | prefer slots `4–12` on join; fall back outward |
| Asteroids per system | `0` (70%), `1` (25%), `2` (5%) |
| Asteroid richness | `3` harvests |
| Asteroid yield / harvest | metal `2000–8000`, crystal `1000–4000`, deut `0–500` (scaled by richness) |

### Starshards

| Key | v1 |
|-----|---:|
| Daily login | `15` |
| Expedition starshards roll | include in expedition table: `5%` chance `+5–25` |
| Pirate destroy | `40 + 5 * tier` |
| Officer costs | `50 / 50 / 60 / 60 / 40 / 70` for the six officers |
| Officer duration | `7d` wall-clock |
| Skill node costs | `25` / `40` / `60` by tier depth |
| Starting Starshards | `0` |

### Officers (effect magnitudes v1)

| Officer | Effect |
|---------|--------|
| Quartermaster | mineOutput `×1.10` |
| Archivist | researchSpeed `×1.15` |
| Navigator | fleetSpeed `×1.10`, fleetSlots `+1` |
| Warden | defensePower `×1.15` |
| Engineer | energyOutput `×1.15` |
| Spymaster | espionageLevel `+1` detail floor |

### Pirates

> **Superseded for density / level cap / raid cadence** by Micah redesign 2026-10-14 — see [round2-contract.md](./round2-contract.md) §5 and [vision.md](../vision.md#pirates--aliens-redesign-2026-10-14). Legacy v1 numbers below are historical only.

| Key | Legacy v1 | Redesign |
|-----|---:|----------|
| Target density | ~1 base per `40` systems (≈100 / universe) | **`PIRATE_TARGET_BASE_COUNT = 200`** |
| Growth interval | `6h` → tier+1 (cap tier `8`) | `6h` → +1; **`PIRATE_MAX_LEVEL = 100`** |
| Player destroy → respawn delay | `12–36h` random elsewhere | retain unless retuned |
| Raid interval (NPC) | `8–24h` | **`PIRATE_RAID_PERIOD_MS` = 1 h**, random offset within the hour |
| Threat vs small players | fleets capped so early empires can survive with losses, not wipe | still aim for survivable early game; balance via tuning |

### Moons (carry forward)

Keep [moons.md](./moons.md): `MOON_DEBRIS_MIN = 5000`, chance `min(20, floor((m+c)/1000))`.

---

## 7. Migration / reset safety (Upstash KV)

Live uses Vercel + Upstash Redis via **`KV_REST_API_URL`**, **`KV_REST_API_TOKEN`** (and related `KV_REST_API_*`). Shared multiplayer blob(s) must not be half-upgraded.

### Rules

1. **Schema version** — `UniverseState.schemaVersion: number` (v1 contract→universe = `2`; prototype without field = `1`).
2. **Read path** — on load, if `schemaVersion < CURRENT`, run pure migrators **or** refuse and reset (see below). Never silently assume `MAP_SLOTS = 8`.
3. **Key layout** — prefer versioned keys, e.g. `starhold:universe:v{n}` / keep `starhold:universe` but bump `UniverseState.id` + `schemaVersion` together.
4. **Incompatible map resize (1×9×8 → 10×399×15)** — treat as **universe reset**:
   - Write new empty universe under new id
   - Delete or rename old key to `starhold:universe:archive:{id}:{ts}`
   - Do **not** attempt to remap player coords in place for v1
5. **Partial deploy safety** — migrator must be idempotent; API boot checks env `KV_REST_API_*` present before writes.
6. **Admin / agent reset** — document a single explicit reset path (script or guarded `POST`) that archives then recreates; never wipe from a feature PR by accident.
7. **CI** — unit tests for migrator + “old blob rejected/reset” ; no live KV in CI.

### Env (production)

| Var | Role |
|-----|------|
| `KV_REST_API_URL` | Upstash REST endpoint |
| `KV_REST_API_TOKEN` | Auth |
| `KV_REST_API_READ_ONLY_TOKEN` | optional |

Vercel production branch = **`main`** → https://starhold-two.vercel.app

---

## 8. Dependency order (A before B–E)

```
Design contract (this doc) ──► A (universe + economy)
                                   │
                                   ├──► B UI/UX (rebase on A)
                                   ├──► C Moons expansions (rebase on A)
                                   ├──► D Starshards / officers / skills (rebase on A)
                                   └──► E Pirates AI (rebase on A)
```

| Thread | Must wait for A | May stub before A merges |
|--------|-----------------|---------------------------|
| **A** | Lands map constants, fields curve, position mults, galaxy payload (asteroid/pirate **slots** in view may be empty arrays), KV schemaVersion + reset | — |
| **B** | Full 15-slot + deep-space + asteroid/pirate row layout; resource bar hooks for Starshards | Can scaffold classic nav shell against **current** API; must not assume `MAP_SLOTS = 8` after A |
| **C** | Coords/moon flags on 10×399 map; debris keys | Can extend moon buildings / jump gate behind flags; formation math mostly independent |
| **D** | `PlayerState.starshards` field + view echo; expedition/pirate earn hooks wired by A or follow-up | Can implement officer/skill catalogs + UI against stub balance `0` shards; **do not** invent a second currency name |
| **E** | `pirateBases` on universe + galaxy `pirateBase` field + mission target hooks | Can author AI growth tables in isolation; integration PR after A |

**Hard rule:** B–E open PRs may merge **after** A is on `main` (rebase/merge main first). Do not ship a second incompatible map constant set.

---

## 9. Process reminders (all threads)

- Branch off **`main`**, small PR per batch, CI green required
- **Never** push `cursor/core-loop-prototype-1093` (retired)
- Vercel production = **`main`** → https://starhold-two.vercel.app
- Shared state: Upstash **`KV_REST_API_*`**
- **One** agent playtest per **merged milestone**, not per PR

See [process.md](../process.md) · [project-context.md](../project-context.md) · [vision.md](../vision.md)
