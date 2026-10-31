import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILDINGS,
  DEFENSES,
  RESEARCH,
  SHIPS,
  createUniverse,
  joinUniverse,
  ensureUniverseShape,
  type BuildingId,
  type DefenseId,
  type ShipId,
  type ResearchId,
} from "./index.js";

describe("B7-10/21/22 display name renames and save key invariants", () => {
  it("asserts all approved building display names and invariant internal IDs", () => {
    const expectedBuildings: Record<BuildingId, string> = {
      metalMine: "Ore Mine",
      crystalMine: "Crystalizer",
      deutSynth: "Deuterium Extractor",
      solarPlant: "Solar Array",
      metalStorage: "Metal Vault",
      crystalStorage: "Crystal Vault",
      deutTank: "Deut Tank",
      shipyard: "Shipyard",
      researchLab: "Research Lab",
      lunarBase: "Lunar Habitat",
      sensorArray: "System Scanner",
      jumpGate: "Moon Bridge",
      chronoLathe: "Nano Production",
      mantleLoom: "Land Reclamation",
      rigFoundry: "Manufacture Line",
      riftSiphon: "Rift Siphon",
      echoVault: "Data Archive",
      anomalyForge: "Anomaly Lab",
      driftBeacon: "Fleet Command Post",
    };

    for (const [id, expectedName] of Object.entries(expectedBuildings)) {
      const def = BUILDINGS[id as BuildingId];
      assert.ok(def, `Building def ${id} must exist`);
      assert.equal(def.id, id, `Internal ID for building ${id} must match key`);
      assert.equal(def.name, expectedName, `Building ${id} display name must match`);
    }
  });

  it("asserts all approved ship display names and invariant internal IDs", () => {
    const expectedShips: Record<ShipId, string> = {
      scout: "Recon Drone",
      hauler: "Mining Freighter",
      fastCargo: "Light Transport",
      bulkCargo: "Heavy Transport",
      interceptor: "Strike Fighter",
      cruiser: "Guided-Missile Cruiser",
      bomber: "Stealth Bomber",
      probe: "Spy Satellite",
      recycler: "Recovery Vessel",
      colonyShip: "Colonizer",
      voidforgeTitan: "Dreadnought",
      worldEater: "World Eater",
      swarmDrone: "Swarm Drone",
      swarmHarvester: "Swarm Harvester",
      swarmMothership: "Mothership",
      helioBuoy: "Solar Relay Satellite",
      keelSovereign: "Supercarrier",
      rakeCorsair: "Frigate",
      anvilDread: "Heavy Battlecruiser",
      wardbreaker: "Siege Destroyer",
      vaultScout: "Reconnaissance Corvette",
      astrolabeWing: "Pathfinder Wing",
      spoilSkimmer: "Battle Harvester",
      lineDrummer: "Escort Destroyer",
      veinAnchor: "Mining Platform",
      gridStake: "Power Relay Platform",
      foundationArk: "Outpost Carrier",
      frontierBeacon: "Forward Operating Beacon",
    };

    for (const [id, expectedName] of Object.entries(expectedShips)) {
      const def = SHIPS[id as ShipId];
      assert.ok(def, `Ship def ${id} must exist`);
      assert.equal(def.id, id, `Internal ID for ship ${id} must match key`);
      assert.equal(def.name, expectedName, `Ship ${id} display name must match`);
    }
  });

  it("asserts all approved defense display names and invariant internal IDs", () => {
    const expectedDefenses: Record<DefenseId, string> = {
      laserBattery: "Light Laser Turret",
      shieldDome: "Small Shield Generator",
      needleTurret: "Missile Battery",
      prismLaser: "Directed-Energy Turret",
      arcLattice: "Laser Defense Grid",
      pulseBastion: "Heavy Laser Turret",
      gaussRail: "Railgun Battery",
      ionSheath: "Ion Cannon",
      plasmaSpire: "Plasma Cannon",
      flakCurtain: "Anti-Air Flak Battery",
      kineticFence: "Coilgun Perimeter",
      emberMortar: "Plasma Artillery",
      rippleArray: "Ion Shield Generator",
      haloProjector: "Planetary Shield Projector",
      crownAegis: "Large Shield Generator",
      siegeBlockade: "Ion Fortress",
      frostLance: "Cryo Ion Cannon",
      voidWard: "Graviton Barrier",
    };

    for (const [id, expectedName] of Object.entries(expectedDefenses)) {
      const def = DEFENSES[id as DefenseId];
      assert.ok(def, `Defense def ${id} must exist`);
      assert.equal(def.id, id, `Internal ID for defense ${id} must match key`);
      assert.equal(def.name, expectedName, `Defense ${id} display name must match`);
    }
  });

  it("asserts crystalizerTech research display name and invariant internal ID", () => {
    assert.equal(RESEARCH.crystalizerTech.id, "crystalizerTech");
    assert.equal(RESEARCH.crystalizerTech.name, "Crystal Refining");
  });

  it("verifies an old save retains identical internal keys without save migration", () => {
    const universe = createUniverse("Old Save Key Invariance", 8);
    const { planet } = joinUniverse(universe, "InvariancePilot", 1_800_000);
    const p = universe.planets[planet.id];

    // Populate with various building, ship, defense IDs
    p.buildings.metalMine = 10;
    p.buildings.crystalMine = 8;
    p.buildings.jumpGate = 1;
    p.ships.scout = 50;
    p.ships.hauler = 20;
    p.ships.voidforgeTitan = 2;
    p.defenses.needleTurret = 100;
    p.defenses.laserBattery = 50;

    const snapshot = JSON.parse(JSON.stringify(universe));
    ensureUniverseShape(snapshot);

    const reloadedPlanet = snapshot.planets[planet.id];
    assert.equal(reloadedPlanet.buildings.metalMine, 10);
    assert.equal(reloadedPlanet.buildings.crystalMine, 8);
    assert.equal(reloadedPlanet.buildings.jumpGate, 1);
    assert.equal(reloadedPlanet.ships.scout, 50);
    assert.equal(reloadedPlanet.ships.hauler, 20);
    assert.equal(reloadedPlanet.ships.voidforgeTitan, 2);
    assert.equal(reloadedPlanet.defenses.needleTurret, 100);
    assert.equal(reloadedPlanet.defenses.laserBattery, 50);
  });
});
