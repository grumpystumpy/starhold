import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACS_HOLD_MAX_MS,
  ACS_JOIN_WINDOW_MS,
  advanceUniverse,
  createAlliance,
  createUniverse,
  joinAlliance,
  joinUniverse,
  launchFleet,
  leaveAcsFleet,
  playerView,
} from "./index.js";

describe("ACS joint strike", () => {
  it("create + ally join + hold + combined resolve", () => {
    const universe = createUniverse("ACS Test", 100, 100);
    const a = joinUniverse(universe, "Leader");
    const b = joinUniverse(universe, "Wing");
    assert.equal(
      createAlliance(universe, a.player.id, "Strike Force", "stk").ok,
      true,
    );
    const allyId = playerView(universe, a.player.id).alliance!.id;
    assert.equal(
      joinAlliance(universe, b.player.id, { allianceId: allyId }).ok,
      true,
    );

    // Seed ships on both home worlds.
    const pa = universe.planets[a.player.homePlanetId]!;
    const pb = universe.planets[b.player.homePlanetId]!;
    pa.ships.interceptor = 20;
    pb.ships.interceptor = 20;
    pa.resources.deuterium = 50_000;
    pb.resources.deuterium = 50_000;

    // Target: empty rival — create a third player to raid.
    const c = joinUniverse(universe, "Target");
    const target = universe.planets[c.player.homePlanetId]!;
    target.ships.scout = 2;
    target.defenses = { ...target.defenses, laserBattery: 0 };

    const t0 = Date.now();
    const lead = launchFleet(universe, {
      playerId: a.player.id,
      mission: "raid",
      ships: { interceptor: 10 },
      targetPlanetId: target.id,
      openAcs: true,
      now: t0,
    });
    assert.equal(lead.ok, true);
    assert.ok(lead.ok && lead.fleet?.acsGroupId);
    const acsId = lead.ok ? lead.fleet!.acsGroupId! : "";

    const join = launchFleet(universe, {
      playerId: b.player.id,
      mission: "raid",
      ships: { interceptor: 10 },
      targetPlanetId: target.id,
      acsGroupId: acsId,
      now: t0 + 1_000,
    });
    assert.equal(join.ok, true);
    assert.equal(join.ok && join.fleet?.acsGroupId, acsId);

    const group = universe.acsGroups![acsId]!;
    assert.equal(group.fleetIds.length, 2);
    assert.equal(group.status, "open");

    // Force lock + resolve after both would have arrived.
    const resolveAt = Math.max(
      lead.ok ? lead.fleet!.arrivesAt : 0,
      join.ok ? join.fleet!.arrivesAt : 0,
    );
    advanceUniverse(universe, resolveAt + ACS_JOIN_WINDOW_MS);
    // After join window, group locks; advance to resolvesAt.
    const g2 = universe.acsGroups![acsId]!;
    if (g2.status === "open") {
      advanceUniverse(universe, g2.joinClosesAt + 1);
    }
    const g3 = universe.acsGroups![acsId]!;
    const when = (g3.resolvesAt ?? resolveAt) + 1;
    advanceUniverse(universe, when);

    const done = universe.acsGroups![acsId];
    assert.ok(done);
    assert.equal(done!.status, "resolved");
    const reports = Object.values(universe.reports);
    assert.ok(reports.some((r) => r.acsGroupId === acsId));
    assert.ok(
      reports.some((r) => (r.summary ?? "").includes("Joint Strike")),
    );
  });

  it("rejects cross-alliance join", () => {
    const universe = createUniverse("ACS Deny", 50, 50);
    const a = joinUniverse(universe, "A");
    const b = joinUniverse(universe, "B");
    createAlliance(universe, a.player.id, "Alpha Team", "aaa");
    createAlliance(universe, b.player.id, "Beta Team", "bbb");
    const pa = universe.planets[a.player.homePlanetId]!;
    const pb = universe.planets[b.player.homePlanetId]!;
    pa.ships.interceptor = 5;
    pb.ships.interceptor = 5;
    pa.resources.deuterium = 20_000;
    pb.resources.deuterium = 20_000;
    const c = joinUniverse(universe, "Victim");
    const target = universe.planets[c.player.homePlanetId]!;

    const lead = launchFleet(universe, {
      playerId: a.player.id,
      mission: "raid",
      ships: { interceptor: 2 },
      targetPlanetId: target.id,
      openAcs: true,
    });
    assert.equal(lead.ok, true);
    const acsId = lead.ok ? lead.fleet!.acsGroupId! : "";
    const join = launchFleet(universe, {
      playerId: b.player.id,
      mission: "raid",
      ships: { interceptor: 2 },
      targetPlanetId: target.id,
      acsGroupId: acsId,
    });
    assert.equal(join.ok, false);
  });

  it("leave ACS before resolve cancels solo group", () => {
    const universe = createUniverse("ACS Leave", 20, 20);
    const a = joinUniverse(universe, "Solo");
    createAlliance(universe, a.player.id, "Lone", "lon");
    const pa = universe.planets[a.player.homePlanetId]!;
    pa.ships.interceptor = 5;
    pa.resources.deuterium = 20_000;
    const c = joinUniverse(universe, "Prey");
    const target = universe.planets[c.player.homePlanetId]!;
    const lead = launchFleet(universe, {
      playerId: a.player.id,
      mission: "raid",
      ships: { interceptor: 2 },
      targetPlanetId: target.id,
      openAcs: true,
    });
    assert.equal(lead.ok, true);
    const fleetId = lead.ok ? lead.fleet!.id : "";
    const acsId = lead.ok ? lead.fleet!.acsGroupId! : "";
    const left = leaveAcsFleet(universe, a.player.id, fleetId);
    assert.equal(left.ok, true);
    assert.equal(universe.acsGroups![acsId]?.status, "cancelled");
  });

  it("exposes open ACS groups on player view", () => {
    const universe = createUniverse("ACS View", 10, 10);
    const a = joinUniverse(universe, "V");
    createAlliance(universe, a.player.id, "Viewers", "vw");
    const pa = universe.planets[a.player.homePlanetId]!;
    pa.ships.interceptor = 3;
    pa.resources.deuterium = 10_000;
    const c = joinUniverse(universe, "T");
    launchFleet(universe, {
      playerId: a.player.id,
      mission: "raid",
      ships: { interceptor: 1 },
      targetPlanetId: c.player.homePlanetId,
      openAcs: true,
    });
    const view = playerView(universe, a.player.id);
    assert.ok(view.openAcsGroups.length >= 1);
    assert.equal(view.openAcsGroups[0]?.status, "open");
    assert.ok(ACS_JOIN_WINDOW_MS > 0);
    assert.ok(ACS_HOLD_MAX_MS > 0);
  });
});
