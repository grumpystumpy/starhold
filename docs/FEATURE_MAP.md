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

The 30s `/api/state` poll sets `X-Starhold-State-Tick` to `skipped` or `advanced`. A skipped poll does not run `advanceUniverse`. It still refreshes mine output on that player's planets, and hostile fleets already in flight stay on the view. The poll advances when a build, yard, or research queue needs a start or completion, an officer hire has expired, a fleet that belongs to or targets the player has arrived or its swarm is ready to grow, a Joint Strike window should lock, an occupation involves the player or has ended, a mini planet is due to drift, one of the player's spy reports is past its TTL, the commander's season month has rolled, the universe seed is unfinished, the seasonal boss timer has fired, or a pirate or alien raid is due on a read that is allowed to run raids. A poll that advances saves the same universe a full tick would have saved.

Kick, leave, and disband detach that player's Joint Strike (ACS) fleets: outbound and holding both return home, `acsGroupId` clears, and the group cancels if it drops below `ACS_MIN_FLEETS_TO_RESOLVE`. Combat math is unchanged.

Tags render as `Name [TAG]` on galaxy rows and `[TAG] Name` on commander highscore rows.

## Highscores

Player ranks stay on `save_highscores` id `board`. Alliance ranks are a second row, id `alliances`, written in the same maintenance rebuild and the migration scores stage. A normal page load reads both rows in one `SELECT` and never scans alliances. A missing alliances row serves `[]`.

The */30 maintenance cron always fully rebuilds the commander board for every player on the server; page loads only read the cached board.

The highscore page has Commanders and Alliances tabs. The Alliances tab shows rank, `[TAG] name`, members, total points, and average points, top 100, sorted by total member points then tag. Each alliance contributes at most `ALLIANCE_MAX_MEMBERS` (16) members to that total.

Hall of Fame and Hall of Shame render on that same page (`data-testid="hall-of-fame"` and `data-testid="hall-of-shame"` in `apps/web/src/ui/render-pages.ts`). Fame lists the biggest fights by the value of ships and defenses destroyed (`combatHallOfFame` in `packages/game/src/combat-share.ts`), at most 20, and links the public battle report when the fight has a share code. Shame ranks commanders by lifetime ship value lost (`player.combatStats.lostValue` via `combatHallOfShame`), at most 20. Both lists live on the `save_highscores` id `board` row. The */30 maintenance rebuild in `apps/server/src/row-store.ts` passes `includeCombatLists` and rewrites both lists for every player on the server. A normal or NPC save does not load every report: it keeps other players' fame fights and refreshes shame from every loaded commander, so one write cannot blank the halls. The migration scores stage writes the same lists from the universe already in memory. A view with no cached board (`packages/game/src/world-view.ts`) builds the same two lists from the universe. `scripts/quality-gate-battle-reports.mjs` checks the copied card, the public report page, and both halls.

## Events / seasonal boss

The seasonal pirate mothership is one marked `PirateBase` in `pirateBases`, tracked by optional universe fields `pirateBossBaseId`, `pirateBossActiveUntil`, and `pirateBossNextSpawnAt`. `tickPirates` spawns it at a bounded nearby open slot, expires it after seven days, and starts a seven-day cooldown after defeat or expiry. It reuses pirate combat, galaxy visibility, and loot reporting, with 10x Starshards and resources on defeat. Damage is stored on optional `PirateBase.bossDamage` and paid once via `bossRewardsPaid` (`world-pirate-boss.ts`): rank 1, then anyone at 10% or 1% of total damage, as Starshards plus resources on the home planet. Tuning lives in `packages/game/src/data/tuning.ts` (`PIRATE_BOSS_TIERS`). The player view adds optional `pirateBoss`. Pirate spawn sites are selected round-robin across all galaxies (`1..MAP_GALAXIES`) ranked by seed hash key, ensuring every galaxy has pirate bases and galaxy 1 always receives one. The Seasons page renders the command panel, the fleet-events strip renders a compact card (including the latest `bossDamage` report callout), and the galaxy page banners an active boss with a Raid boss button that reuses the pirate-raid prefill. Coverage is in `pirates.test.ts`, `pirate-boss.test.ts`, `render-seasons.test.ts`, `render-events.test.ts`, and `render-galaxy-page.test.ts`.

Season clocks sit beside those month boards. `pirateBossSeasonSchedule` in `packages/game/src/world-seasons.ts` reads the open month and the existing boss fields. It returns view-only `bossSchedule` on the season board (`packages/game/src/types-view.ts`): phase active, cooldown, or due, the active-window end, and the next spawn. While a mothership is up, the next spawn is the window close plus the cooldown from `packages/game/src/data/tuning.ts` and is not written to `pirateBossNextSpawnAt`. `packages/game/src/world-pirate-boss.ts` copies the month hunt name onto the player view (`seasonId`, `flavorTitle`, `flavorLine`, `projectedSpawnAt`) and still pays `PIRATE_BOSS_TIERS` with the same amounts. `packages/game/src/world.ts` exports the schedule helpers. `apps/web/src/ui/render-seasons.ts` shows the window, the cooldown, and the next spawn beside the boards. `apps/web/src/ui/render-events.ts` and `apps/web/src/ui/render-fleets-panels.ts` repeat the month name and the window countdown. `apps/web/src/ui/styles-panels.css` stacks that column on a narrow screen. This note lives in `docs/FEATURE_MAP.md`. Older saves still omit `pirateBossBaseId`, `pirateBossActiveUntil`, and `pirateBossNextSpawnAt`.

Living non-boss pirate bases are capped at `PIRATE_BASES_PER_GALAXY` (75) in each galaxy. The universe total `PIRATE_TARGET_BASE_COUNT` in `packages/game/src/catalog.ts` is that tuning value times `MAP_GALAXIES`. The flat 200 constant is retired so this product is the only living-cap source. `cullExcessPirateBases` in `packages/game/src/world-pirates.ts` runs at the start of `tickPirates`, again after a boss spawn in that same tick, and from `ensurePiratePopulation`. It trims over-full galaxies first, then any remaining excess, until no galaxy has more than 75 living non-boss bases and the living total is at most the derived cap. Cull order inside a galaxy and for the leftover total is older `lastRaidAt`, then lower level, then a base whose next raid is still in the future, then id. The seasonal boss (`pirateBossBaseId` or `seasonalBoss`) stays. Removal clears the base through the existing destroy path and drops the record so that wreck cannot respawn. In-flight player fleets stay in `fleets` and resolve as a miss on arrival. The cull writes no combat report and no raid alert. Top-up, split, respawn, and expedition `newPirateBase` (`packages/game/src/world-expedition.ts`) add a base only while the living total is under the derived cap and the destination galaxy is under 75. Boss spawn can raise the living total by one inside the tick; the post-spawn cull then removes one ordinary base so the tick ends at the cap. Free ship and defense spawns add units on an existing base and leave the base count unchanged. A pirate or alien base in `packages/game/src/types-core.ts` may store optional `recentRaidTargets` (target id to last raid time). `pickRaidTarget` skips a planet or NPC target that the same base raided inside `PIRATE_SAME_TARGET_COOLDOWN_MS` (4 hours). The timestamp is written when that raid actually fires. Entries older than the window are dropped. Older saves omit the field and still load. The npc job raid budget in `packages/game/src/catalog.ts` follows that larger living cap. Raid-only slices consume it; page-load raid budgets stay as they are.

On the Workers `*/10` NPC job, when a tick budget is set, even ten-minute wall-clock slices grow pirate and alien bases and apply free spawns; odd slices catch up raids only. Each phase has its own resumable cursor (`aiCatchUpCursor` for grow, optional `aiRaidCatchUpCursor` for raids), so work in one phase cannot clear the other's backlog. Each slice visits at most `NPC_AI_BATCH_SIZE` (50) bases. Non-budgeted ticks keep the combined catch-up path. Population culling and boss upkeep stay active on both phases.

Ordinary pirate raid power keeps the existing detachment cap, then applies a level term. `pirateRaidPowerFactor` in `packages/game/src/world-pirates.ts` multiplies the factor passed into `scalePirateRaidFleet` by `(1 + PIRATE_RAID_LEVEL_POWER_BONUS * (level / PIRATE_MAX_LEVEL))`. `PIRATE_RAID_LEVEL_POWER_BONUS` is `0.5` in `packages/game/src/data/tuning.ts`. Level 0 keeps today's factor (`PIRATE_RAID_POWER_FACTOR` against NPCs, `PIRATE_RAID_POWER_FACTOR_PLAYER` against players). Level `PIRATE_MAX_LEVEL` is 1.5× that factor. Aliens do not use this bonus.

When a pirate raid's outcome is not `attacker_win` (a loss or a draw), the whole sent detachment is subtracted from `base.ships` and clamped at 0. Combat survivors of that detachment are not put back. On `attacker_win`, only destroyed sent hulls leave the hangar (sent minus survived). There is no 50% floor on the unsent hangar. Aliens keep the previous hangar scale. A flight-time pirate raid uses that same loss rule: the detachment is removed at launch, and a loss or draw deletes the fleet with no return leg.

`PIRATE_RAID_DISTANCE_REF` is `400` in `packages/game/src/data/tuning.ts`. Pirate player-planet picks multiply the existing relic, fairness, fatigue, deterrence, and cooldown weight by `1 / (1 + (d / PIRATE_RAID_DISTANCE_REF)^2)`. `d` is `coordDistance` from `packages/game/src/formulas-travel.ts` (`|Δgalaxy|*100 + |Δsystem|*10 + |Δslot|`). That distance term is never zero. Aliens keep the previous pick weights. `pirateRaidDistanceWeight` and `piratePlanetPickWeight` in `packages/game/src/world-pirates.ts` are that factor and the pre-deterrence product.

A pirate raid on a player planet launches an outbound `FleetMission` instead of resolving inside `fireRaid`. `ownerPlayerId` is `npc_pirates`, `mission` is `raid`, `phase` is `outbound`, and optional `originPirateBaseId` on `packages/game/src/types-core.ts` names the pirate base. There is no fake origin planet. The detachment (level factor and `PIRATE_STRENGTH_MULT`, boss hangar exempt) leaves the hangar at launch. `arrivesAt` is `departedAt + flightSecondsOneWay * 1000` with the pirate ships' speeds, `universe.fleetSpeed`, and zero combustion, fleet-speed tech, and class bonuses. The 4h same-target cooldown and `lastRaidAt` / `nextRaidAt` advance at dispatch. `packages/game/src/world-view.ts` already lists that outbound raid in `hostileInbound`. `apps/web/src/ui/render-events.ts` labels it Hostile incoming. No extra raid-alert message is written.

`packages/game/src/world-arrival.ts` resolves `ownerPlayerId === "npc_pirates"` in `resolveNpcPiratePlayerFleet` before the missing-origin delete. Page loads and the `*/10` npc job share that due-fleet path, so a fleet is fought once. Outbound arrival reuses the pirate planet combat report. A win starts a return leg; surviving ships and loot are added to the pirate base when that leg arrives. Any other outcome deletes the fleet and the sent ships stay gone. NPC-vs-NPC and alien raids stay instant. `STARHOLD_E2E=1` still skips NPC combat and does not launch these fleets. This note lives in `docs/FEATURE_MAP.md`.

`PIRATE_STRENGTH_MULT` is `0.5` in `packages/game/src/data/tuning.ts`. `scaleOrdinaryPirateShips` in `packages/game/src/world-pirates.ts` is the one place that applies it, to ordinary hangar templates (`pirateShipsForTier`) and free-spawn ship counts (`pirateFreeSpawnShips`). Raid detachments are taken from that hangar, so they inherit the cut. The seasonal boss hangar, built from the unscaled tier template plus `PIRATE_BOSS_MOTHERSHIPS`, does not use this multiplier. `PIRATE_BOSS_TIERS` payout amounts are unchanged. This note lives in `docs/FEATURE_MAP.md`.

## Open questions

- Join requests do not expire.
- Officer cap does not limit who may approve a request. Approval is independent of `ALLIANCE_MAX_OFFICERS`.
- A pending request is kept when the alliance switches back to open. It is not auto-accepted. Approve still works. Switching to open still clears invites only.

## Messages

Messages in the inbox display category badges matching their filter bucket (`Combat`, `Spy`, `Alerts`) alongside the specific kind badge (`message-kind`), allowing players to identify message categories at a glance. After combat resolves, each attacker (including a Joint Strike participant) and the defender receive that combat report, and no extra raid alert is written. A saved post-resolution `raidAlert` stays hidden, including from the unread badge, only when its matching combat report is visible. Unrelated alerts and pre-attack hostile-fleet warnings remain. The combat report, in the inbox details and the report subwindow, compares each side's ships before, survivors, and losses from that report's before/after counts, and shows loot and debris as separate figures. Attacker and defender viewpoints, Before/After tables, share links, and inbox filters stay. Copy share (`data-copy-battle-share` in `apps/web/src/ui/render-messages.ts`, handled in `apps/web/src/main-handlers-click.ts`) writes the plaintext card from `formatCombatShareCard` plus the public URL from `battleShareUrl` in `apps/web/src/ui/shared-report.ts`. The card names both sides' ship counts before and after. The public page shows the same before/after ship tables. The paths are `world-arrival-raid.ts` (planet, occupy, and moon fights), `world-pirates.ts` (pirate and alien raids), `world-view.ts` (who receives the report), `render-messages.ts` and `styles.css` (inbox and subwindow), and `render-shell.ts` with `patch-chrome.ts` (unread badge).

## Fleet tab

The Fleet tab shows the composer, hostile inbound fleets, sensor contacts, and a link to Messages. In-flight fleets are in the top fleet events banner; combat, spy, and expedition reports are in Messages.

A blocked build or fleet send shows the existing rejection next to that button (`blocked-reason` in `render-chrome-rows.ts`, `render-chrome-join.ts`, and `render-fleets-composer.ts`). Ship and defense counts update the resource reason as the number changes, and the note is removed when the action is allowed again. Server checks stay in place. This entry is in `FEATURE_MAP.md`.

Step 2 of the fleet composer ends with one review (`data-testid="fleet-send-review"`) before Send. It restates the mission, destination coordinates, target type, and target name, then separates flight duration from a clock time labeled with the timezone. Launch fuel is the full-cruise one-way cost. The speed control stays a preview and is not sent. Returning harvest, deploy-to-foreign, and spy missions show an estimated return. Station, transport, Moon Bridge, colonize, expedition, occupy, and combat missions do not promise a guaranteed return. Expedition has no separate hold; Joint Strike explains the 15-minute join window and 30-minute hold cap; occupation explains the two-day cap. Officers, class, and route bonuses are named as missing from the estimate. Changing ships, target, mission, speed, or the Joint Strike controls repaints the review. Ship counts, presets, and send-max are unchanged.

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

Overview shows `data-testid="onboarding-panel"` until the briefing is dismissed or every step is claimed. The Goals page shows `data-testid="onboarding-restore"` while it is dismissed with steps still unclaimed, and a compact claim list otherwise. Both are rendered by `render-onboarding.ts`.

A finished step that is not claimed yet says "Ready to claim", adds `data-testid="onboarding-claim-hint-<stepId>"` ("Already done. Claim the reward."), and the progress line counts those rewards (`data-testid="onboarding-progress"`). The step rule in `ONBOARDING_STEPS` stays the level check. `scripts/first-hour-audit.mjs` (`npm run e2e:gate:first-hour`, from `package.json`) walks a new commander through that panel, the starter claims, Goals, the extractor, Research Lab, Power Discipline, the Shipyard, a Recon Drone, a Spy Satellite, Galaxy, and the fleet review on a local production build. Larger follow-ups are listed in `docs/FIRST_HOUR_AUDIT.md` and are not implemented here.

The Overview hint from `render-helpers.ts` names the research and hulls a new commander can actually start: Power Discipline after the Research Lab, then a Recon Drone or Spy Satellite. The fleet composer's example line (`render-fleets-composer.ts`, `data-testid="fleet-orbit-hint"`) says "1 Recon Drone".

The same surfaces show one optional next step (`data-testid="next-goal"`) when a catalog gate is still open. It is computed on read by `nextGoalSuggestionFor` from owned buildings, research levels, and the gates already enforced by `previewResearchUpgrade`, `previewBuildingUpgrade`, and ship `researchReq` / `shipyardLevel`. It is not stored, pays nothing, and does not change `claimed`, `dismissed`, or `recon`. A save with no `player.onboarding` still receives a suggestion and still does not gain that field until a claim or dismiss. Queued work does not count until it finishes. In-flight fleets are not read or written.

Distance is the smallest unmet level on a gate. A gate the commander can start now (distance 0) wins. Ties break by the total missing levels, then research in `RESEARCH_ORDER`, then gated buildings (System Scanner, Moon Bridge, Manufacture Line, Land Reclamation, Nano Production), then hulls in `SHIP_ORDER` that declare `researchReq`. The line names the catalog step and why, and links to Buildings or Research. Moon-only gates are omitted when the commander has no moon. When nothing is gated, the element is omitted.

Dismissing the briefing hides the suggestion. Restore shows it again. When every tutorial step is claimed, Overview stays clear and the Goals page keeps the suggestion until Hide suggestion, which uses the same dismiss flag. Restore then reads Show next step.

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

## Mini-planet occupation

An occupy win on a mini planet already captures it: `ownerPlayerId` and `planetIds` move to the occupier. While that occupation is active, occupied means owned. The occupier can queue buildings, ships, and defenses there (field caps and mini-kind limits still apply), and mine income stays on the mini instead of the 30/70 split. A non-mini occupation is unchanged, including the yard blocks and the split. When the occupation ends, the capturer keeps the mini until a later capture or vacate. No new save fields.

## Test safety nets

Cross-version fixtures live in `apps/server/src/fixtures/`. `pre-row-save.json` is a schema-2 universe blob (the pre-row-save shape) with single-object build and research queues. `pre-onboarding-boss-save.json` is a schema-4 universe with no `player.onboarding` and no `pirateBoss*` fields. `pre-oauth-account.json` is an account row with email, peppered password hash, and `playerId` only — no `sessionEpoch`, `recoveryCodeHashes`, or OAuth fields. Both universes keep an unfinished `seedCursor` so normalize does not reseed the full map. `packages/game/src/cross-version-save.test.ts` loads each universe through `migrateOrResetUniverse`, asserts `didReset` is false, and checks resources, buildings, research, the in-flight fleet, and queues. One short tick must not throw. `apps/server/src/cross-version-account.test.ts` loads the same blobs through the KV universe reader and the account through `getAccountById` / `authenticateEmailPassword`.

To add a fixture for the next save shape: commit a sanitized JSON snapshot from before that migration (no live emails or raw passwords), keep `seedCursor` unfinished when the blob is not a full map, and extend the two tests so the new fields survive with `didReset === false`.

`npm run test:break` runs `scripts/deliberate-break-check.mjs`. It hardlink-copies the tree, then breaks only the copy: resource production, combat resolution, save normalize, password verify, and the occupied-planet queue guard. The script fails if any of those focused tests still pass. It does not edit the working tree. Full-tier runs it after unit tests.

`noImplicitOverride`, `noFallthroughCasesInSwitch`, and `noImplicitReturns` are on in `tsconfig.base.json`. `noUncheckedIndexedAccess` stays off: the fixes are not small and include `packages/game/src/world-mini.ts`. Lint also rejects `debugger`, `eval(`, `fit(`, `fdescribe(`, `xit` and `xdescribe` calls.


## Email password reset

Email reset is off until a provider is configured. Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and `EMAIL_FROM` (and `PUBLIC_URL` for the link origin). `GET /api/auth/providers` then returns `emailReset: true`, and the join screen shows "Email me a reset link" next to Forgot password? Recovery codes are unchanged.

`POST /api/auth/reset/request` always answers 200 with the same body, rate-limited per email and IP. The token is 32 random bytes, stored only as `hashToken` on optional `account.resetTokenHash` plus `resetTokenExpiresAt` (30 minutes), and indexed at `starhold:reset:<hash>` so confirm does not scan accounts. `POST /api/auth/reset/confirm` `{ token, newPassword }` is single-use, sets the password, bumps `sessionEpoch` (other devices are signed out), and clears the token. `EMAIL_MOCK=1` keeps the last message in memory (`GET /api/auth/reset/mock`) and is refused on Workers unless `STARHOLD_E2E=1`. The landing page is `/?reset=<token>`.

## Action recovery copy

A failed order re-checks state once. If that read times out or never returns a view, the flash is "Couldn't confirm. Check and tap again if needed." "Not applied — tap again." is only used when a view proves the order did not land. Account actions (join, login, signup, password, recovery codes) never show the overload "checking" line unless a state read follows. The galaxy jump field uses `inputmode="decimal"`.


## NPC player page (STARHOLD-D)

The */10 NPC cron still calls `withUniverse` with `{ npc: true }`. That pass, in `apps/server/src/row-store.ts`, no longer reads every `save_players` document in one shot. It pages with `SELECT id FROM save_players WHERE id > ? ORDER BY id ASC LIMIT ?`, then loads that page's player rows, the planets those players own, and the systems those planets sit in. A pirate raid whose target is on that page is launched there as an outbound fleet (`ownerPlayerId` `npc_pirates`, `target_owner_id` that player). The cron pass does not fight it. A later tick that loads the fleet — the owner's `/api/state` read, or maintenance — resolves it once through `resolveNpcPiratePlayerFleet` in `packages/game/src/world-pirates.ts`. A second tick does not fight that fleet again. Optional world field `npcPlayerPageCursor` (`packages/game/src/types-view.ts`) stores the last id of a full page. Older saves omit it. A short page clears it so the next run starts at the first id, and a cursor past the last id loads the first page in that same run. Maintenance and `work.full` still load every player.

## CPU bursts and pirate smoke retries

`npm run perf:cpu-burst` posts 10 `POST /api/build-ship` calls and 10 `POST /api/build-defense` calls back to back. On `wrangler dev --local` with `STARHOLD_CPU_PROFILE=1`, the warm run's `x-starhold-cpu-ms` max was 69 ms for both bursts, over the 10 ms free-plan limit. Build rules are unchanged. Numbers and the method are in `docs/cloudflare.md`. The UI smoke signs up a fresh commander, up to 5 times, when the home galaxy has no pirate. It logs `pirate-home-retries:N`, still requires the galaxy page to show `galaxy-pirate`, and fails with a different message when a pirate exists only outside those home galaxies or when no pirate base was found. State reads for that search stay within 5×399.

## Installable app

Starhold can be added to an iPhone or Android home screen. It is not a store app. `apps/web/public/manifest.webmanifest` is the identity (`id` `/`, standalone, theme `#0f1a24`) with 192 and 512 icons plus a maskable 512. Apple uses `/icons/apple-touch-icon.png`. The page pads `env(safe-area-inset-*)` and keeps form text at 16px on narrow screens so the keyboard does not zoom the layout.

The install note explains Share → Add to Home Screen on iPhone. Android shows Install app only after the browser fires `beforeinstallprompt`. Other browsers get written steps and no Install button. Dismiss stores `starhold-pwa-install-dismissed` and does not ask again. Standalone display, including iOS `navigator.standalone`, hides the note.

A shell service worker (`apps/web/public/sw.js`, served as `/sw.js`) caches only the public document, manifest, icons, and hashed `/assets/*.js|css` files, capped at 24 entries. `classifyRequest` is the allowlist: `/` and `/index.html` and `/manifest.webmanifest` are network-first, `/icons/*.png` and hashed `/assets/*.js|css` are cache-first, and everything else, including `/api` and auth, is bypass. The document is stored only under `/index.html` (`documentCacheUrl` strips the query string, so a player id in the URL is not a cache key). The manifest is stored only under `/manifest.webmanifest`. Those keys do not overwrite each other. An offline manifest miss returns the plain offline text and does not serve the cached HTML document. Responses that carry `Set-Cookie`, and every `/api` or auth request, are not stored. The worker does not reload the page. `apps/web/src/pwa.ts` registers `/sw.js` on the production hashed bundle and paints the update note from `apps/web/src/pwa-policy.ts`. `serviceWorkerUpdateReady` treats installed, activating, and activated as an update when this page already has a controller. `skipWaiting` lets the next shell take the active slot without calling `clients.claim` and without reloading the open page. The page marks that update when the active worker is no longer the controller. While the fleet screen is open the update control will not reload. Offline copy says the game is not playable and that orders are not queued. Coming back online does not replay them.

`scripts/pwa-smoke.mjs` checks a local production build. It requires manifest identity (`id` `/`, standalone, `start_url` `/`, `scope` `/`, theme `#0f1a24`, 192 and 512 icons), service worker registration, an offline navigation that loads the cached shell and a hashed script, a manifest miss that stays plain text, isolated document and manifest cache keys, and a `starhold-shell-v2` update that does not reload while the fleet screen is open. The signed-in commander id and name stay the same. Screenshots land in `docs/pwa/iphone.png`, `docs/pwa/android.png`, `docs/pwa/desktop.png`, `docs/pwa/offline-iphone.png`, `docs/pwa/offline-android.png`, and `docs/pwa/offline-desktop.png`. This script does not pass a physical install.

`docs/PWA_DEVICE_CHECKLIST.md` is the copy-ready iPhone Safari and Android Chrome install list. Physical installs stay UNVERIFIED until Micah or BrowserStack Live records standalone launch, the offline note text, and the home screen icon. Emulation and these screenshots do not count. The installable-app entries live in `docs/FEATURE_MAP.md`.

No save fields were added. `packages/game/src/fixtures/in-flight-fleet-save.json` is a main-branch universe with one deploy still in flight; `migrateOrResetUniverse` keeps that fleet.

## What's new

A dismissible popup (`data-testid="whats-new"`) shows once per commander when the shared release key is newer than the key they last dismissed. It is part of the existing shell, not a new page. The catalog is `RELEASE_NOTES` in `packages/game/src/release-notes.ts`, oldest first. The current key is the last id, `271`, covering that release: home-screen install, the fleet-send review, combat-report losses with loot and debris separated, the next locked building/research/ship hint, and the blocked-action reason beside the button.

Optional save field `player.whatsNewDismissedReleaseId` is written only by dismiss. Older saves omit it and still load. Reading the popup does not create the field. Dismiss stores the current key and leaves planets, resources, buildings, research, onboarding, and in-flight fleets in place.

`packages/game/src/fixtures/pre-whats-new-inflight.json` is a main-branch universe (created before this field existed) with one deploy still outbound. `migrateOrResetUniverse` keeps that fleet and leaves the field unset, so the popup is due. `packages/game/src/cross-version-save.test.ts` loads it.

| Action | Route | Who |
| --- | --- | --- |
| Dismiss | `POST /api/whats-new/dismiss` `{ playerId }` | owning session (401 without a cookie, 403 for another commander) |

Playwright e2e, smoke, and quality-gate scripts dismiss that dialog before they click the shell or measure layout. A signed-in page presses Got it. A page opened with `?commander=` or `?playerId=` has no session, so `POST /api/e2e/grant` `{ dismissWhatsNew: true }` (only when `STARHOLD_E2E=1`) writes the same field and the next state read removes the dialog. Players still see the popup until they dismiss it. The helper is `scripts/lib/dismiss-whats-new.mjs`.

The route is not called on a normal page load. `playerView` fills optional `whatsNew` (`releaseId`, `title`, `items`) or `null`. `apps/web/src/ui/render-shell.ts` paints the dialog inside `shellHtml` and `syncWhatsNewPopup` removes it when a patched shell's view is already dismissed. `apps/web/src/ui/render-app.ts` calls that sync on the patch path. The Got it button is handled in `apps/web/src/main-handlers-click.ts` via `apps/web/src/main-actions.ts` and `apps/web/src/main-actions-starshards.ts`, which post through `apps/web/src/api.ts`. The server route is in `apps/server/src/app.ts`. The player field lives on `packages/game/src/types-view.ts` and is copied through `packages/game/src/world-view.ts` and `packages/game/src/world.ts`. Dialog layout is in `apps/web/src/ui/styles-shell.css`. Test file lists that include the new suites are `packages/game/package.json` and `apps/server/package.json`. This entry is in `docs/FEATURE_MAP.md`.

## Credits and art pass

The Credits page is an account route, `/credits`, linked from the side nav (`data-testid="nav-credits"`) and from the join screen (`data-testid="join-credits"`). It is not a game-nav page. Guests can open it. Security stays signed-in only.

Plates are mapped in `apps/web/src/ui/assets.ts` (`BUILDING_ART`, `SHIP_ART`, `DEFENSE_ART`, `RESOURCE_ART`, `PLANET_ART`, `planetArtFor`, `UI_ART`, `RESEARCH_ART`, `BACKGROUND_ART`). Research rows use `RESEARCH_ART`. Ship, defense, building, and hangar thumbs use the existing img slots. The galaxy page uses the Kenney sky file as a full-bleed backdrop. The join screen uses the NASA photograph as a full-bleed backdrop. Galaxy slot discs stay on `/planet-art/`.

Every referenced file is listed in `docs/ART_CREDITS.md`. game-icons.net lines on the Credits page use the required CC BY 3.0 credit. Capital hulls, shield-style defenses, Jump Gate, Chrono Lathe, Mantle Loom, the deuterium chip, and officer portraits stay on the original plates. No save fields were added.


