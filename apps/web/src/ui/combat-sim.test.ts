import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createUniverse,
  joinUniverse,
  playerView,
  runCombatSandbox,
  type EspionageReport,
  type PlayerView,
} from "@starhold/game";
import { pageHtml } from "./render-pages";
import {
  applyCombatSimPaste,
  loadCombatSimSpy,
  resetCombatSimState,
  runCombatSim,
} from "./render-combat-sim";

function viewWithCruisers(): PlayerView {
  const now = 1_700_000_000_000;
  const universe = createUniverse("Sim UI", 1);
  const joined = joinUniverse(universe, "Simmer", now);
  universe.planets[joined.planet.id]!.ships.cruiser = 7;
  universe.planets[joined.planet.id]!.resources.metal = 4321;
  const view = playerView(universe, joined.player.id, now);
  view.planet.ships.cruiser = 7;
  view.planet.resources.metal = 4321;
  view.spyReports = [
    {
      id: "spy-1",
      at: now,
      missionId: "m",
      spyPlayerId: view.player.id,
      targetPlayerId: "other",
      targetName: "Rival",
      targetCoords: { galaxy: 1, system: 2, slot: 4 },
      detail: 3,
      resources: { metal: 1, crystal: 2, deuterium: 3 },
      buildings: null,
      ships: { cruiser: 4, scout: 2 },
      defenses: { laserBattery: 9 },
      research: { weaponsTech: 3 },
      summary: "scan",
    } as EspionageReport,
  ];
  return view;
}

function snapshot(view: PlayerView): string {
  return JSON.stringify({
    ships: view.planet.ships,
    defenses: view.planet.defenses,
    resources: view.planet.resources,
    research: view.player.research,
    fleets: view.fleets,
    reports: view.reports,
  });
}

describe("combat simulator page", () => {
  it("prefills orbit counts and loads a spy report into the defender", () => {
    resetCombatSimState();
    const view = viewWithCruisers();
    const html = pageHtml("simulator", view, false, null);
    assert.match(html, /data-testid="combat-sim"/);
    assert.match(html, /value="7"[^>]*data-testid="combat-sim-attacker-cruiser"/);
    assert.match(html, /data-testid="combat-sim-spy"/);
    assert.match(html, /Rival 1:2:4/);
    const report = view.spyReports[0]!;
    loadCombatSimSpy(report);
    const loaded = pageHtml("simulator", view, false, null);
    assert.match(loaded, /value="4"[^>]*data-testid="combat-sim-defender-cruiser"/);
    assert.match(loaded, /value="2"[^>]*data-testid="combat-sim-defender-scout"/);
    assert.match(loaded, /value="9"[^>]*data-testid="combat-sim-defense-laserBattery"/);
  });

  it("fills the defender from pasted spy-report lines", () => {
    resetCombatSimState();
    const view = viewWithCruisers();
    pageHtml("simulator", view, false, null);
    const ok = applyCombatSimPaste(
      "Ships: 3× Recon Drone\nDefenses: 2× Light Laser Turret\nResearch: Ordnance Doctrine L1",
    );
    assert.equal(ok, true);
    const html = pageHtml("simulator", view, false, null);
    assert.match(html, /value="3"[^>]*data-testid="combat-sim-defender-scout"/);
    assert.match(html, /value="2"[^>]*data-testid="combat-sim-defense-laserBattery"/);
  });

  it("running the sim matches the sandbox and leaves the view unchanged", () => {
    resetCombatSimState();
    const view = viewWithCruisers();
    pageHtml("simulator", view, false, null);
    loadCombatSimSpy(view.spyReports[0]!);
    const before = snapshot(view);
    const result = runCombatSim(view);
    assert.equal(snapshot(view), before);
    assert.equal(view.planet.ships.cruiser, 7);
    assert.equal(view.planet.resources.metal, 4321);
    const expected = runCombatSandbox({
      attacker: view.planet.ships,
      defender: { cruiser: 4, scout: 2 },
      defenses: { laserBattery: 9 },
      attackerResearch: view.player.research,
      attackerLevel: view.player.level,
      attackerClassId: view.player.playerClass?.classId ?? null,
      defenderResearch: { weaponsTech: 3 },
      seed: "starhold-sim",
    });
    assert.deepEqual(result, expected);
    const shown = pageHtml("simulator", view, false, null);
    assert.match(shown, /data-testid="combat-sim-result"/);
    assert.match(shown, /data-testid="combat-sim-outcome"/);
    assert.match(shown, /data-testid="combat-loot"/);
    assert.match(shown, /data-testid="combat-debris"/);
  });
});
