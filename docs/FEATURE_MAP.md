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

## Messages

Messages in the inbox display category badges matching their filter bucket (`Combat`, `Spy`, `Alerts`) alongside the specific kind badge (`message-kind`), allowing players to identify message categories at a glance.
