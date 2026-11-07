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

## Events / seasonal boss

The seasonal pirate mothership is one marked `PirateBase` in `pirateBases`, tracked by optional universe fields `pirateBossBaseId`, `pirateBossActiveUntil`, and `pirateBossNextSpawnAt`. `tickPirates` spawns it at a bounded nearby open slot, expires it after seven days, and starts a seven-day cooldown after defeat or expiry. It reuses pirate combat, galaxy visibility, and loot reporting, with 10x Starshards and resources on defeat. Damage is stored on optional `PirateBase.bossDamage` and paid once via `bossRewardsPaid` (`world-pirate-boss.ts`): rank 1, then anyone at 10% or 1% of total damage, as Starshards plus resources on the home planet. Tuning lives in `packages/game/src/data/tuning.ts` (`PIRATE_BOSS_TIERS`). The player view adds optional `pirateBoss`. Pirate spawn sites are selected round-robin across all galaxies (`1..MAP_GALAXIES`) ranked by seed hash key, ensuring every galaxy has pirate bases and galaxy 1 always receives one. The Seasons page renders the command panel, the fleet-events strip renders a compact card (including the latest `bossDamage` report callout), and the galaxy page banners an active boss with a Raid boss button that reuses the pirate-raid prefill. Coverage is in `pirates.test.ts`, `pirate-boss.test.ts`, `render-seasons.test.ts`, `render-events.test.ts`, and `render-galaxy-page.test.ts`.

## Open questions

- Join requests do not expire.
- Officer cap does not limit who may approve a request. Approval is independent of `ALLIANCE_MAX_OFFICERS`.
- A pending request is kept when the alliance switches back to open. It is not auto-accepted. Approve still works. Switching to open still clears invites only.

## Messages

Messages in the inbox display category badges matching their filter bucket (`Combat`, `Spy`, `Alerts`) alongside the specific kind badge (`message-kind`), allowing players to identify message categories at a glance.

## Fleet tab

The Fleet tab shows the composer, hostile inbound fleets, sensor contacts, and a link to Messages. In-flight fleets are in the top fleet events banner; combat, spy, and expedition reports are in Messages.

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

## OAuth sign-in

Email + password signup, login, claim, logout, and `/api/auth/me` are unchanged. Google and Discord are optional and env-gated. If a provider's client id and secret are unset, its button is omitted and its routes return `404 { error: "provider not configured" }`. `GET /api/auth/providers` always includes `passwordAuth: true`.

| Route | Behavior |
| --- | --- |
| `GET /api/auth/providers` | `{ providers, passwordAuth: true }` |
| `GET /api/auth/oauth/:provider/start` | 302 to the provider (PKCE S256 + state) |
| `GET /api/auth/oauth/:provider/callback` | session cookie, 302 to `/` |
| `POST /api/auth/oauth/:provider/unlink` | session required; refuses the only sign-in method |
| `GET /api/auth/oauth/mock/authorize` | local mock only, when `OAUTH_MOCK=1` |

KV keys (10-minute TTL on state): `oauth:state:<hash>`, `oauth:link:<provider>:<subject>` → account id, `oauth:acct:<accountId>` → `[{ provider, subject, email, linkedAt }]`. Account rows are not given new fields.

Collision rule: a verified email that already belongs to an account is not auto-linked while signed out. The player must sign in with their password first, then start the provider again to attach it. A new email creates an account whose `passwordHash` is `oauth$none`. Existing `authenticateEmailPassword` rejects that marker (`verifyPassword` only accepts `pbkdf2$` and `scrypt$`), so the password form cannot be used on that account until a real password exists.

`OAUTH_MOCK=1` lists provider `mock` for tests. It is refused when `STARHOLD_RUNTIME=workers` unless `STARHOLD_E2E=1`. Do not set it in production.

Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`. Redirect URI: `https://starhold.stumpysgarage.workers.dev/api/auth/oauth/<provider>/callback`.


## Open questions

- `joinUniverse` already builds Ore Mine, Crystalizer, and Solar Array to level 1, so a live new commander starts at 3/8 and can claim those rewards immediately. The rules still treat level 0 as incomplete.
- Colony foundation is one planet with all three levels, not levels split across colonies.
- Recon is marked when an expedition resolves or a spy report is written, including a blank Moving Fortress scan. Dismiss does not clear claims.
- A full vault pays only what fits. The step is still claimed.

## Account security

Signed-in commanders open Security from the account menu (`/security`). Guests do not see that link. Email reset is not sent; recovery is one-time codes until a mail domain exists.

Optional save fields (older rows omit them and still load): `account.sessionEpoch` (missing = 0), `account.recoveryCodeHashes` (sha256 via `hashToken`, never plaintext), `session.epoch` (missing = 0). `getSession` rejects a session whose epoch is lower than the account epoch.

| Route | Body | Effect |
| --- | --- | --- |
| `GET /api/account/security` | session cookie | `{ email, hasPassword, recoveryCodesRemaining, createdAt, lastLoginAt }` |
| `POST /api/account/password` | `{ current, next }` | Verifies the current password, rehashes, bumps the epoch, re-issues this session. Wrong current password is 403. |
| `POST /api/account/sessions/revoke-others` | session cookie | Bumps the epoch and re-issues this session. Other devices are signed out. |
| `POST /api/account/recovery-codes` | `{ current }` | Returns 10 `XXXX-XXXX` codes once and stores only hashes. Regenerating replaces the old set. |
| `POST /api/auth/recover` | `{ email, code, next }` | Public. Consumes one code, sets the password, clears `needsPasswordReset`, bumps the epoch, and signs in. Unknown email and bad code share one error. |

Password change and recover are rate-limited. The join screen's Forgot password? link opens the recover form. It does not replace email + password signup or login.


