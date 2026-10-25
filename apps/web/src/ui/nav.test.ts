import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NAV_PAGES,
  SHOP_TABS,
  pageFromPath,
  pathForPage,
  resolveNavPage,
  shopTabFromUrl,
} from "./nav";
import { createUniverse, joinUniverse, playerView } from "@starhold/game";
import { shopPageHtml } from "./render-shop";

describe("nav routes", () => {
  it("maps contract paths to pages", () => {
    assert.equal(pageFromPath("/"), "overview");
    assert.equal(pageFromPath("/overview"), "overview");
    assert.equal(pageFromPath("/goals"), "goals");
    assert.equal(pageFromPath("/buildings"), "buildings");
    assert.equal(pageFromPath("/defenses"), "defenses");
    assert.equal(pageFromPath("/shipyard"), "shipyard");
    assert.equal(pageFromPath("/research"), "research");
    assert.equal(pageFromPath("/fleet"), "fleet");
    assert.equal(pageFromPath("/galaxy"), "galaxy");
    assert.equal(pageFromPath("/shop"), "shop");
    assert.equal(pageFromPath("/officers"), "shop");
    assert.equal(pageFromPath("/skills"), "shop");
    assert.equal(pageFromPath("/highscore"), "highscore");
    assert.equal(pageFromPath("/alliances"), "alliances");
    assert.equal(pageFromPath("/seasons"), "seasons");
    assert.equal(pageFromPath("/messages"), "messages");
  });

  it("aliases Round 1 panel paths", () => {
    assert.equal(pageFromPath("/resources"), "buildings");
    assert.equal(pageFromPath("/facilities"), "buildings");
    assert.equal(pageFromPath("/defense"), "defenses");
    assert.equal(resolveNavPage("resources"), "buildings");
    assert.equal(resolveNavPage("defense"), "defenses");
  });

  it("does not expose Officers and Skills as top-level pages", () => {
    assert.ok(NAV_PAGES.includes("shop"));
    assert.ok(!(NAV_PAGES as readonly string[]).includes("officers"));
    assert.ok(!(NAV_PAGES as readonly string[]).includes("skills"));
    assert.deepEqual(SHOP_TABS, ["items", "resources", "officers", "skills"]);
    assert.equal(shopTabFromUrl("/shop", "?shopTab=skills"), "skills");
    assert.equal(shopTabFromUrl("/officers", ""), "officers");
    assert.equal(shopTabFromUrl("/skills", ""), "skills");
    assert.equal(shopTabFromUrl("/shop", ""), "items");
  });

  it("renders the existing Officers and Skills panels as Shop sub-tabs", () => {
    const universe = createUniverse("Shop UI", 8);
    const joined = joinUniverse(universe, "Shopper", 170_000_000);
    const view = playerView(universe, joined.player.id, 170_000_000);
    const officers = shopPageHtml(view, false, "officers");
    const skills = shopPageHtml(view, false, "skills");
    assert.match(officers, /data-testid="officers-panel"/);
    assert.equal((officers.match(/data-shop-tab=/g) ?? []).length, 4);
    assert.match(officers, /data-shop-tab="officers"/);
    assert.match(officers, /aria-selected="true"/);
    assert.match(skills, /data-testid="skills-panel"/);
    assert.match(skills, /data-shop-tab="skills"/);
    assert.match(skills, /aria-selected="true"/);
  });

  it("emits canonical paths for every nav page", () => {
    for (const page of NAV_PAGES) {
      assert.equal(pageFromPath(pathForPage(page)), page);
    }
  });
});
