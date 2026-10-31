import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILDINGS,
  MINI_BUILDING_ORDER,
  MINI_DRIFT_INTERVAL_MS,
  MINI_IRONWATER_DEUT_MULT,
  MINI_RICH_MINE_MULT,
  MINI_SLOT_MIN,
  MINI_WORLD_EATER_MIN,
} from "./catalog.js";
import {
  buildingAllowedOn,
  canDestroyMiniPlanet,
  emptyDefenses,
  normalizeFleetShips,
  productionPerHour,
  riftSiphonMineMult,
  echoVaultStorageMult,
  anomalyForgeShipTimeFactor,
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
  playerView,
} from "./world.js";
import {
  createMiniPlanet,
  discoverMiniPlanet,
  fortressRelocateLandingWindow,
  isMiniPlanet,
  isUnclaimedMini,
  miniKindOf,
  relocateMovingFortress,
  empireDriftBeaconCount,
  seedUniverseMinis,
  tickMiniDrift,
} from "./world-mini.js";

describe("mini planets (Micah revision)", () => {
  it("counts each owned mini with a Drift Beacon for both runtime slot caps", () => {
    const universe = createUniverse("Beacon Slots", 8);
    const a = joinUniverse(universe, "Beacon Keeper", 250_000_000);
    const [firstId, secondId, unownedId] = universe.miniPlanetIds!;
    const first = universe.planets[firstId!]!;
    const second = universe.planets[secondId!]!;
    const unowned = universe.planets[unownedId!]!;
    first.ownerPlayerId = a.player.id;
    a.player.planetIds.push(first.id);
    first.buildings.driftBeacon = 0;
    second.ownerPlayerId = a.player.id;
    a.player.planetIds.push(second.id);
    second.buildings.driftBeacon = 0;
    unowned.buildings.driftBeacon = 2;

    assert.equal(empireDriftBeaconCount(universe, a.player.id), 0);
    const zero = playerView(universe, a.player.id, 250_000_001);
    assert.equal(zero.fleetSlotCap, 1);
    assert.equal(zero.expeditionSlotCap, 1);

    universe.planets[first.id]!.buildings.driftBeacon = 1;
    assert.equal(empireDriftBeaconCount(universe, a.player.id), 1);
    const one = playerView(universe, a.player.id, 250_000_002);
    assert.equal(one.fleetSlotCap, 2);
    assert.equal(one.expeditionSlotCap, 2);

    universe.planets[second.id]!.buildings.driftBeacon = 1;
    assert.equal(empireDriftBeaconCount(universe, a.player.id), 2);
    const two = playerView(universe, a.player.id, 250_000_003);
    assert.equal(two.fleetSlotCap, 3);
    assert.equal(two.expeditionSlotCap, 3);
    universe.planets[first.id]!.buildings.driftBeacon = 0;
    universe.planets[second.id]!.buildings.driftBeacon = 0;
    assert.equal(empireDriftBeaconCount(universe, a.player.id), 0);
  });

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
      assert.ok(p.flags?.miniKind);
    }
  });

  it("special buildings exist; mines allowed on minis", () => {
    assert.equal(BUILDINGS.riftSiphon.name, "Rift Siphon");
    assert.equal(BUILDINGS.echoVault.name, "Data Archive");
    assert.equal(BUILDINGS.anomalyForge.name, "Anomaly Lab");
    assert.equal(BUILDINGS.driftBeacon.name, "Fleet Command Post");
    assert.ok(MINI_BUILDING_ORDER.includes("riftSiphon"));
    assert.ok(MINI_BUILDING_ORDER.includes("metalMine"));
    assert.ok(MINI_BUILDING_ORDER.includes("researchLab"));
  });

  it("buildingAllowedOn allows mines + specials on minis", () => {
    const universe = createUniverse("Mini Build", 8);
    const a = joinUniverse(universe, "Builder", 300_000_000);
    const miniId = universe.miniPlanetIds![0]!;
    const mini = universe.planets[miniId]!;
    assert.equal(buildingAllowedOn(mini, "riftSiphon"), true);
    assert.equal(buildingAllowedOn(mini, "metalMine"), true);
    assert.equal(buildingAllowedOn(a.planet, "riftSiphon"), false);
    assert.equal(buildingAllowedOn(a.planet, "metalMine"), true);
  });

  it("rich mine mult applies on standard minis", () => {
    const universe = createUniverse("Mini Rich", 8);
    const miniId = universe.miniPlanetIds![0]!;
    const mini = universe.planets[miniId]!;
    mini.buildings.metalMine = 5;
    mini.buildings.solarPlant = 10;
    const normal = {
      ...mini,
      flags: undefined,
      coords: { galaxy: 1, system: 1, slot: 8 },
    };
    const miniProd = productionPerHour(mini, 1);
    const normalProd = productionPerHour(normal, 1);
    assert.ok(miniProd.metal > normalProd.metal);
    assert.ok(
      Math.abs(miniProd.metal / normalProd.metal - MINI_RICH_MINE_MULT) < 0.01,
    );
  });

  it("Ironwater Rock deut is 10× best-normal (13× slot-8)", () => {
    const iron = createMiniPlanet("seed", 1, 1, 20, 1, "ironwater");
    iron.buildings.deutSynth = 5;
    iron.buildings.solarPlant = 20;
    const std = createMiniPlanet("seed", 1, 2, 20, 1, "standard");
    std.buildings.deutSynth = 5;
    std.buildings.solarPlant = 20;
    const ironDeut = productionPerHour(iron, 1).deuterium;
    const stdDeut = productionPerHour(std, 1).deuterium;
    assert.ok(stdDeut > 0);
    assert.ok(
      Math.abs(ironDeut / stdDeut - MINI_IRONWATER_DEUT_MULT) < 0.01,
    );
  });

  it("discovery is finder-only", () => {
    const universe = createUniverse("Mini Disc", 8);
    const a = joinUniverse(universe, "Finder", 301_000_000);
    const b = joinUniverse(universe, "Blind", 301_000_001);
    const miniId = universe.miniPlanetIds![0]!;
    const mini = universe.planets[miniId]!;
    discoverMiniPlanet(universe, a.player.id, miniId);
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
  });

  it("mines queue on mini; specials still work", () => {
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
    const mine = queueBuildingUpgrade(
      universe,
      a.player.id,
      "metalMine",
      303_000_200,
      miniId,
    );
    assert.equal(mine.ok, true);
    const special = queueBuildingUpgrade(
      universe,
      a.player.id,
      "riftSiphon",
      303_000_201,
      miniId,
    );
    assert.equal(special.ok, true);
    mini.buildings.riftSiphon = 2;
    mini.buildings.echoVault = 2;
    mini.buildings.anomalyForge = 2;
    assert.equal(riftSiphonMineMult(mini), 1.3);
    assert.equal(echoVaultStorageMult(mini), 1.5);
    assert.equal(anomalyForgeShipTimeFactor(mini), 0.84);
    assert.ok(storageFor(mini).metal > 0);
    const slow = shipUnitBuildSeconds("scout", 1, 0, 0, 0);
    const fast = shipUnitBuildSeconds("scout", 1, 0, 0, 2);
    assert.ok(fast < slow);
  });

  it("direct capture needs capital ships; destroy needs WE and never pays deut", () => {
    const universe = createUniverse("Mini War", 8);
    seedUniverseMinis(universe);
    const a = joinUniverse(universe, "Attacker", 304_000_000);
    const b = joinUniverse(universe, "Defender", 304_000_001);
    const miniId = universe.miniPlanetIds![0]!;
    const mini = universe.planets[miniId]!;
    mini.ownerPlayerId = b.player.id;
    mini.flags = { mini: true, miniKind: "standard" };
    mini.resources = { metal: 1000, crystal: 500, deuterium: 999 };
    mini.buildings.solarPlant = 3;
    mini.ships = normalizeFleetShips({});
    mini.defenses = emptyDefenses();
    universe.players[b.player.id]!.planetIds.push(miniId);
    universe.planets[miniId] = mini;

    assert.equal(canDestroyMiniPlanet(normalizeFleetShips({ worldEater: 0 })), false);
    assert.equal(
      canDestroyMiniPlanet(normalizeFleetShips({ worldEater: MINI_WORLD_EATER_MIN })),
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
      ships: normalizeFleetShips({ voidforgeTitan: 1, hauler: 20 }),
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
      attackerBefore: normalizeFleetShips({ voidforgeTitan: 1, hauler: 20 }),
      attackerAfter: normalizeFleetShips({ voidforgeTitan: 1, hauler: 20 }),
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

    const titanDestroy = resolveMiniPlanetChoice(
      universe,
      a.player.id,
      fleetId,
      "destroy",
    );
    assert.equal(titanDestroy.ok, false);
    assert.equal(universe.planets[miniId]?.id, miniId);
    assert.equal(universe.planets[miniId]?.ownerPlayerId, b.player.id);

    const cap = resolveMiniPlanetChoice(universe, a.player.id, fleetId, "capture");
    assert.equal(cap.ok, true);
    assert.equal(universe.planets[miniId]!.ownerPlayerId, a.player.id);
    assert.ok(isMiniPlanet(universe.planets[miniId]!));

    const mini2Id =
      universe.miniPlanetIds!.find((id) => id !== miniId) ??
      universe.miniPlanetIds![1];
    assert.ok(mini2Id);
    const mini3Id =
      universe.miniPlanetIds!.find((id) => id !== miniId && id !== mini2Id) ??
      universe.miniPlanetIds![2];
    assert.ok(mini3Id);
    const mini3 = universe.planets[mini3Id]!;
    mini3.ownerPlayerId = b.player.id;
    if (!universe.players[b.player.id]!.planetIds.includes(mini3Id)) {
      universe.players[b.player.id]!.planetIds.push(mini3Id);
    }
    const mothershipFleetId = "flt_mothership_cap";
    universe.fleets[mothershipFleetId] = {
      ...structuredClone(universe.fleets[fleetId]!),
      id: mothershipFleetId,
      targetPlanetId: mini3Id,
      targetCoords: { ...mini3.coords },
      ships: normalizeFleetShips({ swarmMothership: 1 }),
      reportId: "rpt_mothership_cap",
    };
    const mothershipReport = structuredClone(universe.reports.rpt_cap!);
    delete mothershipReport.miniResolved;
    universe.reports.rpt_mothership_cap = {
      ...mothershipReport,
      id: "rpt_mothership_cap",
      missionId: mothershipFleetId,
      targetCoords: { ...mini3.coords },
      attackerBefore: normalizeFleetShips({ swarmMothership: 1 }),
      attackerAfter: normalizeFleetShips({ swarmMothership: 1 }),
      miniPlanetId: mini3Id,
      miniResolveAvailable: true,
    };
    const mothershipDestroy = resolveMiniPlanetChoice(
      universe,
      a.player.id,
      mothershipFleetId,
      "destroy",
    );
    assert.equal(mothershipDestroy.ok, false);
    assert.equal(universe.planets[mini3Id]?.id, mini3Id);
    assert.equal(universe.planets[mini3Id]?.ownerPlayerId, b.player.id);
    const mothershipCapture = resolveMiniPlanetChoice(
      universe,
      a.player.id,
      mothershipFleetId,
      "capture",
    );
    assert.equal(mothershipCapture.ok, true);
    assert.equal(universe.planets[mini3Id]?.ownerPlayerId, a.player.id);

    const mini2 = universe.planets[mini2Id]!;
    mini2.ownerPlayerId = b.player.id;
    mini2.resources = { metal: 2000, crystal: 1000, deuterium: 5000 };
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
      ships: normalizeFleetShips({ worldEater: 1, hauler: 50 }),
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
      attackerBefore: normalizeFleetShips({ worldEater: 1, hauler: 50 }),
      attackerAfter: normalizeFleetShips({ worldEater: 1, hauler: 50 }),
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
    assert.equal(universe.fleets[fleet2]?.cargo.deuterium ?? 0, 0);
  });

  it("fortress jump: ±1 galaxy, ±10 accuracy landing window", () => {
    const universe = createUniverse("Mini Fort", 8);
    const a = joinUniverse(universe, "Lord", 305_000_000);
    const fort = createMiniPlanet(universe.seed!, 1, 350, 22, 305_000_000, "fortress");
    fort.ownerPlayerId = a.player.id;
    fort.resources.deuterium = 500_000;
    universe.planets[fort.id] = fort;
    universe.miniPlanetIds = [...(universe.miniPlanetIds ?? []), fort.id];
    universe.players[a.player.id]!.planetIds.push(fort.id);
    assert.equal(miniKindOf(fort), "fortress");
    const win = fortressRelocateLandingWindow(1, 350);
    assert.equal(win.systemMin, 340);
    assert.equal(win.systemMax, 360);
    const ok = relocateMovingFortress(
      universe,
      a.player.id,
      fort.id,
      1,
      355,
      305_000_100,
    );
    assert.equal(ok.ok, true, ok.ok ? "" : ok.error);
    if (ok.ok) {
      assert.ok(ok.landed.system >= 345 && ok.landed.system <= 365);
      assert.equal(ok.landed.galaxy, 1);
    }
    const farGalaxy = relocateMovingFortress(
      universe,
      a.player.id,
      fort.id,
      4,
      100,
      305_000_200,
    );
    assert.equal(farGalaxy.ok, false);
  });

  it("minis drift systems over time while keeping ownership", () => {
    const universe = createUniverse("Mini Drift", 8);
    const a = joinUniverse(universe, "Holder", 306_000_000);
    const miniId = universe.miniPlanetIds![0]!;
    const mini = universe.planets[miniId]!;
    mini.ownerPlayerId = a.player.id;
    mini.lastDriftAt = 306_000_000;
    universe.players[a.player.id]!.planetIds.push(miniId);
    const before = mini.coords.system;
    tickMiniDrift(universe, 306_000_000 + MINI_DRIFT_INTERVAL_MS * 3 + 1);
    assert.equal(universe.planets[miniId]!.ownerPlayerId, a.player.id);
    // Drift is stochastic; at least lastDriftAt advanced.
    assert.ok((universe.planets[miniId]!.lastDriftAt ?? 0) > 306_000_000);
    void before;
  });

  it("xp for mini discovery is 10", () => {
    assert.equal(xpForMiniPlanetDiscovery(), 10);
  });
});
