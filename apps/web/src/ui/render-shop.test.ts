import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUniverse, joinUniverse, playerView } from "@starhold/game";
import { resourceMerchantSection, shopPageHtml } from "./render-shop";

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
    const shopAt = resHtml.indexOf('data-testid="shop-resources"');
    const merchantAt = resHtml.indexOf('data-testid="resource-merchant"');
    assert.ok(shopAt >= 0 && merchantAt > shopAt);
    assert.match(resHtml, /3000 metal returns 900 deuterium after the 10% fee/);
    assert.match(resHtml, /no Starshard cost/);
    assert.match(resHtml, /Enter an amount to see the exact output/);
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

  it("previews the merchant output and shows stock or storage errors beside Trade", () => {
    const universe = createUniverse("Merchant UI", 8);
    const joined = joinUniverse(universe, "MerchantUi", 170_000_000);
    const player = universe.players[joined.player.id]!;
    const home = universe.planets[player.homePlanetId]!;
    const selected = structuredClone(home);
    selected.id = `${home.id}_merchant`;
    selected.name = "Merchant World";
    selected.coords = { ...home.coords, slot: home.coords.slot + 1 };
    selected.resources = { metal: 9000, crystal: 100, deuterium: 40 };
    universe.planets[selected.id] = selected;
    player.planetIds.push(selected.id);
    player.activePlanetId = selected.id;
    const view = playerView(universe, player.id, 170_000_000);
    const draft = { give: "metal" as const, get: "deuterium" as const, amount: "3000" };

    const ready = resourceMerchantSection(view, draft, false);
    assert.match(ready, /data-planet-id="[^"]+_merchant"/);
    assert.match(ready, /Merchant World/);
    assert.doesNotMatch(ready, new RegExp(`data-planet-id="${home.id}"`));
    assert.match(ready, /You receive 900 deuterium/);
    assert.match(ready, /data-testid="merchant-trade"(?![^>]*disabled)/);
    assert.match(ready, /data-testid="resource-merchant-error"[^>]*hidden/);
    const readyButton = ready.indexOf('data-testid="merchant-trade"');
    const readyError = ready.indexOf('data-testid="resource-merchant-error"');
    assert.ok(readyButton >= 0 && readyError > readyButton && readyError - readyButton < 500);

    universe.planets[selected.id]!.resources = { metal: 10, crystal: 100, deuterium: 40 };
    const shortView = playerView(universe, player.id, 170_000_000);
    const short = resourceMerchantSection(shortView, draft, false);
    const shortButton = short.indexOf('data-testid="merchant-trade"');
    const shortError = short.indexOf("Not enough metal.");
    assert.match(short, /You receive 900 deuterium/);
    assert.match(short, /data-testid="merchant-trade"[^>]*disabled/);
    assert.match(short, /class="blocked-reason"/);
    assert.ok(shortButton >= 0 && shortError > shortButton);

    const caps = shortView.economy.storage;
    universe.planets[selected.id]!.resources = {
      metal: 9000,
      crystal: 0,
      deuterium: caps.deuterium,
    };
    const fullView = playerView(universe, player.id, 170_000_000);
    const full = resourceMerchantSection(fullView, draft, false);
    const fullButton = full.indexOf('data-testid="merchant-trade"');
    const fullError = full.indexOf("deuterium storage is too full for this trade.");
    assert.match(full, /You receive 900 deuterium/);
    assert.match(full, /data-testid="merchant-trade"[^>]*disabled/);
    assert.ok(fullButton >= 0 && fullError > fullButton && fullError - fullButton < 500);
  });
});
