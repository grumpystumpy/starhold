import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BASE_INCOME_PER_HOUR } from "./data/tuning.js";
import {
  coordDistance,
  emptyFleetShips,
  fleetCargoCapacity,
  flightSecondsOneWay,
} from "./formulas.js";
import {
  createUniverse,
  ensureUniverseShape,
  joinUniverse,
  mineOutputPerHour,
  productionPerHour,
  queueResearch,
  advancePlanet,
  advanceUniverse,
  launchFleet,
  MIN_FLIGHT_SECONDS,
  RESEARCH,
  RESEARCH_ORDER,
  SHIPS,
  SHIP_ORDER,
  type UniverseState,
} from "./index.js";

describe("B4-04 Metallurgist / Crystalizer / Deut Synthesis Researches", () => {
  it("level 0 production equals today's production (baseline)", () => {
    const universe = createUniverse("Baseline Test", 1);
    const { planet } = joinUniverse(universe, "Alice", 100_000);
    planet.buildings.metalMine = 10;
    planet.buildings.crystalMine = 8;
    planet.buildings.deutSynth = 5;

    const unboostedRates = productionPerHour(planet, 1, 0, undefined, undefined);
    const levelZeroRates = productionPerHour(planet, 1, 0, undefined, {
      metallurgistTech: 0,
      crystalizerTech: 0,
      deutSynthesisTech: 0,
    });

    assert.equal(levelZeroRates.metal, unboostedRates.metal);
    assert.equal(levelZeroRates.crystal, unboostedRates.crystal);
    assert.equal(levelZeroRates.deuterium, unboostedRates.deuterium);
  });

  it("level N gives +5% * N on mine output only; base income stays flat", () => {
    const universe = createUniverse("Mine Boost Test", 1);
    const { planet } = joinUniverse(universe, "Bob", 100_000);
    planet.buildings.metalMine = 10;
    planet.buildings.crystalMine = 8;
    planet.buildings.deutSynth = 5;
    planet.buildings.solarPlant = 30; // Adequate energy

    // Slot 4 neutral metal pos = 1.0
    const baseMetalMine = mineOutputPerHour("metal", 10) * 4; // PRODUCTION_MULT = 4
    const baseCrystalMine = mineOutputPerHour("crystal", 8) * 4 * 1.15; // slot 4 crystal pos = 1.15
    const baseDeutMine = mineOutputPerHour("deuterium", 5) * 4 * 0.85; // slot 4 deut pos = 0.85

    // Test Metallurgist Level 3 (+15%)
    const metalL3 = productionPerHour(planet, 1, 0, undefined, {
      metallurgistTech: 3,
      crystalizerTech: 0,
      deutSynthesisTech: 0,
    });
    assert.equal(
      metalL3.metal,
      baseMetalMine * 1.15 + BASE_INCOME_PER_HOUR.metal,
      "Metal mine output scales by 1 + 0.05 * 3, base income stays flat",
    );
    assert.equal(metalL3.crystal, baseCrystalMine + BASE_INCOME_PER_HOUR.crystal);
    assert.equal(metalL3.deuterium, baseDeutMine + BASE_INCOME_PER_HOUR.deuterium);

    // Test Crystalizer Level 2 (+10%)
    const crystalL2 = productionPerHour(planet, 1, 0, undefined, {
      metallurgistTech: 0,
      crystalizerTech: 2,
      deutSynthesisTech: 0,
    });
    assert.equal(
      crystalL2.crystal,
      baseCrystalMine * 1.10 + BASE_INCOME_PER_HOUR.crystal,
      "Crystal mine output scales by 1 + 0.05 * 2, base income stays flat",
    );
    assert.equal(crystalL2.metal, baseMetalMine + BASE_INCOME_PER_HOUR.metal);

    // Test Deut Synthesis Level 4 (+20%)
    const deutL4 = productionPerHour(planet, 1, 0, undefined, {
      metallurgistTech: 0,
      crystalizerTech: 0,
      deutSynthesisTech: 4,
    });
    assert.equal(
      deutL4.deuterium,
      baseDeutMine * 1.20 + BASE_INCOME_PER_HOUR.deuterium,
      "Deut synth output scales by 1 + 0.05 * 4, base income stays flat",
    );
    assert.equal(deutL4.metal, baseMetalMine + BASE_INCOME_PER_HOUR.metal);
  });

  it("old save fixture loads with levels 0 and preserves all progress", () => {
    const path = fileURLToPath(
      new URL("../../../apps/server/src/fixtures/catalog-complete-save.json", import.meta.url),
    );
    const fixture = JSON.parse(readFileSync(path, "utf8")) as {
      universe: UniverseState;
      planetId: string;
    };

    const universe = fixture.universe;
    const player = Object.values(universe.players)[0];
    assert.ok(player);

    ensureUniverseShape(universe);

    assert.equal(player.research.metallurgistTech, 0);
    assert.equal(player.research.crystalizerTech, 0);
    assert.equal(player.research.deutSynthesisTech, 0);

    // Verify progress preserved
    const planet = universe.planets[fixture.planetId];
    assert.ok(planet);
    assert.equal(planet.id, fixture.planetId);
  });

  it("queuing and upgrading the three new researches works with prerequisites", () => {
    const universe = createUniverse("Queue Test", 1);
    const { planet, player } = joinUniverse(universe, "Charlie", 100_000);
    planet.buildings.researchLab = 5;
    planet.resources = { metal: 1_000_000, crystal: 1_000_000, deuterium: 1_000_000 };

    // Locked without energyTech
    const lockedMet = queueResearch(universe, player.id, "metallurgistTech", 100_000);
    assert.equal(lockedMet.ok, false);

    // Unlock energyTech level 2
    player.research.energyTech = 2;

    const resMet = queueResearch(universe, player.id, "metallurgistTech", 100_001);
    assert.ok(resMet.ok);
    assert.equal(player.researchQueue.length, 1);
    assert.equal(player.researchQueue[0]!.researchId, "metallurgistTech");

    // Complete research
    const completesAt = player.researchQueue[0]!.completesAt;
    advancePlanet(planet, 1, completesAt + 1, player.research.energyTech, undefined, player);
    advanceUniverse(universe, completesAt + 1);

    assert.equal(player.research.metallurgistTech, 1);
  });

  it("RESEARCH_ORDER includes the three new research IDs", () => {
    assert.ok(RESEARCH_ORDER.includes("metallurgistTech"));
    assert.ok(RESEARCH_ORDER.includes("crystalizerTech"));
    assert.ok(RESEARCH_ORDER.includes("deutSynthesisTech"));
    assert.equal(RESEARCH.metallurgistTech.name, "Metallurgist");
    assert.equal(RESEARCH.crystalizerTech.name, "Crystalizer");
    assert.equal(RESEARCH.deutSynthesisTech.name, "Deut Synthesis");
  });
});

describe("B4-05 Cargo Hold and B4-06 Fleet Speed Researches", () => {
  it("registers both research definitions and catalog entries", () => {
    assert.deepEqual(RESEARCH_ORDER.slice(-2), ["cargoHoldTech", "fleetSpeedTech"]);
    assert.equal(RESEARCH.cargoHoldTech.name, "Cargo Hold");
    assert.equal(RESEARCH.fleetSpeedTech.name, "Fleet Thrusters");
  });

  it("Cargo Hold level 0 is baseline and each level boosts every ship's cargo", () => {
    for (const id of SHIP_ORDER) {
      const ships = emptyFleetShips();
      ships[id] = 1;
      const base = SHIPS[id].cargo;

      assert.equal(fleetCargoCapacity(ships), base);
      assert.equal(fleetCargoCapacity(ships, 0), base);
      assert.equal(
        fleetCargoCapacity(ships, 3),
        Math.floor(base * (1 + 0.05 * 3)),
        `${id} cargo at level 3`,
      );
    }
  });

  it("Cargo Hold permits transport cargo above baseline capacity", () => {
    const universe = createUniverse("Cargo Hold Transport", 1);
    const owner = joinUniverse(universe, "Cargo Owner", 1_000_000);
    const other = joinUniverse(universe, "Temporary Target", 1_000_001);
    const target = universe.planets[other.planet.id]!;
    target.ownerPlayerId = owner.player.id;
    owner.player.planetIds.push(target.id);
    owner.player.research.cargoHoldTech = 1;
    owner.planet.ships.hauler = 1;
    owner.planet.resources = {
      metal: 20_000,
      crystal: 20_000,
      deuterium: 20_000,
    };
    const boostedCapacity = fleetCargoCapacity(owner.planet.ships, 1);

    const launch = launchFleet(universe, {
      playerId: owner.player.id,
      mission: "transport",
      targetPlanetId: target.id,
      ships: { hauler: 1 },
      cargo: { metal: boostedCapacity, crystal: 0, deuterium: 0 },
      now: 1_000_100,
    });

    assert.equal(launch.ok, true, launch.ok ? "" : launch.error);
    if (launch.ok) assert.equal(launch.fleet.cargo.metal, boostedCapacity);
  });

  it("Fleet Speed level 0 is baseline and level N boosts cruise speed", () => {
    const origin = { galaxy: 1, system: 1, slot: 1 };
    const target = { galaxy: 1, system: 10, slot: 1 };
    const ships = emptyFleetShips();
    ships.scout = 1;
    const distance = coordDistance(origin, target);
    const baseline = flightSecondsOneWay(origin, target, ships, 1);
    const levelZero = flightSecondsOneWay(origin, target, ships, 1, 0, null, 0);
    const levelFive = flightSecondsOneWay(origin, target, ships, 1, 0, null, 5);

    assert.equal(levelZero, baseline);
    assert.equal(
      levelFive,
      Math.max(
        MIN_FLIGHT_SECONDS,
        Math.ceil(
          (distance * 1_000_000) /
            (SHIPS.scout.speed * (1 + 0.02 * 5)),
        ),
      ),
    );
    assert.ok(levelFive < baseline);
  });

  it("Fleet Speed shortens outbound and return durations on launch", () => {
    const travelDurations = (fleetSpeedTech: number) => {
      const universe = createUniverse(`Fleet Speed ${fleetSpeedTech}`, 1);
      universe.skipNpcRaids = true;
      const { planet, player } = joinUniverse(
        universe,
        "Speed Researcher",
        2_000_000,
      );
      player.research.fleetSpeedTech = fleetSpeedTech;
      planet.ships.recycler = 1;
      planet.resources.deuterium = 100_000;
      const targetCoords = {
        galaxy: planet.coords.galaxy,
        system: planet.coords.system === 1 ? 2 : planet.coords.system - 1,
        slot: 16,
      };
      const debrisKey = `${targetCoords.galaxy}:${targetCoords.system}:${targetCoords.slot}`;
      universe.debris[debrisKey] = {
        coords: targetCoords,
        metal: 1_000,
        crystal: 1_000,
      };
      const now = 2_000_100;
      const launch = launchFleet(universe, {
        playerId: player.id,
        mission: "harvest",
        targetCoords,
        ships: { recycler: 1 },
        now,
      });
      assert.equal(launch.ok, true, launch.ok ? "" : launch.error);
      if (!launch.ok) return { outbound: Infinity, returning: Infinity };

      const outbound = launch.fleet.arrivesAt - now;
      advanceUniverse(universe, launch.fleet.arrivesAt);
      const returningFleet = universe.fleets[launch.fleet.id];
      assert.ok(returningFleet);
      return {
        outbound,
        returning: returningFleet.arrivesAt - launch.fleet.arrivesAt,
      };
    };

    const baseline = travelDurations(0);
    const boosted = travelDurations(5);
    assert.ok(boosted.outbound < baseline.outbound);
    assert.ok(boosted.returning < baseline.returning);
  });

  it("old save defaults both researches to 0 without changing saved progress", () => {
    const path = fileURLToPath(
      new URL("../../../apps/server/src/fixtures/catalog-complete-save.json", import.meta.url),
    );
    const fixture = JSON.parse(readFileSync(path, "utf8")) as {
      universe: UniverseState;
      planetId: string;
    };
    const universe = fixture.universe;
    const player = Object.values(universe.players)[0];
    assert.ok(player);
    const playerBefore = JSON.parse(JSON.stringify(player)) as typeof player;
    const planetBefore = JSON.parse(
      JSON.stringify(universe.planets[fixture.planetId]),
    );
    const fleetsBefore = JSON.parse(JSON.stringify(universe.fleets));
    const progressBefore = {
      planetIds: [...player.planetIds],
      researchQueue: JSON.parse(JSON.stringify(player.researchQueue ?? [])),
      starshards: player.starshards,
      level: player.level,
      xp: player.xp,
      xpTotal: player.xpTotal,
    };

    ensureUniverseShape(universe);

    for (const id of [
      "cargoHoldTech",
      "fleetSpeedTech",
      "metallurgistTech",
      "crystalizerTech",
      "deutSynthesisTech",
      "researchNetwork",
    ] as const) {
      assert.equal(player.research[id], 0);
    }
    const playerExpected = JSON.parse(
      JSON.stringify(playerBefore),
    ) as typeof player;
    for (const id of [
      "cargoHoldTech",
      "fleetSpeedTech",
      "metallurgistTech",
      "crystalizerTech",
      "deutSynthesisTech",
      "researchNetwork",
    ] as const) {
      if (playerExpected.research[id] == null) {
        playerExpected.research[id] = 0;
      }
    }
    playerExpected.hiddenReportIds ??= [];
    playerExpected.officerLevels ??= {};
    playerExpected.skillLevels ??= {};
    assert.deepEqual(player, playerExpected);

    const planet = universe.planets[fixture.planetId]!;
    assert.equal(planet.ships.bulkCargo, 0);
    assert.equal(planet.ships.fastCargo, 0);
    assert.equal(planet.defenses?.prismLaser, 0);
    planetBefore.ships.bulkCargo = 0;
    planetBefore.ships.fastCargo = 0;
    planetBefore.defenses.prismLaser = 0;
    assert.deepEqual(planet, planetBefore);
    assert.deepEqual(universe.fleets, fleetsBefore);
    assert.deepEqual(
      {
        planetIds: player.planetIds,
        researchQueue: player.researchQueue,
        starshards: player.starshards,
        level: player.level,
        xp: player.xp,
        xpTotal: player.xpTotal,
      },
      progressBefore,
    );
  });
});
