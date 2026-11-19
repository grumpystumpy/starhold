import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  activePirateBases,
  advanceUniverse,
  createAlliance,
  createUniverse,
  graduateNewbieProtection,
  isVacationMode,
  joinAlliance,
  joinUniverse,
  launchFleet,
  migrateOrResetUniverse,
  pickRaidTarget,
  setVacationMode,
  VACATION_ATTACK_BLOCKED,
  VACATION_SEND_BLOCKED,
  type UniverseState,
} from "./index.js";

describe("vacation mode", () => {
  it("blocks new fleets while on and restores them when toggled off", () => {
    const universe = createUniverse("Vacation send", 8);
    const home = joinUniverse(universe, "Hold", 10_000_000);
    const other = joinUniverse(universe, "Far", 10_000_001);
    universe.planets[home.planet.id]!.ships.scout = 3;
    universe.planets[home.planet.id]!.resources.deuterium = 400;
    assert.equal(home.player.vacationMode, undefined);
    assert.equal(isVacationMode(home.player), false);

    const on = setVacationMode(universe, home.player.id, true);
    assert.equal(on.ok, true);
    assert.equal(typeof home.player.vacationMode?.startedAt, "number");
    const blocked = launchFleet(
      universe,
      home.player.id,
      other.planet.id,
      "deploy",
      { scout: 1 },
      10_000_100,
    );
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.error, VACATION_SEND_BLOCKED);
    assert.equal(universe.planets[home.planet.id]!.ships.scout, 3);
    assert.equal(Object.keys(universe.fleets).length, 0);

    const off = setVacationMode(universe, home.player.id, false);
    assert.equal(off.ok, true);
    assert.equal(home.player.vacationMode, undefined);
    assert.equal(isVacationMode(home.player), false);
    const sent = launchFleet(
      universe,
      home.player.id,
      other.planet.id,
      "deploy",
      { scout: 1 },
      10_000_200,
    );
    assert.equal(sent.ok, true);
    if (!sent.ok) return;
    assert.equal(sent.fleet.phase, "outbound");
    assert.equal(universe.planets[home.planet.id]!.ships.scout, 2);
  });

  it("rejects an incoming player attack while the defender is on vacation", () => {
    const universe = createUniverse("Vacation shield", 8);
    const attacker = joinUniverse(universe, "Raider", 20_000_000);
    const defender = joinUniverse(universe, "Away", 20_000_001);
    graduateNewbieProtection(universe, universe.players[defender.player.id]!);
    universe.planets[attacker.planet.id]!.ships.scout = 4;
    universe.planets[attacker.planet.id]!.resources.deuterium = 500;
    const defenderShips = universe.planets[defender.planet.id]!.ships.scout ?? 0;

    assert.equal(setVacationMode(universe, defender.player.id, true).ok, true);
    const blocked = launchFleet(
      universe,
      attacker.player.id,
      defender.planet.id,
      "raid",
      { scout: 2 },
      20_000_100,
    );
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.error, VACATION_ATTACK_BLOCKED);
    assert.equal(universe.planets[attacker.planet.id]!.ships.scout, 4);
    assert.equal(Object.keys(universe.fleets).length, 0);
    assert.equal(universe.planets[defender.planet.id]!.ships.scout ?? 0, defenderShips);

    setVacationMode(universe, defender.player.id, false);
    const allowed = launchFleet(
      universe,
      attacker.player.id,
      defender.planet.id,
      "raid",
      { scout: 2 },
      20_000_200,
    );
    assert.equal(allowed.ok, true);
  });

  it("lets an in-flight attack land with combat after the target turns vacation on", () => {
    const universe = createUniverse("Vacation inbound", 8);
    const attacker = joinUniverse(universe, "Raider", 30_000_000);
    const defender = joinUniverse(universe, "Away", 30_000_001);
    graduateNewbieProtection(universe, universe.players[defender.player.id]!);
    universe.planets[attacker.planet.id]!.ships.scout = 4;
    universe.planets[attacker.planet.id]!.resources.deuterium = 500;
    universe.planets[defender.planet.id]!.ships.scout = 1;
    const launchedAt = 30_000_100;
    const launch = launchFleet(
      universe,
      attacker.player.id,
      defender.planet.id,
      "raid",
      { scout: 2 },
      launchedAt,
    );
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    assert.equal(launch.fleet.phase, "outbound");
    assert.ok(launch.fleet.departedAt < launchedAt + 1_000);
    const turned = setVacationMode(
      universe,
      defender.player.id,
      true,
      launchedAt + 1_000,
    );
    assert.equal(turned.ok, true);
    assert.equal(universe.fleets[launch.fleet.id]?.phase, "outbound");
    advanceUniverse(universe, launch.fleet.arrivesAt);
    const mid = universe.fleets[launch.fleet.id];
    assert.ok(mid);
    assert.equal(mid.phase, "returning");
    assert.ok(mid.reportId);
    const report = universe.reports[mid.reportId];
    assert.ok(report);
    assert.ok(report.outcome === "attacker_win" || report.outcome === "defender_win");
    assert.equal(universe.planets[defender.planet.id]!.ships.scout ?? 0, 0);
  });

  it("joins a Joint Strike opened before vacation and rejects a new one", () => {
    const universe = createUniverse("Vacation ACS", 100, 100);
    const leader = joinUniverse(universe, "Leader", 80_000_000_000);
    const wing = joinUniverse(universe, "Wing", 80_000_000_001);
    const target = joinUniverse(universe, "Target", 80_000_000_002);
    const t0 = 80_000_010_000;
    assert.equal(
      createAlliance(universe, leader.player.id, "Strike Force", "stk", "open", t0).ok,
      true,
    );
    const allyId = universe.players[leader.player.id]!.allianceId!;
    assert.equal(
      joinAlliance(universe, wing.player.id, { allianceId: allyId }, t0 + 1).ok,
      true,
    );
    graduateNewbieProtection(universe, universe.players[target.player.id]!);
    universe.planets[leader.planet.id]!.ships.interceptor = 20;
    universe.planets[wing.planet.id]!.ships.interceptor = 20;
    universe.planets[leader.planet.id]!.resources.deuterium = 50_000;
    universe.planets[wing.planet.id]!.resources.deuterium = 50_000;

    const lead = launchFleet(universe, {
      playerId: leader.player.id,
      mission: "raid",
      ships: { interceptor: 8 },
      targetPlanetId: target.planet.id,
      openAcs: true,
      now: t0 + 10_000,
    });
    assert.equal(lead.ok, true);
    if (!lead.ok) return;
    const acsId = lead.fleet.acsGroupId;
    assert.ok(acsId);
    const openedAt = universe.acsGroups![acsId]!.createdAt;
    assert.equal(
      setVacationMode(universe, target.player.id, true, openedAt + 5_000).ok,
      true,
    );
    assert.equal(universe.fleets[lead.fleet.id]?.phase, "outbound");

    const join = launchFleet(universe, {
      playerId: wing.player.id,
      mission: "raid",
      ships: { interceptor: 4 },
      targetPlanetId: target.planet.id,
      acsGroupId: acsId,
      now: openedAt + 6_000,
    });
    assert.equal(join.ok, true);
    if (!join.ok) return;
    assert.equal(join.fleet.acsGroupId, acsId);
    assert.equal(universe.acsGroups![acsId]!.fleetIds.length, 2);
    assert.ok(join.fleet.departedAt > universe.players[target.player.id]!.vacationMode!.startedAt);

    const outsider = joinUniverse(universe, "Out", 80_000_000_003);
    assert.equal(
      createAlliance(
        universe,
        outsider.player.id,
        "Second Force",
        "sec",
        "open",
        openedAt + 7_000,
      ).ok,
      true,
    );
    universe.planets[outsider.planet.id]!.ships.interceptor = 10;
    universe.planets[outsider.planet.id]!.resources.deuterium = 50_000;
    const fresh = launchFleet(universe, {
      playerId: outsider.player.id,
      mission: "raid",
      ships: { interceptor: 2 },
      targetPlanetId: target.planet.id,
      openAcs: true,
      now: openedAt + 8_000,
    });
    assert.equal(fresh.ok, false);
    if (!fresh.ok) assert.equal(fresh.error, VACATION_ATTACK_BLOCKED);
    assert.equal(universe.acsGroups![acsId]!.fleetIds.length, 2);
  });

  it("lets fleets already out finish and return home", () => {
    const universe = createUniverse("Vacation return", 8);
    const home = joinUniverse(universe, "Hold", 40_000_000);
    const other = joinUniverse(universe, "Far", 40_000_001);
    universe.planets[home.planet.id]!.ships.scout = 3;
    universe.planets[home.planet.id]!.resources.deuterium = 200;
    const launch = launchFleet(
      universe,
      home.player.id,
      other.planet.id,
      "deploy",
      { scout: 2 },
      40_000_100,
    );
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    assert.equal(setVacationMode(universe, home.player.id, true).ok, true);
    assert.equal(universe.fleets[launch.fleet.id]?.phase, "outbound");
    advanceUniverse(universe, launch.fleet.arrivesAt);
    const mid = universe.fleets[launch.fleet.id];
    assert.ok(mid);
    assert.equal(mid.phase, "returning");
    assert.equal(mid.ships.scout, 2);
    advanceUniverse(universe, mid.arrivesAt);
    assert.equal(universe.fleets[launch.fleet.id], undefined);
    assert.equal(universe.planets[home.planet.id]!.ships.scout, 3);
    assert.equal(universe.planets[other.planet.id]!.ships.scout ?? 0, 0);
  });

  it("skips vacation players when a pirate picks a raid target", () => {
    const now = 1_700_000_000_000;
    const universe = createUniverse("Vacation pirates", 8);
    universe.pirateBossNextSpawnAt = Number.MAX_SAFE_INTEGER;
    const away = joinUniverse(universe, "Away", now - 100 * 86_400_000);
    const home = joinUniverse(universe, "Home", now - 100 * 86_400_000);
    for (const joined of [away, home]) {
      const player = universe.players[joined.player.id]!;
      player.attackedPiratesAt = now - 1000;
      graduateNewbieProtection(universe, player);
    }
    const awayPlanet = universe.planets[away.planet.id]!;
    const homePlanet = universe.planets[home.planet.id]!;
    const base = activePirateBases(universe).find((entry) => !entry.seasonalBoss);
    assert.ok(base);
    universe.planets = {
      [awayPlanet.id]: awayPlanet,
      [homePlanet.id]: homePlanet,
    };
    universe.pirateBases = { [base.id]: base };
    universe.alienBases = {};
    assert.equal(setVacationMode(universe, away.player.id, true).ok, true);

    const picked = pickRaidTarget(universe, base, now, "pirate");
    assert.equal(picked?.kind, "planet");
    if (picked?.kind === "planet") assert.equal(picked.planet.id, homePlanet.id);

    assert.equal(setVacationMode(universe, home.player.id, true).ok, true);
    assert.equal(pickRaidTarget(universe, base, now, "pirate"), null);

    assert.equal(setVacationMode(universe, home.player.id, false).ok, true);
    const restored = pickRaidTarget(universe, base, now + 1, "pirate");
    assert.equal(restored?.kind, "planet");
    if (restored?.kind === "planet") assert.equal(restored.planet.id, homePlanet.id);
  });

  it("loads a main-branch save without the field as off and keeps the in-flight fleet", () => {
    const path = fileURLToPath(
      new URL("./fixtures/in-flight-fleet-save.json", import.meta.url),
    );
    const before = JSON.parse(readFileSync(path, "utf8")) as UniverseState;
    const fleetId = Object.keys(before.fleets)[0];
    assert.ok(fleetId);
    const saved = before.fleets[fleetId]!;
    const ownerBefore = before.players[saved.ownerPlayerId]!;
    assert.equal(ownerBefore.vacationMode, undefined);
    const loaded = migrateOrResetUniverse(structuredClone(before));
    assert.equal(loaded.didReset, false);
    const fleet = loaded.universe.fleets[fleetId];
    assert.ok(fleet);
    assert.equal(fleet.mission, saved.mission);
    assert.equal(fleet.arrivesAt, saved.arrivesAt);
    assert.equal(fleet.ships.scout, saved.ships.scout);
    const owner = loaded.universe.players[saved.ownerPlayerId];
    assert.equal(owner?.vacationMode, undefined);
    assert.equal(isVacationMode(owner), false);
    assert.equal(owner?.name, ownerBefore.name);
    assert.equal(Object.keys(loaded.universe.fleets).length, 1);
  });
});
