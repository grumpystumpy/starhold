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
    assert.equal((html.match(/class="shop-item-card"/g) ?? []).length, 6);
    assert.match(html, /data-price="200"/);
    assert.match(html, /data-price="380"/);
    assert.match(html, /Select a moon to buy moon field expansions\./);

    const resHtml = shopPageHtml(view, false, "resources");
    assert.match(resHtml, /1\.5k/);
    assert.match(resHtml, /3k metal, 2k crystal, and 1k deuterium/);
  });

  it("targets the selected planet and renders the nine officer duration prices", () => {
    const universe = createUniverse("Selected Shop UI Test", 8);
    const joined = joinUniverse(universe, "SelectedShopper", 170_000_000);
    const player = universe.players[joined.player.id]!;
    const home = universe.planets[player.homePlanetId]!;
    const selected = structuredClone(home);
    selected.id = `${home.id}_second`;
    selected.name = "Second Planet";
    selected.coords = { ...home.coords, slot: home.coords.slot + 1 };
    universe.planets[selected.id] = selected;
    player.planetIds.push(selected.id);
    player.activePlanetId = selected.id;
    player.starshards = 1000;
    const view = playerView(universe, player.id, 170_000_001);

    const html = shopPageHtml(view, false, "items");
    assert.match(
      html,
      new RegExp(`<option value="${selected.id}" selected>Second Planet`),
    );

    const officersHtml = shopPageHtml(view, false, "officers");
    const quartermaster = officersHtml.match(
      /<li class="officer-row" data-testid="officer-quartermaster"[\s\S]*?<\/li>/,
    )?.[0];
    assert.ok(quartermaster);
    const durationOptions = [...quartermaster.matchAll(/<option value="(\d+)" data-price="(\d+)"/g)];
    assert.deepEqual(
      durationOptions.map(([, hours]) => hours),
      ["1", "2", "4", "8", "16", "24", "48", "96", "192"],
    );
    assert.deepEqual(
      durationOptions.map(([, , price]) => price),
      ["5", "10", "20", "40", "80", "120", "240", "480", "960"],
    );
  });
});
