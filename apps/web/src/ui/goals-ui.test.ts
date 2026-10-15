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
    assert.equal(resources, "2,000 metal · 1,000 crystal · 500 deuterium");
    assert.equal(resources.includes("_"), false);

    const weekly = goalRewardText({
      starshards: 0,
      metal: 12000,
      crystal: 6000,
      deuterium: 3000,
    });
    assert.equal(
      weekly,
      "12,000 metal · 6,000 crystal · 3,000 deuterium",
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
