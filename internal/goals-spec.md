# Daily / weekly goals

## Source gap

`docs/vision.md` on `main` has no 2026-10-14 feature queue and no item #11. The coordinator store (`docs/vision.md`, `internal/backlog-queue.md`, `internal/backlog-micah-add-change-2026-10-14.md`) was not mounted. This file records the spec used for implementation, taken from the worker request and existing Starhold patterns (daily login, expeditions, pirate fights, `tuning.ts`).

Alliance chat is out of scope.

## Player promise

Each commander has a short list of **daily** and **weekly** goals. Finishing one pays **Starshards** or **resources** (metal, crystal, deuterium). Names stay original: Starshards, expeditions, pirate fights. No OGame labels, and no underscores in UI text. Displayed counts use thousands separators.

Examples shipped:

| Cadence | Goal | Target | Reward |
|---------|------|--------|--------|
| Daily | Pirate victories | 3 | 25 Starshards |
| Daily | Expedition runs | 5 | 2,000 metal, 1,000 crystal, 500 deuterium |
| Weekly | Weekly pirate victories | 12 | 100 Starshards |
| Weekly | Weekly expedition runs | 20 | 12,000 metal, 6,000 crystal, 3,000 deuterium |

All of those numbers live in `packages/game/src/data/tuning.ts`.

## What counts

- **Pirate victory:** the player destroys a pirate base on a `pirateRaid`, or the colony holds (`defender_win`) when pirates raid it. Losses and draws do not count. An expedition ambush is not a pirate fight.
- **Expedition run:** the outbound expedition arrival resolves, including an empty find. The return trip does not count again.

## Periods

- Daily key: UTC `YYYY-MM-DD` (same clock as daily login).
- Weekly key: ISO week in UTC, Monday start, `YYYY-Www`.

## Free-tier lazy catch-up / minimal KV

No new Redis keys and no cron. Counters live on `player.goals` inside the existing universe document.

The next read or fleet tick rolls a stale period forward and clears only that cadence’s progress and claims. Fleets that resolve during that tick (including ones that arrived while the player was offline) credit the **period open at catch-up time**, so a returning player can still finish and claim. Closed periods are not stored. Unclaimed rewards from a rolled period are dropped.

Resource rewards land on the active planet and must fit in storage. A full vault refuses the claim so the reward is not silently clipped. Starshards have no storage cap.

Each goal can be claimed once per its current period.
