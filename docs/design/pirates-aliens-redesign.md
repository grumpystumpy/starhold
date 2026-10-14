# Pirates + Aliens redesign — implementer handoff

**Status:** design only (no game code in the docs task).  
**Authoritative product copy:** [vision.md](../vision.md#pirates--aliens-redesign-2026-10-14)  
**Contract:** [round2-contract.md](./round2-contract.md) §5–5b  
**Supersedes:** Round 2 pirate cap-12 / full-catalog-including-titans, legacy density/raid cadence, and open PR **[#44](https://github.com/grumpystumpy/starhold/pull/44)** (do not merge #44; new implementation PR).

**Micah override (2026-10-14, replaces conflicting prior numbers):** pirate target **200** (not 500); raids **once per hour at a random time within that hour** (not every 30 min); aliens use the **same** raid schedule; universe starts with **zero** aliens (found only). Everything else from the redesign stands.

All numeric knobs go in `packages/game/src/data/tuning.ts`. Constant **names** below are fixed for implementers even before magnitudes are final.

---

## 1. Pirates — behavior

| Behavior | Spec |
|----------|------|
| Max level | **100** |
| Level-up | Every level grants **defenses**; higher levels grant **more** |
| 3h free spawn | Adds **weak ships** (existing idea) **and** **defenses**; defenses **never decay** / accumulate forever; amounts scale with level |
| Ships | Every ship players can field **except** the three biggest: **World Eater** (`worldEater`), **Mothership** (`swarmMothership`), **Void Titan** (`voidforgeTitan`). No class-exclusives / stationary. |
| Raids | **Once per hour**, at a **random time within that hour** |
| Targets | Players **and** other pirate bases; pirate-vs-pirate **slightly less often** than pirate-vs-player |
| Coalition | After a split, original + all descendants share `coalitionId`; **never** raid each other |
| Split | **Once**, at **exactly level 25**: original stays as-is; spawn **2** new **level-1** bases in **nearby** systems; set `splitDone` |
| Density | Target **200** bases across all galaxies |
| Migration | Top existing universe up to 200 **without wiping player data** (additive spawn into empty systems) |
| Destroy | Player `pirateRaid` still destroys; Starshards/respawn policy unchanged unless Micah retunes |

### Raid scheduling

```text
period      = PIRATE_RAID_PERIOD_MS          // 1 hour
periodStart = floor(now / period) * period
nextRaidAt  = periodStart + floor(rng * period)   // random within the hour
// after fire: advance to next periodStart, roll a new offset
vsPiratePeriod = period * PIRATE_VS_PIRATE_RAID_PERIOD_MULT
```

### Suggested formulas (placeholders — edit magnitudes in tuning only)

```text
freeShips(level)     = PIRATE_FREE_SHIP_BASE + PIRATE_FREE_SHIP_PER_LEVEL * level
freeDefenses(level)  = PIRATE_FREE_DEFENSE_BASE + PIRATE_FREE_DEFENSE_PER_LEVEL * level
levelUpDefenses(L)   = PIRATE_LEVEL_DEFENSE_BASE + PIRATE_LEVEL_DEFENSE_PER_LEVEL * L
```

Composition tables (which defense/ship ids, weights) live in tuning as `PIRATE_*_COMPOSITION` maps.

---

## 2. Aliens — behavior

| Behavior | Spec |
|----------|------|
| Initial density | **Zero** — `alienBases = {}` at universe create; migrators must **not** seed aliens |
| Visibility | **Hidden** until expedition find |
| Find chance | **0.001%** per expedition = `0.00001` |
| Daily roll | Universe daily find window/seed **resets each day** (UTC day key recommended) |
| Volume | More expedition runners → more independent rolls → more find chances |
| Settle | On find: claim **nearest open slot-1** planet relative to finder’s expedition **origin** coords |
| Buildup | **4 hours** after settle — no raids until `buildupEndsAt` |
| Growth path | Same as pirates (levels, accumulating defenses, 3h ship+defense spawn, coalitions) |
| Raids | **Same schedule as pirates:** once per hour, random time within the hour (after buildup) |
| Split | Once at **level 50** (not 25) |
| Strength | **Stronger** than pirates; **more** ships/defenses per spawn period (`ALIEN_STRENGTH_MULT` and/or higher bases) |
| Count | **Few** — hard cap `ALIEN_MAX_BASE_COUNT`; only via finds + splits |
| Tech | For each research (at least combat techs): `topPlayerLevel + ALIEN_TECH_ABOVE_TOP_PLAYER` (always **+1**) |
| Names | Original only — faction label **Aliens**; no OGame terms in UI |

Expedition outcome: add a rare `alienFind` (or equivalent) path gated by chance + daily seed + cap.

---

## 3. `tuning.ts` constant checklist

Implementers must add these exports (values match Micah override / contract defaults):

### Pirates

- `PIRATE_MAX_LEVEL` (= `100`)
- `PIRATE_LEVEL_GROWTH_INTERVAL_MS`
- `PIRATE_TARGET_BASE_COUNT` (= `200`)
- `PIRATE_RAID_PERIOD_MS` (= `60 * 60 * 1000`) — **not** a fixed 30 min interval
- `PIRATE_VS_PIRATE_RAID_PERIOD_MULT` (or stretched period ms)
- `PIRATE_FREE_SPAWN_INTERVAL_MS`
- `PIRATE_FREE_SHIP_BASE`, `PIRATE_FREE_SHIP_PER_LEVEL`, `PIRATE_FREE_SHIP_COMPOSITION`
- `PIRATE_FREE_DEFENSE_BASE`, `PIRATE_FREE_DEFENSE_PER_LEVEL`, `PIRATE_FREE_DEFENSE_COMPOSITION`
- `PIRATE_LEVEL_DEFENSE_BASE`, `PIRATE_LEVEL_DEFENSE_PER_LEVEL`, `PIRATE_LEVEL_DEFENSE_COMPOSITION`
- `PIRATE_SPLIT_LEVEL`, `PIRATE_SPLIT_CHILD_COUNT`, `PIRATE_SPLIT_CHILD_LEVEL`, `PIRATE_SPLIT_NEARBY_SYSTEM_RADIUS`
- `PIRATE_EXCLUDED_SHIP_IDS`

### Aliens

- `ALIEN_INITIAL_BASE_COUNT` (= `0`)
- `ALIEN_EXPEDITION_FIND_CHANCE`
- `ALIEN_SETTLE_SLOT`
- `ALIEN_BUILDUP_MS`
- `ALIEN_MAX_LEVEL`
- `ALIEN_SPLIT_LEVEL`, `ALIEN_SPLIT_CHILD_COUNT`, `ALIEN_SPLIT_CHILD_LEVEL`, `ALIEN_SPLIT_NEARBY_SYSTEM_RADIUS`
- `ALIEN_RAID_PERIOD_MS` (= same as `PIRATE_RAID_PERIOD_MS`)
- `ALIEN_VS_ALIEN_RAID_PERIOD_MULT`
- `ALIEN_FREE_SPAWN_INTERVAL_MS`
- `ALIEN_STRENGTH_MULT`
- `ALIEN_FREE_SHIP_BASE`, `ALIEN_FREE_SHIP_PER_LEVEL` (+ composition)
- `ALIEN_FREE_DEFENSE_BASE`, `ALIEN_FREE_DEFENSE_PER_LEVEL` (+ composition)
- `ALIEN_LEVEL_DEFENSE_BASE`, `ALIEN_LEVEL_DEFENSE_PER_LEVEL` (+ composition)
- `ALIEN_MAX_BASE_COUNT`
- `ALIEN_TECH_ABOVE_TOP_PLAYER`
- `ALIEN_EXCLUDED_SHIP_IDS` (may alias pirate exclusions)

Relic bias constant `MINI_RELIC_PIRATE_WEIGHT` stays owned by mini-planets; aliens may get a separate weight later if Micah asks.

---

## 4. Schema / migration notes

1. Raise or extend universe migrator (additive): `defenses` / `nextRaidAt` on pirate bases, `coalitionId`, `splitDone`, `alienBases: {}`, daily find seed fields.
2. `PIRATE_TARGET_BASE_COUNT` (= 200) top-up: spawn missing pirate bases into empty systems only; **never** reset players/planets.
3. **Do not** seed or top up aliens — `ALIEN_INITIAL_BASE_COUNT = 0`.
4. Cap legacy `level`/`tier` growth at 100 going forward; existing bases above old cap 12 continue growing under new rules.
5. Strip any hangar entries for excluded ship ids on migrate.
6. Galaxy UI: pirate **Lv**; aliens hidden until found (then show as Aliens faction row — original copy).

---

## 5. Performance — Hobby free-tier call

**Facts**

- Live stack: Vercel Hobby + one Upstash/KV **universe JSON document** (`STARHOLD_UNIVERSE_KEY`).
- No `crons` in current `vercel.json`.
- Vercel **Hobby cron is daily-only** (not every hour).
- Upstash free tier is command-budget limited; full-document GET+SET per tick is expensive at scale.
- Naïve math: 200 bases × 24 raids/day ≈ 4.8k raid events/day — still disastrous if each is a separate KV RMW.

**Flags**

| Option | Exceeds Hobby / free tier? |
|--------|----------------------------|
| Vercel cron every hour | **Yes / unavailable** on Hobby (schedule floor is daily) |
| Per-base writes or per-raid KV updates | **Yes** — command + latency blowup |
| Lazy catch-up on read + single coalesced write | **No** (fits free tier if AI work stays inside existing request `maxDuration`) |
| Optional **daily** cron for day-key reset + pirate top-up | **Usually OK** (1–2 RMW/day) |
| Upstash QStash / paid cron for hourly | Avoid on free-only policy |

### Recommendation (clear)

**Use lazy / batched AI simulation on universe read or player-driven tick** (galaxy view, fleet resolve, auth state load — wherever universe is already loaded). Catch up all due level-ups, 3h spawns, and hourly `nextRaidAt` firings for elapsed wall-clock in **one in-memory pass**, then **one** write-back.

Do **not** implement hourly Vercel crons on Hobby. Do **not** schedule per-base jobs. Optional daily cron only for alien daily seed reset + pirate count top-up if lazy paths miss those.

If a single request cannot finish catch-up within `maxDuration` (30s), process a **bounded batch** of AI bases per request and store `aiCatchUpCursor` / `lastAiSimAt` on the universe — still no high-frequency cron.

---

## 6. Test / quality gate hints (for implementer PR)

- Unit: level cap 100; defenses accumulate across N free spawns; excluded ships never enter hangar; split only at 25 (pirates) / 50 (aliens); coalition targeting filter; migrate top-up to **200** pirates without wiping players; **zero** aliens on fresh/migrated universe until find.
- Raid: `nextRaidAt` falls within each hour window; at most one raid per period per base (catch-up may fire multiple elapsed hours).
- Alien: find chance constant; settle nearest open slot-1; buildup blocks raids; same hourly random schedule after buildup; tech = top+1.
- Perf smoke: simulate 200 bases × multi-hour catch-up in one tick under timeout budget.
- E2E: galaxy pirate Lv; no alien row until find fixture; destroy still works.
- Do **not** merge until Micah approval; supersedes #44.

---

## 7. Doc / PR sync

Store paths (source of truth for this task):

- `docs/vision.md`
- `docs/design/round2-contract.md` §5–5b
- `docs/design/universe-contract.md` (pirates table pointer)
- `internal/pirates-aliens-redesign.md` (this file)

Repo sync: prefer a small docs-only PR mirroring vision + round2 §5–5b; if absent, implementer copies from this store before coding.
