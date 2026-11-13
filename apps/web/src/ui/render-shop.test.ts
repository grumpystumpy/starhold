import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUniverse, joinUniverse, playerView, type PlayerTradeList } from "@starhold/game";
import { setMarketBook, setMarketDraft } from "./market-panel";
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

  it("renders the market tab without removing the Starshard bundle", () => {
    const universe = createUniverse("Market UI", 8, 8, { lazySeed: true });
    const joined = joinUniverse(universe, "MarketViewer", 170_000_000);
    const planet = universe.planets[joined.planet.id]!;
    planet.resources = { metal: 20_000, crystal: 12_000, deuterium: 4_000 };
    const view = playerView(universe, joined.player.id, 170_000_000);
    const book: PlayerTradeList = {
      callerPlayerId: joined.player.id,
      feePercent: 10,
      minAmount: 1000,
      maxOpenPerPlayer: 3,
      dailyCap: 1_000_000,
      dailyUsed: 0,
      newbie: false,
      openOwn: 0,
      offers: [
        {
          id: "trd_ui",
          posterPlayerId: "other",
          posterName: "Other Commander",
          planetId: "plnt_other",
          offerResource: "metal",
          offerAmount: 10_000,
          requestResource: "crystal",
          requestAmount: 4_000,
          createdAt: 170_000_000,
          expiresAt: 170_000_000 + 48 * 60 * 60 * 1000,
          acceptorReceives: 9_000,
          posterReceives: 3_600,
          own: false,
          acceptBlock: "Not enough crystal on this planet.",
          cancelBlock: "Only the poster can cancel this offer.",
        },
      ],
    };
    setMarketBook(book);
    const html = shopPageHtml(view, false, "market");
    assert.match(html, /data-testid="shop-tab-market"/);
    assert.match(html, /data-testid="page-market"/);
    assert.match(html, /data-testid="market-post"/);
    assert.match(html, /data-testid="market-fee-preview"/);
    assert.match(html, /10%/);
    assert.match(html, /data-testid="market-post-preview"/);
    assert.match(html, /Buyer receives 9k metal\. You receive 3\.6k crystal\./);
    assert.match(html, /data-testid="market-offer-trd_ui"/);
    assert.match(html, /data-testid="market-offer-when-trd_ui"/);
    assert.match(html, /Posted 0s ago\. Expires in 48h\./);
    assert.match(html, /data-testid="market-accept-trd_ui"/);
    assert.match(html, /data-testid="market-cancel-trd_ui"/);
    assert.match(html, /Not enough crystal on this planet\./);
    assert.match(html, /disabled/);

    setMarketDraft({
      offerResource: "crystal",
      offerAmount: 15_000,
      requestResource: "deuterium",
      requestAmount: 2_000,
    });
    const short = shopPageHtml(view, false, "market");
    assert.match(short, /Not enough crystal on this planet\./);
    assert.match(short, /data-testid="market-post"[^>]*disabled/);
    assert.match(short, /Buyer receives 13\.5k crystal\. You receive 1\.8k deuterium\./);

    setMarketDraft({
      offerResource: "metal",
      offerAmount: 2_000,
      requestResource: "metal",
      requestAmount: 2_000,
    });
    const same = shopPageHtml(view, false, "market");
    assert.match(same, /different resources/);
    assert.match(same, /data-testid="market-post"[^>]*disabled/);

    const resources = shopPageHtml(view, false, "resources");
    assert.match(resources, /data-testid="trade-buy-resources"/);
    assert.match(resources, /data-testid="trade-sell-resources"/);
    assert.match(resources, /data-testid="shop-resources"/);
    setMarketBook(null);
    setMarketDraft(null);
  });
});
