import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import type { CombatReport } from "@starhold/game";
import {
  advancePlayingReplays,
  battleReplayPlaying,
  battleReplayRound,
  BATTLE_REPLAY_STEP_MS,
  combatBattleExtrasHtml,
  pauseBattleReplay,
  playBattleReplay,
  resetBattleReplayForTests,
  restartBattleReplay,
  setBattleReplayReducedMotionForTests,
  setBattleReplayRound,
  toggleBattleReplay,
} from "./render-fleets-panels";

function report(): CombatReport {
  return {
    id: "rpt_replay",
    at: 1,
    missionId: "m1",
    attackerPlayerId: "p1",
    defenderPlayerId: "p2",
    attackerName: "Alpha",
    defenderName: "Bravo",
    targetCoords: { galaxy: 1, system: 2, slot: 3 },
    attackerBefore: { scout: 3 },
    attackerAfter: { scout: 1 },
    defenderBefore: { interceptor: 2 },
    defenderAfter: { interceptor: 0 },
    defensesBefore: {},
    defensesAfter: {},
    loot: { metal: 0, crystal: 0, deuterium: 0 },
    debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
    outcome: "attacker_win",
    rounds: 3,
    summary: "Replay",
    shareCode: "sh_replay",
    roundLog: [
      {
        round: 1,
        attackerLosses: { ships: { scout: 1 } },
        defenderLosses: { ships: {} },
        debrisThisRound: { metal: 1, crystal: 0, deuterium: 0 },
        shieldsAbsorbed: { attacker: 5, defender: 9 },
      },
      {
        round: 2,
        attackerLosses: { ships: { scout: 1 } },
        defenderLosses: { ships: { interceptor: 1 } },
        debrisThisRound: { metal: 2, crystal: 1, deuterium: 0 },
      },
      {
        round: 3,
        attackerLosses: { ships: {} },
        defenderLosses: { ships: { interceptor: 1 } },
        debrisThisRound: { metal: 0, crystal: 0, deuterium: 0 },
      },
    ],
  } as CombatReport;
}

function visibleRound(html: string): string {
  const match = html.match(
    /<div class="battle-round is-active"[^>]*data-testid="battle-round-(\d+)"/,
  );
  return match?.[1] ?? "";
}

describe("animated battle replay", () => {
  beforeEach(() => {
    resetBattleReplayForTests();
  });

  it("uses one named playback interval", () => {
    assert.equal(BATTLE_REPLAY_STEP_MS, 800);
  });

  it("plays, pauses, and restarts without jumping a remount back to round 1", () => {
    const fight = report();
    const closed = combatBattleExtrasHtml(fight);
    assert.match(closed, /data-testid="battle-replay-play"/);
    assert.match(closed, /data-battle-replay-play="rpt_replay"/);
    assert.match(closed, /data-testid="battle-replay-pause"/);
    assert.match(closed, /data-testid="battle-replay-restart"/);
    assert.match(closed, /data-testid="battle-fire-1"/);
    assert.match(closed, /Shields absorbed: attacker 5, defender 9/);
    assert.match(closed, /Shields absorbed: attacker 0, defender 0/);
    assert.equal(visibleRound(closed), "1");

    toggleBattleReplay(fight.id, 1);
    playBattleReplay(fight.id);
    assert.equal(battleReplayPlaying(fight.id), true);
    assert.equal(advancePlayingReplays(), true);
    assert.equal(battleReplayRound(fight.id), 2);

    const playing = combatBattleExtrasHtml(fight);
    assert.equal(visibleRound(playing), "2");
    assert.match(playing, /data-playing="1"/);
    assert.match(playing, /data-testid="battle-details-rpt_replay" open/);

    const remount = combatBattleExtrasHtml(fight);
    assert.equal(visibleRound(remount), "2");
    assert.equal(battleReplayRound(fight.id), 2);

    pauseBattleReplay(fight.id);
    assert.equal(battleReplayPlaying(fight.id), false);
    assert.equal(advancePlayingReplays(), false);
    assert.equal(battleReplayRound(fight.id), 2);
    assert.equal(visibleRound(combatBattleExtrasHtml(fight)), "2");

    restartBattleReplay(fight.id);
    assert.equal(battleReplayRound(fight.id), 1);
    assert.equal(battleReplayPlaying(fight.id), false);
    assert.equal(visibleRound(combatBattleExtrasHtml(fight)), "1");
  });

  it("pauses when a round tab is selected", () => {
    const fight = report();
    combatBattleExtrasHtml(fight);
    toggleBattleReplay(fight.id, 1);
    playBattleReplay(fight.id);
    advancePlayingReplays();
    setBattleReplayRound(fight.id, 3);
    assert.equal(battleReplayPlaying(fight.id), false);
    assert.equal(advancePlayingReplays(), false);
    assert.equal(battleReplayRound(fight.id), 3);
    assert.equal(visibleRound(combatBattleExtrasHtml(fight)), "3");
  });

  it("does not autoplay when reduced motion is requested", () => {
    const fight = report();
    setBattleReplayReducedMotionForTests(true);
    const html = combatBattleExtrasHtml(fight);
    assert.match(html, /data-reduced-motion="1"/);
    assert.match(html, /data-testid="battle-replay-play"/);
    assert.match(html, /data-testid="battle-round-tab-2"/);
    assert.match(html, /data-testid="battle-replay-reduced"/);
    toggleBattleReplay(fight.id, 1);
    playBattleReplay(fight.id);
    assert.equal(battleReplayPlaying(fight.id), false);
    assert.equal(advancePlayingReplays(), false);
    assert.equal(battleReplayRound(fight.id), 1);
    assert.equal(visibleRound(combatBattleExtrasHtml(fight)), "1");
  });
});
