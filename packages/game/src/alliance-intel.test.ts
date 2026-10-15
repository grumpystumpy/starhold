import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALLIANCE_CHAT_MAX_CHARS,
  ALLIANCE_CHAT_MAX_MESSAGES,
  ALLIANCE_CHAT_RATE_PER_MIN,
  ALLIANCE_MARKERS_MAX,
  createAlliance,
  createUniverse,
  deleteAllianceIntel,
  deleteAllianceMarker,
  ensureUniverseShape,
  galaxyViewFor,
  joinAlliance,
  joinUniverse,
  jointStrikeHelpersAvailable,
  listAllianceChat,
  playerView,
  postAllianceChat,
  proposeAllianceStrike,
  resetAllianceChatRateLimit,
  setAllianceRole,
  shareAllianceIntel,
  upsertAllianceMarker,
  type EspionageReport,
} from "./index.js";

function allyOf(universe: ReturnType<typeof createUniverse>, playerId: string) {
  const id = universe.players[playerId]?.allianceId;
  if (!id) throw new Error("expected alliance");
  const alliance = universe.alliances?.[id];
  if (!alliance) throw new Error("missing alliance record");
  return alliance;
}

function spyFixture(
  id: string,
  spyPlayerId: string,
  targetName: string,
): EspionageReport {
  return {
    id,
    at: 1_700_000_000_000,
    missionId: "fleet_1",
    spyPlayerId,
    targetPlayerId: "other",
    targetName,
    targetCoords: { galaxy: 1, system: 1, slot: 8 },
    detail: 2,
    resources: { metal: 1200, crystal: 340, deuterium: 50 },
    ships: { probe: 4, interceptor: 2 },
    defenses: { laserBattery: 3 },
    buildings: { metalMine: 9 },
    research: { espionageTech: 4 },
    summary: `Fleet/defense scan of ${targetName} succeeded.`,
  };
}

describe("alliance chat, intel, markers", () => {
  it("migrates missing arrays and keeps a chat ring", () => {
    resetAllianceChatRateLimit();
    const universe = createUniverse("Intel", 1);
    const founder = joinUniverse(universe, "Founder");
    assert.equal(
      createAlliance(universe, founder.player.id, "Solar Guard", "sol").ok,
      true,
    );
    const alliance = allyOf(universe, founder.player.id);
    delete alliance.chat;
    delete alliance.intel;
    delete alliance.markers;
    ensureUniverseShape(universe);
    assert.deepEqual(alliance.chat, []);
    assert.deepEqual(alliance.intel, []);
    assert.deepEqual(alliance.markers, []);

    const posted = postAllianceChat(
      universe,
      founder.player.id,
      "  Hold \u0001the lane\u0007  ",
      1_000,
    );
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    assert.equal(posted.message.body, "Hold the lane");
    const view = playerView(universe, founder.player.id, 1_000);
    assert.equal(view.alliance?.chat.length, 1);
    assert.equal(view.alliance?.chat[0]?.body, "Hold the lane");

    assert.equal(
      postAllianceChat(universe, founder.player.id, "   ", 2_000).ok,
      false,
    );
    assert.equal(
      postAllianceChat(universe, founder.player.id, "x".repeat(ALLIANCE_CHAT_MAX_CHARS + 1), 3_000)
        .ok,
      false,
    );

    const outsider = joinUniverse(universe, "Outsider");
    assert.equal(listAllianceChat(universe, outsider.player.id).ok, false);
  });

  it("rate-limits chat writes and drops the oldest message", () => {
    resetAllianceChatRateLimit();
    const universe = createUniverse("Chat cap", 1);
    const founder = joinUniverse(universe, "Cap");
    assert.equal(createAlliance(universe, founder.player.id, "Cap Fleet", "cap").ok, true);
    const t0 = 10_000_000;
    for (let i = 0; i < ALLIANCE_CHAT_RATE_PER_MIN; i++) {
      const result = postAllianceChat(
        universe,
        founder.player.id,
        `m${i}`,
        t0,
      );
      assert.equal(result.ok, true);
    }
    const blocked = postAllianceChat(universe, founder.player.id, "too fast", t0);
    assert.equal(blocked.ok, false);

    resetAllianceChatRateLimit();
    for (let i = 0; i < ALLIANCE_CHAT_MAX_MESSAGES + 1; i++) {
      const result = postAllianceChat(
        universe,
        founder.player.id,
        `ring${i}`,
        t0 + i * 61_000,
      );
      assert.equal(result.ok, true);
    }
    const messages = listAllianceChat(
      universe,
      founder.player.id,
      t0 + ALLIANCE_CHAT_MAX_MESSAGES * 61_000,
    );
    assert.equal(messages.ok, true);
    if (!messages.ok) return;
    assert.equal(messages.messages.length, ALLIANCE_CHAT_MAX_MESSAGES);
    assert.equal(messages.messages[0]?.body, "ring1");
    assert.equal(
      messages.messages[messages.messages.length - 1]?.body,
      `ring${ALLIANCE_CHAT_MAX_MESSAGES}`,
    );
  });

  it("shares a frozen spy snapshot and lets officers remove it", () => {
    const universe = createUniverse("Spy share", 1);
    const founder = joinUniverse(universe, "Founder");
    const recruit = joinUniverse(universe, "Recruit");
    const stranger = joinUniverse(universe, "Stranger");
    assert.equal(
      createAlliance(universe, founder.player.id, "Open Intel", "oi").ok,
      true,
    );
    const allyId = playerView(universe, founder.player.id).alliance!.id;
    assert.equal(joinAlliance(universe, recruit.player.id, { allianceId: allyId }).ok, true);
    const report = spyFixture("spy_frozen", founder.player.id, "Recruit");
    universe.spyReports[report.id] = report;

    const shared = shareAllianceIntel(universe, founder.player.id, report.id, 5_000);
    assert.equal(shared.ok, true);
    if (!shared.ok) return;
    report.resources = { metal: 1, crystal: 1, deuterium: 1 };
    report.ships = { probe: 99 };
    const allyView = playerView(universe, recruit.player.id, 5_000);
    const stamp = allyView.alliance?.intel[0];
    assert.equal(stamp?.targetLabel, "Recruit");
    assert.equal(stamp?.snapshot.resources?.metal, 1200);
    assert.equal(stamp?.snapshot.ships?.probe, 4);
    assert.equal(stamp?.snapshot.defenses?.laserBattery, 3);
    assert.equal(
      shareAllianceIntel(universe, founder.player.id, report.id, 6_000).ok,
      false,
    );
    assert.equal(
      shareAllianceIntel(universe, recruit.player.id, report.id, 6_000).ok,
      false,
    );

    assert.equal(
      deleteAllianceIntel(universe, recruit.player.id, stamp!.id, 7_000).ok,
      false,
    );
    assert.equal(
      setAllianceRole(universe, founder.player.id, recruit.player.id, "officer").ok,
      true,
    );
    assert.equal(
      deleteAllianceIntel(universe, recruit.player.id, stamp!.id, 8_000).ok,
      true,
    );
    assert.equal(playerView(universe, founder.player.id, 8_000).alliance?.intel.length, 0);
    assert.equal(listAllianceChat(universe, stranger.player.id).ok, false);
  });

  it("upserts galaxy markers, expires them, and hides them from outsiders", () => {
    const universe = createUniverse("Markers", 1);
    const founder = joinUniverse(universe, "Founder");
    const outsider = joinUniverse(universe, "Outsider");
    assert.equal(
      createAlliance(universe, founder.player.id, "Pin Fleet", "pin").ok,
      true,
    );
    const now = 50_000_000;
    const first = upsertAllianceMarker(
      universe,
      founder.player.id,
      { galaxy: 1, system: 2, slot: 4 },
      "  siege window \u0007",
      now,
    );
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.marker.note, "siege window");
    const updated = upsertAllianceMarker(
      universe,
      founder.player.id,
      { galaxy: 1, system: 2, slot: 4 },
      "updated note",
      now + 10,
    );
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.marker.id, first.marker.id);
    assert.equal(allyOf(universe, founder.player.id).markers?.length, 1);

    const home = founder.planet.coords;
    const marked = upsertAllianceMarker(
      universe,
      founder.player.id,
      home,
      "home",
      now + 20,
    );
    assert.equal(marked.ok, true);
    const galaxy = galaxyViewFor(
      universe,
      founder.player.id,
      home.galaxy,
      home.system,
      now + 20,
    );
    const slot = galaxy.slots.find((s) => s.coords.slot === home.slot);
    assert.equal(slot?.allianceMarker?.note, "home");
    assert.equal(slot?.allianceMarker?.markedBy, "Founder");
    const hidden = galaxyViewFor(
      universe,
      outsider.player.id,
      home.galaxy,
      home.system,
      now + 20,
    );
    assert.equal(
      hidden.slots.find((s) => s.coords.slot === home.slot)?.allianceMarker,
      null,
    );

    const record = allyOf(universe, founder.player.id);
    const homeMarker = record.markers!.find(
      (m) => m.coords.slot === home.slot && m.coords.system === home.system,
    )!;
    homeMarker.expiresAt = now + 20;
    const after = galaxyViewFor(
      universe,
      founder.player.id,
      home.galaxy,
      home.system,
      now + 21,
    );
    assert.equal(
      after.slots.find((s) => s.coords.slot === home.slot)?.allianceMarker,
      null,
    );

    assert.equal(
      deleteAllianceMarker(universe, outsider.player.id, updated.marker.id).ok,
      false,
    );
  });

  it("keeps at most the marker cap", () => {
    const universe = createUniverse("Marker cap", 1);
    const founder = joinUniverse(universe, "Founder");
    assert.equal(createAlliance(universe, founder.player.id, "Pins", "pns").ok, true);
    const now = 80_000_000;
    for (let i = 0; i < ALLIANCE_MARKERS_MAX + 1; i++) {
      const result = upsertAllianceMarker(
        universe,
        founder.player.id,
        { galaxy: 1, system: i + 1, slot: 3 },
        `n${i}`,
        now + i,
      );
      assert.equal(result.ok, true);
    }
    const markers = allyOf(universe, founder.player.id).markers ?? [];
    assert.equal(markers.length, ALLIANCE_MARKERS_MAX);
    assert.equal(
      markers.some((m) => m.coords.system === 1),
      false,
    );
  });

  it("proposes Joint Strike in chat and omits ACS prefill without helpers", () => {
    const universe = createUniverse("Strike", 1);
    const founder = joinUniverse(universe, "Vesper");
    assert.equal(createAlliance(universe, founder.player.id, "Strike", "stk").ok, true);
    assert.equal(jointStrikeHelpersAvailable(), false);
    const proposed = proposeAllianceStrike(
      universe,
      founder.player.id,
      { galaxy: 2, system: 4, slot: 6 },
      "dawn",
      "raid",
      9_000,
    );
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    assert.equal(proposed.acsPrefill, null);
    assert.ok(proposed.planId.startsWith("chat_"));
    const chat = playerView(universe, founder.player.id, 9_000).alliance?.chat ?? [];
    assert.match(
      chat[0]?.body ?? "",
      /Vesper proposed Joint Strike on 2:4:6 — dawn/,
    );
    const outsider = joinUniverse(universe, "Lone");
    assert.equal(
      proposeAllianceStrike(
        universe,
        outsider.player.id,
        { galaxy: 1, system: 1, slot: 1 },
        "",
        "pirateRaid",
        10_000,
      ).ok,
      false,
    );
  });
});
