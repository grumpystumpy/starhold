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

NPC bases across the universe. **Superseded for levels/raids/density by [Pirates + Aliens redesign](#pirates--aliens-redesign-2026-10-14)** (max level 100, 200 bases, once-per-hour random raids, coalitions). Successful player raid still destroys the base; challenging but not run-ending for small players.

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
4. **Pirates upgrade** — Historical Round 2 intent (levels, 3h free ships). **Operational rules now follow [Pirates + Aliens redesign](#pirates--aliens-redesign-2026-10-14)** (cap 100, defenses accumulate, ship exclusions, 200-base density, once-per-hour random raids, split/coalition).
5. **Rename audit** — OGame-identical labels → Starhold flavor (Crater Hab, Horizon Scanner, Fold Bridge, Voidforge Titan, Outpost Cradle, Salvage Trawler, Whisper Probe, Beam Emplacement, Aegis Cupola, Power Discipline, Pulse Drive, Ordnance Doctrine, Hull Weave, Aegis Lattice, Shadow Optics, Stellar Cartography, Fleet OS). Audit entire catalogs.
6. **Mini planets** — Random small planets outside slots 1–16; discoverable only via expedition outcome (reveals coords to finder). 3–4 special-only buildings. After colonize: attacker with ≥5 World Eaters who wins can **capture** (ownership transfer) or **destroy** (huge resource payout + debris).
7. **New ships** (combat + rapid fire + tests; friend-group balance):
   - **Voidforge Titan** — moon-killer flagship; Deathstar-class balance reference only; moon destruction chance formula
   - **World Eater** — destroy mini planets → debris; cannot collect debris
   - **Swarm Drone** — tiny/fast/low dmg/low armor/high shields/no cargo/cheap; swarm numbers bonus; intercepts damage to mothership; must be carried by Swarm Mothership
   - **Swarm Harvester** — harvest debris + steal resources into mothership cargo; no weapons, high shields, medium armor; intercepts mothership damage; if mothership <30% armor, kamikaze for shield+armor damage; mothership-carried
   - **Swarm Mothership** — carry up to 2000 swarm ships; produce drones anywhere (no home planet); research Swarm Hold +15% of base (300) capacity per level; can occupy enemy planet/moon up to 2 days after defenses destroyed (occupation effects in contract)

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

## Process (Micah-approved — adopt 2026-10-13; batch-merge rule 2026-10-14)

1. **No status-only wakes/reports.** Do not schedule wakes just to note “waiting on CI” or rebase progress. Use CI completion / merge events. Report only on a **batch merge to `main`**, a **blocker**, or a **decision needed from Micah**.
2. **Max 3 concurrent build threads**, fixed lanes — apply after current H/J finish:
   - **(a) UI / routes**
   - **(b) Game engine / rules / persistence**
   - **(c) Content + balance data**
   Assign each thread to one lane; avoid cross-lane file edits (cuts rebase churn).
3. **Single tuning source.** All ship/defense/building/research stats, costs, build times, XP awards, queue sizes, and level bonuses live in one module (e.g. `packages/game/src/data/tuning.ts` or JSON). Balance tweaks = edit that file only.
4. **Fast lane.** Number tweaks, renames, copy/UI text → open a PR to `main`; **no** design doc. Design-contract-first **only** for new systems. **Turn off auto-merge** for fast-lane PRs. **Do not** merge small PRs to `main` one-at-a-time.
5. **Protect Vercel Hobby deploy limit.** Each merge to `main` triggers a production deploy. Let all active lanes finish, then combine into **as few merges as possible** (ideally one batch PR) so production deploys once. No solo merges to `main`.
6. **Staging + balance report.** Staging env (Vercel preview or second project on a `staging` branch, within Hobby deploy limits). Promote to production `main` about **once a day** in a batch. CI posts a PR comment diffing tuning values (stats/costs/requirements) vs `main`.

Main-only production deploys stay; staging is the exception path for daily batch promote.

### Micah approval gate (2026-10-14)

1. **Nothing merges to `main` without Micah's explicit approval** (relayed by the coordinator). No auto-merge at all, including fast-lane. Finished work stays as open PRs or one integration branch until approved.
2. **Deploys:** at most 3–4 production updates per day, each approved by Micah first. Keep Vercel usage minimal (spare deploys for urgent fixes). No PR preview deploys — `git.deploymentEnabled` main-only (or ignoreCommand).
3. **Queue order:** Micah's send order, oldest first. Keep lanes busy continuously.
4. **Reporting:** as soon as each item is done, report merge-ready (PR link + one-line plain summary) for Micah's approval list; also report blockers.

### Quality gate (2026-10-14)

An item only goes on Micah's merge list after it is proven against what's currently running:

1. Rebase on latest `main` (includes #39 nested `/api/*`).
2. Unit tests + typecheck + production build green.
3. Playwright against a **local** production build (`npm run build:vercel` + local serve of `apps/web/dist` + API — not Next.js; Starhold is Vite/Hono). Env shape like prod: KV + `SESSION_SECRET`. Cover signup → login → cookie persistence **and** the new feature end-to-end.
4. UI reviewer sign-off at desktop 1280×800 and phone 390×844.
5. Save-format compatibility with existing Upstash KV player data (no resets; migrate if needed).
6. Combines cleanly with other merge-ready items.
7. **Do not** use Vercel preview deploys for this testing.

Report to coordinator only when passed: PR link + one-line summary + what was tested.


## Pirates + Aliens redesign (2026-10-14)

Micah redesign. **Supersedes** Round 1 density/raid cadence, Round 2 pirate cap-12 / “every ship” catalog, and open PR **#44**. Contract: [design/round2-contract.md](./design/round2-contract.md) §5–5b. Implementer note: store `internal/pirates-aliens-redesign.md`. All numeric knobs live in `packages/game/src/data/tuning.ts` (constant names documented before code lands). **Original names only** (no OGame terms).

### Pirates

- **Max level 100** (not 12). Every level-up grants defenses; higher levels grant more.
- Each **weak-ship spawn** (every **3h**) **also** adds defenses. Defenses **accumulate forever**; amount scales with level.
- Ship catalog: every ship **except the three biggest** — **World Eater**, **Mothership**, **Void Titan**.
- **Raid once per hour** at a **random time within that hour** (players and other pirates). Pirate-vs-pirate slightly less often than pirate-vs-player. Same **split family** (original + descendants) never attack each other (**coalition**).
- **Fairness (queued 2026-10-14):** vs players under **100k** points, each pirate raid that day reduces that day’s remaining raid chance by **−1% of the original** chance (does **not** apply to aliens). See [Feature queue](#feature-queue-micah-2026-10-14--after-current-backlog-planet-art-last).
- Universe target: **200 pirate bases** across all galaxies. New universes seed to 200; migration **tops up** existing universes to 200 **without wiping player data**.
- **Split once at exactly level 25:** original unchanged + **2** new level-1 bases in nearby systems. No other split levels.

### Aliens (new faction)

- Universe starts with **zero** alien bases — they exist **only after** an expedition find.
- **Hidden** until found by expedition. Find chance **0.001% per expedition**; universe daily find window/roll **resets each day**. More expedition runners → more independent find chances.
- Once found: settle the **nearest open slot-1** planet relative to the finder’s expedition origin.
- **Build up 4 hours**, then raid anyone on the **same** once-per-hour random-time schedule as pirates.
- Same growth path as pirates (leveling, accumulating defenses, 3h ship+defense spawns, hourly random raids, coalitions) but **split at level 50**, **stronger**, more ships/defenses per spawn period.
- **Few** alien bases (found only). Tech always **1 level above** the top player’s tech **per research**.

### Performance (Hobby)

200 pirate bases (+ rare aliens) × hourly random raids must not blow KV / serverless. Simulate with **lazy catch-up on read** (or a rare batched tick) — not per-base writes. **Recommendation:** do **not** rely on Vercel Hobby cron for hourly cadence (Hobby cron is daily-only); prefer player-driven lazy AI ticks. Flag Upstash free-tier command budget if every tick rewrites the whole universe document. Details in the implementer note.

### Feature queue (Micah 2026-10-14) — after current backlog; PLANET ART last

Canonical ordered list: store [internal/backlog-queue.md](../internal/backlog-queue.md) (§A current · §B ADD · §C CHANGE · §D PLANET ART). Detail: [internal/backlog-micah-add-change-2026-10-14.md](../internal/backlog-micah-add-change-2026-10-14.md).

**Do not start ADD/CHANGE until in-flight work ahead is clear** (Messages inbox, etc.). All numeric knobs → `tuning.ts`. New systems need a design-contract addendum before content/engine work. Quality gate + **no merge without Micah** still apply. Free-tier: **lazy catch-up, minimal KV writes** (same Hobby constraints as pirates/aliens).

#### ADD (new systems — backlog #10–#14)

1. **Replayable battle reports** — round-by-round losses / debris / XP; shareable in chat.
2. **Daily + weekly goals** — e.g. win 3 pirate fights, run 5 expeditions → Starshards or resources.
3. **Alliance chat + shared intel** — shared spy reports, galaxy target markers, joint attack planning (builds on alliances).
4. **Event log + alerts** — one feed: raids, finished builds, fleet returns, nearby minis found while away.
5. **Monthly seasons + leaderboards** (combat, economy, pirate kills) + cosmetic rewards (planet skins, titles). No real-money.

#### CHANGE (balance / UX — backlog #15–#19)

6. **New-player protection** — from players **and** pirates; ends permanently at **2,500 points**.
7. **Naming consistency** — every screen/tooltip/report/doc uses current original names (colony not outpost, Colonizer, Mothership, etc.); no underscores; numbers with commas.
8. **Tooltips everywhere** — hover/tap ship/building/research/stat → function, cost, requirements; phones too.
9. **Pirate raid fairness** — players under **100,000** points only: each successful pirate raid on that player that day lowers pick chance by **1% of original** (additive, daily reset). Does **not** apply to aliens.
10. **World Eater speed −50%** — cruise speed halved vs current (`tuning.ts`).

#### PLANET ART (always last — backlog #20)

After all ADD/CHANGE items above. Spec unchanged (see below).

### Queue addendum — PLANET ART (last after Oct 14 queue)

60–75 distinct planet images: hot slots 1–5, habitable 6–10, cold 11–15 (track temperature mechanic). Mini planets: 30–40 varied. Deterministic seed `galaxy:system:slot`; no duplicates in-system or adjacent. Original art only; webp/lazy-load; overview + galaxy + lists; desktop+phone; quality gate; report merge-ready with preview screenshots.

### Mini planets (revised 2026-10-14 — PR #42 redesign)

**Spawn:** ~**1 per 5 systems** (not 1/80). Multiple minis allowed in the same system.

**Lifecycle / ownership**
- Rich output (well above similar-size normals). Drift/move over time; holder keeps it until lost.
- **Remove owner:** any ship/fleet that **wins a battle** there removes the current owner → leaves it **unoccupied**. That same fleet operation **cannot** also capture it.
- **Capture unoccupied:** only a **Colonizer**, as a **separate** fleet mission.
- **Capture occupied exception:** a fleet containing a **Void Titan, Mothership, or World Eater** that wins vs the owner **captures directly** (ownership transfer, no Colonizer).
- **Destroy:** **World Eater only**. Always a massive debris field (**metal/crystal only**, never deuterium). Destroyed minis have **no respawn timer** — they re-enter the discoverable pool immediately (expeditions can find them/new ones).

**Visibility:** discovered minis visible **only to the finder** at first; **8 hours after colonized** → visible to all in galaxy view.

**Buildings:** normal buildings allowed; 4 specials as extras if they fit.

**Super-rare (very low spawn)** — numbers in tuning module:
1. **Ironwater Rock** (original name OK) — deut **10×** best normal planet; normal buildings.
2. **Moving Fortress** — relocate by spending deuterium: target any system in the **current galaxy or ±1 galaxy** (at most one galaxy per jump). Accuracy **±10 systems** around the chosen system (e.g. pick 1:350 → land 1:340–1:360), clamped to systems **1–399**; slot = any free mini slot. Show landing window in move UI. Espionage returns nothing; owner gets **no** incoming-fleet warning; combat mods for fleets/defenses defending/attacking/orbiting: shields **×3**, plasma attack **×2**, armor **−75%**; **one per player** (document simplest second-MF rule). Range/accuracy/cost in tuning.
3. **Relic World** — +30% research speed empire-wide, +25% expedition finds; draws more pirate raids; **one per player**.

Revise open PR #42; quality gate again before merge list.
