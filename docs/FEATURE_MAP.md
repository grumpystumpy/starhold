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

Messages in the inbox display category badges matching their filter bucket (`Combat`, `Spy`, `Alerts`) alongside the specific kind badge (`message-kind`), allowing players to identify message categories at a glance. After combat resolves, each attacker (including a Joint Strike participant) and the defender receive that combat report, and no extra raid alert is written. A saved post-resolution `raidAlert` stays hidden, including from the unread badge, only when its matching combat report is visible. Unrelated alerts and pre-attack hostile-fleet warnings remain. The combat report, in the inbox details and the report subwindow, compares each side's ships before, survivors, and losses from that report's before/after counts, and shows loot and debris as separate figures. Attacker and defender viewpoints, Before/After tables, share links, and inbox filters stay. The paths are `world-arrival-raid.ts` (planet, occupy, and moon fights), `world-pirates.ts` (pirate and alien raids), `world-view.ts` (who receives the report), `render-messages.ts` and `styles.css` (inbox and subwindow), and `render-shell.ts` with `patch-chrome.ts` (unread badge).

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

Overview shows `data-testid="onboarding-panel"` until the briefing is dismissed or every step is claimed. The Goals page shows `data-testid="onboarding-restore"` while it is dismissed with steps still unclaimed, and a compact claim list otherwise.

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


## CPU bursts and pirate smoke retries

`npm run perf:cpu-burst` posts 10 `POST /api/build-ship` calls and 10 `POST /api/build-defense` calls back to back. On `wrangler dev --local` with `STARHOLD_CPU_PROFILE=1`, the warm run's `x-starhold-cpu-ms` max was 69 ms for both bursts, over the 10 ms free-plan limit. Build rules are unchanged. Numbers and the method are in `docs/cloudflare.md`. The UI smoke signs up a fresh commander, up to 5 times, when the home galaxy has no pirate. It logs `pirate-home-retries:N`, still requires the galaxy page to show `galaxy-pirate`, and fails with a different message when a pirate exists only outside those home galaxies or when no pirate base was found. State reads for that search stay within 5×399.

## Installable app

Starhold can be added to an iPhone or Android home screen. It is not a store app. `apps/web/public/manifest.webmanifest` is the identity (`id` `/`, standalone, theme `#0f1a24`) with 192 and 512 icons plus a maskable 512. Apple uses `/icons/apple-touch-icon.png`. The page pads `env(safe-area-inset-*)` and keeps form text at 16px on narrow screens so the keyboard does not zoom the layout.

The install note explains Share → Add to Home Screen on iPhone. Android shows Install app only after the browser fires `beforeinstallprompt`. Other browsers get written steps and no Install button. Dismiss stores `starhold-pwa-install-dismissed` and does not ask again. Standalone display, including iOS `navigator.standalone`, hides the note.

A shell service worker (`/sw.js`) caches only the public document, manifest, icons, and hashed `/assets/*.js|css` files, capped at 24 entries. The document is stored only under `/index.html` (the query string is stripped, so a player id in the URL is not a cache key). The manifest is stored only under `/manifest.webmanifest`. Those keys do not overwrite each other. An offline manifest miss returns the plain offline text and does not serve the cached HTML document. Responses that carry `Set-Cookie`, and every `/api` or auth request, are not stored. The worker does not reload the page. While the fleet screen is open the update control will not reload. Offline copy says the game is not playable and that orders are not queued. Coming back online does not replay them.

No save fields were added. `packages/game/src/fixtures/in-flight-fleet-save.json` is a main-branch universe with one deploy still in flight; `migrateOrResetUniverse` keeps that fleet.

## What's new

A dismissible popup (`data-testid="whats-new"`) shows once per commander when the shared release key is newer than the key they last dismissed. It is part of the existing shell, not a new page. The catalog is `RELEASE_NOTES` in `packages/game/src/release-notes.ts`, oldest first. The current key is the last id, `271`, covering that release: home-screen install, the fleet-send review, combat-report losses with loot and debris separated, the next locked building/research/ship hint, and the blocked-action reason beside the button.

Optional save field `player.whatsNewDismissedReleaseId` is written only by dismiss. Older saves omit it and still load. Reading the popup does not create the field. Dismiss stores the current key and leaves planets, resources, buildings, research, onboarding, and in-flight fleets in place.

`packages/game/src/fixtures/pre-whats-new-inflight.json` is a main-branch universe (created before this field existed) with one deploy still outbound. `migrateOrResetUniverse` keeps that fleet and leaves the field unset, so the popup is due. `packages/game/src/cross-version-save.test.ts` loads it.

| Action | Route | Who |
| --- | --- | --- |
| Dismiss | `POST /api/whats-new/dismiss` `{ playerId }` | owning session (401 without a cookie, 403 for another commander) |

The route is not called on a normal page load. `playerView` fills optional `whatsNew` (`releaseId`, `title`, `items`) or `null`. `apps/web/src/ui/render-shell.ts` paints the dialog inside `shellHtml` and `syncWhatsNewPopup` removes it when a patched shell's view is already dismissed. `apps/web/src/ui/render-app.ts` calls that sync on the patch path. The Got it button is handled in `apps/web/src/main-handlers-click.ts` via `apps/web/src/main-actions.ts` and `apps/web/src/main-actions-starshards.ts`, which post through `apps/web/src/api.ts`. The server route is in `apps/server/src/app.ts`. The player field lives on `packages/game/src/types-view.ts` and is copied through `packages/game/src/world-view.ts` and `packages/game/src/world.ts`. Dialog layout is in `apps/web/src/ui/styles-shell.css`. Test file lists that include the new suites are `packages/game/package.json` and `apps/server/package.json`. This entry is in `docs/FEATURE_MAP.md`.


