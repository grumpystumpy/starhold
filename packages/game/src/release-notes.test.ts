import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CURRENT_RELEASE_ID,
  RELEASE_NOTES,
  createUniverse,
  dismissWhatsNew,
  joinUniverse,
  launchFleet,
  playerView,
  releaseNotesNewerThan,
  whatsNewViewFor,
} from "./index.js";

describe("what's new release notes", () => {
  it("seeds release 271 with the last deploy's notes", () => {
    assert.equal(CURRENT_RELEASE_ID, "271");
    assert.equal(RELEASE_NOTES.length, 1);
    assert.equal(RELEASE_NOTES[0]?.id, "271");
    const text = RELEASE_NOTES[0]!.items.join("\n");
    assert.match(text, /home screen/);
    assert.match(text, /Add to Home Screen/);
    assert.match(text, /Install app/);
    assert.match(text, /review of the mission/);
    assert.match(text, /loot and debris/);
    assert.match(text, /still locked/);
    assert.match(text, /shows the reason/);
  });

  it("shows only release ids newer than the one the player dismissed", () => {
    const notes = [
      { id: "271", title: "What's new", items: ["Install"] },
      { id: "280", title: "What's new", items: ["Later"] },
    ];
    assert.deepEqual(
      releaseNotesNewerThan(notes, undefined).map((note) => note.id),
      ["271", "280"],
    );
    assert.deepEqual(
      releaseNotesNewerThan(notes, "271").map((note) => note.id),
      ["280"],
    );
    assert.deepEqual(releaseNotesNewerThan(notes, "280"), []);
    assert.deepEqual(
      releaseNotesNewerThan(notes, "unknown").map((note) => note.id),
      ["271", "280"],
    );
  });

  it("shows the popup until dismiss, without writing the save on read", () => {
    const now = 1_700_000_000_000;
    const universe = createUniverse("Notes", 1, 1, { lazySeed: true });
    const { player } = joinUniverse(universe, "Hold", now);
    const live = universe.players[player.id]!;
    assert.equal(live.whatsNewDismissedReleaseId, undefined);
    assert.equal(live.onboarding, undefined);

    const pending = whatsNewViewFor(live);
    assert.equal(pending?.releaseId, "271");
    assert.equal(pending?.items.length, 5);
    assert.equal(live.whatsNewDismissedReleaseId, undefined);
    assert.equal(playerView(universe, player.id, now).whatsNew?.releaseId, "271");

    const dismissed = dismissWhatsNew(universe, player.id);
    assert.equal(dismissed.ok, true);
    assert.equal(live.whatsNewDismissedReleaseId, "271");
    assert.equal(live.onboarding, undefined);
    assert.equal(whatsNewViewFor(live), null);
    assert.equal(playerView(universe, player.id, now).whatsNew, null);
  });

  it("dismisses the popup without touching fleets, resources, or onboarding", () => {
    const now = 1_700_000_000_000;
    const universe = createUniverse("Keep", 8, 8, { lazySeed: true });
    const hold = joinUniverse(universe, "Hold", now);
    const far = joinUniverse(universe, "Far", now + 1);
    const home = universe.planets[hold.planet.id]!;
    home.ships.scout = 1;
    home.resources.deuterium = 50_000;
    home.resources.metal = 123_456;
    const launch = launchFleet(
      universe,
      hold.player.id,
      far.planet.id,
      "deploy",
      { scout: 1 },
      now + 100,
    );
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    const owner = universe.players[hold.player.id]!;
    owner.onboarding = { claimed: ["metalMine1"], dismissed: false };
    const fleetBefore = structuredClone(universe.fleets[launch.fleet.id]);
    const metalBefore = home.resources.metal;
    const crystalBefore = home.resources.crystal;
    const schemaBefore = universe.schemaVersion;

    const result = dismissWhatsNew(universe, hold.player.id);
    assert.equal(result.ok, true);
    assert.equal(universe.schemaVersion, schemaBefore);
    const fleet = universe.fleets[launch.fleet.id];
    assert.ok(fleet);
    assert.equal(fleet.mission, fleetBefore?.mission);
    assert.equal(fleet.phase, "outbound");
    assert.equal(fleet.ships.scout, 1);
    assert.equal(fleet.arrivesAt, fleetBefore?.arrivesAt);
    assert.equal(home.resources.metal, metalBefore);
    assert.equal(home.resources.crystal, crystalBefore);
    assert.deepEqual(owner.onboarding, {
      claimed: ["metalMine1"],
      dismissed: false,
    });
    assert.equal(owner.whatsNewDismissedReleaseId, "271");
    assert.equal(dismissWhatsNew(universe, "missing").ok, false);
  });
});
