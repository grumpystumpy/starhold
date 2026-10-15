import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAlliance,
  createUniverse,
  disbandAlliance,
  galaxyViewFor,
  inviteToAlliance,
  joinAlliance,
  joinUniverse,
  kickFromAlliance,
  leaveAlliance,
  playerView,
  setAllianceJoinMode,
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
