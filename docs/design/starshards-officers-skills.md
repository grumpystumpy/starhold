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
| Officers | Hire/renew 7d with Starshards (`POST /api/activate-officer`) |
| Skills | Permanent unlock (`POST /api/unlock-skill`) |

## Officers

Quartermaster / Archivist / Navigator / Warden / Engineer / Spymaster — costs `50/50/60/60/40/70`. Effects applied while active (mine, research, fleet, defense, energy, espionage).

## Skills

Three branches (economy / military / exploration), 12 nodes, costs `25/40/60` by depth. Effects stack multiplicatively with officers.

## API (single-segment for Vercel)

- `POST /api/claim-daily` `{ playerId }`
- `POST /api/activate-officer` `{ playerId, officerId }`
- `POST /api/unlock-skill` `{ playerId, skillId }`

`PlayerView` adds `officerCatalog`, `skillCatalog`, `dailyLoginAvailable`.

## UI

Stub Officers + Skills panels on the current dashboard (thread B may relocate into classic left nav). Starshards shown in the resource bar with daily claim.
