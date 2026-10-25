import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUniverse, joinUniverse, playerView } from "@starhold/game";
import { shopPageHtml } from "./render-shop";

describe("render-shop items tab", () => {
  it("renders the items tab by default", () => {
    const universe = createUniverse("Shop UI Test", 8);
    const joined = joinUniverse(universe, "ItemShopper", 170_000_000);
    const view = playerView(universe, joined.player.id, 170_000_000);

    const html = shopPageHtml(view, false, "items");
    assert.match(html, /data-testid="shop-items"/);
    assert.match(html, /Planet Field Expansion S/);
    assert.match(html, /Fleet Logistics License L/);
    assert.match(html, /data-buy-shop-item="item_planet_fields_s"/);
  });
});
