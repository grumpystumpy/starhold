# Feature map — alliances and highscores

This file covers the alliance and highscore surfaces touched by B7-31. The rest of the game map lives in `AGENTS.md` and `docs/`. A full-game feature map was not in the repo; this section was added rather than invented.

## Alliances

Records live on the universe document (`alliances`). Membership is `player.allianceId`. Role id stays `founder`; the UI label is Leader. Join modes: `open` (anyone joins), `invite` (invited only), `request` (one pending ask, Leader or Officer approves). New alliances still default to `open`.

Optional save fields (no schema bump, no migration): `alliance.pendingRequests[]` `{ playerId, requestedAt }` capped at 20, and `player.pendingAllianceId` (one outstanding request). Older saves omit both and still load.

| Action | Route | Who |
| --- | --- | --- |
| Create | `POST /api/alliance/create` | any unaffiliated player (`joinMode` open, invite, or request) |
| Join or request | `POST /api/alliance/join` | open/invite joins; request mode stores a pending request |
| Approve | `POST /api/alliance/request/approve` | Leader or Officer |
| Reject | `POST /api/alliance/request/reject` | Leader or Officer |
| Cancel | `POST /api/alliance/request/cancel` | the requester |
| Leave / kick / role / join mode / class / disband | existing `/api/alliance/*` routes | unchanged permissions |
| Chat | `GET /api/alliance/chat?since=<ts>` and `POST /api/alliance/chat` | members, session cookie |

Leader can promote and demote Officers and kick anyone except themselves. Officers can invite, approve or reject requests, and kick Members. Officers cannot change join mode or disband. A Leader who leaves hands the role to the oldest Officer (earliest `joinedAt`, then `playerId`), else the oldest Member, else the alliance disbands.

Chat stores 200 messages and returns at most 50. The client polls `GET /api/alliance/chat?since=` only while the Alliances page is open, after the existing 30s `/api/state` poll.

Kick, leave, and disband detach that player's Joint Strike (ACS) fleets: outbound and holding both return home, `acsGroupId` clears, and the group cancels if it drops below `ACS_MIN_FLEETS_TO_RESOLVE`. Combat math is unchanged.

Tags render as `Name [TAG]` on galaxy rows and `[TAG] Name` on commander highscore rows.

## Highscores

Player ranks stay on `save_highscores` id `board`. Alliance ranks are a second row, id `alliances`, written in the same maintenance rebuild and the migration scores stage. A normal page load reads both rows in one `SELECT` and never scans alliances. A missing alliances row serves `[]`.

The */30 maintenance cron always fully rebuilds the commander board for every player on the server; page loads only read the cached board.

The highscore page has Commanders and Alliances tabs. The Alliances tab shows rank, `[TAG] name`, members, total points, and average points, top 100, sorted by total member points then tag. Each alliance contributes at most `ALLIANCE_MAX_MEMBERS` (16) members to that total.

## Open questions

- Join requests do not expire.
- Officer cap does not limit who may approve a request. Approval is independent of `ALLIANCE_MAX_OFFICERS`.
- A pending request is kept when the alliance switches back to open. It is not auto-accepted. Approve still works. Switching to open still clears invites only.

## Onboarding & Fleet Presets

`player.onboarding` is optional (`claimed`, `dismissed`, `recon`). Older saves omit it and still load. `onboardingViewFor` does not write the field. Claiming or dismissing creates it.

Steps, in order, live in `ONBOARDING_STEPS` (`packages/game/src/data/tuning.ts`):

| Id | Done when | Reward |
| --- | --- | --- |
| `metalMine1` | Ore Mine ≥ 1 on any owned world | 600 metal, 250 crystal |
| `solarPlant1` | Solar Array ≥ 1 | 700 metal, 300 crystal |
| `crystalMine1` | Crystalizer ≥ 1 | 800 metal, 400 crystal |
| `deutSynth1` | Deuterium Extractor ≥ 1 | 900 metal, 500 crystal, 250 deuterium |
| `researchLab1` | Research Lab ≥ 1 and any research ≥ 1 | 1,200 metal, 800 crystal, 300 deuterium, 15 Starshards |
| `shipyardScout1` | Shipyard ≥ 1 and at least one ship in orbit or in a fleet | 1,500 metal, 1,000 crystal, 400 deuterium, 15 Starshards |
| `firstReconOrExpedition` | `onboarding.recon`, a Spy Satellite, expedition goal progress, or a spy/expedition report | 2,000 metal, 1,200 crystal, 600 deuterium, 20 Starshards |
| `colonyFoundation` | One world has Ore Mine ≥ 4, Crystalizer ≥ 3, and Solar Array ≥ 3 | 3,000 metal, 2,000 crystal, 1,000 deuterium, 50 Starshards |

Any completed step can be claimed in any order. A second claim is rejected. Cargo is clamped to free storage on the active world and the step still counts as claimed.

| Action | Route |
| --- | --- |
| Claim | `POST /api/onboarding/claim` `{ playerId, stepId }` |
| Dismiss or restore | `POST /api/onboarding/dismiss` `{ playerId, dismissed }` |

Both routes use the shop session ownership check (401 without a cookie, 403 for another commander) and return the updated player view. They are not called on a normal page load.

Overview shows `data-testid="onboarding-panel"` until the briefing is dismissed or every step is claimed. The Goals page shows `data-testid="onboarding-restore"` while it is dismissed with steps still unclaimed, and a compact claim list otherwise.

Fleet composer hides built-in `moonDestruction` and `miniPlanetDestruction` until the player owns that hull or meets its research and shipyard level. `expedition`, `raid`, `miniPlanetCapture`, and custom presets stay visible. The presets remain on the save, and the galaxy preset buttons are unchanged.

## Open questions

- `joinUniverse` already builds Ore Mine, Crystalizer, and Solar Array to level 1, so a live new commander starts at 3/8 and can claim those rewards immediately. The rules still treat level 0 as incomplete.
- Colony foundation is one planet with all three levels, not levels split across colonies.
- Recon is marked when an expedition resolves or a spy report is written, including a blank Moving Fortress scan. Dismiss does not clear claims.
- A full vault pays only what fits. The step is still claimed.

