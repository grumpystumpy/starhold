import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUniverse, joinUniverse, playerView, type PlayerTradeList } from "@starhold/game";
import { setMarketBook } from "./market-panel";
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
    assert.match(html, /9k metal/);
    assert.match(html, /3\.6k crystal/);
    assert.match(html, /data-testid="market-offer-trd_ui"/);
    assert.match(html, /data-testid="market-accept-trd_ui"/);
    assert.match(html, /data-testid="market-cancel-trd_ui"/);
    assert.match(html, /Not enough crystal on this planet\./);
    assert.match(html, /disabled/);

    const resources = shopPageHtml(view, false, "resources");
    assert.match(resources, /data-testid="trade-buy-resources"/);
    assert.match(resources, /data-testid="trade-sell-resources"/);
    assert.match(resources, /data-testid="shop-resources"/);
    setMarketBook(null);
  });
});
