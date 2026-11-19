import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ALLIANCE_APPLICATION_NOTE_MAX,
  ALLIANCE_MAX_MEMBERS,
  ALLIANCE_PENDING_REQUEST_CAP,
  ALLIANCE_RELATION_CAP,
  acceptAllianceNap,
  ALLIANCE_RECRUITMENT_BLURB_MAX,
  allianceRecruitingDirectory,
  approveJoinRequest,
  cancelAllianceRelation,
  cancelJoinRequest,
  createAlliance,
  createUniverse,
  allianceViewFor,
  declareAllianceWar,
  disbandAlliance,
  galaxyViewFor,
  inviteToAlliance,
  joinAlliance,
  joinUniverse,
  kickFromAlliance,
  launchFleet,
  leaveAlliance,
  migrateOrResetUniverse,
  offerAllianceNap,
  playerView,
  rejectJoinRequest,
  setAllianceJoinMode,
  setAllianceRecruiting,
  setAllianceRole,
} from "./index.js";

describe("alliances foundation", () => {
  it("create → galaxy tag → leave clears tag", () => {
    const universe = createUniverse("Ally Test", 1);
    const a = joinUniverse(universe, "Alpha");
    const create = createAlliance(universe, a.player.id, "Solar Guard", "sol");
    assert.equal(create.ok, true);
    const view = playerView(universe, a.player.id);
    assert.ok(view.alliance);
    assert.equal(view.alliance?.tag, "SOL");
    assert.equal(view.alliance?.myRole, "founder");
    assert.equal(view.player.allianceId, view.alliance?.id);

    const galaxy = galaxyViewFor(
      universe,
      a.player.id,
      view.planet.coords.galaxy,
      view.planet.coords.system,
    );
    const home = galaxy.slots.find((s) => s.playerId === a.player.id);
    assert.equal(home?.allianceTag, "SOL");

    const left = leaveAlliance(universe, a.player.id);
    assert.equal(left.ok, true);
    assert.equal(playerView(universe, a.player.id).alliance, null);
    const galaxy2 = galaxyViewFor(
      universe,
      a.player.id,
      view.planet.coords.galaxy,
      view.planet.coords.system,
    );
    assert.equal(
      galaxy2.slots.find((s) => s.playerId === a.player.id)?.allianceTag,
      null,
    );
  });

  it("open join + kick + disband", () => {
    const universe = createUniverse("Ally Join", 1);
    const founder = joinUniverse(universe, "Founder");
    const recruit = joinUniverse(universe, "Recruit");
    assert.equal(
      createAlliance(universe, founder.player.id, "Open Fleet", "opn").ok,
      true,
    );
    const allyId = playerView(universe, founder.player.id).alliance!.id;
    assert.equal(
      joinAlliance(universe, recruit.player.id, { allianceId: allyId }).ok,
      true,
    );
    assert.equal(
      playerView(universe, recruit.player.id).alliance?.tag,
      "OPN",
    );
    assert.equal(
      kickFromAlliance(universe, founder.player.id, recruit.player.id).ok,
      true,
    );
    assert.equal(playerView(universe, recruit.player.id).alliance, null);
    assert.equal(disbandAlliance(universe, founder.player.id).ok, true);
    assert.equal(playerView(universe, founder.player.id).alliance, null);
    assert.deepEqual(universe.alliances, {});
  });

  it("invite mode blocks join without invite", () => {
    const universe = createUniverse("Ally Invite", 1);
    const founder = joinUniverse(universe, "Lead");
    const other = joinUniverse(universe, "Other");
    assert.equal(
      createAlliance(universe, founder.player.id, "Quiet Ring", "qr", "invite")
        .ok,
      true,
    );
    const allyId = playerView(universe, founder.player.id).alliance!.id;
    const blocked = joinAlliance(universe, other.player.id, {
      allianceId: allyId,
    });
    assert.equal(blocked.ok, false);
    assert.equal(
      inviteToAlliance(universe, founder.player.id, other.player.id).ok,
      true,
    );
    assert.equal(
      joinAlliance(universe, other.player.id, { tag: "qr" }).ok,
      true,
    );
  });

  it("rejects duplicate tag/name and migrate shape", () => {
    const universe = createUniverse("Ally Dup", 1);
    const a = joinUniverse(universe, "One");
    const b = joinUniverse(universe, "Two");
    assert.equal(
      createAlliance(universe, a.player.id, "Same Name", "aa").ok,
      true,
    );
    const dupTag = createAlliance(universe, b.player.id, "Other Name", "aa");
    assert.equal(dupTag.ok, false);
    const dupName = createAlliance(universe, b.player.id, "Same Name", "bb");
    assert.equal(dupName.ok, false);
    assert.equal(leaveAlliance(universe, a.player.id).ok, true);
    // Solo founder leave deletes the alliance — name/tag free again.
    assert.equal(
      createAlliance(universe, b.player.id, "Same Name", "bb").ok,
      true,
    );

    const legacy = createUniverse("Legacy", 1);
    delete legacy.alliances;
    for (const p of Object.values(legacy.players)) {
      delete (p as { allianceId?: string | null }).allianceId;
    }
    const view = playerView(legacy, joinUniverse(legacy, "LegacyCmd").player.id);
    assert.equal(view.alliance, null);
    assert.ok(legacy.alliances);
    assert.equal(view.player.allianceId, null);
  });

  it("founder transfer via set role", () => {
    const universe = createUniverse("Ally Transfer", 1);
    const a = joinUniverse(universe, "A");
    const b = joinUniverse(universe, "B");
    assert.equal(
      createAlliance(universe, a.player.id, "Torch", "tch").ok,
      true,
    );
    const id = playerView(universe, a.player.id).alliance!.id;
    assert.equal(joinAlliance(universe, b.player.id, { allianceId: id }).ok, true);
    assert.equal(
      setAllianceRole(universe, a.player.id, b.player.id, "founder").ok,
      true,
    );
    assert.equal(playerView(universe, b.player.id).alliance?.myRole, "founder");
    assert.equal(
      playerView(universe, a.player.id).alliance?.myRole === "officer" ||
        playerView(universe, a.player.id).alliance?.myRole === "member",
      true,
    );
    assert.equal(
      setAllianceJoinMode(universe, b.player.id, "invite").ok,
      true,
    );
  });
});

describe("alliance join requests and leader handoff", () => {
  function requestAlliance() {
    const universe = createUniverse("Ally Request", 1);
    const leader = joinUniverse(universe, "Leader");
    const recruit = joinUniverse(universe, "Recruit");
    const other = joinUniverse(universe, "Other");
    assert.equal(
      createAlliance(universe, leader.player.id, "Gate Watch", "gate", "request").ok,
      true,
    );
    const id = playerView(universe, leader.player.id).alliance!.id;
    return { universe, leader, recruit, other, id };
  }

  it("stores one request, dedupes, and caps the list", () => {
    const { universe, leader, recruit, other, id } = requestAlliance();
    const first = joinAlliance(universe, recruit.player.id, { allianceId: id });
    assert.equal(first.ok, true);
    assert.equal(first.ok && first.requested, true);
    assert.equal(playerView(universe, recruit.player.id).alliance, null);
    assert.equal(
      playerView(universe, recruit.player.id).pendingAllianceRequest?.allianceId,
      id,
    );
    const again = joinAlliance(universe, recruit.player.id, { allianceId: id });
    assert.equal(again.ok, true);
    assert.equal(universe.alliances?.[id]?.pendingRequests?.length, 1);

    const blocked = joinAlliance(universe, recruit.player.id, {
      allianceId: "missing",
    });
    assert.equal(blocked.ok, false);
    const second = createAlliance(universe, other.player.id, "Other Gate", "ogt", "request");
    assert.equal(second.ok, true);
    const otherId = playerView(universe, other.player.id).alliance!.id;
    const cross = joinAlliance(universe, recruit.player.id, { allianceId: otherId });
    assert.equal(cross.ok, false);

    const cappedPlayer = joinUniverse(universe, "Cap");
    const alliance = universe.alliances![id]!;
    alliance.pendingRequests = [];
    for (let i = 0; i < ALLIANCE_PENDING_REQUEST_CAP; i++) {
      alliance.pendingRequests.push({ playerId: `ghost${i}`, requestedAt: i });
    }
    const capped = joinAlliance(universe, cappedPlayer.player.id, { allianceId: id });
    assert.equal(capped.ok, false);
    assert.equal(
      universe.alliances?.[id]?.pendingRequests?.length,
      ALLIANCE_PENDING_REQUEST_CAP,
    );
    assert.equal(playerView(universe, leader.player.id).alliance?.pendingRequests?.length, 20);
  });

  it("approves, rejects, and cancels, and clears a request when the player joins", () => {
    const { universe, leader, recruit, other, id } = requestAlliance();
    assert.equal(joinAlliance(universe, recruit.player.id, { allianceId: id }).ok, true);
    assert.equal(
      approveJoinRequest(universe, recruit.player.id, leader.player.id).ok,
      false,
    );
    assert.equal(
      approveJoinRequest(universe, leader.player.id, recruit.player.id).ok,
      true,
    );
    assert.equal(playerView(universe, recruit.player.id).alliance?.id, id);
    assert.equal(playerView(universe, recruit.player.id).pendingAllianceRequest, null);
    assert.equal(universe.alliances?.[id]?.pendingRequests?.length ?? 0, 0);

    assert.equal(joinAlliance(universe, other.player.id, { allianceId: id }).ok, true);
    assert.equal(
      rejectJoinRequest(universe, leader.player.id, other.player.id).ok,
      true,
    );
    assert.equal(universe.players[other.player.id]?.pendingAllianceId ?? null, null);
    assert.equal(joinAlliance(universe, other.player.id, { allianceId: id }).ok, true);
    assert.equal(cancelJoinRequest(universe, other.player.id).ok, true);
    assert.equal(playerView(universe, other.player.id).pendingAllianceRequest, null);

    assert.equal(setAllianceRole(universe, leader.player.id, recruit.player.id, "officer").ok, true);
    assert.equal(joinAlliance(universe, other.player.id, { allianceId: id }).ok, true);
    assert.equal(
      approveJoinRequest(universe, recruit.player.id, other.player.id).ok,
      true,
    );
    const member = joinUniverse(universe, "Member");
    assert.equal(joinAlliance(universe, member.player.id, { allianceId: id }).ok, true);
    assert.equal(
      approveJoinRequest(universe, other.player.id, member.player.id).ok,
      false,
    );
  });

  it("transfers leadership to the oldest officer, else the oldest member, else disbands", () => {
    const universe = createUniverse("Handoff", 1);
    const leader = joinUniverse(universe, "Leader");
    const early = joinUniverse(universe, "Early");
    const late = joinUniverse(universe, "Late");
    const plain = joinUniverse(universe, "Plain");
    assert.equal(
      createAlliance(universe, leader.player.id, "Torch Bearers", "tor").ok,
      true,
    );
    const id = playerView(universe, leader.player.id).alliance!.id;
    const t = 5_000_000;
    assert.equal(joinAlliance(universe, late.player.id, { allianceId: id }, t + 50).ok, true);
    assert.equal(joinAlliance(universe, early.player.id, { allianceId: id }, t + 10).ok, true);
    assert.equal(joinAlliance(universe, plain.player.id, { allianceId: id }, t + 5).ok, true);
    assert.equal(setAllianceRole(universe, leader.player.id, late.player.id, "officer", t + 60).ok, true);
    assert.equal(setAllianceRole(universe, leader.player.id, early.player.id, "officer", t + 70).ok, true);
    universe.alliances![id]!.members[early.player.id]!.joinedAt = t + 10;
    universe.alliances![id]!.members[late.player.id]!.joinedAt = t + 50;
    assert.equal(kickFromAlliance(universe, late.player.id, early.player.id, t + 75).ok, false);
    assert.equal(kickFromAlliance(universe, late.player.id, plain.player.id, t + 76).ok, true);
    assert.equal(joinAlliance(universe, plain.player.id, { allianceId: id }, t + 77).ok, true);
    universe.alliances![id]!.members[plain.player.id]!.joinedAt = t + 5;
    assert.equal(leaveAlliance(universe, leader.player.id, t + 80).ok, true);
    assert.equal(playerView(universe, early.player.id).alliance?.myRole, "founder");
    assert.equal(universe.alliances?.[id]?.founderPlayerId, early.player.id);
    assert.equal(disbandAlliance(universe, late.player.id, t + 90).ok, false);
    assert.equal(setAllianceJoinMode(universe, late.player.id, "invite", t + 90).ok, false);
    assert.equal(kickFromAlliance(universe, early.player.id, plain.player.id, t + 95).ok, true);
    assert.equal(playerView(universe, plain.player.id).alliance, null);
    assert.equal(joinAlliance(universe, plain.player.id, { allianceId: id }, t + 96).ok, true);
    universe.alliances![id]!.members[plain.player.id]!.joinedAt = t + 5;

    assert.equal(leaveAlliance(universe, early.player.id, t + 100).ok, true);
    assert.equal(universe.alliances?.[id]?.founderPlayerId, late.player.id);
    assert.equal(universe.alliances?.[id]?.members[late.player.id]?.role, "founder");
    assert.equal(setAllianceRole(universe, late.player.id, plain.player.id, "member", t + 105).ok, true);
    assert.equal(leaveAlliance(universe, late.player.id, t + 110).ok, true);
    assert.equal(universe.alliances?.[id]?.founderPlayerId, plain.player.id);
    assert.equal(leaveAlliance(universe, plain.player.id, t + 120).ok, true);
    assert.equal(universe.alliances?.[id], undefined);
  });

  it("loads an old alliance record that has no pendingRequests", () => {
    const universe = createUniverse("Old Ally", 1);
    const leader = joinUniverse(universe, "OldLead");
    const id = "ally_legacy";
    universe.alliances = {
      [id]: {
        id,
        name: "Old Guard",
        tag: "OLD",
        joinMode: "open",
        createdAt: 1,
        founderPlayerId: leader.player.id,
        members: {
          [leader.player.id]: {
            playerId: leader.player.id,
            role: "founder",
            joinedAt: 1,
          },
        },
      },
    };
    universe.players[leader.player.id]!.allianceId = id;
    const view = playerView(universe, leader.player.id);
    assert.equal(view.alliance?.tag, "OLD");
    assert.equal(view.alliance?.myRole, "founder");
    assert.equal(view.player.allianceId, id);
    assert.deepEqual(view.alliance?.pendingRequests, []);
    const galaxy = galaxyViewFor(
      universe,
      leader.player.id,
      view.planet.coords.galaxy,
      view.planet.coords.system,
    );
    assert.equal(
      galaxy.slots.find((slot) => slot.playerId === leader.player.id)?.allianceTag,
      "OLD",
    );
    assert.ok(ALLIANCE_MAX_MEMBERS >= 1);
  });

  it("breaks an officer handoff tie by player id", () => {
    const universe = createUniverse("Handoff Tie", 1);
    const leader = joinUniverse(universe, "Leader");
    const a = joinUniverse(universe, "A");
    const b = joinUniverse(universe, "B");
    assert.equal(createAlliance(universe, leader.player.id, "Tied Torch", "tie").ok, true);
    const id = playerView(universe, leader.player.id).alliance!.id;
    assert.equal(joinAlliance(universe, a.player.id, { allianceId: id }, 10).ok, true);
    assert.equal(joinAlliance(universe, b.player.id, { allianceId: id }, 11).ok, true);
    assert.equal(setAllianceRole(universe, leader.player.id, a.player.id, "officer", 12).ok, true);
    assert.equal(setAllianceRole(universe, leader.player.id, b.player.id, "officer", 13).ok, true);
    universe.alliances![id]!.members[a.player.id]!.joinedAt = 20;
    universe.alliances![id]!.members[b.player.id]!.joinedAt = 20;
    const expected = [a.player.id, b.player.id].sort((x, y) => x.localeCompare(y))[0];
    assert.equal(leaveAlliance(universe, leader.player.id, 30).ok, true);
    assert.equal(universe.alliances?.[id]?.founderPlayerId, expected);
  });
});

function pair() {
  const universe = createUniverse("Diplomacy", 1);
  const alpha = joinUniverse(universe, "Alpha");
  const beta = joinUniverse(universe, "Beta");
  assert.equal(createAlliance(universe, alpha.player.id, "Alpha Pact", "alp").ok, true);
  assert.equal(createAlliance(universe, beta.player.id, "Beta Pact", "bet").ok, true);
  const alphaId = playerView(universe, alpha.player.id).alliance!.id;
  const betaId = playerView(universe, beta.player.id).alliance!.id;
  return { universe, alpha, beta, alphaId, betaId };
}

describe("alliance diplomacy", () => {
  it("requires the other leader to accept a NAP and shows it on the galaxy", () => {
    const { universe, alpha, beta, alphaId, betaId } = pair();
    const recruit = joinUniverse(universe, "Recruit");
    assert.equal(joinAlliance(universe, recruit.player.id, { allianceId: betaId }).ok, true);

    const offered = offerAllianceNap(universe, alpha.player.id, betaId, 50);
    assert.equal(offered.ok, true);
    assert.equal(universe.alliances?.[alphaId]?.relations?.[0]?.status, "pending");
    assert.equal(universe.alliances?.[betaId]?.relations?.[0]?.initiatedBy, alphaId);
    assert.equal(
      offerAllianceNap(universe, recruit.player.id, alphaId, 51).ok,
      false,
    );
    const selfAccept = acceptAllianceNap(universe, alpha.player.id, betaId, 52);
    assert.equal(selfAccept.ok, false);
    const memberAccept = acceptAllianceNap(universe, recruit.player.id, alphaId, 53);
    assert.equal(memberAccept.ok, false);

    const home = universe.planets[beta.player.homePlanetId]!;
    const pendingGalaxy = galaxyViewFor(
      universe,
      alpha.player.id,
      home.coords.galaxy,
      home.coords.system,
    );
    assert.equal(
      pendingGalaxy.slots.find((slot) => slot.playerId === beta.player.id)?.diplomacy,
      undefined,
    );

    assert.equal(acceptAllianceNap(universe, beta.player.id, alphaId, 54).ok, true);
    const active = playerView(universe, alpha.player.id).alliance?.relations ?? [];
    assert.equal(active.length, 1);
    assert.equal(active[0]?.kind, "nap");
    assert.equal(active[0]?.status, "active");
    assert.equal(active[0]?.tag, "BET");
    const galaxy = galaxyViewFor(
      universe,
      alpha.player.id,
      home.coords.galaxy,
      home.coords.system,
    );
    assert.equal(
      galaxy.slots.find((slot) => slot.playerId === beta.player.id)?.diplomacy,
      "nap",
    );
    assert.equal(
      galaxy.slots.find((slot) => slot.playerId === alpha.player.id)?.diplomacy,
      undefined,
    );

    assert.equal(declareAllianceWar(universe, alpha.player.id, betaId, 55).ok, false);
    assert.equal(cancelAllianceRelation(universe, alpha.player.id, betaId, 56).ok, true);
    assert.equal(universe.alliances?.[alphaId]?.relations, undefined);
    assert.equal(universe.alliances?.[betaId]?.relations, undefined);
  });

  it("declares war immediately and lets only the declaring leader end it", () => {
    const { universe, alpha, beta, alphaId, betaId } = pair();
    assert.equal(declareAllianceWar(universe, alpha.player.id, betaId, 60).ok, true);
    const war = playerView(universe, beta.player.id).alliance?.relations?.[0];
    assert.equal(war?.kind, "war");
    assert.equal(war?.status, "active");
    assert.equal(war?.canCancel, false);
    assert.equal(cancelAllianceRelation(universe, beta.player.id, alphaId, 61).ok, false);
    assert.equal(universe.alliances?.[betaId]?.relations?.length, 1);
    assert.equal(cancelAllianceRelation(universe, alpha.player.id, betaId, 62).ok, true);
    assert.equal(universe.alliances?.[alphaId]?.relations, undefined);
    assert.equal(universe.alliances?.[betaId]?.relations, undefined);

    const home = universe.planets[beta.player.homePlanetId]!;
    assert.equal(declareAllianceWar(universe, beta.player.id, alphaId, 63).ok, true);
    const galaxy = galaxyViewFor(
      universe,
      alpha.player.id,
      home.coords.galaxy,
      home.coords.system,
    );
    assert.equal(
      galaxy.slots.find((slot) => slot.playerId === beta.player.id)?.diplomacy,
      "war",
    );
  });

  it("clears both sides when an alliance disbands and keeps relations when a member is kicked", () => {
    const { universe, alpha, beta, alphaId, betaId } = pair();
    const gamma = joinUniverse(universe, "Gamma");
    assert.equal(createAlliance(universe, gamma.player.id, "Gamma Pact", "gam").ok, true);
    const gammaId = playerView(universe, gamma.player.id).alliance!.id;
    const recruit = joinUniverse(universe, "Recruit");
    assert.equal(joinAlliance(universe, recruit.player.id, { allianceId: alphaId }).ok, true);
    assert.equal(offerAllianceNap(universe, alpha.player.id, betaId, 70).ok, true);
    assert.equal(acceptAllianceNap(universe, beta.player.id, alphaId, 71).ok, true);
    assert.equal(declareAllianceWar(universe, alpha.player.id, gammaId, 72).ok, true);
    assert.equal(kickFromAlliance(universe, alpha.player.id, recruit.player.id, 73).ok, true);
    assert.equal(universe.alliances?.[alphaId]?.relations?.length, 2);
    assert.equal(disbandAlliance(universe, beta.player.id, 74).ok, true);
    assert.equal(universe.alliances?.[betaId], undefined);
    assert.deepEqual(
      universe.alliances?.[alphaId]?.relations?.map((row) => row.allianceId),
      [gammaId],
    );
    assert.equal(leaveAlliance(universe, gamma.player.id, 75).ok, true);
    assert.equal(universe.alliances?.[gammaId], undefined);
    assert.equal(universe.alliances?.[alphaId]?.relations, undefined);
  });

  it("caps relations and leaves an older alliance without the field", () => {
    const universe = createUniverse("Diplomacy Cap", 1);
    const leader = joinUniverse(universe, "CapLead");
    assert.equal(createAlliance(universe, leader.player.id, "Cap Home", "cap").ok, true);
    const homeId = playerView(universe, leader.player.id).alliance!.id;
    assert.equal(universe.alliances?.[homeId]?.relations, undefined);
    assert.deepEqual(playerView(universe, leader.player.id).alliance?.relations, []);
    for (let i = 0; i < ALLIANCE_RELATION_CAP; i++) {
      const other = joinUniverse(universe, `Cap${i}`);
      assert.equal(
        createAlliance(universe, other.player.id, `Cap Name ${i}`, `c${i}`).ok,
        true,
      );
      const otherId = playerView(universe, other.player.id).alliance!.id;
      assert.equal(declareAllianceWar(universe, leader.player.id, otherId, 80 + i).ok, true);
    }
    const extra = joinUniverse(universe, "CapExtra");
    assert.equal(createAlliance(universe, extra.player.id, "Cap Extra", "cxx").ok, true);
    const extraId = playerView(universe, extra.player.id).alliance!.id;
    const overflow = declareAllianceWar(universe, leader.player.id, extraId, 200);
    assert.equal(overflow.ok, false);
    assert.equal(universe.alliances?.[homeId]?.relations?.length, ALLIANCE_RELATION_CAP);
    assert.equal(universe.alliances?.[extraId]?.relations, undefined);
  });

  it("loads a main-branch in-flight save with didReset false and keeps the fleet", () => {
    const path = fileURLToPath(new URL("./fixtures/in-flight-fleet-save.json", import.meta.url));
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      fleets: Record<string, { ownerPlayerId: string; phase: string; ships: { scout: number } }>;
      players: Record<string, { allianceId?: string | null }>;
    };
    const fleetId = "flt_loyw3v50_wp8zo";
    assert.equal(raw.fleets[fleetId]?.ships.scout, 1);
    const loaded = migrateOrResetUniverse(structuredClone(raw) as never);
    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.fleets[fleetId]?.phase, "outbound");
    assert.equal(loaded.universe.fleets[fleetId]?.ships.scout, 1);
    const ownerId = loaded.universe.fleets[fleetId]!.ownerPlayerId;
    loaded.universe.alliances = {
      ally_old: {
        id: "ally_old",
        name: "Old Guard",
        tag: "OLD",
        joinMode: "open",
        createdAt: 1,
        founderPlayerId: ownerId,
        members: {
          [ownerId]: { playerId: ownerId, role: "founder", joinedAt: 1 },
        },
      },
    };
    loaded.universe.players[ownerId]!.allianceId = "ally_old";
    const view = allianceViewFor(loaded.universe, ownerId);
    assert.equal(loaded.didReset, false);
    assert.deepEqual(view?.relations, []);
    assert.equal(loaded.universe.alliances?.ally_old?.relations, undefined);
    assert.equal(loaded.universe.fleets[fleetId]?.phase, "outbound");
    assert.equal(loaded.universe.fleets[fleetId]?.ships.scout, 1);
  });
});

describe("alliance recruiting", () => {
  function founded() {
    const universe = createUniverse("Recruit", 1);
    const leader = joinUniverse(universe, "Leader");
    const officer = joinUniverse(universe, "Officer");
    const member = joinUniverse(universe, "Member");
    const outsider = joinUniverse(universe, "Outsider");
    assert.equal(
      createAlliance(universe, leader.player.id, "Open Door", "door").ok,
      true,
    );
    const id = playerView(universe, leader.player.id).alliance!.id;
    assert.equal(joinAlliance(universe, officer.player.id, { allianceId: id }).ok, true);
    assert.equal(joinAlliance(universe, member.player.id, { allianceId: id }).ok, true);
    assert.equal(
      setAllianceRole(universe, leader.player.id, officer.player.id, "officer").ok,
      true,
    );
    return { universe, leader, officer, member, outsider, id };
  }

  it("lets only the Leader set the blurb, flag, and note", () => {
    const { universe, leader, officer, member, outsider, id } = founded();
    const input = {
      recruitmentBlurb: "  Fly with us  ",
      recruiting: true,
      applicationNote: "  Tell us your home system.\n",
    };
    const officerDenied = setAllianceRecruiting(universe, officer.player.id, input);
    assert.equal(officerDenied.ok, false);
    if (!officerDenied.ok) {
      assert.equal(officerDenied.error, "Only the Leader can change recruiting.");
    }
    const memberDenied = setAllianceRecruiting(universe, member.player.id, input);
    assert.equal(memberDenied.ok, false);
    if (!memberDenied.ok) {
      assert.equal(memberDenied.error, "Only the Leader can change recruiting.");
    }
    assert.equal(setAllianceRecruiting(universe, outsider.player.id, input).ok, false);
    assert.equal(universe.alliances?.[id]?.recruitmentBlurb, undefined);

    const saved = setAllianceRecruiting(universe, leader.player.id, input);
    assert.equal(saved.ok, true);
    assert.equal(universe.alliances?.[id]?.recruitmentBlurb, "Fly with us");
    assert.equal(universe.alliances?.[id]?.recruiting, true);
    assert.equal(
      universe.alliances?.[id]?.applicationNote,
      "Tell us your home system.",
    );

    const cleared = setAllianceRecruiting(universe, leader.player.id, {
      recruitmentBlurb: "   ",
      recruiting: false,
      applicationNote: "",
    });
    assert.equal(cleared.ok, true);
    assert.equal(universe.alliances?.[id]?.recruitmentBlurb, undefined);
    assert.equal(universe.alliances?.[id]?.recruiting, undefined);
    assert.equal(universe.alliances?.[id]?.applicationNote, undefined);
  });

  it("rejects text over the cap and leaves the record unchanged", () => {
    const { universe, leader, id } = founded();
    assert.equal(
      setAllianceRecruiting(universe, leader.player.id, {
        recruitmentBlurb: "x".repeat(ALLIANCE_RECRUITMENT_BLURB_MAX + 1),
        recruiting: true,
        applicationNote: "ok",
      }).ok,
      false,
    );
    assert.equal(universe.alliances?.[id]?.recruiting, undefined);
    assert.equal(
      setAllianceRecruiting(universe, leader.player.id, {
        recruitmentBlurb: "ok",
        recruiting: true,
        applicationNote: "y".repeat(ALLIANCE_APPLICATION_NOTE_MAX + 1),
      }).ok,
      false,
    );
    assert.equal(universe.alliances?.[id]?.recruitmentBlurb, undefined);
  });

  it("keeps recruiting text off the state directory", () => {
    const { universe, leader, id } = founded();
    assert.equal(
      setAllianceRecruiting(universe, leader.player.id, {
        recruitmentBlurb: "<b>Join</b>",
        recruiting: true,
        applicationNote: "<script>nope</script>",
      }).ok,
      true,
    );
    const view = playerView(universe, leader.player.id);
    const row = view.allianceDirectory.find((entry) => entry.id === id);
    assert.ok(row);
    assert.equal(Object.hasOwn(row!, "recruitmentBlurb"), false);
    assert.equal(Object.hasOwn(row!, "recruiting"), false);
    assert.equal(Object.hasOwn(row!, "applicationNote"), false);
    assert.equal(Object.hasOwn(view.alliance ?? {}, "recruitmentBlurb"), false);
    assert.equal(Object.hasOwn(view.alliance ?? {}, "applicationNote"), false);
    const page = allianceRecruitingDirectory(universe).find((entry) => entry.id === id);
    assert.equal(page?.recruitmentBlurb, "<b>Join</b>");
    assert.equal(page?.recruiting, true);
    assert.equal(page?.applicationNote, "<script>nope</script>");
  });

  it("loads an older save that omits recruiting fields", () => {
    const universe = createUniverse("Old Recruit", 1);
    const leader = joinUniverse(universe, "OldLead");
    const other = joinUniverse(universe, "OldOther");
    assert.equal(
      createAlliance(universe, leader.player.id, "Old Ring", "oldr").ok,
      true,
    );
    const id = leader.player.allianceId!;
    const home = universe.planets[leader.planet.id]!;
    home.buildings.metalMine = 4;
    home.ships.scout = 1;
    home.resources.deuterium = 10_000;
    const launch = launchFleet(
      universe,
      leader.player.id,
      other.planet.id,
      "deploy",
      { scout: 1 },
      80_000_000,
    );
    assert.equal(launch.ok, true);
    const fleetId = launch.ok ? launch.fleet.id : "";
    delete universe.alliances![id]!.recruitmentBlurb;
    delete universe.alliances![id]!.recruiting;
    delete universe.alliances![id]!.applicationNote;
    const research = structuredClone(universe.players[leader.player.id]!.research);
    const raw = JSON.parse(JSON.stringify(universe));
    const loaded = migrateOrResetUniverse(raw);
    assert.equal(loaded.didReset, false);
    const player = loaded.universe.players[leader.player.id]!;
    assert.equal(player.name, "OldLead");
    assert.equal(player.allianceId, id);
    const planet = loaded.universe.planets[leader.planet.id]!;
    assert.equal(planet.buildings.metalMine, 4);
    assert.deepEqual(player.research, research);
    const fleet = loaded.universe.fleets[fleetId];
    assert.ok(fleet);
    assert.equal(fleet?.ownerPlayerId, leader.player.id);
    assert.equal(fleet?.mission, "deploy");
    assert.equal(fleet?.ships.scout, 1);
    assert.equal(loaded.universe.alliances?.[id]?.recruitmentBlurb, undefined);
    assert.equal(loaded.universe.alliances?.[id]?.recruiting, undefined);
    assert.equal(loaded.universe.alliances?.[id]?.applicationNote, undefined);
    const again = playerView(loaded.universe, leader.player.id);
    assert.equal(again.alliance?.name, "Old Ring");
    assert.equal(Object.hasOwn(again.allianceDirectory[0] ?? {}, "recruiting"), false);
  });
});
