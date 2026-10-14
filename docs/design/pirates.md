# Pirates AI (Round 1 E + Round 2 L upgrade)

NPC pirate bases on the `10×399` map. Contracts: [universe-contract.md](./universe-contract.md) §5.6 / §6 · [round2-contract.md](./round2-contract.md) §5 · Round 3: no class hulls.

## Behavior

| Rule | v1 |
|------|----|
| Density | ~1 base / `PIRATE_SYSTEMS_PER_BASE` (40) systems |
| Growth | Every `6h` → level+1 (cap **12**); `tier` ≡ `level`; hangar raised to unlock table; resources scale |
| Free ships | Every **3h**: weak Scout + Interceptor; count = `10 + 5 × level` (never Void Titan free-spawn) |
| Pirate techs | `weapons` / `armour` / `shielding` = `min(2, floor(level / 4))` — very low vs players |
| Ship catalog | Every non-class, non-stationary `ShipId` players can field, unlocked by level |
| NPC raids | Every `8–24h` at players (~70%) or other bases; Relic Worlds (`flags.miniKind === "relic"`) get `MINI_RELIC_PIRATE_WEIGHT` (4×) among planet picks; detachment soft-capped vs weak empires |
| Player `pirateRaid` | Fleet mission targeting `pirateBaseId`; win → loot + Starshards + `destroyedAt` |
| Respawn | `12–36h` later in another empty system (deterministic from id + destroy time) |
| Colonize | Blocked on slots occupied by a living pirate base |

## Unlock table (hangar)

| Levels | Types |
|--------|--------|
| 0–2 | Light: Scout, Interceptor, Hauler, Whisper Probe |
| 3–5 | + Aegis Cruiser, Breach Bomber, Keel Sovereign, Rake Corsair |
| 6–8 | + Salvage Trawler, Outpost Cradle, Anvil Dread, Wardbreaker |
| 9+ | Tiny swarm line + World Eater (11+); Void Titan only at level **12** hangar (not free-spawn) |

Excluded: class-exclusive hulls, stationary hulls (`helioBuoy`, Vein Anchor, Grid Stake).

## Starshards

- Destroy: `40 + 5 × tier`
- Win defense vs pirate raid: `+10`

## Soft threat

Raid detachments use `scalePirateRaidFleet`: power ≤ `max(floor, defenderPower × 1.4)` so early empires take losses, not a wipe. Combat uses pirate techs as attacker/defender research.
