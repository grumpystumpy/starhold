import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACS_MIN_FLEETS_TO_RESOLVE } from "./catalog.js";
import {
  advanceUniverse,
  createAlliance,
  createUniverse,
  joinAlliance,
  joinUniverse,
  launchFleet,
  leaveAcsFleet,
  recallFleet,
} from "./index.js";
import { graduateNewbieProtection } from "./test-graduate.js";

function raidSetup() {
  const universe = createUniverse("Recall", 8, 8);
  const attacker = joinUniverse(universe, "Recall Commander");
  const defender = joinUniverse(universe, "Recall Target");
  graduateNewbieProtection(universe, universe.players[defender.player.id]!);
  const origin = universe.planets[attacker.planet.id]!;
  origin.ships.scout = 4;
  origin.resources.deuterium = 50_000;
  const now = 50_000_000;
  const launch = launchFleet(universe, {
    playerId: attacker.player.id,
    mission: "raid",
    ships: { scout: 1 },
    targetPlanetId: defender.planet.id,
    now,
  });
  assert.equal(launch.ok, true);
  if (!launch.ok) throw new Error(launch.error);
  return { universe, attacker, defender, origin, launch, now };
}

describe("recallFleet", () => {
  it("turns an outbound fleet around after the time already flown and does not refund fuel", () => {
    const { universe, attacker, launch } = raidSetup();
    const origin = universe.planets[attacker.planet.id]!;
    const deut = origin.resources.deuterium;
    const hangar = origin.ships.scout ?? 0;
    const oneWay = launch.fleet.arrivesAt - launch.fleet.departedAt;
    assert.ok(oneWay > 2);
    const mid = launch.fleet.departedAt + Math.floor(oneWay / 2);
    const recalled = recallFleet(universe, attacker.player.id, launch.fleet.id, mid);
    assert.equal(recalled.ok, true);
    if (!recalled.ok) return;
    const flown = mid - launch.fleet.departedAt;
    const live = universe.planets[attacker.planet.id]!;
    assert.equal(recalled.fleet.phase, "returning");
    assert.equal(recalled.fleet.arrivesAt, mid + flown);
    assert.equal(recalled.fleet.acsGroupId ?? null, null);
    assert.equal(live.resources.deuterium, deut);
    assert.equal(live.ships.scout, hangar);

    advanceUniverse(universe, recalled.fleet.arrivesAt);
    const home = universe.planets[attacker.planet.id]!;
    assert.equal(universe.fleets[launch.fleet.id], undefined);
    assert.equal(home.ships.scout, hangar + 1);
    assert.ok(home.resources.deuterium <= deut || home.resources.deuterium < deut + 1_000);
  });

  it("rejects fleets that are not the caller's, not outbound, pirate, or already resolved", () => {
    const { universe, attacker, defender, launch, now } = raidSetup();
    const other = recallFleet(universe, defender.player.id, launch.fleet.id, now);
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.error, "Fleet not found.");

    const fleet = universe.fleets[launch.fleet.id]!;
    fleet.phase = "returning";
    const returning = recallFleet(universe, attacker.player.id, fleet.id, now);
    assert.equal(returning.ok, false);
    if (!returning.ok) {
      assert.equal(returning.error, "Only an outbound fleet can be recalled.");
    }
    fleet.phase = "holding";
    const holding = recallFleet(universe, attacker.player.id, fleet.id, now);
    assert.equal(holding.ok, false);
    if (!holding.ok) {
      assert.equal(holding.error, "Only an outbound fleet can be recalled.");
    }

    fleet.phase = "outbound";
    fleet.reportId = "already-fought";
    const resolved = recallFleet(universe, attacker.player.id, fleet.id, now);
    assert.equal(resolved.ok, false);
    if (!resolved.ok) assert.equal(resolved.error, "Fleet is already resolved.");
    fleet.reportId = null;

    universe.fleets.npc1 = {
      ...fleet,
      id: "npc1",
      ownerPlayerId: "npc_pirates",
      originPirateBaseId: "pir:1:1:1",
      originPlanetId: "",
      phase: "outbound",
      reportId: null,
    };
    const pirate = recallFleet(universe, "npc_pirates", "npc1", now);
    assert.equal(pirate.ok, false);
    if (!pirate.ok) assert.equal(pirate.error, "NPC fleets cannot be recalled.");
    assert.equal(universe.fleets.npc1?.phase, "outbound");

    const missing = recallFleet(universe, attacker.player.id, "nope", now);
    assert.equal(missing.ok, false);
  });

  it("detaches a Joint Strike fleet so the group cancels below the minimum", () => {
    const universe = createUniverse("Recall ACS", 8, 8);
    const leader = joinUniverse(universe, "Recall Lead");
    const wing = joinUniverse(universe, "Recall Wing");
    assert.equal(createAlliance(universe, leader.player.id, "Recall ACS", "rac").ok, true);
    const allianceId = Object.values(universe.alliances ?? {})[0]!.id;
    assert.equal(joinAlliance(universe, wing.player.id, { allianceId }).ok, true);
    const target = joinUniverse(universe, "Recall Victim");
    graduateNewbieProtection(universe, universe.players[target.player.id]!);

    const home = universe.planets[leader.planet.id]!;
    const wingHome = universe.planets[wing.planet.id]!;
    home.ships.scout = 3;
    wingHome.ships.scout = 3;
    home.resources.deuterium = 50_000;
    wingHome.resources.deuterium = 50_000;
    const now = 60_000_000;
    const lead = launchFleet(universe, {
      playerId: leader.player.id,
      mission: "raid",
      ships: { scout: 1 },
      targetPlanetId: target.planet.id,
      openAcs: true,
      now,
    });
    assert.equal(lead.ok, true);
    if (!lead.ok) return;
    const groupId = lead.fleet.acsGroupId!;
    const joined = launchFleet(universe, {
      playerId: wing.player.id,
      mission: "raid",
      ships: { scout: 1 },
      targetPlanetId: target.planet.id,
      acsGroupId: groupId,
      now: now + 1_000,
    });
    assert.equal(joined.ok, true);
    if (!joined.ok) return;

    const deut = home.resources.deuterium;
    const leadOne = lead.fleet.arrivesAt - lead.fleet.departedAt;
    assert.ok(leadOne > 2);
    const recallAt = lead.fleet.departedAt + Math.floor(leadOne / 3);
    const recalled = recallFleet(universe, leader.player.id, lead.fleet.id, recallAt);
    assert.equal(recalled.ok, true);
    if (!recalled.ok) return;
    assert.equal(recalled.fleet.phase, "returning");
    assert.equal(recalled.fleet.acsGroupId ?? null, null);
    assert.equal(recalled.fleet.arrivesAt, recallAt + (recallAt - lead.fleet.departedAt));
    assert.equal(home.resources.deuterium, deut);
    const group = universe.acsGroups![groupId]!;
    assert.equal(group.fleetIds.includes(lead.fleet.id), false);
    assert.equal(group.fleetIds.includes(joined.fleet.id), true);
    assert.equal(universe.fleets[joined.fleet.id]?.phase, "outbound");

    const wingDeut = wingHome.resources.deuterium;
    const wingOne = joined.fleet.arrivesAt - joined.fleet.departedAt;
    const wingRecallAt = joined.fleet.departedAt + Math.floor(wingOne / 3);
    assert.ok(wingRecallAt < joined.fleet.arrivesAt);
    const second = recallFleet(universe, wing.player.id, joined.fleet.id, wingRecallAt);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.fleet.phase, "returning");
    assert.equal(second.fleet.acsGroupId ?? null, null);
    assert.equal(wingHome.resources.deuterium, wingDeut);
    assert.ok(ACS_MIN_FLEETS_TO_RESOLVE >= 1);
    assert.equal(universe.acsGroups![groupId]?.status, "cancelled");

    const again = leaveAcsFleet(universe, wing.player.id, joined.fleet.id, wingRecallAt + 1);
    assert.equal(again.ok, false);
  });
});
