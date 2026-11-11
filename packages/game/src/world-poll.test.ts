import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUniverse, joinUniverse, queueBuildingUpgrade } from "./world.js";
import { playerPollRevision, statePollIncludeForPage } from "./world-poll.js";

describe("player poll revision", () => {
  it("ignores resource stocks and changes when a building is queued", () => {
    const universe = createUniverse("poll");
    const { player } = joinUniverse(universe, "Rev");
    const now = 1_700_000_000_000;
    const before = playerPollRevision(universe, player.id, now, {});
    const planet = universe.planets[player.activePlanetId]!;
    planet.resources = {
      metal: planet.resources.metal + 500,
      crystal: planet.resources.crystal,
      deuterium: planet.resources.deuterium,
    };
    assert.equal(playerPollRevision(universe, player.id, now, {}), before);
    const queued = queueBuildingUpgrade(universe, player.id, "metalMine", now);
    assert.equal(queued.ok, true);
    assert.notEqual(playerPollRevision(universe, player.id, now, {}), before);
  });

  it("uses a different revision for the messages page than overview", () => {
    const universe = createUniverse("poll-page");
    const { player } = joinUniverse(universe, "Page");
    const now = 1_700_000_000_000;
    const overview = statePollIncludeForPage("overview");
    const messages = statePollIncludeForPage("messages");
    assert.equal(overview.messages, undefined);
    assert.equal(messages.messages, true);
    assert.notEqual(
      playerPollRevision(universe, player.id, now, overview),
      playerPollRevision(universe, player.id, now, messages),
    );
  });
});
