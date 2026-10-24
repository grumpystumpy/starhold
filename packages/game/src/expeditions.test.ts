import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXPEDITION_SLOT, SHIPS, SHIP_ORDER } from "./catalog.js";
import {
  expeditionBlackHoleRoll,
  expeditionKindFromRoll,
  expeditionRoll,
  expeditionShipsFind,
  expeditionStarshardsFind,
  resourceFind,
  resolveExpeditionArrival,
} from "./world-expedition.js";
import {
  advanceUniverse,
  createUniverse,
  joinUniverse,
  launchFleet,
  migrateOrResetUniverse,
  playerView,
} from "./world.js";

describe("P2 expeditions", () => {
  it("maps rolls to kinds", () => {
    assert.equal(expeditionKindFromRoll(0), "resources");
    assert.equal(expeditionKindFromRoll(39), "resources");
    assert.equal(expeditionKindFromRoll(40), "ships");
    assert.equal(expeditionKindFromRoll(54), "ships");
    assert.equal(expeditionKindFromRoll(55), "nothing");
    assert.equal(expeditionKindFromRoll(67), "nothing");
    assert.equal(expeditionKindFromRoll(68), "miniPlanet");
    assert.equal(expeditionKindFromRoll(69), "miniPlanet");
    assert.equal(expeditionKindFromRoll(70), "starshards");
    assert.equal(expeditionKindFromRoll(74), "starshards");
    assert.equal(expeditionKindFromRoll(75), "newPirateBase");
    assert.equal(expeditionKindFromRoll(76), "newPirateBase");
    assert.equal(expeditionKindFromRoll(77), "newAlienBase");
    assert.equal(expeditionKindFromRoll(78), "newAlienBase");
    assert.equal(expeditionKindFromRoll(79), "pirates");
    assert.equal(expeditionKindFromRoll(99), "pirates");
  });

  it("handles black hole outcome (fleet lost completely) vs just above threshold", () => {
    const universe = createUniverse("BlackHole Test", 8);
    const p = joinUniverse(universe, "Captain", 100_000);
    const planet = universe.planets[p.planet.id]!;
    planet.ships.hauler = 10;
    planet.resources.deuterium = 10_000;

    // Find a fleetId + arrivesAt combination where expeditionBlackHoleRoll returns true
    let bhTime = 100_100;
    const fleetId = "flt_bh_test";
    while (!expeditionBlackHoleRoll(fleetId, bhTime)) {
      bhTime++;
    }

    const launch = launchFleet(universe, {
      playerId: p.player.id,
      mission: "expedition",
      targetCoords: { ...planet.coords, slot: EXPEDITION_SLOT },
      ships: { hauler: 10 },
      now: bhTime - 100,
    });
    assert.ok(launch.ok);
    if (!launch.ok) return;

    // Swap fleet ID and arrival time to match our tested seed
    delete universe.fleets[launch.fleet.id];
    launch.fleet.id = fleetId;
    launch.fleet.arrivesAt = bhTime;
    universe.fleets[fleetId] = launch.fleet;

    advanceUniverse(universe, bhTime);
    // Fleet is destroyed and lost immediately upon arrival
    assert.equal(universe.fleets[fleetId], undefined);
    const reports = Object.values(universe.expeditionReports).filter(r => r.missionId === fleetId);
    assert.equal(reports.length, 1);
    const report = reports[0]!;
    assert.equal(report.kind, "blackHole");
    assert.match(report.summary, /black hole/i);

    // Planet has 0 haulers remaining
    assert.equal(universe.planets[planet.id]!.ships.hauler ?? 0, 0);

    // Find a time where expeditionBlackHoleRoll returns false
    let normalTime = 100_100;
    while (expeditionBlackHoleRoll("flt_normal_test", normalTime)) {
      normalTime++;
    }
    const fleetId2 = "flt_normal_test";
    universe.planets[planet.id]!.ships.hauler = 10;
    const launch2 = launchFleet(universe, {
      playerId: p.player.id,
      mission: "expedition",
      targetCoords: { ...planet.coords, slot: EXPEDITION_SLOT },
      ships: { hauler: 10 },
      now: normalTime - 100,
    });
    assert.ok(launch2.ok);
    if (!launch2.ok) return;

    delete universe.fleets[launch2.fleet.id];
    launch2.fleet.id = fleetId2;
    launch2.fleet.arrivesAt = normalTime;
    universe.fleets[fleetId2] = launch2.fleet;

    advanceUniverse(universe, normalTime);
    const f2 = universe.fleets[fleetId2];
    assert.ok(f2);
    assert.ok(f2.reportId);
    const report2 = universe.expeditionReports[f2.reportId!];
    assert.notEqual(report2.kind, "blackHole");
  });

  it("nothing outcome leaves ships, resources, and XP unchanged", () => {
    const universe = createUniverse("Nothing Test", 8);
    const p = joinUniverse(universe, "Explorer", 100_000);
    const planet = universe.planets[p.planet.id]!;
    planet.ships.hauler = 5;
    planet.resources.deuterium = 5_000;
    const playerBefore = universe.players[p.player.id]!;
    const xpBefore = playerBefore.xp ?? 0;

    let time = 100_100;
    const fleetId = "flt_nothing_test";
    while (expeditionBlackHoleRoll(fleetId, time) || expeditionKindFromRoll(expeditionRoll(fleetId, time)) !== "nothing") {
      time++;
    }

    const launch = launchFleet(universe, {
      playerId: p.player.id,
      mission: "expedition",
      targetCoords: { ...planet.coords, slot: EXPEDITION_SLOT },
      ships: { hauler: 5 },
      now: time - 100,
    });
    assert.ok(launch.ok);
    if (!launch.ok) return;

    delete universe.fleets[launch.fleet.id];
    launch.fleet.id = fleetId;
    launch.fleet.arrivesAt = time;
    universe.fleets[fleetId] = launch.fleet;

    advanceUniverse(universe, time);
    const f = universe.fleets[fleetId];
    assert.ok(f && f.reportId);
    const report = universe.expeditionReports[f.reportId!];
    assert.equal(report.kind, "nothing");
    assert.deepEqual(report.cargoGained, { metal: 0, crystal: 0, deuterium: 0 });

    const playerAfter = universe.players[p.player.id]!;
    assert.equal(playerAfter.xp ?? 0, xpBefore);

    advanceUniverse(universe, f.arrivesAt);
    assert.equal(universe.planets[planet.id]!.ships.hauler, 5);
  });

  it("spawns new pirate base and new alien base in target galaxy on free slot, falling back to ambush when galaxy full", () => {
    const universe = createUniverse("New NPC Base Test", 8);
    const p = joinUniverse(universe, "Pioneer", 100_000);
    const planet = universe.planets[p.planet.id]!;
    planet.ships.hauler = 10;
    planet.resources.deuterium = 10_000;

    // 1. Spawn New Pirate Base
    let timeP = 100_100;
    const fleetIdP = "flt_new_pirate";
    while (
      expeditionBlackHoleRoll(fleetIdP, timeP) ||
      expeditionKindFromRoll(expeditionRoll(fleetIdP, timeP)) !== "newPirateBase"
    ) {
      timeP++;
    }

    universe.fleets[fleetIdP] = {
      id: fleetIdP,
      ownerPlayerId: p.player.id,
      mission: "expedition",
      originPlanetId: planet.id,
      targetCoords: { galaxy: 1, system: 1, slot: EXPEDITION_SLOT },
      ships: { hauler: 10 },
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      arrivesAt: timeP,
      returnsAt: timeP + 1000,
      phase: "outbound",
    };

    advanceUniverse(universe, timeP);
    const fP = universe.fleets[fleetIdP];
    assert.ok(fP && fP.reportId);
    const reportP = universe.expeditionReports[fP.reportId!];
    assert.equal(reportP.kind, "newPirateBase");
    assert.ok(reportP.newPirateBaseId);
    assert.ok(reportP.newBaseCoords);
    assert.equal(reportP.newBaseCoords!.galaxy, 1);
    assert.ok(reportP.newBaseCoords!.slot >= 1 && reportP.newBaseCoords!.slot <= 15);
    assert.notEqual(reportP.newBaseCoords!.slot, 16);
    assert.ok(universe.pirateBases?.[reportP.newPirateBaseId!]);
    assert.match(reportP.summary, new RegExp(`${reportP.newBaseCoords!.galaxy}:${reportP.newBaseCoords!.system}:${reportP.newBaseCoords!.slot}`));

    // 2. Spawn New Alien Base
    let timeA = 100_100;
    const fleetIdA = "flt_new_alien";
    while (
      expeditionBlackHoleRoll(fleetIdA, timeA) ||
      expeditionKindFromRoll(expeditionRoll(fleetIdA, timeA)) !== "newAlienBase"
    ) {
      timeA++;
    }

    universe.fleets[fleetIdA] = {
      id: fleetIdA,
      ownerPlayerId: p.player.id,
      mission: "expedition",
      originPlanetId: planet.id,
      targetCoords: { galaxy: 2, system: 1, slot: EXPEDITION_SLOT },
      ships: { hauler: 10 },
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      arrivesAt: timeA,
      returnsAt: timeA + 1000,
      phase: "outbound",
    };

    advanceUniverse(universe, timeA);
    const fA = universe.fleets[fleetIdA];
    assert.ok(fA && fA.reportId);
    const reportA = universe.expeditionReports[fA.reportId!];
    assert.equal(reportA.kind, "newAlienBase");
    assert.ok(reportA.newAlienBaseId);
    assert.ok(reportA.newBaseCoords);
    assert.equal(reportA.newBaseCoords!.galaxy, 2);
    assert.ok(reportA.newBaseCoords!.slot >= 1 && reportA.newBaseCoords!.slot <= 15);
    assert.notEqual(reportA.newBaseCoords!.slot, 16);
    assert.ok(universe.alienBases?.[reportA.newAlienBaseId!]);
    assert.match(reportA.summary, new RegExp(`${reportA.newBaseCoords!.galaxy}:${reportA.newBaseCoords!.system}:${reportA.newBaseCoords!.slot}`));

    // 3. Fallback when galaxy is full
    // Fill galaxy 3 slots 1..15 in all systems 1..399
    for (let sys = 1; sys <= 399; sys++) {
      for (let sl = 1; sl <= 15; sl++) {
        const dummyId = `pir_dummy_${sys}_${sl}`;
        universe.pirateBases![dummyId] = {
          id: dummyId,
          coords: { galaxy: 3, system: sys, slot: sl },
          name: "Dummy Base",
          tier: 0,
          level: 0,
          ships: {},
          defenses: {},
          resources: { metal: 0, crystal: 0, deuterium: 0 },
          lastGrewAt: 100_000,
          lastRaidAt: 100_000,
          nextRaidAt: 200_000,
          lastFreeSpawnAt: 100_000,
          destroyedAt: null,
          coalitionId: dummyId,
          splitDone: true,
        };
      }
    }

    let timeFull = 100_100;
    const fleetIdFull = "flt_full_gal";
    while (
      expeditionBlackHoleRoll(fleetIdFull, timeFull) ||
      expeditionKindFromRoll(expeditionRoll(fleetIdFull, timeFull)) !== "newPirateBase"
    ) {
      timeFull++;
    }

    universe.fleets[fleetIdFull] = {
      id: fleetIdFull,
      ownerPlayerId: p.player.id,
      mission: "expedition",
      originPlanetId: planet.id,
      targetCoords: { galaxy: 3, system: 1, slot: EXPEDITION_SLOT },
      ships: { hauler: 10 },
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      arrivesAt: timeFull,
      returnsAt: timeFull + 1000,
      phase: "outbound",
    };

    advanceUniverse(universe, timeFull);
    const fFull = universe.fleets[fleetIdFull];
    assert.ok(fFull && fFull.reportId);
    const reportFull = universe.expeditionReports[fFull.reportId!];
    // Falls back to pirate ambush
    assert.match(reportFull.summary, /pirate ambush/i);
  });

  it("launches to deep-space slot and returns with a report", () => {
    const universe = createUniverse("Expedition Drift", 8);
    const a = joinUniverse(universe, "Voyager", 140_000_000);
    universe.planets[a.planet.id].ships.scout = 2;
    universe.planets[a.planet.id].ships.hauler = 1;
    universe.planets[a.planet.id].resources.deuterium = 5_000;

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      mission: "expedition",
      targetCoords: {
        galaxy: a.planet.coords.galaxy,
        system: a.planet.coords.system,
        slot: EXPEDITION_SLOT,
      },
      ships: { scout: 2, hauler: 1 },
      now: 140_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    assert.equal(launch.fleet.targetCoords.slot, EXPEDITION_SLOT);
    assert.equal(launch.fleet.phase, "outbound");

    advanceUniverse(universe, launch.fleet.arrivesAt);
    const mid = universe.fleets[launch.fleet.id];
    assert.ok(mid);
    assert.equal(mid.phase, "returning");
    assert.ok(mid.reportId);
    const report = universe.expeditionReports[mid.reportId!];
    assert.ok(report);
    assert.ok(
      [
        "resources",
        "ships",
        "nothing",
        "pirates",
        "starshards",
        "miniPlanet",
      ].includes(report.kind),
    );

    const metalBefore = universe.planets[a.planet.id].resources.metal;
    advanceUniverse(universe, mid.arrivesAt);
    assert.equal(universe.fleets[launch.fleet.id], undefined);
    const view = playerView(universe, a.player.id, mid.arrivesAt + 1);
    assert.ok(view.expeditionReports.length >= 1);
    if (report.kind === "resources" || report.kind === "pirates") {
      assert.ok(
        universe.planets[a.planet.id].resources.metal >= metalBefore,
      );
    }
  });

  it("rejects wrong slot and enforces expedition cap at Stellar Cartography 0", () => {
    const universe = createUniverse("Cap Drift", 8);
    const a = joinUniverse(universe, "Capped", 141_000_000);
    universe.planets[a.planet.id].ships.scout = 4;
    universe.planets[a.planet.id].resources.deuterium = 5_000;
    // Extra fleet slots so Fleet OS does not mask the expedition cap.
    universe.players[a.player.id].research.computerTech = 2;
    assert.equal(universe.players[a.player.id].research.astrophysics, 0);

    const badSlot = launchFleet(universe, {
      playerId: a.player.id,
      mission: "expedition",
      targetCoords: {
        galaxy: 1,
        system: 1,
        slot: 1,
      },
      ships: { scout: 1 },
      now: 141_000_100,
    });
    assert.equal(badSlot.ok, false);

    const first = launchFleet(universe, {
      playerId: a.player.id,
      mission: "expedition",
      targetCoords: {
        galaxy: a.planet.coords.galaxy,
        system: a.planet.coords.system,
        slot: EXPEDITION_SLOT,
      },
      ships: { scout: 1 },
      now: 141_000_200,
    });
    assert.equal(first.ok, true);

    const second = launchFleet(universe, {
      playerId: a.player.id,
      mission: "expedition",
      targetCoords: {
        galaxy: a.planet.coords.galaxy,
        system: a.planet.coords.system,
        slot: EXPEDITION_SLOT,
      },
      ships: { scout: 1 },
      now: 141_000_300,
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.match(second.error, /expedition limit/i);
  });

  it("Drift Beacons add expedition slots and launch enforcement uses the added cap", () => {
    const universe = createUniverse("Beacon Expedition Cap", 8);
    const a = joinUniverse(universe, "Beacon Voyager", 142_000_000);
    const mini = universe.planets[universe.miniPlanetIds![0]!]!;
    mini.ownerPlayerId = a.player.id;
    a.player.planetIds.push(mini.id);
    mini.buildings.driftBeacon = 1;
    universe.planets[a.planet.id]!.ships.scout = 3;
    universe.planets[a.planet.id]!.resources.deuterium = 10_000;
    a.player.research.computerTech = 3;

    const launch = (now: number) => launchFleet(universe, {
      playerId: a.player.id,
      mission: "expedition",
      targetCoords: { ...a.planet.coords, slot: EXPEDITION_SLOT },
      ships: { scout: 1 },
      now,
    });
    assert.equal(launch(142_000_100).ok, true);
    assert.equal(launch(142_000_200).ok, true);
    const overCap = launch(142_000_300);
    assert.equal(overCap.ok, false);
    if (!overCap.ok) assert.match(overCap.error, /expedition limit/i);
  });

  it("expeditionRoll is stable for a fleet id + time", () => {
    assert.equal(
      expeditionRoll("flt_demo", 1_000_000),
      expeditionRoll("flt_demo", 1_000_000),
    );
    assert.notEqual(
      expeditionRoll("flt_demo", 1_000_000),
      expeditionRoll("flt_demo", 1_000_001),
    );
  });

  it("scales resource finds linearly with fleet structural (hull) points below cap", () => {
    // Hauler hull = 60, cargo = 5000.
    // 10 Haulers -> hull = 600, cargo = 50,000.
    // 20 Haulers -> hull = 1200 (exactly 2x), cargo = 100,000.
    // Both fleets are well below structural cap (10,000) and have surplus cargo.
    const fleet10 = { hauler: 10 };
    const fleet20 = { hauler: 20 };
    // Find roll 0 -> kind "resources", rollFactor = 0.55.
    const roll = 0;
    const find10 = resourceFind(fleet10, roll);
    const find20 = resourceFind(fleet20, roll);

    const total10 = find10.metal + find10.crystal + find10.deuterium;
    const total20 = find20.metal + find20.crystal + find20.deuterium;

    // Hand-computed:
    // Raw budget 10 = 600 * 15 * 0.55 = 4950.
    // Raw budget 20 = 1200 * 15 * 0.55 = 9900.
    assert.equal(total10, 4950);
    assert.equal(total20, 9900);
    assert.equal(total20, 2 * total10);
  });

  it("caps resource finds for huge fleets at EXPEDITION_STRUCTURAL_CAP", () => {
    // 500 Haulers -> hull = 30,000.
    // 1000 Haulers -> hull = 60,000.
    // Both exceed structural cap (10,000).
    const hugeFleet1 = { hauler: 500 };
    const hugeFleet2 = { hauler: 1000 };
    const roll = 0;

    const find1 = resourceFind(hugeFleet1, roll);
    const find2 = resourceFind(hugeFleet2, roll);

    const total1 = find1.metal + find1.crystal + find1.deuterium;
    const total2 = find2.metal + find2.crystal + find2.deuterium;

    // Hand-computed cap find: 10,000 * 15 * 0.55 = 82,500.
    assert.equal(total1, 82500);
    assert.equal(total2, 82500);
  });

  it("scales Starshard finds with fleet structural points up to cap", () => {
    // 100 Haulers -> hull = 6,000.
    // 200 Haulers -> hull = 12,000 (capped at 10,000).
    const fleet6k = { hauler: 100 };
    const fleet12k = { hauler: 200 };
    const roll = 70; // roll 70 -> starshards find, base = 5 + (70 % 21) = 12.

    const shards6k = expeditionStarshardsFind(fleet6k, roll);
    const shards12k = expeditionStarshardsFind(fleet12k, roll);

    // Hand-computed:
    // 6,000 / 10,000 * 12 = 7.2 -> floor(7.2) = 7.
    // 10,000 / 10,000 * 12 = 12 -> floor(12) = 12.
    assert.equal(shards6k, 7);
    assert.equal(shards12k, 12);
  });

  it("limits scout-only ship finds to ships costing no more than a Scout Skiff", () => {
    const maxCost =
      SHIPS.scout.cost.metal +
      SHIPS.scout.cost.crystal +
      SHIPS.scout.cost.deuterium;
    const allowed = SHIP_ORDER.filter((id) => {
      const cost = SHIPS[id].cost;
      return (
        id !== "voidforgeTitan" &&
        id !== "worldEater" &&
        id !== "swarmMothership" &&
        cost.metal + cost.crystal + cost.deuterium > 0 &&
        cost.metal + cost.crystal + cost.deuterium <= maxCost
      );
    });
    for (let roll = 0; roll < 100; roll++) {
      assert.ok(allowed.includes(expeditionShipsFind({ scout: 5 }, roll).shipId));
    }
  });

  it("finds ships up to the largest sent class deterministically", () => {
    const fleet = { cruiser: 2, scout: 2 };
    const pool = SHIP_ORDER.filter((id) => {
      const cost = SHIPS[id].cost;
      return (
        id !== "voidforgeTitan" &&
        id !== "worldEater" &&
        id !== "swarmMothership" &&
        cost.metal + cost.crystal + cost.deuterium > 0 &&
        cost.metal + cost.crystal + cost.deuterium <=
          SHIPS.cruiser.cost.metal +
            SHIPS.cruiser.cost.crystal +
            SHIPS.cruiser.cost.deuterium
      );
    });
    const roll = pool.indexOf("cruiser");
    assert.ok(roll >= 0);
    const found = expeditionShipsFind(fleet, roll);
    assert.deepEqual(found, expeditionShipsFind(fleet, roll));
    assert.equal(found.shipId, "cruiser");
    const foundStructure = found.count * SHIPS[found.shipId].hull;
    const fleetStructure =
      fleet.cruiser * SHIPS.cruiser.hull + fleet.scout * SHIPS.scout.hull;
    assert.ok(
      foundStructure <=
        Math.max(SHIPS[found.shipId].hull, Math.floor(fleetStructure * 0.5)),
    );
  });

  it("never finds forbidden capital ships, including on expedition arrival", () => {
    const fleetShips = { worldEater: 1, voidforgeTitan: 1, keelSovereign: 1 };
    for (let roll = 0; roll < 100; roll++) {
      const found = expeditionShipsFind(fleetShips, roll);
      assert.notEqual(found.shipId, "voidforgeTitan");
      assert.notEqual(found.shipId, "worldEater");
      assert.notEqual(found.shipId, "swarmMothership");
    }

    const universe = createUniverse("Forbidden Ship Finds", 8);
    const { player, planet } = joinUniverse(universe, "Voyager", 150_000_000);
    for (let roll = 40; roll < 55; roll++) {
      const fleet = {
        id: "",
        ownerPlayerId: player.id,
        originPlanetId: planet.id,
        targetPlanetId: null,
        targetPlayerId: null,
        targetCoords: { ...planet.coords, slot: EXPEDITION_SLOT },
        mission: "expedition" as const,
        ships: { ...fleetShips },
        cargo: { metal: 0, crystal: 0, deuterium: 0 },
        departedAt: 0,
        arrivesAt: roll,
        phase: "outbound" as const,
        reportId: null,
      };
      resolveExpeditionArrival(universe, fleet, 150_000_100 + roll);
      const report = universe.expeditionReports[fleet.reportId!];
      assert.ok(report);
      assert.equal(report.kind, "ships");
      assert.equal(report.shipsDelta.voidforgeTitan, undefined);
      assert.equal(report.shipsDelta.worldEater, undefined);
      assert.equal(report.shipsDelta.swarmMothership, undefined);
    }
  });

  it("yields identical expedition result for the same fleet and seed", () => {
    const universe1 = createUniverse("Seed Test 1", 8);
    const universe2 = createUniverse("Seed Test 2", 8);
    const a1 = joinUniverse(universe1, "Player", 100_000);
    const a2 = joinUniverse(universe2, "Player", 100_000);

    universe1.planets[a1.planet.id].ships.hauler = 20;
    universe1.planets[a1.planet.id].resources.deuterium = 5_000;
    universe2.planets[a2.planet.id].ships.hauler = 20;
    universe2.planets[a2.planet.id].resources.deuterium = 5_000;

    const launch1 = launchFleet(universe1, {
      playerId: a1.player.id,
      mission: "expedition",
      targetCoords: { ...a1.planet.coords, slot: EXPEDITION_SLOT },
      ships: { hauler: 20 },
      now: 100_100,
    });
    const launch2 = launchFleet(universe2, {
      playerId: a2.player.id,
      mission: "expedition",
      targetCoords: { ...a2.planet.coords, slot: EXPEDITION_SLOT },
      ships: { hauler: 20 },
      now: 100_100,
    });

    assert.ok(launch1.ok && launch2.ok);
    if (!launch1.ok || !launch2.ok) return;

    // Use identical fleet ID and arrival time to test deterministic roll logic
    const oldId1 = launch1.fleet.id;
    const oldId2 = launch2.fleet.id;
    delete universe1.fleets[oldId1];
    delete universe2.fleets[oldId2];
    launch1.fleet.id = "flt_seeded_1";
    launch2.fleet.id = "flt_seeded_1";
    universe1.fleets["flt_seeded_1"] = launch1.fleet;
    universe2.fleets["flt_seeded_1"] = launch2.fleet;

    advanceUniverse(universe1, launch1.fleet.arrivesAt);
    advanceUniverse(universe2, launch2.fleet.arrivesAt);

    const r1 = universe1.expeditionReports[universe1.fleets[launch1.fleet.id]!.reportId!];
    const r2 = universe2.expeditionReports[universe2.fleets[launch2.fleet.id]!.reportId!];

    assert.equal(r1.kind, r2.kind);
    assert.deepEqual(r1.cargoGained, r2.cargoGained);
    assert.equal(r1.starshardsGained, r2.starshardsGained);
  });

  it("loads an old saved state with an expedition in flight through normal save loading path and resolves without save reset", () => {
    const fresh = createUniverse("Old Save Exped", 8);
    const p = joinUniverse(fresh, "Veteran", 200_000);
    const planet = fresh.planets[p.planet.id]!;
    planet.buildings.metalMine = 12;
    planet.resources = { metal: 10_000, crystal: 5_000, deuterium: 2_000 };
    planet.ships.scout = 5;

    // Stamp as existing pre-change saved state (schemaVersion 5)
    fresh.schemaVersion = 5;

    const fleetId = "flt_old_exped_1";
    fresh.fleets[fleetId] = {
      id: fleetId,
      ownerPlayerId: p.player.id,
      mission: "expedition",
      originPlanetId: p.planet.id,
      targetCoords: { ...p.planet.coords, slot: EXPEDITION_SLOT },
      ships: { hauler: 10 },
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      arrivesAt: 200_500,
      returnsAt: 201_000,
      phase: "outbound",
    };
    const legacyReport = {
      id: "xpd_legacy",
      at: 199_000,
      missionId: "flt_legacy",
      playerId: p.player.id,
      targetCoords: { ...p.planet.coords, slot: EXPEDITION_SLOT },
      kind: "ships" as const,
      cargoGained: { metal: 0, crystal: 0, deuterium: 0 },
      shipsDelta: { scout: 2 },
      summary: "Salvage drones joined the fleet (+2 Scout Skiff).",
    };
    fresh.expeditionReports[legacyReport.id] = legacyReport;

    // Load through normal save-loading path (migrateOrResetUniverse)
    const { universe: loaded, didReset } = migrateOrResetUniverse(fresh);
    assert.equal(didReset, false);
    assert.equal(loaded.planets[p.planet.id]!.buildings.metalMine, 12);
    assert.deepEqual(loaded.expeditionReports[legacyReport.id], legacyReport);

    advanceUniverse(loaded, 200_500);

    const f = loaded.fleets[fleetId];
    assert.ok(f);
    assert.equal(f.phase, "returning");
    assert.ok(f.reportId);
    const rep = loaded.expeditionReports[f.reportId!];
    assert.ok(rep);
    assert.ok(rep.summary);

    // Existing progress (buildings, resources, ships) is kept
    assert.equal(loaded.planets[p.planet.id]!.buildings.metalMine, 12);
    assert.equal(loaded.planets[p.planet.id]!.ships.scout, 5);
    assert.ok(loaded.planets[p.planet.id]!.resources.metal >= 10_000);
  });
});
