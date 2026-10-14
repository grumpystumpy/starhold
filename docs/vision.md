# Starhold vision (Micah)

**North star:** An OGame-like game that's fun for friends to play against each other.

## Product direction

Friends-only multiplayer. No real-money purchases. Premium in-game currency is earned in-game (expeditions, pirate kills, daily login, etc.).

**Live:** https://starhold-two.vercel.app (Vercel deploys `main`). Shared state: Upstash KV (`KV_REST_API_*`). Universe resets/migrations must be safe.

---

## Round 1 (complete — keep as north star)

### Parallel workstreams (after design contract)

| ID | Area | Notes |
|----|------|--------|
| **A** | Universe and economy | Galaxy data model + position-based production. **Lands first** — others depend on it. |
| **B** | UI/UX overhaul | Classic OGame-style layout (see below). |
| **C** | Moons and moon buildings | Debris → moon chance; moon-only buildings. |
| **D** | Premium currency, officers, skills | Original currency name; officers + skill tree. |
| **E** | Pirates AI | NPC bases that grow, raid everyone, destroy-on-raid, respawn. |

Coordinator owns integration: shared design/schema contract first, merge in dependency order, rebase dependents, keep `main` green and deployed. CI on every PR. One agent playtest per **merged milestone**, not per PR.

### Requirements detail

#### UI (B)

Organized, user-friendly, classic OGame-style:

- Left nav: Overview, Resources, Facilities, Research, Shipyard, Defense, Fleet, Galaxy, Officers, Skills, Highscore, Messages
- Top resource bar: amounts, production rates, storage
- Right: planet/moon switcher list
- Build queues with countdown timers
- Clear cost and requirement tooltips
- Responsive layout

#### Officers (D)

Bought with premium in-game currency (like Dark Matter, **original name**). Each officer boosts a different aspect (e.g. mining, research speed, fleet slots/speed, defense, energy, espionage) for a duration or permanently. Currency earned only in-game (friends-only, no real money).

#### Skills (D)

Skill tree purchased with the same currency; permanent perks across economy, military, and exploration.

#### Moons (C)

Created from large debris fields after battles (OGame-style chance). Moon-only buildings (e.g. lunar base for fields, sensor phalanx, jump gate, plus originals).

#### Galaxy (A + UI)

OGame-style map: galaxy:system navigation; planet table with player names, alliance, debris, moon, action buttons; asteroids + deep-space zone per system; asteroids mineable/harvestable via mission.

#### Pirates (E)

NPC bases spawn randomly, grow slowly, raid players and each other. Successful player raid destroys the base; it eventually respawns elsewhere. Challenging but not run-ending for small players.

#### Universe size (A)

- **10 galaxies × 399 systems**
- Each system: **15 planet slots** + **slot 16 = deep space**

#### Planet fields (A)

- Smallest planets at slots **1 and 15** (min **250** fields)
- Largest at slot **8**; slots **7 and 9** slightly smaller
- Curve between those points; randomized within a band per slot

#### Position production (A)

- Further from sun → more deuterium, less energy
- Closer to sun → more crystal, more energy
- Slot **8** neutral (**1.0×** across the board)
- Smooth multipliers per slot

### Order of execution (Round 1)

1. Design doc and schema contract (shared)
2. **A** (universe + economy)
3. **B–E in parallel**, merging as they finish (rebase on main as needed)

---

## Round 2 (complete — keep as contract)

Shared contract: **[design/round2-contract.md](./design/round2-contract.md)** (on `main`). Threads F–L landed or superseded; balance continues via fast-lane tuning PRs.

### Round 2 goals

1. **Build queues** — Multi-item queues per planet for buildings, ships, defenses, and research; cancel/reorder; live countdowns. Queue length grows via research, skills, and officers.
2. **Navigation** — Top-left dropdown; separate pages with real routes/URLs for Buildings, Defenses, Shipyard, Research, Galaxy, Officers, Skills, plus Overview, Fleet, Highscore, Messages.
3. **Player levels** — No max level. XP from building, research, combat, expeditions, pirate kills (design amounts in contract). Each level grants: +0.5% resource production, time reduction on build/research/fleet, shielding tech, weapons tech, and ship build speed. Level + XP bar in the top bar and on highscores.
4. **Pirates upgrade** — Bases build every ship type players can; bases level up over time; every 3h free weak ships scaled by base level (count grows with level); pirate techs stay very low vs players.
5. **Rename audit** — OGame-identical labels → Starhold flavor (Crater Hab, Horizon Scanner, Fold Bridge, Voidforge Titan, Colonizer, Salvage Trawler, Whisper Probe, Beam Emplacement, Aegis Cupola, Power Discipline, Pulse Drive, Ordnance Doctrine, Hull Weave, Aegis Lattice, Shadow Optics, Stellar Cartography, Fleet OS). Audit entire catalogs.
6. **Mini planets** — Random small planets outside slots 1–16; discoverable only via expedition outcome (reveals coords to finder). 3–4 special-only buildings. After colonize: attacker with ≥5 World Eaters who wins can **capture** (ownership transfer) or **destroy** (huge resource payout + debris).
7. **New ships** (combat + rapid fire + tests; friend-group balance):
   - **Voidforge Titan** — moon-killer flagship; Deathstar-class balance reference only; moon destruction chance formula
   - **World Eater** — destroy mini planets → debris; cannot collect debris
   - **Swarm Drone** — tiny/fast/low dmg/low armor/high shields/no cargo/cheap; swarm numbers bonus; intercepts damage to mothership; must be carried by Mothership
   - **Swarm Harvester** — harvest debris + steal resources into mothership cargo; no weapons, high shields, medium armor; intercepts mothership damage; if mothership <30% armor, kamikaze for shield+armor damage; mothership-carried
   - **Mothership** — carry up to 2,000 swarm ships; produce drones anywhere (no home planet); research Swarm Hold +15% of base (300) capacity per level; can occupy enemy planet/moon up to 2 days after defenses destroyed (occupation effects in contract)

### Parallel workstreams (Round 2)

| ID | Area | Notes |
|----|------|--------|
| **F** | Rename audit | Catalog display names + id aliases. **Land early** — unblocks UI copy and ship/building docs. |
| **G** | Navigation / routes | Top-left dropdown + real client routes for all listed pages. |
| **H** | Build queues | Multi-item queues, cancel/reorder, countdowns, length growth hooks. |
| **I** | Player levels / XP | XP sources, level bonuses, top-bar + highscore. Can parallel **G**/**H**. |
| **J** | New ships | Voidforge Titan, World Eater, swarm line; combat + RF + unit tests. **Before** mini-planets & pirate full catalog. |
| **K** | Mini planets | Expedition discovery, special buildings, colonize, capture/destroy. Needs **J** (World Eater). |
| **L** | Pirates upgrade | Base levels, 3h free ships, full player ship catalog. Needs **J** ship ids. |

**Merge dependency order (suggested):**

```
round2-contract ──► F (renames)
                      │
                      ├──► G (nav) ──────────────┐
                      ├──► H (queues) ───────────┤
                      ├──► I (levels) ───────────┼──► integration / playtest
                      └──► J (ships) ──► K (mini)
                                      └► L (pirates)
```

Coordinator owns integration: rebase dependents, keep `main` green, **ignore Vercel preview** (main-only deploys). One agent playtest per **merged milestone**.

### Reporting

Milestones only: Round 2 design ready (short summary), each merged area, blockers.

---

## Round 3 (current)

Shared **addendum** for new systems: **[design/round3-contract.md](./design/round3-contract.md)**. Fast-lane UI/copy and fleet/galaxy items ship as small PRs **without** waiting on the addendum. **Content/engine for items 11–19** wait until the contract is on `main`. All names **ORIGINAL** (never Battleship / Battlecruiser / Destroyer / Bomber / Solar Satellite / Robotics Factory / Nanite / Terraformer / Graviton as-is). Report once per merged batch.

### Round 3 goals (Micah)

**Fast lane (UI/copy) — no contract:**

1. Thousands separators everywhere numbers display (shared formatter).
2. Skills tab: underscores → spaces in names.
3. Top bar refresh: no flicker/layout jump; fixed widths / tabular numerals.
4. Copy: “visiting another rival” → “attacking another rival”.
5. Rename Outpost Cradle → **Colonizer**; “outpost” wording → “colony”; Swarm Mothership → **Mothership**.
6. Players can rename planets (validated, length-limited, profanity-safe).

**Fleet / galaxy:**

7. Fleet tab: only ships in orbit on the selected planet.
8. Fleet presets per player per universe (Expedition, Raid, Moon Destruction, Mini Planet Capture/Destruction, plus custom).
9. Galaxy: “Send max expeditions” using Expedition preset.
10. Galaxy: scan every owned planet in the current system (probes, batch).

**New systems (contract addendum — items 11–19):**

11. **15 new defenses** — distinct roles; **no** missiles / silos / ABM.
12. **Player classes** — Miner, Explorer, Fleeter, Expansionist; Starshards-paid change rules.
13. **Field-expansion building** — costs 1 field, +5 fields/level, very high energy (**Mantle Loom**).
14. **Orbital energy ship** — solar-sat function, original name (**Helio Buoy**); output from temperature.
15. **Temperature by slot** — hotter inward (more solar); colder outward (less solar, more deut); integrate with position production.
16. **Four main warships** — backbone, fleet hunter (RF), mobile platform, anti-defense (**Keel Sovereign**, **Rake Corsair**, **Anvil Dread**, **Wardbreaker**).
17. **Well Binding** (gravity research) — gate for Void Titan, Mothership, World Eater.
18. **Rig Foundry** (construction building) — −15% build time/level; Chrono Lathe requires it at **L10**.
19. **8 class-exclusive ships** (2 per class) — including designed “second” hulls per class.

### Parallel lanes (Round 3)

| Lane | Area | Notes |
|------|------|--------|
| **a** | UI / routes / copy | Fast-lane 1–6; fleet/galaxy chrome 7–10; class picker after contract |
| **b** | Engine / rules / KV | Class system, temperature, Helio energy, gates, schema v4 |
| **c** | Content + balance | Defenses, warships, class ships, Mantle Loom, Rig Foundry, Well Binding in `tuning.ts` |
| **reviewer** | UI/UX | Standing visual + layout CI (not a builder) |

Max **3 builders** + reviewer. Contract-first **only** for 11–19.

### Reporting

Once per **merged batch**; no status-only wakes. After contract merge: short name + class-bonus + ship/defense list for Micah balance review.

---

## Process (Micah-approved — adopt 2026-10-13)

1. **No status-only wakes/reports.** Do not schedule wakes just to note “waiting on CI” or rebase progress. Use CI completion / merge events. Report only on **merge**, **blocker**, or a **decision needed from Micah**.
2. **Max 3 concurrent build threads**, fixed lanes — apply after current H/J finish:
   - **(a) UI / routes**
   - **(b) Game engine / rules / persistence**
   - **(c) Content + balance data**
   Assign each thread to one lane; avoid cross-lane file edits (cuts rebase churn).
3. **Single tuning source.** All ship/defense/building/research stats, costs, build times, XP awards, queue sizes, and level bonuses live in one module (e.g. `packages/game/src/data/tuning.ts` or JSON). Balance tweaks = edit that file only.
4. **Fast lane.** Number tweaks, renames, copy/UI text → straight PR to `main` with auto-merge on green CI; **no** design doc. Design-contract-first **only** for new systems.
5. **Staging + balance report.** Staging env (Vercel preview or second project on a `staging` branch, within Hobby deploy limits). Promote to production `main` about **once a day** in a batch. CI posts a PR comment diffing tuning values (stats/costs/requirements) vs `main`.

Main-only production deploys stay; staging is the exception path for daily batch promote.
