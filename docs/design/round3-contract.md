# Starhold Round 3 contract (v1)

**Status:** shared schema + balance **addendum** for Micah items **11–19** only.  
**Scope:** design / IDs / API shapes / KV notes — **no feature code** in this PR.  
**North star:** [vision.md](../vision.md).  
**Prior contracts:** [universe-contract.md](./universe-contract.md) + [round2-contract.md](./round2-contract.md) remain in force. Round 3 **extends** them.  
**Out of scope here:** fast-lane UI/copy (1–6) and fleet/galaxy presets (7–10) — those ship without this contract.  
**All numbers marked v1 tunable** unless noted otherwise.  
**Naming hard rule:** all **ORIGINAL** display names. Never ship Battleship / Battlecruiser / Destroyer / Bomber / Solar Satellite / Robotics Factory / Nanite / Terraformer / Graviton **as-is**.

---

## 0. Lane assignment (items 11–19)

| Lane | Owns | Items |
|------|------|-------|
| **c — content + balance** | `packages/game/src/data/tuning.ts` (+ catalog re-exports), unit fixtures | 11 defenses, 16 warships, 19 class ships, 13/18 buildings, 17 research rows |
| **b — engine / rules / KV** | formulas, migrator schema v4, class pick/change, temp→energy, orbital energy, gates | 12 classes, 14 Helio Buoy energy, 15 temperature, Chrono Lathe gate amend, class-ship rules |
| **a — UI / routes** | class picker, catalog panels, tooltips, planet rename already fast-lane | Display only; no balance edits |

```
round3-contract (this doc)
  ├──► c: defenses / buildings / research / ships (tuning)
  ├──► b: playerClass + temp + orbital energy + gates + KV v4
  └──► a: class UI + new catalog chrome (after c ids land)
```

**Hard rules:** Do not start content/engine for 11–19 until this contract is on `main`. Tuning lives only in `tuning.ts`. Ignore Vercel preview; production = `main`.

---

## 11. Fifteen new defenses (no missiles)

**Rule:** **no** missile silos, interplanetary missiles, or anti-ballistic missiles — ever in Round 3.  
Existing `laserBattery` / `shieldDome` stay. These **15** are additive.

| Id | Display | Role | Yard | Cost m/c/d | Build s | Atk | Shield | Hull |
|----|---------|------|-----:|------------|--------:|----:|-------:|-----:|
| `needleTurret` | **Needle Turret** | Cheap mass DPS | 1 | 200/0/0 | 8 | 12 | 2 | 25 |
| `arcLattice` | **Arc Lattice** | Light beam | 2 | 150/50/0 | 10 | 20 | 4 | 35 |
| `pulseBastion` | **Pulse Bastion** | Mid beam | 4 | 600/200/0 | 25 | 80 | 20 | 100 |
| `gaussRail` | **Gauss Rail** | Crystal-heavy pierce | 6 | 2000/1500/0 | 50 | 180 | 30 | 180 |
| `ionSheath` | **Ion Sheath** | Shield-breaker | 6 | 1000/500/200 | 45 | 120 | 80 | 150 |
| `plasmaSpire` | **Plasma Spire** | Late heavy DPS | 8 | 5000/3000/1000 | 90 | 450 | 60 | 400 |
| `flakCurtain` | **Flak Curtain** | Anti-fighter RF (see §16.5) | 3 | 400/200/50 | 18 | 30 | 10 | 60 |
| `kineticFence` | **Kinetic Fence** | Cheap hull wall | 2 | 400/100/0 | 12 | 5 | 5 | 120 |
| `emberMortar` | **Ember Mortar** | Deut-hungry punch | 5 | 800/400/400 | 35 | 140 | 15 | 90 |
| `rippleArray` | **Ripple Array** | Mid soak | 4 | 800/600/0 | 30 | 4 | 120 | 150 |
| `haloProjector` | **Halo Projector** | Small cupola (1/planet soft-cap UI) | 5 | 6000/4000/0 | 120 | 1 | 400 | 200 |
| `crownAegis` | **Crown Aegis** | Large cupola (1/planet soft-cap UI) | 8 | 50_000/40_000/10_000 | 600 | 1 | 5000 | 2000 |
| `siegeBlockade` | **Siege Blockade** | Anti-capital soak | 7 | 3000/2000/500 | 70 | 40 | 200 | 500 |
| `frostLance` | **Frost Lance** | Cold-slot preferential (+10% atk slots 12–15) | 5 | 900/300/300 | 40 | 100 | 25 | 110 |
| `voidWard` | **Void Ward** | Elite late defense | 10 | 20_000/15_000/5000 | 300 | 600 | 300 | 800 |

### Data shape

```ts
// DefenseDef already exists; Round 3 adds optional:
interface DefenseDef {
  // ...existing fields
  /** Soft UI hint: recommend ≤1 of this id per planet (Halo / Crown). */
  uniqueHint?: boolean;
  /** Slot-band attack multiplier when planet.coords.slot in range. */
  slotAttackBonus?: { slots: number[]; factor: number }; // Frost Lance: {12..15}, 1.10
}
```

Defenses still create **no debris**. Soft uniqueHint is **not** a hard engine lock in v1 (friends can overbuild).

### API

Existing `POST /api/queue/defense` / build-defense paths — new ids only. No missile endpoints.

---

## 12. Player classes + Starshards change rules

### Classes (choose one)

| Id | Display | Role | Bonuses (v1, multiplicative unless noted) |
|----|---------|-------|-------------------------------------------|
| `miner` | **Miner** | Defense + resources | Mine output **×1.12**; defense power **×1.10**; defense build time **×0.90** |
| `explorer` | **Explorer** | Exploration + research | Expedition yield **×1.20**; research time **×0.90**; Whisper Probe speed **×1.25**; +1 expedition slot |
| `fleeter` | **Fleeter** | Military + yard speed | Ship/defense attack **×1.08**; fleet cruise speed **×1.10**; ship build time **×0.90**; +1 fleet slot |
| `expansionist` | **Expansionist** | Colonies / empire | +**2** colony slots (added to Stellar Cartography); colony ship speed **×1.15**; building build time **×0.95**; Fold Bridge cooldown **×0.85** |

### Pick / change (Starshards)

| Event | Rule |
|-------|------|
| First pick | Free, once, from Overview / join interstitial; required before class-exclusive ships |
| Change cost | **`200 + 100 × priorChangeCount`** Starshards (v1) |
| Cooldown | **7 days** wall-clock after a change (not after first pick) |
| Refund | None |
| Exclusive hulls | Old class ships **remain** in hangars; **cannot rebuild** until class restored; shipyard UI hides them |

### Data / API / KV

```ts
type PlayerClassId = "miner" | "explorer" | "fleeter" | "expansionist";

interface PlayerClassState {
  classId: PlayerClassId | null;
  chosenAt: number | null;
  changeCount: number;       // increments on each paid change
  lastChangeAt: number | null;
}

// on PlayerState:
playerClass: PlayerClassState;
```

```http
POST /api/class/choose   { playerId, classId }          // first pick only; free
POST /api/class/change   { playerId, classId }          // spends Starshards; respects cooldown
GET  /api/class/catalog  → bonuses + exclusive ship ids
```

**Starshards sink (amend universe-contract §1 Spend):** add row — **Class change** per table above.  
**KV:** additive on `PlayerState`; migrator sets `{ classId: null, chosenAt: null, changeCount: 0, lastChangeAt: null }`.

---

## 13. Field-expansion building — **Mantle Loom**

| | |
|--|--|
| Id | `mantleLoom` |
| Display | **Mantle Loom** |
| Effect | Each level: **−1 field used by the building itself** is already paid; **+5** to `fieldsCap` per level net → formula below |
| Energy | **Very high:** `energyUse = 80 × level` (flat per level, not growth curve) |
| Gate | Solar Array **5**; Research Lab **3** |
| Planet only | Not buildable on moons |

### Fields formula (v1)

```
fieldsUsed(mantleLoom) = 1          // always occupies 1 field regardless of level
fieldsCapBonus         = 5 * level  // added to rolled fieldsCap
netFieldsFromLoom      = 5*level - 1
```

Upgrade from L→L+1 requires `fieldsRemaining ≥ 0` after accounting for the single occupied field (same as other buildings that use 1 field).

| Level cost (base) | Growth |
|-------------------|--------|
| metal `50_000`, crystal `100_000`, deuterium `30_000` | `costGrowth: 2.0` |
| `baseBuildSeconds: 120` | |

---

## 14. Orbital energy ship — **Helio Buoy**

Solar-satellite **function**, original name. Lives in hangar / orbit; **does not fly missions** (excluded from fleet launch; auto-parked).

| | |
|--|--|
| Id | `helioBuoy` |
| Display | **Helio Buoy** |
| Cost | metal `0`, crystal `2000`, deuterium `500` |
| Build s | `30` |
| Yard | **3** |
| Cargo / atk / shield / hull | `0 / 0 / 1 / 10` |
| Speed / fuel | `0` / `0` (non-mobile) |
| Energy | `floor( temperatureK / 4 )` **per buoy** (see §15) |

```ts
helioBuoyEnergy(planet) =
  count(helioBuoy) * Math.floor(planetTemperatureK(planet.coords.slot) / 4)
```

Adds to planet energy pool like Solar Array (after slot energy mult). Destroyable in combat like ships; **no debris** from buoys (v1).

```http
// build via ship queue; launch API rejects helioBuoy in composition
```

---

## 15. Temperature by slot

Integrate with existing `SLOT_PRODUCTION_MULT` (do not replace metal/crystal/deut curves).

| Slot | Temp K (v1) | Notes |
|-----:|------------:|-------|
| 1 | 220 | Hottest — high solar |
| 2 | 200 | |
| 3 | 180 | |
| 4 | 160 | |
| 5 | 140 | |
| 6 | 120 | |
| 7 | 100 | |
| 8 | 90 | Neutral band |
| 9 | 80 | |
| 10 | 70 | |
| 11 | 60 | |
| 12 | 50 | |
| 13 | 40 | |
| 14 | 30 | |
| 15 | 20 | Coldest — low solar, high deut already in slot mult |

```ts
function planetTemperatureK(slot: number): number { /* table above */ }

// Solar Array energy (amend):
solarEnergy *= (planetTemperatureK(slot) / 90)   // slot 8 baseline 1.0×
// Helio Buoy uses floor(temp/4) as above.
// Deut Still: keep SLOT_PRODUCTION_MULT.deuterium (already rises outward).
```

Expose `temperatureK` on planet economy payload for UI.

---

## 16. Four main-line warships

Sit **above** Aegis Cruiser / Breach Bomber; **below** Void Titan.

| Id | Display | Role (Micah) | Yard | Cost m/c/d | Build s | Cargo | Atk | Shield | Hull | Speed | Fuel |
|----|---------|--------------|-----:|------------|--------:|------:|----:|-------:|-----:|------:|-----:|
| `keelSovereign` | **Keel Sovereign** | Fleet backbone | 7 | 40_000 / 20_000 / 10_000 | 1800 | 1500 | 1000 | 400 | 2500 | 2500 | 3 |
| `rakeCorsair` | **Rake Corsair** | Fleet hunter (RF vs light) | 7 | 30_000 / 40_000 / 15_000 | 1600 | 750 | 700 | 250 | 1200 | 6000 | 2.5 |
| `anvilDread` | **Anvil Dread** | Mobile battle platform | 8 | 60_000 / 25_000 / 20_000 | 2200 | 2000 | 500 | 800 | 3000 | 2000 | 4 |
| `wardbreaker` | **Wardbreaker** | Anti-defense strike | 8 | 50_000 / 35_000 / 20_000 | 2000 | 400 | 1200 | 150 | 900 | 3000 | 3.5 |

**Research req (all four):** Ordnance Doctrine **6**, Hull Weave **5**, Aegis Lattice **5**, Pulse Drive **4**.

### 16.5 Rapid-fire additions (v1)

| Firer | Target | Factor |
|-------|--------|------:|
| `rakeCorsair` | `scout` | 6 |
| `rakeCorsair` | `interceptor` | 4 |
| `rakeCorsair` | `cruiser` | 3 |
| `rakeCorsair` | `swarmDrone` | 8 |
| `rakeCorsair` | `probe` | 12 |
| `wardbreaker` | `laserBattery` / Beam Emplacement | 10 |
| `wardbreaker` | `needleTurret` | 10 |
| `wardbreaker` | `arcLattice` | 8 |
| `wardbreaker` | `pulseBastion` | 6 |
| `wardbreaker` | `gaussRail` | 4 |
| `wardbreaker` | `ionSheath` | 4 |
| `wardbreaker` | `plasmaSpire` | 3 |
| `wardbreaker` | `shieldDome` / Aegis Cupola | 5 |
| `wardbreaker` | `haloProjector` | 5 |
| `wardbreaker` | `crownAegis` | 3 |
| `wardbreaker` | `rippleArray` | 6 |
| `flakCurtain` | `scout` | 5 |
| `flakCurtain` | `interceptor` | 4 |
| `flakCurtain` | `swarmDrone` | 8 |
| `flakCurtain` | `probe` | 10 |
| `anvilDread` | `bomber` / Breach Bomber | 2 |
| `keelSovereign` | `cruiser` | 2 |

---

## 17. Gravity research gate — **Well Binding**

| | |
|--|--|
| Id | `gravityWell` |
| Display | **Well Binding** |
| Flavor | Gravity doctrine for moon/planet destruction and mini-planet harvest (not “Graviton”) |
| Lab | **6** |
| Base cost | metal `0`, crystal `4000`, deuterium `2000` |
| Growth | `2.0` |
| Base research s | `120` |

**Hard gate (amend Round 2 ship reqs):** Void Titan, Mothership (`swarmMothership`), and World Eater each require **`gravityWell` ≥ 1** in addition to existing Ordnance / Aegis / Hull gates.

```ts
researchReq: { /* existing */, gravityWell: 1 }
```

UI copy: “Requires Well Binding 1 — gravity for moon/planet rupture (and Mothership mini-planet harvest).”

---

## 18. Construction building — **Rig Foundry**

Robotics-plant **function**, original name. Stacks **before** Chrono Lathe’s exponential cut.

| | |
|--|--|
| Id | `rigFoundry` |
| Display | **Rig Foundry** |
| Effect | Build time for **buildings, ships, defenses** × `(1 - 0.15 × level)`, floored at **×0.10** (cap effective level 6 for the −15% chain; higher levels still allowed for Chrono gate / future) |
| Cap note | Levels above 6: time factor stays **0.10** from this building alone; Chrono Lathe still multiplies after |
| Gate | Shipyard **2** |
| Energy | `energyUsePerLevel: 15` |
| Base cost | metal `400`, crystal `200`, deuterium `100` |
| Growth | `2.0` |
| Base build s | `40` |

### Chrono Lathe amend (Round 2 §7.5b)

| Gate | Old | New |
|------|-----|-----|
| Start Chrono Lathe | Shipyard **10** | Shipyard **10** **and** Rig Foundry **10** |

Order of time multipliers (v1):

```
time *= rigFoundryFactor(level)     // (1 - 0.15*lvl), min 0.10
time *= chronoLatheFactor(level)    // 0.1^level
time *= level/officer/skill factors // existing
```

---

## 19. Class-exclusive ships (8)

Buildable **only** when `playerClass.classId` matches. Pirates do **not** get class hulls (v1).

### 19.1 Explorer

| Id | Display | Role |
|----|---------|------|
| `vaultScout` | **Vault Scout** | Boosts expedition yield when in the expedition fleet |
| `astrolabeWing` | **Astrolabe Wing** | *(second — designed)* Parked on a planet: −8% research time empire-wide if ≥1 owned; +1 Shadow Optics detail when used as probe escort |

| Stat | Vault Scout | Astrolabe Wing |
|------|------------:|---------------:|
| Cost m/c/d | 2000/4000/1000 | 3000/5000/1500 |
| Build s | 120 | 150 |
| Yard | 5 | 6 |
| Cargo | 200 | 100 |
| Atk / Sh / Hull | 20 / 40 / 80 | 10 / 60 / 100 |
| Speed / fuel | 18_000 / 1 | 14_000 / 1.2 |

**Vault Scout yield:** expedition resource/Starshards finds × `(1 + 0.05 × min(count, 10))` (cap +50%).  
**Astrolabe Wing:** empire research time × `0.92` if any Wing exists in any hangar; spy missions that include ≥1 Wing gain +1 report detail tier (cap at max).

### 19.2 Fleeter

| Id | Display | Role |
|----|---------|------|
| `spoilSkimmer` | **Spoil Skimmer** | After a battle you win, harvests a cut of the debris field into its cargo without a separate recycle mission |
| `lineDrummer` | **Line Drummer** | *(second — designed)* Fleet-speed aura + light RF support |

| Stat | Spoil Skimmer | Line Drummer |
|------|--------------:|-------------:|
| Cost m/c/d | 4000/2000/2000 | 5000/4000/1000 |
| Build s | 140 | 160 |
| Yard | 6 | 6 |
| Cargo | 25_000 | 500 |
| Atk / Sh / Hull | 5 / 30 / 120 | 80 / 40 / 200 |
| Speed / fuel | 5000 / 1.5 | 8000 / 2 |

**Spoil Skimmer:** on attacker victory, up to `min(cargoFree, floor(debris × 0.15 × skimmerCount / max(1, skimmerCount)))` metal+crystal pulled into Skimmer cargo before the debris field is written (v1: **15% of field** total from all Skimmers, split by cargo space). Does not replace Salvage Trawler full clears.  
**Line Drummer:** each Drummer in fleet grants cruise speed × `1.02` (stacking, cap ×1.20 at 10). RF: Drummer → scout/interceptor **3**.

### 19.3 Miner

| Id | Display | Role |
|----|---------|------|
| `veinAnchor` | **Vein Anchor** | Stationary — **cannot** join fleets; boosts that planet’s mine output |
| `gridStake` | **Grid Stake** | *(second — designed)* Stationary energy booster + light local defense |

| Stat | Vein Anchor | Grid Stake |
|------|------------:|-----------:|
| Cost m/c/d | 5000/2500/0 | 4000/4000/500 |
| Build s | 200 | 180 |
| Yard | 4 | 5 |
| Cargo | 0 | 0 |
| Atk / Sh / Hull | 0 / 50 / 200 | 40 / 80 / 250 |
| Speed / fuel | 0 / 0 | 0 / 0 |
| Flags | `stationary: true` | `stationary: true` |

**Vein Anchor:** planet mine output × `(1 + 0.03 × min(count, 10))` (cap +30%).  
**Grid Stake:** planet energy × `(1 + 0.04 × min(count, 10))`; participates in defense with its combat stats.

Launch API rejects stationary ids. Movement between planets: **not allowed** (scrap/rebuild only).

### 19.4 Expansionist

| Id | Display | Role |
|----|---------|------|
| `foundationArk` | **Foundation Ark** | Colonizer — new colony starts with boosted buildings (consumes itself) |
| `frontierBeacon` | **Frontier Beacon** | *(second — designed)* Empire colony logistics |

| Stat | Foundation Ark | Frontier Beacon |
|------|---------------:|----------------:|
| Cost m/c/d | 10_000 / 10_000 / 5000 | 8000 / 6000 / 4000 |
| Build s | 600 | 400 |
| Yard | 5 | 6 |
| Cargo | 2000 | 1000 |
| Atk / Sh / Hull | 0 / 80 / 400 | 30 / 100 / 300 |
| Speed / fuel | 2500 / 2 | 4000 / 1.5 |

**Foundation Ark** on successful colonize (replaces Colonizer for this path; Colonizer remains for normal colonies):

```
metalMine 5, crystalMine 5, deutSynth 5,
solarPlant 5,
metalStorage 5, crystalStorage 5, deutTank 5,
rigFoundry 6
```

Consumed on landing (same as Colonizer). Requires free slot + Expansionist class.

**Frontier Beacon:** while ≥1 exists in empire hangars, +1 colony slot; Fold Bridge cooldown ×0.75 (stacks with class ×0.85 → combined multiply).

---

## API / view summary (Round 3 deltas)

```ts
interface UniverseState {
  schemaVersion: 4; // Round 3 bump from Round 2’s 3
}

interface PlayerState {
  playerClass: PlayerClassState;
  // starshards sinks include class change
}

interface PlanetState {
  // buildings: + mantleLoom, rigFoundry
  // defenses: + 15 ids
  // ships hangar: + warships, helioBuoy, class ships
}

interface PlanetEconomyView {
  temperatureK: number;
  energy: {
    // ...
    helioBuoy: number;
    solarTempFactor: number; // tempK / 90
  };
  fields: {
    cap: number;           // rolled + mantleLoom bonus
    mantleLoomBonus: number;
  };
}
```

```http
POST /api/class/choose
POST /api/class/change
GET  /api/class/catalog
```

Ship queue accepts new ids; launch rejects `helioBuoy`, `veinAnchor`, `gridStake`.

---

## Safe KV migration (schema v3 → v4)

| Version | Meaning |
|--------:|---------|
| 3 | Round 2 queues / levels / ships / mini / pirates |
| **4** | Round 3 class + new catalog ids + temp fields (view-only) |

### Rules

1. **Additive:** init `playerClass` defaults; init building/defense/ship counts `0` for new ids on read.
2. **Idempotent** when `schemaVersion >= 4`.
3. **No map reset.** Chrono Lathe gate is enforced on **new** queue starts only (existing in-progress Chrono builds complete).
4. Partial deploy: unknown ship/defense ids filtered in view until lane-c lands.
5. Env unchanged: `KV_REST_API_*`. Production = `main` → https://starhold-two.vercel.app

---

## Tests required (implementation PRs)

- Defense catalog length + no missile ids
- Class choose / change Starshards debit + cooldown
- Mantle Loom fieldsCap + energy use
- Helio Buoy energy vs temperature table
- Solar Array temp factor at slots 1 / 8 / 15
- Warship RF matrix lookups
- `gravityWell: 1` blocks VT / MS / WE builds
- Rig Foundry −15%/lvl + Chrono requires Foundry 10
- Class ship build gate; stationary rejection; Foundation Ark bootstrap levels
- Spoil Skimmer debris skim math

---

## Micah review — name + bonus cheat sheet

**Classes:** Miner / Explorer / Fleeter / Expansionist (bonuses in §12).  
**Buildings:** Mantle Loom (+5 fields/lvl), Rig Foundry (−15% time/lvl; Chrono needs L10).  
**Research:** Well Binding (gates VT / Mothership / WE).  
**Orbital:** Helio Buoy (temp/4 energy each).  
**Warships:** Keel Sovereign, Rake Corsair, Anvil Dread, Wardbreaker.  
**Class ships:** Vault Scout + Astrolabe Wing; Spoil Skimmer + Line Drummer; Vein Anchor + Grid Stake; Foundation Ark + Frontier Beacon.  
**Defenses (15):** Needle Turret, Arc Lattice, Pulse Bastion, Gauss Rail, Ion Sheath, Plasma Spire, Flak Curtain, Kinetic Fence, Ember Mortar, Ripple Array, Halo Projector, Crown Aegis, Siege Blockade, Frost Lance, Void Ward.
