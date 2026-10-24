import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEBRIS_FROM_DEFENSES,
  DEBRIS_FROM_SHIPS,
  DEFENSES,
  DEFENSE_REBUILD_MINER_RATE,
  DEFENSE_REBUILD_RATE,
  EXPEDITION_AMBUSH_DEBRIS_RATE,
  EXPEDITION_SLOT,
  SHIPS,
} from "./catalog.js";
import {
  coordsKey,
  debrisFromDestroyed,
  debrisFromDestroyedDefenses,
  destroyedShipResources,
  emptyDefenses,
  emptyFleetShips,
  rebuildDefenses,
} from "./formulas.js";
import type { FleetMission, FleetShips, PlanetState, UniverseState } from "./types.js";
import { graduateNewbieProtection } from "./test-graduate.js";
import {
  advanceUniverse,
  applyNpcRaidOnNpc,
  applyNpcRaidOnPlanet,
  createPirateBase,
  createUniverse,
  expeditionKindFromRoll,
  expeditionRoll,
  joinUniverse,
  launchFleet,
  resolveExpeditionArrival,
  resolvePirateRaidArrival,
} from "./world.js";

const DAY = 24 * 60 * 60 * 1000;

function fresh(name: string, now: number) {
  const universe = createUniverse(name, 1);
  const defender = joinUniverse(universe, "Defender", now);
  const attacker = joinUniverse(universe, "Attacker", now + 1);
  graduateNewbieProtection(universe, universe.players[defender.player.id]!);
  universe.skipNpcRaids = true;
  universe.planets[attacker.planet.id]!.resources.deuterium = 50_000;
  universe.planets[defender.planet.id]!.resources.deuterium = 50_000;
  return { universe, defender, attacker };
}

function wipeDefenses(universe: UniverseState, planet: PlanetState, now: number) {
  planet.defenses = emptyDefenses();
  planet.defenses.laserBattery = 10;
  planet.ships = emptyFleetShips();
  const owner = Object.values(universe.players).find((p) => p.homePlanetId !== planet.id)!;
  const home = universe.planets[owner.homePlanetId]!;
  home.ships = emptyFleetShips();
  home.ships.interceptor = 40;
  const launch = launchFleet(universe, {
    playerId: owner.id,
    mission: "raid",
    targetPlanetId: planet.id,
    ships: { interceptor: 40 },
    now,
  });
  assert.equal(launch.ok, true, launch.ok ? "" : launch.error);
  if (!launch.ok) throw new Error(launch.error);
  advanceUniverse(universe, launch.fleet.arrivesAt);
  const report = Object.values(universe.reports).find((r) => r.missionId === launch.fleet.id);
  assert.ok(report);
  return report;
}

describe("defense rebuild and battle debris", () => {
  it("rebuilds 70% by default and 90% for a Miner", () => {
    assert.equal(DEFENSE_REBUILD_RATE, 0.7);
    assert.equal(DEFENSE_REBUILD_MINER_RATE, 0.9);
    const now = 1_600_000_000_000;
    const plain = fresh("Rebuild 70", now);
    const report = wipeDefenses(plain.universe, plain.defender.planet, now + 10);
    const lost = report.defensesDestroyed?.laserBattery ?? 0;
    assert.equal(lost, 10);
    assert.equal(report.defensesRebuilt?.laserBattery, Math.round(lost * 0.7));
    assert.equal(
      report.defensesPermanentlyLost?.laserBattery,
      lost - Math.round(lost * 0.7),
    );
    assert.equal(
      plain.universe.planets[plain.defender.planet.id]!.defenses.laserBattery,
      10 - (report.defensesPermanentlyLost?.laserBattery ?? 0),
    );

    const miner = fresh("Rebuild 90", now);
    miner.defender.player.playerClass = {
      classId: "miner",
      chosenAt: now,
      changeCount: 0,
      lastChangeAt: null,
    };
    const mined = wipeDefenses(miner.universe, miner.defender.planet, now + 10);
    assert.equal(mined.defensesDestroyed?.laserBattery, 10);
    assert.equal(mined.defensesRebuilt?.laserBattery, Math.round(10 * 0.9));
    assert.equal(mined.defensesPermanentlyLost?.laserBattery, 1);
    assert.equal(
      miner.universe.planets[miner.defender.planet.id]!.defenses.laserBattery,
      9,
    );

    const npc = createPirateBase(plain.universe.seed ?? "s", 1, 2, 3, now, 0);
    npc.defenses = emptyDefenses();
    npc.defenses.laserBattery = 10;
    npc.ships = emptyFleetShips();
    const rebuilt = rebuildDefenses(npc.defenses, emptyDefenses(), DEFENSE_REBUILD_RATE);
    assert.equal(rebuilt.defensesRebuilt.laserBattery, 7);
    assert.equal(rebuilt.defensesPermanentlyLost.laserBattery, 3);
    assert.equal(rebuilt.defensesAfter.laserBattery, 7);
  });

  it("turns 60% of destroyed ships and 5% of permanently lost defenses into debris", () => {
    assert.equal(DEBRIS_FROM_SHIPS, 0.6);
    assert.equal(DEBRIS_FROM_DEFENSES, 0.05);
    const before = emptyFleetShips();
    before.scout = 4;
    before.helioBuoy = 5;
    const after = emptyFleetShips();
    after.scout = 1;
    after.helioBuoy = 0;
    const ships = destroyedShipResources(before, after);
    assert.equal(ships.metal, 3 * SHIPS.scout.cost.metal);
    assert.equal(ships.crystal, 3 * SHIPS.scout.cost.crystal);
    assert.equal(ships.deuterium, 0);
    const field = debrisFromDestroyed(ships);
    assert.equal(field.metal, Math.floor(ships.metal * 0.6));
    assert.equal(field.crystal, Math.floor(ships.crystal * 0.6));
    assert.equal(field.deuterium, 0);
    const guns = debrisFromDestroyedDefenses({ laserBattery: 3 });
    const metal = 3 * DEFENSES.laserBattery.cost.metal;
    const crystal = 3 * DEFENSES.laserBattery.cost.crystal;
    assert.equal(guns.metal, Math.floor(metal * 0.05));
    assert.equal(guns.crystal, Math.floor(crystal * 0.05));
    assert.equal(guns.deuterium, 0);
  });

  it("drops debris at every battle's coordinates", () => {
    const now = 1_610_000_000_000;
    const { universe, defender, attacker } = fresh("All battles", now);
    defender.planet.defenses = emptyDefenses();
    defender.planet.defenses.laserBattery = 10;
    defender.planet.ships = emptyFleetShips();
    attacker.planet.ships = emptyFleetShips();
    attacker.planet.ships.interceptor = 40;
    const launch = launchFleet(universe, {
      playerId: attacker.player.id,
      mission: "raid",
      targetPlanetId: defender.planet.id,
      ships: { interceptor: 40 },
      now: now + 10,
    });
    assert.equal(launch.ok, true, launch.ok ? "" : launch.error);
    if (!launch.ok) return;
    advanceUniverse(universe, launch.fleet.arrivesAt);
    const pvp = Object.values(universe.reports).find((r) => r.missionId === launch.fleet.id)!;
    const shipDebris = debrisFromDestroyed(
      destroyedShipResources(pvp.attackerBefore, pvp.attackerAfter),
    );
    const holdDebris = debrisFromDestroyed(
      destroyedShipResources(pvp.defenderBefore, pvp.defenderAfter),
    );
    const gunDebris = debrisFromDestroyedDefenses(pvp.defensesPermanentlyLost ?? {});
    assert.equal(pvp.debrisCreated.metal, shipDebris.metal + holdDebris.metal + gunDebris.metal);
    assert.equal(
      pvp.debrisCreated.crystal,
      shipDebris.crystal + holdDebris.crystal + gunDebris.crystal,
    );
    assert.equal(pvp.debrisCreated.deuterium, 0);
    assert.equal(
      universe.debris[coordsKey(defender.planet.coords)]?.metal,
      pvp.debrisCreated.metal,
    );

    const planet = universe.planets[defender.planet.id]!;
    planet.ships = emptyFleetShips();
    planet.ships.scout = 2;
    planet.defenses = emptyDefenses();
    planet.defenses.laserBattery = 10;
    const raider = createPirateBase(universe.seed ?? universe.id, 2, 4, 6, now, 0);
    raider.ships = emptyFleetShips();
    raider.ships.interceptor = 50;
    raider.defenses = emptyDefenses();
    universe.pirateBases![raider.id] = raider;
    applyNpcRaidOnPlanet(universe, raider, planet, now + 20, "pirate", () => {});
    const npcReport = Object.values(universe.reports).find((r) => r.missionId === raider.id);
    assert.ok(npcReport);
    assert.ok((npcReport.debrisCreated.metal ?? 0) > 0);
    assert.equal(
      universe.debris[coordsKey(planet.coords)]?.metal,
      (pvp.debrisCreated.metal ?? 0) + npcReport.debrisCreated.metal,
    );
    assert.equal(npcReport.defensesRebuilt?.laserBattery, Math.round(10 * 0.7));
    assert.equal(planet.defenses.laserBattery, 7);

    const pirate = createPirateBase(universe.seed ?? universe.id, 2, 8, 5, now, 0);
    pirate.ships = emptyFleetShips();
    pirate.ships.scout = 3;
    pirate.defenses = emptyDefenses();
    pirate.defenses.laserBattery = 10;
    universe.pirateBases![pirate.id] = pirate;
    const strike = emptyFleetShips();
    strike.interceptor = 40;
    resolvePirateRaidArrival(
      universe,
      fleetAt(attacker.player.id, attacker.planet.id, pirate, strike, now + 30),
      now + 30,
    );
    const hit = Object.values(universe.reports).find((r) => r.missionId !== raider.id && r.targetCoords.slot === 5);
    assert.ok(hit);
    assert.ok((universe.debris[coordsKey(pirate.coords)]?.metal ?? 0) > 0);
    assert.equal(hit.debrisCreated.metal, universe.debris[coordsKey(pirate.coords)]?.metal);
    assert.equal(hit.defensesDestroyed?.laserBattery, 10);
    assert.equal(hit.defensesRebuilt?.laserBattery, Math.round(10 * 0.7));
    assert.equal(hit.defensesPermanentlyLost?.laserBattery, 3);
    // Winning the raid destroys the base. Rebuild is on the report; the wreck is emptied.
    assert.ok(pirate.destroyedAt != null);
    assert.equal(pirate.defenses.laserBattery, 0);
    assert.equal(Object.values(universe.planets).some((p) => p.parentPlanetId === pirate.id), false);

    const left = createPirateBase(universe.seed ?? universe.id, 3, 3, 3, now, 0, "coal-a");
    const right = createPirateBase(universe.seed ?? universe.id, 3, 3, 4, now, 0, "coal-b");
    left.ships = emptyFleetShips();
    left.ships.interceptor = 25;
    left.defenses = emptyDefenses();
    right.ships = emptyFleetShips();
    right.ships.scout = 4;
    right.defenses = emptyDefenses();
    right.defenses.laserBattery = 10;
    universe.pirateBases![left.id] = left;
    universe.pirateBases![right.id] = right;
    const planetsBefore = Object.keys(universe.planets).length;
    applyNpcRaidOnNpc(universe, left, right, now + 40, () => {}, () => {});
    assert.ok((universe.debris[coordsKey(right.coords)]?.metal ?? 0) > 0);
    assert.equal(right.defenses.laserBattery, 7);
    assert.equal(Object.keys(universe.planets).length, planetsBefore);
  });

  it("forms a moon from an NPC raid on a player planet when the roll allows", () => {
    const now = 1_620_000_000_000;
    const universe = createUniverse("Npc moon", 1);
    universe.skipNpcRaids = true;
    const defender = joinUniverse(universe, "Defender", now);
    const planet = universe.planets[defender.planet.id]!;
    const raider = createPirateBase(universe.seed ?? universe.id, 4, 4, 4, now, 0);
    raider.defenses = emptyDefenses();
    universe.pirateBases![raider.id] = raider;
    let formed = false;
    for (let n = 0; n < 40 && !formed; n++) {
      if (planet.moonId) {
        delete universe.planets[planet.moonId];
        planet.moonId = null;
      }
      planet.ships = emptyFleetShips();
      planet.ships.cruiser = 2_500;
      planet.defenses = emptyDefenses();
      raider.ships = emptyFleetShips();
      raider.ships.cruiser = 2_500;
      raider.destroyedAt = null;
      applyNpcRaidOnPlanet(universe, raider, planet, now + n, "pirate", () => {});
      formed = Boolean(planet.moonId && universe.planets[planet.moonId]?.kind === "moon");
    }
    assert.equal(formed, true);

    const slot16: PlanetState = {
      ...planet,
      id: "slot16",
      name: "Deep",
      coords: { ...planet.coords, slot: 16 },
      moonId: null,
      parentPlanetId: null,
      ships: emptyFleetShips(),
      defenses: emptyDefenses(),
    };
    slot16.ships.cruiser = 2_500;
    universe.planets[slot16.id] = slot16;
    const deep = createPirateBase(
      universe.seed ?? "s",
      slot16.coords.galaxy,
      slot16.coords.system,
      9,
      now,
      0,
    );
    deep.ships = emptyFleetShips();
    deep.ships.cruiser = 2_500;
    deep.defenses = emptyDefenses();
    universe.pirateBases![deep.id] = deep;
    applyNpcRaidOnPlanet(universe, deep, slot16, now + 100, "pirate", () => {});
    assert.equal(slot16.moonId ?? null, null);
  });

  it("keeps existing debris and asteroids and does not expire debris", () => {
    const now = 1_630_000_000_000;
    const universe = createUniverse("Keep debris", 1);
    universe.skipNpcRaids = true;
    const { planet } = joinUniverse(universe, "Keeper", now);
    const keep = coordsKey({ galaxy: planet.coords.galaxy, system: planet.coords.system, slot: 3 });
    const rock = `ast-${planet.coords.galaxy}-${planet.coords.system}`;
    universe.debris[keep] = {
      coords: { galaxy: planet.coords.galaxy, system: planet.coords.system, slot: 3 },
      metal: 80,
      crystal: 15,
    };
    universe.asteroids[rock] = {
      id: rock,
      coords: { galaxy: planet.coords.galaxy, system: planet.coords.system, slot: 15 },
      metal: 40,
      crystal: 10,
      deuterium: 2,
      richness: 3,
    };
    const { attacker } = (() => {
      const joined = joinUniverse(universe, "Raider", now + 1);
      return { attacker: joined };
    })();
    graduateNewbieProtection(universe, universe.players[planet.ownerPlayerId]!);
    universe.planets[attacker.planet.id]!.resources.deuterium = 20_000;
    universe.planets[attacker.planet.id]!.ships = emptyFleetShips();
    universe.planets[attacker.planet.id]!.ships.interceptor = 15;
    planet.ships = emptyFleetShips();
    planet.ships.scout = 6;
    const launch = launchFleet(universe, {
      playerId: attacker.player.id,
      mission: "raid",
      targetPlanetId: planet.id,
      ships: { interceptor: 15 },
      now: now + 5,
    });
    assert.equal(launch.ok, true, launch.ok ? "" : launch.error);
    if (!launch.ok) return;
    advanceUniverse(universe, launch.fleet.arrivesAt);
    assert.equal(universe.debris[keep]?.metal, 80);
    assert.equal(universe.debris[keep]?.crystal, 15);
    assert.equal(universe.asteroids[rock]?.metal, 40);
    assert.equal(universe.asteroids[rock]?.richness, 3);
    assert.ok((universe.debris[coordsKey(planet.coords)]?.metal ?? 0) > 0);
    const battleMetal = universe.debris[coordsKey(planet.coords)]!.metal;
    universe.skipNpcRaids = true;
    advanceUniverse(universe, now + 30 * DAY);
    assert.equal(universe.debris[keep]?.metal, 80);
    assert.equal(universe.debris[keep]?.crystal, 15);
    assert.equal(universe.debris[coordsKey(planet.coords)]?.metal, battleMetal);
    assert.equal(universe.asteroids[rock]?.metal, 40);
  });

  it("leaves 40% ambush debris at slot 16 and lets a harvester collect it", () => {
    assert.equal(EXPEDITION_AMBUSH_DEBRIS_RATE, 0.4);
    assert.equal(EXPEDITION_SLOT, 16);
    const now = 1_640_000_000_000;
    const universe = createUniverse("Ambush", 1);
    universe.skipNpcRaids = true;
    const { player, planet } = joinUniverse(universe, "Pilot", now);
    let stamp = now;
    let fleetId = "amb-0";
    for (let n = 0; n < 400; n++) {
      fleetId = `amb-${n}`;
      stamp = now + n;
      if (expeditionKindFromRoll(expeditionRoll(fleetId, stamp)) === "pirates") break;
    }
    const ships = emptyFleetShips();
    ships.scout = 10;
    ships.helioBuoy = 5;
    const fleet: FleetMission = {
      id: fleetId,
      ownerPlayerId: player.id,
      originPlanetId: planet.id,
      targetPlanetId: null,
      targetPlayerId: null,
      targetCoords: { galaxy: planet.coords.galaxy, system: planet.coords.system, slot: 16 },
      mission: "expedition",
      ships,
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: stamp - 1,
      arrivesAt: stamp,
      phase: "outbound",
      reportId: null,
    };
    universe.fleets[fleet.id] = fleet;
    resolveExpeditionArrival(universe, fleet, stamp);
    const lost = destroyedShipResources(ships, fleet.ships);
    const report = universe.expeditionReports?.[fleet.reportId ?? ""];
    assert.ok(report);
    assert.equal(report.kind, "pirates");
    assert.equal(report.debrisCreated?.metal, Math.floor(lost.metal * 0.4));
    assert.equal(report.debrisCreated?.crystal, Math.floor(lost.crystal * 0.4));
    assert.equal(report.debrisCreated?.deuterium, 0);
    assert.ok((report.debrisCreated?.metal ?? 0) > 0);
    const at = coordsKey({
      galaxy: planet.coords.galaxy,
      system: planet.coords.system,
      slot: 16,
    });
    assert.equal(universe.debris[at]?.metal, report.debrisCreated?.metal);

    // The ambush fleet is still in flight and occupies the only Fleet OS slot.
    delete universe.fleets[fleet.id];

    const denied = launchFleet(universe, {
      playerId: player.id,
      mission: "harvest",
      targetCoords: { galaxy: 1, system: 2, slot: 16 },
      ships: { recycler: 1 },
      now: stamp + 10,
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.match(denied.error, /bounds|No debris/i);

    const outOfBounds = launchFleet(universe, {
      playerId: player.id,
      mission: "harvest",
      targetCoords: { galaxy: planet.coords.galaxy, system: planet.coords.system, slot: 17 },
      ships: { recycler: 1 },
      now: stamp + 11,
    });
    assert.equal(outOfBounds.ok, false);
    if (!outOfBounds.ok) assert.match(outOfBounds.error, /bounds/i);

    const home = universe.planets[planet.id]!;
    home.ships = emptyFleetShips();
    home.ships.recycler = 1;
    home.resources.deuterium = 20_000;
    const harvest = launchFleet(universe, {
      playerId: player.id,
      mission: "harvest",
      targetCoords: { galaxy: planet.coords.galaxy, system: planet.coords.system, slot: 16 },
      ships: { recycler: 1 },
      now: stamp + 12,
    });
    assert.equal(harvest.ok, true, harvest.ok ? "" : harvest.error);
    if (!harvest.ok) return;
    advanceUniverse(universe, harvest.fleet.arrivesAt);
    const hauler = universe.fleets[harvest.fleet.id];
    assert.ok(hauler);
    assert.ok(hauler.cargo.metal + hauler.cargo.crystal > 0);
  });
});

function fleetAt(
  playerId: string,
  originId: string,
  base: { id: string; coords: { galaxy: number; system: number; slot: number } },
  ships: FleetShips,
  now: number,
): FleetMission {
  return {
    id: `hit-${base.id}`,
    ownerPlayerId: playerId,
    originPlanetId: originId,
    targetPlanetId: null,
    targetPlayerId: null,
    targetPirateBaseId: base.id,
    targetCoords: { ...base.coords },
    mission: "pirateRaid",
    ships,
    cargo: { metal: 0, crystal: 0, deuterium: 0 },
    departedAt: now,
    arrivesAt: now,
    phase: "outbound",
    reportId: null,
  };
}
