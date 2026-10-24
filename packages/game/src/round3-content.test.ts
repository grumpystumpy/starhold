import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILDINGS,
  CHRONO_LATHE_RIG_FOUNDRY_REQ,
  CHRONO_LATHE_SHIPYARD_REQ,
  DEFENSES,
  DEFENSE_ORDER,
  PLAYER_CLASS_BONUSES,
  RESEARCH,
  SHIPS,
  SHIP_ORDER,
  SLOT_TEMPERATURE_K,
  UNIVERSE_SCHEMA_VERSION,
  changePlayerClass,
  choosePlayerClass,
  classChangeCost,
  createUniverse,
  economySnapshot,
  helioBuoyEnergy,
  joinUniverse,
  launchFleet,
  mantleLoomFieldsBonus,
  migrateOrResetUniverse,
  migrateUniverseV3ToV4,
  planetTemperatureK,
  queueBuildingUpgrade,
  queueShipBuild,
  rapidFireFactor,
  rigFoundryTimeFactor,
  shipResearchReqMet,
  solarTempFactor,
  spoilSkimmerDebris,
} from "./index.js";
import { ensureUniverseShape } from "./world-bootstrap.js";

const R3_DEFENSE_IDS = [
  "needleTurret",
  "arcLattice",
  "pulseBastion",
  "gaussRail",
  "ionSheath",
  "plasmaSpire",
  "flakCurtain",
  "kineticFence",
  "emberMortar",
  "rippleArray",
  "haloProjector",
  "crownAegis",
  "siegeBlockade",
  "frostLance",
  "voidWard",
] as const;

const MISSILE_NAMES = /missile|anti.?ballistic|interplanetary/i;

describe("Round 3 content + engine (11–19)", () => {
  it("schema version is 5", () => {
    assert.equal(UNIVERSE_SCHEMA_VERSION, 5);
    const u = createUniverse("R3", 8);
    assert.equal(u.schemaVersion, UNIVERSE_SCHEMA_VERSION);
  });

  it("has 15 new defenses and no missile ids", () => {
    for (const id of R3_DEFENSE_IDS) {
      assert.ok(DEFENSES[id], id);
      assert.ok(DEFENSE_ORDER.includes(id));
      assert.ok(!MISSILE_NAMES.test(DEFENSES[id].name));
      assert.ok(!MISSILE_NAMES.test(id));
    }
    assert.equal(R3_DEFENSE_IDS.length, 15);
    assert.equal(DEFENSE_ORDER.length, 18); // +2 legacy + Prism Laser
  });

  it("Prism Laser tuning and old-save defense default", () => {
    assert.deepEqual(DEFENSES.prismLaser, {
      id: "prismLaser",
      name: "Prism Laser",
      description: "Crystal-focused prism emitter.",
      cost: { metal: 60, crystal: 200, deuterium: 0 },
      buildSeconds: 9,
      shipyardLevel: 2,
      attack: 22,
      shield: 6,
      armor: 9,
      hull: 22,
    });
    assert.equal(DEFENSE_ORDER[DEFENSE_ORDER.indexOf("needleTurret") + 1], "prismLaser");

    const universe = createUniverse("Prism Laser old save", 8);
    const { planet } = joinUniverse(universe, "PrismTester", 1_000_000);
    const preserved = { ...planet.defenses };
    delete (planet.defenses as Partial<typeof planet.defenses>).prismLaser;
    const loaded = migrateOrResetUniverse(JSON.parse(JSON.stringify(universe))).universe;
    assert.equal(loaded.planets[planet.id].defenses.prismLaser, 0);
    for (const [id, count] of Object.entries(preserved)) {
      assert.equal(loaded.planets[planet.id].defenses[id as keyof typeof planet.defenses], count);
    }
  });

  it("warships + Helio Buoy + class ships exist in tuning", () => {
    for (const id of [
      "helioBuoy",
      "keelSovereign",
      "rakeCorsair",
      "anvilDread",
      "wardbreaker",
      "vaultScout",
      "astrolabeWing",
      "spoilSkimmer",
      "lineDrummer",
      "veinAnchor",
      "gridStake",
      "foundationArk",
      "frontierBeacon",
    ] as const) {
      assert.ok(SHIPS[id], id);
      assert.ok(SHIP_ORDER.includes(id));
    }
    assert.equal(SHIPS.helioBuoy.stationary, true);
    assert.equal(SHIPS.veinAnchor.stationary, true);
    assert.equal(SHIPS.gridStake.stationary, true);
    assert.equal(SHIPS.vaultScout.classExclusive, "explorer");
    assert.equal(SHIPS.foundationArk.classExclusive, "expansionist");
  });

  it("adds fast and bulk cargo ships and defaults them on old planets", () => {
    assert.equal(SHIPS.fastCargo.cargo, 10_000);
    assert.equal(SHIPS.bulkCargo.cargo, 50_000);
    assert.equal(SHIP_ORDER[SHIP_ORDER.indexOf("hauler") + 1], "fastCargo");
    assert.equal(SHIP_ORDER[SHIP_ORDER.indexOf("hauler") + 2], "bulkCargo");

    const universe = createUniverse("Cargo old save", 8);
    const { planet } = joinUniverse(universe, "Cargo", 1_700_000);
    const oldSave = structuredClone(universe);
    const oldPlanet = oldSave.planets[planet.id]!;
    delete oldPlanet.ships.fastCargo;
    delete oldPlanet.ships.bulkCargo;
    oldPlanet.ships.hauler = 7;
    ensureUniverseShape(oldSave);
    assert.equal(oldPlanet.ships.fastCargo, 0);
    assert.equal(oldPlanet.ships.bulkCargo, 0);
    assert.equal(oldPlanet.ships.hauler, 7);
  });

  it("Mantle Loom + Rig Foundry + Well Binding in catalogs", () => {
    assert.equal(BUILDINGS.mantleLoom.name, "Mantle Loom");
    assert.equal(BUILDINGS.rigFoundry.name, "Rig Foundry");
    assert.equal(RESEARCH.gravityWell.name, "Well Binding");
    assert.equal(CHRONO_LATHE_SHIPYARD_REQ, 10);
    assert.equal(CHRONO_LATHE_RIG_FOUNDRY_REQ, 10);
  });

  it("temperature table + Helio Buoy energy + solar temp factor", () => {
    assert.equal(planetTemperatureK(1), 220);
    assert.equal(planetTemperatureK(8), 90);
    assert.equal(planetTemperatureK(15), 20);
    assert.equal(Object.keys(SLOT_TEMPERATURE_K).length, 15);
    assert.equal(solarTempFactor(8), 1);
    assert.ok(Math.abs(solarTempFactor(1) - 220 / 90) < 1e-9);
    assert.ok(Math.abs(solarTempFactor(15) - 20 / 90) < 1e-9);

    const universe = createUniverse("Temp", 8);
    const { planet } = joinUniverse(universe, "Hot", 400_000_000);
    const p = universe.planets[planet.id];
    p.coords.slot = 1;
    p.ships.helioBuoy = 3;
    assert.equal(helioBuoyEnergy(p), 3 * Math.floor(220 / 4));
    p.coords.slot = 15;
    assert.equal(helioBuoyEnergy(p), 3 * Math.floor(20 / 4));
  });

  it("Mantle Loom fieldsCap bonus + energy economy exposure", () => {
    const universe = createUniverse("Loom", 8);
    const { planet } = joinUniverse(universe, "Weaver", 401_000_000);
    const p = universe.planets[planet.id];
    const baseCap = p.fieldsCap ?? 0;
    p.buildings.mantleLoom = 2;
    assert.equal(mantleLoomFieldsBonus(p), 10);
    const snap = economySnapshot(p, 1, 0);
    assert.equal(snap.fields.mantleLoomBonus, 10);
    assert.equal(snap.fields.cap, baseCap + 10);
    assert.equal(snap.temperatureK, planetTemperatureK(p.coords.slot));
    assert.ok("helioBuoy" in snap.energy);
    assert.ok("solarTempFactor" in snap.energy);
  });

  it("Rig Foundry −15%/lvl floor 0.10; Chrono needs Foundry 10", () => {
    assert.equal(rigFoundryTimeFactor(0), 1);
    assert.ok(Math.abs(rigFoundryTimeFactor(1) - 0.85) < 1e-9);
    assert.ok(Math.abs(rigFoundryTimeFactor(6) - 0.1) < 1e-9);
    assert.equal(rigFoundryTimeFactor(10), 0.1);

    const universe = createUniverse("ChronoGate", 8);
    const { player, planet } = joinUniverse(universe, "Late", 402_000_000);
    const prep = () => {
      const p = universe.planets[planet.id];
      p.buildings.shipyard = 10;
      p.buildings.metalStorage = 12;
      p.buildings.crystalStorage = 12;
      p.buildings.deutTank = 12;
      p.resources = {
        metal: 10_000_000,
        crystal: 10_000_000,
        deuterium: 10_000_000,
      };
      return p;
    };
    prep().buildings.rigFoundry = 9;
    const blocked = queueBuildingUpgrade(
      universe,
      player.id,
      "chronoLathe",
      402_000_100,
    );
    assert.equal(blocked.ok, false);

    prep().buildings.rigFoundry = 10;
    const ok = queueBuildingUpgrade(
      universe,
      player.id,
      "chronoLathe",
      402_000_200,
    );
    assert.equal(ok.ok, true);
  });

  it("gravityWell gates Void Titan / Mothership / World Eater", () => {
    const research = {
      weaponsTech: 20,
      shieldingTech: 20,
      armourTech: 20,
      gravityWell: 0,
    };
    assert.equal(shipResearchReqMet("voidforgeTitan", research).ok, false);
    assert.equal(shipResearchReqMet("swarmMothership", research).ok, false);
    assert.equal(shipResearchReqMet("worldEater", research).ok, false);
    research.gravityWell = 1;
    assert.equal(shipResearchReqMet("voidforgeTitan", research).ok, true);
    assert.equal(shipResearchReqMet("swarmMothership", research).ok, true);
    assert.equal(shipResearchReqMet("worldEater", research).ok, true);
  });

  it("warship RF matrix lookups", () => {
    assert.equal(rapidFireFactor("rakeCorsair", "scout"), 6);
    assert.equal(rapidFireFactor("rakeCorsair", "probe"), 12);
    assert.equal(rapidFireFactor("wardbreaker", "laserBattery"), 10);
    assert.equal(rapidFireFactor("wardbreaker", "crownAegis"), 3);
    assert.equal(rapidFireFactor("flakCurtain", "swarmDrone"), 8);
    assert.equal(rapidFireFactor("anvilDread", "bomber"), 2);
    assert.equal(rapidFireFactor("keelSovereign", "cruiser"), 2);
    assert.equal(rapidFireFactor("lineDrummer", "scout"), 3);
  });

  it("class choose free; change spends Starshards + cooldown", () => {
    const universe = createUniverse("Class", 8);
    const { player } = joinUniverse(universe, "Cadet", 403_000_000);
    const now = 403_000_000;
    assert.equal(choosePlayerClass(universe, player.id, "miner", now).ok, true);
    assert.equal(universe.players[player.id].playerClass?.classId, "miner");
    assert.equal(
      choosePlayerClass(universe, player.id, "fleeter", now + 1).ok,
      false,
    );

    universe.players[player.id].starshards = 500;
    const cost = classChangeCost(0);
    assert.equal(cost, 200);
    const changed = changePlayerClass(
      universe,
      player.id,
      "fleeter",
      now + 1000,
    );
    assert.equal(changed.ok, true);
    assert.equal(universe.players[player.id].playerClass?.classId, "fleeter");
    assert.equal(universe.players[player.id].starshards, 500 - cost);
    assert.equal(universe.players[player.id].playerClass?.changeCount, 1);

    universe.players[player.id].starshards = 1000;
    const cooled = changePlayerClass(
      universe,
      player.id,
      "explorer",
      now + 2000,
    );
    assert.equal(cooled.ok, false);
  });

  it("class ship build gate + stationary launch reject", () => {
    const universe = createUniverse("Gate", 8);
    const { player, planet } = joinUniverse(universe, "Gatee", 404_000_000);
    const p = universe.planets[planet.id];
    p.buildings.shipyard = 10;
    p.buildings.metalStorage = 8;
    p.buildings.crystalStorage = 8;
    p.buildings.deutTank = 8;
    p.resources = { metal: 100_000, crystal: 100_000, deuterium: 50_000 };

    const denied = queueShipBuild(
      universe,
      player.id,
      "vaultScout",
      1,
      404_000_100,
    );
    assert.equal(denied.ok, false);

    choosePlayerClass(universe, player.id, "explorer", 404_000_200);
    const ok = queueShipBuild(
      universe,
      player.id,
      "vaultScout",
      1,
      404_000_300,
    );
    assert.equal(ok.ok, true);

    p.ships.helioBuoy = 2;
    const launch = launchFleet(universe, {
      playerId: player.id,
      mission: "deploy",
      ships: { helioBuoy: 1 },
      targetPlanetId: planet.id,
      now: 404_000_400,
    });
    assert.equal(launch.ok, false);
  });

  it("Spoil Skimmer debris skim math", () => {
    const debris = { metal: 1000, crystal: 1000, deuterium: 0 };
    const skim = spoilSkimmerDebris(debris, {
      ...Object.fromEntries(SHIP_ORDER.map((id) => [id, 0])),
      spoilSkimmer: 2,
    } as never);
    // 15% of 2000 = 300; cargo plenty
    assert.equal(skim.skimmed.metal + skim.skimmed.crystal, 300);
    assert.equal(
      skim.remaining.metal + skim.remaining.crystal,
      1700,
    );
  });

  it("migrates schema 3 → 4 then 5 with playerClass defaults", () => {
    const universe = createUniverse("V4", 8);
    const { player } = joinUniverse(universe, "Migratee", 405_000_000);
    universe.schemaVersion = 3;
    delete universe.players[player.id].playerClass;
    migrateUniverseV3ToV4(universe);
    assert.equal(universe.schemaVersion, 4);
    assert.deepEqual(universe.players[player.id].playerClass, {
      classId: null,
      chosenAt: null,
      changeCount: 0,
      lastChangeAt: null,
    });
    const again = migrateOrResetUniverse(universe);
    assert.equal(again.didReset, false);
    assert.equal(again.universe.schemaVersion, UNIVERSE_SCHEMA_VERSION);
  });

  it("class bonus table matches contract sheet", () => {
    assert.equal(PLAYER_CLASS_BONUSES.miner.mineOutput, 1.12);
    assert.equal(PLAYER_CLASS_BONUSES.miner.energyOutput, 1.1);
    assert.equal(PLAYER_CLASS_BONUSES.fleeter.fleetSlots, 2);
    assert.equal(PLAYER_CLASS_BONUSES.miner.defensePower, 1.1);
    assert.equal(PLAYER_CLASS_BONUSES.explorer.expeditionYield, 1.2);
    assert.equal(PLAYER_CLASS_BONUSES.fleeter.attack, 1.08);
    assert.equal(PLAYER_CLASS_BONUSES.expansionist.colonySlots, 2);
    assert.equal(PLAYER_CLASS_BONUSES.expansionist.jumpGateCooldown, 0.85);
  });
});
