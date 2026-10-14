import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILDINGS,
  MINI_BUILDING_ORDER,
  MINI_SLOT_MIN,
  MINI_WORLD_EATER_MIN,
} from "./catalog.js";
import {
  anomalyForgeShipTimeFactor,
  buildingAllowedOn,
  canResolveMiniPlanet,
  echoVaultStorageMult,
  normalizeFleetShips,
  riftSiphonMineMult,
  shipUnitBuildSeconds,
  storageFor,
  xpForMiniPlanetDiscovery,
} from "./formulas.js";
import {
  advanceUniverse,
  createUniverse,
  joinUniverse,
  launchFleet,
  queueBuildingUpgrade,
  resolveMiniPlanetChoice,
} from "./world.js";
import {
  discoverMiniPlanet,
  isMiniPlanet,
  isUnclaimedMini,
  seedUniverseMinis,
} from "./world-mini.js";
import { emptyDefenses } from "./formulas.js";

describe("mini planets", () => {
  it("seeds minis outside slots 1–16 at universe create", () => {
    const universe = createUniverse("Mini Seed", 8);
    assert.ok((universe.miniPlanetIds?.length ?? 0) > 0);
    for (const id of universe.miniPlanetIds ?? []) {
      const p = universe.planets[id];
      assert.ok(p);
      assert.equal(p.flags?.mini, true);
      assert.ok(p.coords.slot >= MINI_SLOT_MIN);
      assert.ok((p.fieldsCap ?? 0) >= 80 && (p.fieldsCap ?? 0) <= 140);
      assert.equal(p.ownerPlayerId, "");
    }
  });

  it("special buildings exist with original names", () => {
    assert.equal(BUILDINGS.riftSiphon.name, "Rift Siphon");
    assert.equal(BUILDINGS.echoVault.name, "Echo Vault");
    assert.equal(BUILDINGS.anomalyForge.name, "Anomaly Forge");
    assert.equal(BUILDINGS.driftBeacon.name, "Drift Beacon");
    assert.ok(MINI_BUILDING_ORDER.includes("riftSiphon"));
    assert.ok(!MINI_BUILDING_ORDER.includes("metalMine"));
    assert.ok(!MINI_BUILDING_ORDER.includes("researchLab"));
  });

  it("buildingAllowedOn gates mini vs normal planets", () => {
    const universe = createUniverse("Mini Build", 8);
    const a = joinUniverse(universe, "Builder", 300_000_000);
    const miniId = universe.miniPlanetIds![0]!;
    const mini = universe.planets[miniId]!;
    assert.equal(buildingAllowedOn(mini, "riftSiphon"), true);
    assert.equal(buildingAllowedOn(mini, "metalMine"), false);
    assert.equal(buildingAllowedOn(a.planet, "riftSiphon"), false);
    assert.equal(buildingAllowedOn(a.planet, "metalMine"), true);
  });

  it("discovery is finder-only; empire galaxy hides unknown minis", () => {
    const universe = createUniverse("Mini Disc", 8);
    const a = joinUniverse(universe, "Finder", 301_000_000);
    const b = joinUniverse(universe, "Blind", 301_000_001);
    const miniId = universe.miniPlanetIds![0]!;
    const mini = universe.planets[miniId]!;
    discoverMiniPlanet(universe, a.player.id, miniId);
    assert.ok(a.player.discoveredMiniIds?.includes(miniId) ||
      universe.players[a.player.id]!.discoveredMiniIds!.includes(miniId));
    assert.ok(mini.discoveredBy?.includes(a.player.id));
    assert.equal(
      universe.players[b.player.id]!.discoveredMiniIds?.includes(miniId) ??
        false,
      false,
    );
  });

  it("colonize claims unclaimed mini with Colonizer", () => {
    const universe = createUniverse("Mini Col", 8);
    const a = joinUniverse(universe, "Settler", 302_000_000);
    universe.players[a.player.id]!.research.astrophysics = 2;
    const miniId = universe.miniPlanetIds![0]!;
    discoverMiniPlanet(universe, a.player.id, miniId);
    const mini = universe.planets[miniId]!;
    assert.ok(isUnclaimedMini(mini));
    universe.planets[a.planet.id].ships.colonyShip = 1;
    universe.planets[a.planet.id].resources.deuterium = 50_000;
    const launch = launchFleet(universe, {
      playerId: a.player.id,
      mission: "colonize",
      targetCoords: { ...mini.coords },
      ships: { colonyShip: 1 },
      now: 302_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    advanceUniverse(universe, launch.fleet.arrivesAt);
    const claimed = universe.planets[miniId]!;
    assert.equal(claimed.ownerPlayerId, a.player.id);
    assert.ok(universe.players[a.player.id]!.planetIds.includes(miniId));
    assert.equal(isUnclaimedMini(claimed), false);
  });

  it("rift / echo / anomaly formulas stack as contracted", () => {
    const universe = createUniverse("Mini Form", 8);
    const miniId = universe.miniPlanetIds![0]!;
    const mini = universe.planets[miniId]!;
    mini.buildings.riftSiphon = 2;
    mini.buildings.echoVault = 2;
    mini.buildings.anomalyForge = 2;
    mini.buildings.metalStorage = 1;
    assert.equal(riftSiphonMineMult(mini), 1.3);
    assert.equal(echoVaultStorageMult(mini), 1.5);
    assert.equal(anomalyForgeShipTimeFactor(mini), 0.84);
    const base = storageFor({
      ...mini,
      buildings: { ...mini.buildings, echoVault: 0 },
    });
    const boosted = storageFor(mini);
    assert.ok(boosted.metal > base.metal);
    const slow = shipUnitBuildSeconds("scout", 1, 0, 0, 0);
    const fast = shipUnitBuildSeconds("scout", 1, 0, 0, 2);
    assert.ok(fast < slow);
  });

  it("blocks mines on mini via queue", () => {
    const universe = createUniverse("Mini Queue", 8);
    const a = joinUniverse(universe, "Miner", 303_000_000);
    const miniId = universe.miniPlanetIds![0]!;
    discoverMiniPlanet(universe, a.player.id, miniId);
    const mini = universe.planets[miniId]!;
    mini.ownerPlayerId = a.player.id;
    universe.players[a.player.id]!.planetIds.push(miniId);
    universe.players[a.player.id]!.activePlanetId = miniId;
    universe.planets[miniId] = mini;
    mini.resources = { metal: 50_000, crystal: 50_000, deuterium: 10_000 };
    const bad = queueBuildingUpgrade(
      universe,
      a.player.id,
      "metalMine",
      303_000_200,
      miniId,
    );
    assert.equal(bad.ok, false);
    const good = queueBuildingUpgrade(
      universe,
      a.player.id,
      "riftSiphon",
      303_000_201,
      miniId,
    );
    assert.equal(good.ok, true);
  });

  it("capture transfers ownership; destroy pays out and removes planet", () => {
    const universe = createUniverse("Mini War", 8);
    seedUniverseMinis(universe);
    const a = joinUniverse(universe, "Attacker", 304_000_000);
    const b = joinUniverse(universe, "Defender", 304_000_001);
    const miniId = universe.miniPlanetIds![0]!;
    const mini = universe.planets[miniId]!;
    mini.ownerPlayerId = b.player.id;
    mini.flags = { mini: true };
    mini.resources = { metal: 1000, crystal: 500, deuterium: 100 };
    mini.buildings.solarPlant = 3;
    mini.ships = normalizeFleetShips({});
    mini.defenses = emptyDefenses();
    universe.players[b.player.id]!.planetIds.push(miniId);
    universe.planets[miniId] = mini;

    assert.equal(canResolveMiniPlanet(normalizeFleetShips({ worldEater: 4 })), false);
    assert.equal(
      canResolveMiniPlanet(normalizeFleetShips({ worldEater: MINI_WORLD_EATER_MIN })),
      true,
    );

    const fleetId = "flt_cap";
    universe.fleets[fleetId] = {
      id: fleetId,
      ownerPlayerId: a.player.id,
      originPlanetId: a.planet.id,
      targetPlanetId: miniId,
      targetPlayerId: b.player.id,
      targetCoords: { ...mini.coords },
      mission: "raid",
      ships: normalizeFleetShips({ worldEater: 5, hauler: 20 }),
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: 304_000_100,
      arrivesAt: 304_000_100,
      phase: "returning",
      reportId: "rpt_cap",
    };
    universe.reports.rpt_cap = {
      id: "rpt_cap",
      at: 304_000_100,
      missionId: fleetId,
      attackerPlayerId: a.player.id,
      defenderPlayerId: b.player.id,
      attackerName: "Attacker",
      defenderName: "Defender",
      targetCoords: { ...mini.coords },
      attackerBefore: normalizeFleetShips({ worldEater: 5, hauler: 20 }),
      attackerAfter: normalizeFleetShips({ worldEater: 5, hauler: 20 }),
      defenderBefore: normalizeFleetShips({}),
      defenderAfter: normalizeFleetShips({}),
      defensesBefore: emptyDefenses(),
      defensesAfter: emptyDefenses(),
      loot: { metal: 0, crystal: 0, deuterium: 0 },
      debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
      outcome: "attacker_win",
      rounds: 1,
      summary: "win",
      miniResolveAvailable: true,
      miniPlanetId: miniId,
    };

    const cap = resolveMiniPlanetChoice(universe, a.player.id, fleetId, "capture");
    assert.equal(cap.ok, true);
    assert.equal(universe.planets[miniId]!.ownerPlayerId, a.player.id);
    assert.ok(isMiniPlanet(universe.planets[miniId]!));

    // Reset ownership for destroy path on a second mini.
    const mini2Id =
      universe.miniPlanetIds!.find((id) => id !== miniId) ??
      universe.miniPlanetIds![1];
    assert.ok(mini2Id);
    const mini2 = universe.planets[mini2Id]!;
    mini2.ownerPlayerId = b.player.id;
    mini2.resources = { metal: 2000, crystal: 1000, deuterium: 0 };
    mini2.buildings.solarPlant = 2;
    if (!universe.players[b.player.id]!.planetIds.includes(mini2Id)) {
      universe.players[b.player.id]!.planetIds.push(mini2Id);
    }
    const fleet2 = "flt_des";
    universe.fleets[fleet2] = {
      id: fleet2,
      ownerPlayerId: a.player.id,
      originPlanetId: a.planet.id,
      targetPlanetId: mini2Id,
      targetPlayerId: b.player.id,
      targetCoords: { ...mini2.coords },
      mission: "raid",
      ships: normalizeFleetShips({ worldEater: 5, hauler: 50 }),
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: 304_000_200,
      arrivesAt: 304_000_200,
      phase: "returning",
      reportId: "rpt_des",
    };
    universe.reports.rpt_des = {
      id: "rpt_des",
      at: 304_000_200,
      missionId: fleet2,
      attackerPlayerId: a.player.id,
      defenderPlayerId: b.player.id,
      attackerName: "Attacker",
      defenderName: "Defender",
      targetCoords: { ...mini2.coords },
      attackerBefore: normalizeFleetShips({ worldEater: 5, hauler: 50 }),
      attackerAfter: normalizeFleetShips({ worldEater: 5, hauler: 50 }),
      defenderBefore: normalizeFleetShips({}),
      defenderAfter: normalizeFleetShips({}),
      defensesBefore: emptyDefenses(),
      defensesAfter: emptyDefenses(),
      loot: { metal: 0, crystal: 0, deuterium: 0 },
      debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
      outcome: "attacker_win",
      rounds: 1,
      summary: "win",
      miniResolveAvailable: true,
      miniPlanetId: mini2Id,
    };
    const des = resolveMiniPlanetChoice(universe, a.player.id, fleet2, "destroy");
    assert.equal(des.ok, true);
    assert.equal(universe.planets[mini2Id], undefined);
    assert.ok((universe.fleets[fleet2]?.cargo.metal ?? 0) > 0);
  });

  it("xp for mini discovery is 10", () => {
    assert.equal(xpForMiniPlanetDiscovery(), 10);
  });
});
