# Pirates AI (thread E)

NPC pirate bases on the `10×399` map. Contract: [universe-contract.md](./universe-contract.md) §5.6 / §6 Pirates.

## Behavior

| Rule | v1 |
|------|----|
| Density | ~1 base / `PIRATE_SYSTEMS_PER_BASE` (40) systems |
| Growth | Every `6h` → tier+1 (cap `8`); ships/resources scale with tier |
| NPC raids | Every `8–24h` at players (~70%) or other bases; detachment soft-capped vs weak empires |
| Player `pirateRaid` | Fleet mission targeting `pirateBaseId`; win → loot + Starshards + `destroyedAt` |
| Respawn | `12–36h` later in another empty system (deterministic from id + destroy time) |
| Colonize | Blocked on slots occupied by a living pirate base |

## Starshards

- Destroy: `40 + 5 × tier`
- Win defense vs pirate raid: `+10`

## Soft threat

Raid detachments use `scalePirateRaidFleet`: power ≤ `max(floor, defenderPower × 1.4)` so early empires take losses, not a wipe.
