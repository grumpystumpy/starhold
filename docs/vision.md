# Starhold vision (Micah)

**North star:** An OGame-like game that's fun for friends to play against each other.

## Product direction

Friends-only multiplayer. No real-money purchases. Premium in-game currency is earned in-game (expeditions, pirate kills, daily login, etc.).

**Live:** https://starhold-two.vercel.app (Vercel deploys `main`). Shared state: Upstash KV (`KV_REST_API_*`). Universe resets/migrations must be safe.

## Parallel workstreams (after design contract)

| ID | Area | Notes |
|----|------|--------|
| **A** | Universe and economy | Galaxy data model + position-based production. **Lands first** — others depend on it. |
| **B** | UI/UX overhaul | Classic OGame-style layout (see below). |
| **C** | Moons and moon buildings | Debris → moon chance; moon-only buildings. |
| **D** | Premium currency, officers, skills | Original currency name; officers + skill tree. |
| **E** | Pirates AI | NPC bases that grow, raid everyone, destroy-on-raid, respawn. |

Coordinator owns integration: shared design/schema contract first, merge in dependency order, rebase dependents, keep `main` green and deployed. CI on every PR. One agent playtest per **merged milestone**, not per PR.

## Requirements detail

### UI (B)

Organized, user-friendly, classic OGame-style:

- Left nav: Overview, Resources, Facilities, Research, Shipyard, Defense, Fleet, Galaxy, Officers, Skills, Highscore, Messages
- Top resource bar: amounts, production rates, storage
- Right: planet/moon switcher list
- Build queues with countdown timers
- Clear cost and requirement tooltips
- Responsive layout

### Officers (D)

Bought with premium in-game currency (like Dark Matter, **original name**). Each officer boosts a different aspect (e.g. mining, research speed, fleet slots/speed, defense, energy, espionage) for a duration or permanently. Currency earned only in-game (friends-only, no real money).

### Skills (D)

Skill tree purchased with the same currency; permanent perks across economy, military, and exploration.

### Moons (C)

Created from large debris fields after battles (OGame-style chance). Moon-only buildings (e.g. lunar base for fields, sensor phalanx, jump gate, plus originals).

### Galaxy (A + UI)

OGame-style map: galaxy:system navigation; planet table with player names, alliance, debris, moon, action buttons; asteroids + deep-space zone per system; asteroids mineable/harvestable via mission.

### Pirates (E)

NPC bases spawn randomly, grow slowly, raid players and each other. Successful player raid destroys the base; it eventually respawns elsewhere. Challenging but not run-ending for small players.

### Universe size (A)

- **10 galaxies × 399 systems**
- Each system: **15 planet slots** + **slot 16 = deep space**

### Planet fields (A)

- Smallest planets at slots **1 and 15** (min **250** fields)
- Largest at slot **8**; slots **7 and 9** slightly smaller
- Curve between those points; randomized within a band per slot

### Position production (A)

- Further from sun → more deuterium, less energy
- Closer to sun → more crystal, more energy
- Slot **8** neutral (**1.0×** across the board)
- Smooth multipliers per slot

## Order of execution

1. Design doc and schema contract (shared)
2. **A** (universe + economy)
3. **B–E in parallel**, merging as they finish (rebase on main as needed)

## Reporting

Milestones only: design doc ready (short summary), each merged area, blockers.
