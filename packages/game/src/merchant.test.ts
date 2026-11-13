import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RESOURCE_MERCHANT_FEE_PERCENT,
  RESOURCE_MERCHANT_VALUE,
} from "./data/tuning.js";
import {
  assessResourceMerchant,
  createUniverse,
  joinUniverse,
  quoteResourceMerchant,
  tradeWithResourceMerchant,
} from "./world.js";
import { storageForPlanet } from "./world-boosts.js";

function received(amount: number, give: "metal" | "crystal" | "deuterium", get: "metal" | "crystal" | "deuterium"): number {
  const gross = Math.floor((amount * RESOURCE_MERCHANT_VALUE[get]) / RESOURCE_MERCHANT_VALUE[give]);
  return Math.floor((gross * (100 - RESOURCE_MERCHANT_FEE_PERCENT)) / 100);
}

describe("resource merchant", () => {
  it("uses the 3:2:1 rate and a 10% fee on the output", () => {
    assert.deepEqual(RESOURCE_MERCHANT_VALUE, { metal: 3, crystal: 2, deuterium: 1 });
    assert.equal(RESOURCE_MERCHANT_FEE_PERCENT, 10);

    const metalToDeut = quoteResourceMerchant("metal", "deuterium", 3000);
    assert.deepEqual(metalToDeut, { ok: true, gross: 1000, output: 900, fee: 100 });
    assert.equal(metalToDeut.ok && metalToDeut.output, received(3000, "metal", "deuterium"));

    const metalToCrystal = quoteResourceMerchant("metal", "crystal", 3000);
    assert.equal(metalToCrystal.ok && metalToCrystal.output, 1800);

    const crystalToMetal = quoteResourceMerchant("crystal", "metal", 2000);
    assert.equal(crystalToMetal.ok && crystalToMetal.output, 2700);

    const deutToMetal = quoteResourceMerchant("deuterium", "metal", 1000);
    assert.equal(deutToMetal.ok && deutToMetal.output, 2700);

    const deutToCrystal = quoteResourceMerchant("deuterium", "crystal", 1000);
    assert.equal(deutToCrystal.ok && deutToCrystal.output, 1800);
  });

  it("rejects the same resource, a zero output, and a non-integer amount", () => {
    assert.equal(quoteResourceMerchant("metal", "metal", 3000).ok, false);
    assert.equal(quoteResourceMerchant("ore", "metal", 3000).ok, false);
    const tiny = quoteResourceMerchant("metal", "deuterium", 1);
    assert.equal(tiny.ok, false);
    if (!tiny.ok) assert.equal(tiny.output, 0);
    assert.equal(quoteResourceMerchant("metal", "deuterium", 1.5).ok, false);
    assert.equal(quoteResourceMerchant("metal", "deuterium", 0).ok, false);
  });

  it("trades the named planet and leaves home resources and Starshards", () => {
    const now = 159_900_000;
    const universe = createUniverse("Merchant Colony", 8);
    const joined = joinUniverse(universe, "Merchant", now);
    const player = universe.players[joined.player.id]!;
    const home = universe.planets[player.homePlanetId]!;
    const colony = structuredClone(home);
    colony.id = `${home.id}_colony`;
    colony.name = "Colony";
    colony.coords = { ...home.coords, slot: home.coords.slot + 1 };
    universe.planets[colony.id] = colony;
    player.planetIds.push(colony.id);
    player.activePlanetId = colony.id;
    player.starshards = 40;
    home.resources = { metal: 5000, crystal: 4000, deuterium: 3000 };
    colony.resources = { metal: 9000, crystal: 100, deuterium: 50 };
    const fleetsBefore = Object.keys(universe.fleets).length;

    const traded = tradeWithResourceMerchant(
      universe,
      player.id,
      colony.id,
      "metal",
      "deuterium",
      3000,
      now,
    );
    assert.deepEqual(traded, { ok: true, output: 900 });
    assert.deepEqual(universe.planets[colony.id]!.resources, {
      metal: 6000,
      crystal: 100,
      deuterium: 950,
    });
    assert.deepEqual(universe.planets[home.id]!.resources, {
      metal: 5000,
      crystal: 4000,
      deuterium: 3000,
    });
    assert.equal(player.starshards, 40);
    assert.equal(Object.keys(universe.fleets).length, fleetsBefore);

    const missingPlanet = tradeWithResourceMerchant(
      universe,
      player.id,
      "",
      "metal",
      "crystal",
      3000,
      now,
    );
    assert.equal(missingPlanet.ok, false);
    assert.deepEqual(universe.planets[home.id]!.resources, {
      metal: 5000,
      crystal: 4000,
      deuterium: 3000,
    });
  });

  it("refuses a short stockpile or a full vault and does not move resources", () => {
    const now = 159_910_000;
    const universe = createUniverse("Merchant Blocks", 8);
    const joined = joinUniverse(universe, "Blocked", now);
    const planet = universe.planets[joined.planet.id]!;
    planet.resources = { metal: 10, crystal: 10, deuterium: 10 };
    const before = { ...planet.resources };
    const short = tradeWithResourceMerchant(
      universe,
      joined.player.id,
      planet.id,
      "metal",
      "deuterium",
      3000,
      now,
    );
    assert.equal(short.ok, false);
    if (!short.ok) assert.match(short.error, /Not enough metal/);
    assert.deepEqual(universe.planets[planet.id]!.resources, before);

    const live = universe.planets[planet.id]!;
    const caps = storageForPlanet(universe, live, now);
    live.resources = { metal: 9000, crystal: 0, deuterium: caps.deuterium };
    const fullBefore = { ...live.resources };
    const full = tradeWithResourceMerchant(
      universe,
      joined.player.id,
      planet.id,
      "metal",
      "deuterium",
      3000,
      now,
    );
    assert.equal(full.ok, false);
    if (!full.ok) assert.match(full.error, /deuterium storage is too full/);
    assert.deepEqual(universe.planets[planet.id]!.resources, fullBefore);

    const assessed = assessResourceMerchant({
      give: "metal",
      get: "deuterium",
      amount: 3000,
      have: live.resources,
      storage: caps,
    });
    assert.equal(assessed.ok, false);
    if (!assessed.ok) assert.equal(assessed.output, 900);
  });

  it("does not trade a planet the commander does not own", () => {
    const now = 159_920_000;
    const universe = createUniverse("Merchant Owner", 8);
    const joined = joinUniverse(universe, "Owner", now);
    const other = joinUniverse(universe, "Other", now);
    const before = { ...universe.planets[other.planet.id]!.resources };
    const result = tradeWithResourceMerchant(
      universe,
      joined.player.id,
      other.planet.id,
      "metal",
      "crystal",
      300,
      now,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "You do not own that planet.");
    assert.deepEqual(universe.planets[other.planet.id]!.resources, before);
  });
});
