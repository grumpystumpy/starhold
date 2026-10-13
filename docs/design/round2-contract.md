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
| `voidforgeTitan` | **Void Titan** | Moon-killer flagship (3rd largest; Deathstar-class balance **reference only**) |

### UI / docs copy

Replace user-facing strings “Lunar Base”, “Sensor Phalanx”, “Jump Gate”, “Death Star”, and research/defense names above across client, API errors, design docs that still say Round 1 names. Mission/error strings that mention old names update in **F**.

---

## 4. Player levels & XP

### XP awards (v1.1 — Micah mix)

**Target mix** of a typical player's XP earnings (per ~100 XP): **combat 80% · pirates 8% · expeditions 8% · research 4% · buildings 0%**.  

See [vision.md](../vision.md) · [universe-contract.md](./universe-contract.md) · [process.md](../process.md)
