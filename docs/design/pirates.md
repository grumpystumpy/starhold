# Pirates + Aliens (Micah redesign 2026-10-14)

**Authoritative:** [vision.md — Pirates + Aliens redesign](../vision.md#pirates--aliens-redesign-2026-10-14) · [round2-contract.md](./round2-contract.md) §5–5b · [pirates-aliens-redesign.md](./pirates-aliens-redesign.md).

Supersedes Round 1 density/raid cadence, Round 2 cap-12 / full-catalog-including-titans, and open PR **#44**.

## Pirates (summary)

| Rule | Value |
|------|------:|
| Max level | **100** |
| Level-up | Every level grants defenses (more at higher levels) |
| 3h free spawn | Weak ships **and** defenses; defenses accumulate forever |
| Ships | All non-class / non-stationary except World Eater, Mothership, Void Titan |
| Raids | Once per hour, random time within the hour (`nextRaidAt`) |
| Density | **200** bases / universe; migrate tops up without wiping players |
| Split | Once at **exactly level 25** → +2 L1 nearby; `coalitionId` never raid each other |

## Aliens (summary)

| Rule | Value |
|------|------:|
| Initial | **Zero** (`ALIEN_INITIAL_BASE_COUNT = 0`) |
| Find | 0.001% per expedition; daily universe find seed |
| Settle | Nearest open **slot-1** to expedition origin |
| Buildup | 4h then same hourly random raid schedule |
| Split | Once at level **50** |
| Tech | Top player +1 per combat research |

## Performance (Hobby)

Lazy catch-up on read / player tick — one in-memory pass, one KV write. **No** hourly Vercel cron (Hobby is daily-only). See redesign note §5.

## Starshards (unchanged)

- Destroy: `40 + 5 × tier`
- Win defense vs NPC raid: `+10`
