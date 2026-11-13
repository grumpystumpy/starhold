import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLAYER_ACTIVITY_STAMP_MS,
  PLAYER_INACTIVE_MS,
  PLAYER_LONG_INACTIVE_MS,
} from "./data/tuning.js";
import {
  activityStampDue,
  createUniverse,
  galaxyViewFor,
  inactivityMark,
  joinUniverse,
  stampPlayerActivity,
} from "./world.js";
import { createMiniPlanet } from "./world-mini.js";

const DAY = 24 * 60 * 60 * 1000;

describe("galaxy inactivity marks", () => {
  it("uses 7 days, 28 days, and a one-hour stamp", () => {
    assert.equal(PLAYER_INACTIVE_MS, 7 * DAY);
    assert.equal(PLAYER_LONG_INACTIVE_MS, 28 * DAY);
    assert.equal(PLAYER_ACTIVITY_STAMP_MS, 60 * 60 * 1000);
  });

  it("leaves unknown, recent, and future activity unmarked", () => {
    const now = 1_700_000_000_000;
    assert.equal(inactivityMark(undefined, now), null);
    assert.equal(activityStampDue(undefined, Number.NaN), false);
    assert.equal(stampPlayerActivity({}, Number.NaN), false);
    assert.equal(inactivityMark(0, now), null);
    assert.equal(inactivityMark(Number.NaN, now), null);
    assert.equal(inactivityMark(-1, now), null);
    assert.equal(inactivityMark(now + DAY, now), null);
    assert.equal(inactivityMark(now - PLAYER_INACTIVE_MS + 1, now), null);
    assert.equal(inactivityMark(now - DAY, now), null);
  });

  it("marks i at 7 days and I at 28 days", () => {
    const now = 1_700_000_000_000;
    assert.equal(inactivityMark(now - PLAYER_INACTIVE_MS, now), "i");
    assert.equal(inactivityMark(now - PLAYER_LONG_INACTIVE_MS + 1, now), "i");
    assert.equal(inactivityMark(now - PLAYER_LONG_INACTIVE_MS, now), "I");
    assert.equal(inactivityMark(now - 40 * DAY, now), "I");
  });

  it("writes lastActiveAt at most once per hour", () => {
    const player: { lastActiveAt?: number; name: string } = { name: "Hold" };
    const now = 1_700_000_000_000;
    assert.equal(activityStampDue(undefined, now), true);
    assert.equal(stampPlayerActivity(player, now), true);
    assert.equal(player.lastActiveAt, now);
    assert.equal(player.name, "Hold");
    assert.equal(activityStampDue(player.lastActiveAt, now + PLAYER_ACTIVITY_STAMP_MS - 1), false);
    assert.equal(stampPlayerActivity(player, now + PLAYER_ACTIVITY_STAMP_MS - 1), false);
    assert.equal(player.lastActiveAt, now);
    assert.equal(stampPlayerActivity(player, now + PLAYER_ACTIVITY_STAMP_MS), true);
    assert.equal(player.lastActiveAt, now + PLAYER_ACTIVITY_STAMP_MS);
    assert.equal(activityStampDue(now + DAY, now), false);
  });

  it("puts i and I on galaxy slots and minis from lastActiveAt only", () => {
    const now = 1_800_000_000_000;
    const universe = createUniverse("Inactive Galaxy", 8);
    const viewer = joinUniverse(universe, "Viewer", now);
    const quiet = joinUniverse(universe, "Quiet", now + 1);
    const recent = joinUniverse(universe, "Recent", now + 2);
    viewer.player.lastActiveAt = now;
    quiet.player.lastActiveAt = now - PLAYER_INACTIVE_MS;
    recent.player.lastActiveAt = now - DAY;
    const home = universe.planets[quiet.planet.id]!;
    const galaxy = galaxyViewFor(
      universe,
      viewer.player.id,
      home.coords.galaxy,
      home.coords.system,
      now,
    );
    const quietRow = galaxy.slots.find((slot) => slot.planetId === quiet.planet.id);
    const recentRow = galaxy.slots.find((slot) => slot.planetId === recent.planet.id);
    const empty = galaxy.slots.find((slot) => slot.planetId == null);
    assert.ok(quietRow);
    assert.ok(recentRow);
    assert.ok(empty);
    assert.equal(quietRow.inactivity, "i");
    assert.equal(recentRow.inactivity, undefined);
    assert.equal(empty.inactivity, undefined);
    assert.equal(quietRow.playerName, "Quiet");

    quiet.player.lastActiveAt = now - PLAYER_LONG_INACTIVE_MS;
    const longer = galaxyViewFor(
      universe,
      viewer.player.id,
      home.coords.galaxy,
      home.coords.system,
      now,
    );
    assert.equal(
      longer.slots.find((slot) => slot.planetId === quiet.planet.id)?.inactivity,
      "I",
    );

    delete quiet.player.lastActiveAt;
    const unknown = galaxyViewFor(
      universe,
      viewer.player.id,
      home.coords.galaxy,
      home.coords.system,
      now,
    );
    assert.equal(
      unknown.slots.find((slot) => slot.planetId === quiet.planet.id)?.inactivity,
      undefined,
    );

    const mini = createMiniPlanet(universe.seed ?? universe.id, home.coords.galaxy, home.coords.system, 20, now);
    mini.ownerPlayerId = quiet.player.id;
    mini.discoveredBy = [viewer.player.id];
    quiet.player.planetIds.push(mini.id);
    quiet.player.lastActiveAt = now - 30 * DAY;
    universe.planets[mini.id] = mini;
    universe.miniPlanetIds = [...(universe.miniPlanetIds ?? []), mini.id];
    const withMini = galaxyViewFor(
      universe,
      viewer.player.id,
      home.coords.galaxy,
      home.coords.system,
      now,
    );
    const miniRow = withMini.minis.find((body) => body.planetId === mini.id);
    assert.ok(miniRow);
    assert.equal(miniRow.playerName, "Quiet");
    assert.equal(miniRow.inactivity, "I");
    assert.equal(viewer.player.homePlanetId, universe.planets[viewer.planet.id]?.id);
  });
});
