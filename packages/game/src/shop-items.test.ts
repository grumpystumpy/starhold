import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buyShopItem,
  computeShopItemCost,
  computeShopItemPerUnitCost,
  createUniverse,
  fieldsCap,
  grantStarshards,
  joinUniverse,
  playerBoosts,
  playerView,
  resolveCombat,
  SHOP_ITEMS,
  unitHp,
} from "./index.js";
import { SHIPS } from "./catalog.js";
import type { PlanetState, PlayerState, UniverseState } from "./types-view.js";

describe("Shop Items (STA-44)", () => {
  it("pricing rule: bigger tiers cost 5% less per unit of bonus than smallest tier S", () => {
    // Check every family in catalog
    const categories = [
      "fields_planet",
      "fields_moon",
      "buff_hull",
      "buff_armor",
      "buff_shield",
      "fleet_slots",
    ] as const;

    for (const cat of categories) {
      const family = Object.values(SHOP_ITEMS).filter((i) => i.category === cat);
      const tierS = family.find((i) => i.tier === "S")!;
      const tierM = family.find((i) => i.tier === "M")!;
      const tierL = family.find((i) => i.tier === "L")!;

      const unitCostS = computeShopItemPerUnitCost(tierS);
      const unitCostM = computeShopItemPerUnitCost(tierM);
      const unitCostL = computeShopItemPerUnitCost(tierL);

      assert.equal(unitCostS, tierS.baseUnitCost);
      assert.ok(
        Math.abs(unitCostM - 0.95 * tierS.baseUnitCost) < 0.1,
        `Tier M per unit cost (${unitCostM}) should be ~0.95 * c`,
      );
      assert.ok(
        Math.abs(unitCostL - 0.95 * tierS.baseUnitCost) < 0.1,
        `Tier L per unit cost (${unitCostL}) should be ~0.95 * c`,
      );

      assert.ok(
        unitCostS > unitCostM,
        `Tier S per unit cost (${unitCostS}) should be > M (${unitCostM})`,
      );
      assert.ok(
        unitCostS > unitCostL,
        `Tier S per unit cost (${unitCostS}) should be > L (${unitCostL})`,
      );

      // Assert exact starshard costs
      assert.equal(
        tierS.starshards,
        computeShopItemCost(tierS.baseUnitCost, "S", tierS.bonus),
      );
      assert.equal(
        tierM.starshards,
        computeShopItemCost(tierS.baseUnitCost, "M", tierM.bonus),
      );
      assert.equal(
        tierL.starshards,
        computeShopItemCost(tierS.baseUnitCost, "L", tierL.bonus),
      );
    }

    // Explicit numbers check for Planet Fields (c=20): S=100 (20/u), M=190 (19/u), L=380 (19/u)
    assert.equal(SHOP_ITEMS.item_planet_fields_s.starshards, 100);
    assert.equal(SHOP_ITEMS.item_planet_fields_m.starshards, 190);
    assert.equal(SHOP_ITEMS.item_planet_fields_l.starshards, 380);
  });

  it("purchase deducts starshards and rejects invalid attempts without state change", () => {
    const universe = createUniverse("Shop Test", 8);
    const { player } = joinUniverse(universe, "Trader");
    const p = universe.players[player.id];

    grantStarshards(p, 150); // 150 shards
    const initialShards = p.starshards;

    // Unknown item
    const res1 = buyShopItem(universe, {
      playerId: p.id,
      itemId: "unknown_item",
    });
    assert.equal(res1.ok, false);
    assert.equal(p.starshards, initialShards);

    // Insufficient starshards (buying item_fleet_slots_m for 380 shards with only 150)
    const res2 = buyShopItem(universe, {
      playerId: p.id,
      itemId: "item_fleet_slots_m",
    });
    assert.equal(res2.ok, false);
    assert.equal(p.starshards, initialShards);

    // Wrong target planet (not owned)
    const res3 = buyShopItem(universe, {
      playerId: p.id,
      itemId: "item_planet_fields_s",
      targetPlanetId: "nonexistent_planet",
    });
    assert.equal(res3.ok, false);
    assert.equal(p.starshards, initialShards);

    // Valid purchase
    const res4 = buyShopItem(universe, {
      playerId: p.id,
      itemId: "item_planet_fields_s",
      targetPlanetId: p.homePlanetId,
    });
    assert.equal(res4.ok, true);
    assert.equal(p.starshards, initialShards - 100); // 150 - 100 = 50
  });

  it("field items permanently raise fieldsCap and restrict target type (planet vs moon)", () => {
    const universe = createUniverse("Field Test", 8);
    const { player, planet } = joinUniverse(universe, "Builder");
    const p = universe.players[player.id];
    const pl = universe.planets[planet.id];

    grantStarshards(p, 1000);
    const initialCap = fieldsCap(pl);

    // Try applying moon fields item to planet -> reject
    const moonRes = buyShopItem(universe, {
      playerId: p.id,
      itemId: "item_moon_fields_s",
      targetPlanetId: pl.id,
    });
    assert.equal(moonRes.ok, false);
    assert.equal(fieldsCap(pl), initialCap);

    // Apply planet field expansion S (+5)
    const planetRes = buyShopItem(universe, {
      playerId: p.id,
      itemId: "item_planet_fields_s",
      targetPlanetId: pl.id,
    });
    assert.equal(planetRes.ok, true);
    assert.equal(fieldsCap(pl), initialCap + 5);

    // Create a moon for testing moon field items
    const moonId = `moon_${p.id}_test`;
    const moon: PlanetState = {
      id: moonId,
      ownerPlayerId: p.id,
      name: "Test Moon",
      coords: { ...pl.coords },
      kind: "moon",
      parentPlanetId: pl.id,
      moonId: null,
      resources: { metal: 0, crystal: 0, deuterium: 0 },
      lastTickAt: 1000,
      buildings: {},
      ships: {},
      defenses: {},
      buildQueue: [],
      shipQueue: [],
      defenseQueue: [],
    };
    universe.planets[moonId] = moon;
    p.planetIds.push(moonId);

    const initialMoonCap = fieldsCap(moon);

    // Try applying planet field item to moon -> reject
    const failRes = buyShopItem(universe, {
      playerId: p.id,
      itemId: "item_planet_fields_s",
      targetPlanetId: moon.id,
    });
    assert.equal(failRes.ok, false);
    assert.equal(fieldsCap(moon), initialMoonCap);

    // Apply moon field item S (+3) -> succeed
    const okMoonRes = buyShopItem(universe, {
      playerId: p.id,
      itemId: "item_moon_fields_s",
      targetPlanetId: moon.id,
    });
    assert.equal(okMoonRes.ok, true);
    assert.equal(fieldsCap(moon), initialMoonCap + 3);
  });

  it("timed items expire after 24h, grant boosts (fleet slots, combat), and reject duplicates while active", () => {
    const universe = createUniverse("Timed Test", 8);
    const { player } = joinUniverse(universe, "Commander");
    const p = universe.players[player.id];
    const now = 1_000_000;

    grantStarshards(p, 2000);

    // Buy fleet slot license S (+1 slot)
    const res = buyShopItem(universe, {
      playerId: p.id,
      itemId: "item_fleet_slots_s",
      now,
    });
    assert.equal(res.ok, true);

    // Verify boost is active
    let boosts = playerBoosts(p, now);
    assert.equal(boosts.fleetSlots, 1);

    // Attempting to buy fleet slots again while active should be rejected
    const dupRes = buyShopItem(universe, {
      playerId: p.id,
      itemId: "item_fleet_slots_m",
      now,
    });
    assert.equal(dupRes.ok, false);

    // Buy Hull buff S (+5%)
    const hullRes = buyShopItem(universe, {
      playerId: p.id,
      itemId: "item_buff_hull_s",
      now,
    });
    assert.equal(hullRes.ok, true);

    boosts = playerBoosts(p, now);
    assert.equal(boosts.hullBuff, 1.05);

    // Check unit HP is boosted by hullBuff
    const baseHp = unitHp(SHIPS.cruiser.shield, SHIPS.cruiser.armor, SHIPS.cruiser.hull, undefined);
    const boostedHp = unitHp(
      SHIPS.cruiser.shield,
      SHIPS.cruiser.armor,
      SHIPS.cruiser.hull * boosts.hullBuff,
      undefined,
    );
    assert.ok(boostedHp > baseHp);

    // Check combat multiplier effect in resolveCombat
    const normalCombat = resolveCombat(
      { cruiser: 10, bomber: 5 },
      { cruiser: 10 },
      undefined,
      undefined,
      undefined,
      { seed: "combat_test" },
    );

    const boostedCombat = resolveCombat(
      { cruiser: 10, bomber: 5 },
      { cruiser: 10 },
      undefined,
      undefined,
      undefined,
      { attackerHullMult: boosts.hullBuff, seed: "combat_test" },
    );

    assert.ok(
      (boostedCombat.attackerAfter.cruiser ?? 0) >=
        (normalCombat.attackerAfter.cruiser ?? 0),
    );

    // Test exact 24h expiry
    const dayMs = 24 * 60 * 60 * 1000;
    const justBeforeExpiry = now + dayMs - 1;
    const exactExpiry = now + dayMs;

    assert.equal(playerBoosts(p, justBeforeExpiry).fleetSlots, 1);
    assert.equal(playerBoosts(p, justBeforeExpiry).hullBuff, 1.05);

    assert.equal(playerBoosts(p, exactExpiry).fleetSlots, 0);
    assert.equal(playerBoosts(p, exactExpiry).hullBuff, 1.0);
  });

  it("loads existing save fixture with no shop fields required and no lost progress", () => {
    const fixturePath = join(
      process.cwd(),
      "../../apps/server/src/fixtures/catalog-complete-save.json",
    );
    let raw: string;
    try {
      raw = readFileSync(fixturePath, "utf-8");
    } catch {
      raw = readFileSync(
        join(
          process.cwd(),
          "apps/server/src/fixtures/catalog-complete-save.json",
        ),
        "utf-8",
      );
    }

    const save = JSON.parse(raw) as {
      universe?: UniverseState;
      players?: Record<string, PlayerState>;
    } & UniverseState;
    const universe = save.universe ?? save;
    assert.ok(universe.players);

    const pId = Object.keys(universe.players)[0];
    assert.ok(pId);

    const p: PlayerState = universe.players[pId];
    assert.ok(p);

    // View loads cleanly without errors
    const view = playerView(universe, pId, Date.now());
    assert.equal(view.player.id, pId);
    assert.ok(Array.isArray(view.activeItemBuffs));
    assert.equal(view.activeItemBuffs.length, 0);
    assert.ok(view.shopCatalog);
    assert.equal(Object.keys(view.shopCatalog).length, 18);
  });
});
