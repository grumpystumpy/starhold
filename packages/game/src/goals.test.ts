import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GOALS } from "./catalog.js";
import {
  claimGoal,
  listGoals,
  noteGoalProgress,
  utcWeekKey,
} from "./world-goals.js";
import { createUniverse, joinUniverse } from "./world.js";
import { utcDayKey } from "./world-boosts.js";

describe("daily / weekly goals", () => {
  it("exposes tunable goal catalog", () => {
    assert.ok(GOALS.length >= 5);
    assert.ok(GOALS.every((g) => g.target > 0 && g.id));
  });

  it("tracks metrics and allows one claim per period", () => {
    const universe = createUniverse("Goals Drift", 8);
    const a = joinUniverse(universe, "GoalCmd", 200_000_000);
    const now = 200_000_100;

    noteGoalProgress(universe, a.player.id, "pirateWin", 3, now);
    const rows = listGoals(universe.players[a.player.id]!, now);
    const daily = rows.find((g) => g.id === "dailyPirateWins");
    assert.ok(daily);
    assert.equal(daily!.progress, 3);
    assert.equal(daily!.claimable, true);

    const before = universe.players[a.player.id]!.starshards ?? 0;
    const claimed = claimGoal(universe, a.player.id, "dailyPirateWins", now);
    assert.equal(claimed.ok, true);
    assert.ok((universe.players[a.player.id]!.starshards ?? 0) > before);

    const again = claimGoal(universe, a.player.id, "dailyPirateWins", now);
    assert.equal(again.ok, false);
  });

  it("rolls over daily progress on new UTC day", () => {
    const universe = createUniverse("Goals Rollover", 8);
    const a = joinUniverse(universe, "RollCmd", 200_001_000);
    const day1 = Date.parse("2026-10-14T12:00:00.000Z");
    noteGoalProgress(universe, a.player.id, "expedition", 5, day1);
    assert.equal(
      universe.players[a.player.id]!.goalsDaily?.periodKey,
      utcDayKey(day1),
    );
    const day2 = Date.parse("2026-10-15T01:00:00.000Z");
    const rows = listGoals(universe.players[a.player.id]!, day2);
    const daily = rows.find((g) => g.id === "dailyExpeditions");
    assert.equal(daily!.progress, 0);
    assert.equal(
      universe.players[a.player.id]!.goalsDaily?.periodKey,
      utcDayKey(day2),
    );
  });

  it("grants resource rewards to active planet", () => {
    const universe = createUniverse("Goals Res", 8);
    const a = joinUniverse(universe, "ResCmd", 200_002_000);
    const now = 200_002_100;
    noteGoalProgress(universe, a.player.id, "expedition", 5, now);
    const metalBefore = universe.planets[a.planet.id]!.resources.metal;
    const ok = claimGoal(universe, a.player.id, "dailyExpeditions", now);
    assert.equal(ok.ok, true);
    // Re-read from map — advanceUniverse may replace planet object identity.
    const metalAfter = universe.planets[a.planet.id]!.resources.metal;
    assert.ok(metalAfter >= metalBefore + 5000);
  });

  it("utcWeekKey is stable within a week", () => {
    const mon = Date.parse("2026-10-12T12:00:00.000Z"); // Mon
    const sun = Date.parse("2026-10-18T12:00:00.000Z"); // Sun
    assert.equal(utcWeekKey(mon), utcWeekKey(sun));
  });
});
