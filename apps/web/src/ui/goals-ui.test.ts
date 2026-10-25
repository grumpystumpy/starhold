import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { goalRewardText } from "./render-goals";

describe("goal reward text", () => {
  it("formats resource and Starshard rewards with commas and no underscores", () => {
    const resources = goalRewardText({
      starshards: 0,
      metal: 2000,
      crystal: 1000,
      deuterium: 500,
    });
    assert.equal(resources, "2k metal · 1k crystal · 500 deuterium");
    assert.equal(resources.includes("_"), false);

    const weekly = goalRewardText({
      starshards: 0,
      metal: 12000,
      crystal: 6000,
      deuterium: 3000,
    });
    assert.equal(
      weekly,
      "12k metal · 6k crystal · 3k deuterium",
    );

    const shards = goalRewardText({
      starshards: 25,
      metal: 0,
      crystal: 0,
      deuterium: 0,
    });
    assert.equal(shards, "25 Starshards");
    assert.equal(shards.includes("_"), false);
  });
});
