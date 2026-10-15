# Starshards, officers, and skills (thread D)

**Status:** implemented against [universe-contract.md](./universe-contract.md).  
**Currency:** **Starshards** only (no real-money purchases).

## Earn (sources)

| Source | Rule |
|--------|------|
| Daily login | `+15` once per UTC day (`POST /api/claim-daily`) |
| Expedition find | Rolls `70–74` (5%) → `+5–25` Starshards on arrival |
| Pirate base destroy | Live `pirateRaid` win → `grantPirateDestroyStarshards` (`40 + 5×tier`) |
| Pirate fleet kill | Live NPC pirate raid defense win → `grantPirateFleetKillStarshards` (`+10`) |
| Highscore top 3 | First time ranked ≤3 → `+50` once (on `playerView`) |

## Spend (sinks)

| Sink | Rule |
|------|------|
| Officers | Hire/renew 7d with Starshards (`POST /api/activate-officer`). Raise level (`POST /api/raise-officer`) |
| Skills | Buy the next level (`POST /api/unlock-skill`) |

## Levels

Skills and officers each train from level 1 to 10. Existing saves keep what they already own, at level 1. Level 1 effects match the old single unlock.

Cost to go from level L to L+1 is `baseCost * (L + 1)`. The first purchase (0 → 1) is still the catalog price (`25/40/60` for skills, `50/50/60/60/40/70` for officers). Hiring or renewing an officer always costs the catalog price and lasts 7 days. Raising a level does not extend duty. Officer levels stay after the hire expires. You must hire an officer once before raising them.

Multiplier effects (mines, research, fleet speed, defense, energy): `1 + (catalogBonus - 1) * level`. A +5% skill is +5% at level 1 and +50% at level 10.

Flat effects (fleet slots, espionage detail, and the extra queue slots from Yard Depth, Quartermaster, and Archivist): one step at level 1, then another step every 3 levels. Level 1 stays +1. Level 10 is +4. The queue hard cap still applies.

Effects from skills and from officers who are on duty stack by multiplying the multipliers and adding the flat steps.

## Officers

Quartermaster / Archivist / Navigator / Warden / Engineer / Spymaster — hire costs `50/50/60/60/40/70`. Effects apply while on duty, scaled by level.

## Skills

Three branches (economy / military / exploration). First-level costs `25/40/60` by depth. Effects stack multiplicatively with officers.

## API (single-segment for Vercel)

- `POST /api/claim-daily` `{ playerId }`
- `POST /api/activate-officer` `{ playerId, officerId }`
- `POST /api/raise-officer` `{ playerId, officerId }`
- `POST /api/unlock-skill` `{ playerId, skillId }` — buys the next skill level

`PlayerView` adds `officerCatalog`, `skillCatalog`, `dailyLoginAvailable`.

## UI

Stub Officers + Skills panels on the current dashboard (thread B may relocate into classic left nav). Starshards shown in the resource bar with daily claim.
