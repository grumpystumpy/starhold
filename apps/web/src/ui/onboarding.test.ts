import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OnboardingView, PlayerView } from "@starhold/game";
import { fleetComposer } from "./render-fleets-composer";
import { blankFleetDraft } from "./render-fleets-draft";
import { pageHtml } from "./render-pages";

function briefing(partial: Partial<OnboardingView> = {}): OnboardingView {
  const steps = [
    ["metalMine1", "Ore Mine", "buildings", true],
    ["solarPlant1", "Solar Array", "buildings", false],
    ["crystalMine1", "Crystalizer", "buildings", false],
    ["deutSynth1", "Deuterium Extractor", "buildings", false],
    ["researchLab1", "First research", "research", false],
    ["shipyardScout1", "First hull", "shipyard", false],
    ["firstReconOrExpedition", "Look outward", "galaxy", false],
    ["colonyFoundation", "Colony foundation", "buildings", false],
  ] as const;
  return {
    dismissed: false,
    allClaimed: false,
    completedCount: 1,
    steps: steps.map(([id, title, targetNavPage, completed]) => ({
      id,
      title,
      description: `${title} step`,
      targetNavPage,
      completed,
      claimed: false,
      reward: { starshards: 0, metal: 600, crystal: 250, deuterium: 0 },
    })),
    ...partial,
  };
}

function overviewView(onboarding?: OnboardingView): PlayerView {
  return {
    player: { id: "p1", name: "Commander", cosmetics: {}, research: {} },
    planet: {
      id: "pl1",
      name: "Home",
      coords: { galaxy: 1, system: 1, slot: 1 },
      buildings: { shipyard: 0, metalMine: 1 },
      buildQueue: [],
      shipQueue: [],
      defenseQueue: [],
      ships: {},
      defenses: {},
    },
    planetArt: { artId: "earth", artUrl: "", artThumbUrl: "" },
    economy: {
      fields: { used: 1, cap: 100, remaining: 99 },
      positionMult: { metal: 1.2, crystal: 0.9, deuterium: 1.4, energy: 1.1 },
      productionPerHour: { metal: 100, crystal: 50, deuterium: 20 },
      energy: { factor: 1, produced: 100, used: 50 },
      temperatureK: 250,
    },
    goals: [],
    onboarding,
  } as unknown as PlayerView;
}

function fleetView(ships: Record<string, number> = {}): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: {
      id: "p1",
      name: "Alpha",
      research: {},
      fleetPresets: [
        { id: "expedition", name: "Expedition", intent: "expedition", builtIn: true, ships: { scout: 2, hauler: 1 } },
        { id: "raid", name: "Raid", intent: "raid", builtIn: true, ships: { interceptor: 10 } },
        { id: "moonDestruction", name: "Moon Destruction", intent: "moonDestruction", builtIn: true, ships: { voidforgeTitan: 1 } },
        { id: "miniPlanetCapture", name: "Mini Planet Capture", intent: "miniCapture", builtIn: true, ships: { cruiser: 10 } },
        { id: "miniPlanetDestruction", name: "Mini Planet Destruction", intent: "miniDestroy", builtIn: true, ships: { worldEater: 1 } },
        { id: "custom_1", name: "Custom Pack", intent: "custom", builtIn: false, ships: { scout: 1 } },
      ],
    },
    planet: {
      id: "pl1",
      name: "Home",
      kind: "planet",
      coords: { galaxy: 1, system: 1, slot: 8 },
      ships,
      buildings: { shipyard: 0 },
    },
    roster: [],
    ownedPlanets: [],
    galaxy: { galaxy: 1, system: 1, slots: [], asteroids: [], pirateBase: null, alienBase: null },
    fleets: [],
    fleetSlotCap: 1,
    expeditionSlotCap: 1,
    universe: { speed: 1, fleetSpeed: 1 },
    openAcsGroups: [],
  } as unknown as PlayerView;
}

describe("onboarding ui", () => {
  it("shows the overview briefing, claim button, and hides it when dismissed or finished", () => {
    const shown = pageHtml("overview", overviewView(briefing()), false, null);
    assert.match(shown, /data-testid="onboarding-panel"/);
    assert.match(shown, /data-testid="onboarding-claim-metalMine1"/);
    assert.match(shown, /data-testid="onboarding-step-colonyFoundation"/);
    assert.match(shown, /1 \/ 8 complete/);
    assert.match(shown, /data-testid="overview-daily-missions-ready"/);
    assert.doesNotMatch(shown, /Metal ×1\.20/);
    assert.match(shown, /data-testid="position-mult"/);
    assert.match(shown, /data-testid="position-mult-tip"/);
    assert.match(shown, /Hotter slots raise solar energy and metal/);

    const hidden = pageHtml(
      "overview",
      overviewView(briefing({ dismissed: true })),
      false,
      null,
    );
    assert.doesNotMatch(hidden, /data-testid="onboarding-panel"/);

    const done = pageHtml(
      "overview",
      overviewView(briefing({ allClaimed: true })),
      false,
      null,
    );
    assert.doesNotMatch(done, /data-testid="onboarding-panel"/);

    const legacy = pageHtml("overview", overviewView(undefined), false, null);
    assert.doesNotMatch(legacy, /data-testid="onboarding-panel"/);
    assert.match(legacy, /data-testid="overview-panel"/);
  });

  it("restores a dismissed briefing from the goals page", () => {
    const restored = pageHtml(
      "goals",
      overviewView(briefing({ dismissed: true })),
      false,
      null,
    );
    assert.match(restored, /data-testid="onboarding-restore"/);
    assert.match(restored, /data-onboarding-dismiss="false"/);
    assert.doesNotMatch(restored, /data-testid="onboarding-panel"/);

    const open = pageHtml("goals", overviewView(briefing()), false, null);
    assert.match(open, /data-testid="onboarding-goals"/);
    assert.match(open, /data-testid="onboarding-claim-metalMine1"/);
    assert.doesNotMatch(open, /data-testid="onboarding-restore"/);

    const legacy = pageHtml("goals", overviewView(undefined), false, null);
    assert.doesNotMatch(legacy, /data-testid="onboarding-restore"/);
    assert.match(legacy, /data-testid="goals-daily"/);
  });

  it("hides locked superweapon presets until the hull is owned", () => {
    const fresh = fleetComposer(fleetView(), false, blankFleetDraft());
    assert.doesNotMatch(fresh, /Moon Destruction/);
    assert.doesNotMatch(fresh, /Mini Planet Destruction/);
    assert.match(fresh, /Expedition/);
    assert.match(fresh, /Custom Pack/);
    assert.match(fresh, /Mini Planet Capture/);

    const step2 = fleetComposer(
      fleetView({ scout: 1 }),
      false,
      { ...blankFleetDraft(), step: 2, counts: { scout: 1 } },
    );
    assert.match(step2, /Station \/ Deploy \(one-way\)/);
    assert.doesNotMatch(step2, /Deploy \(park own \/ attack rival\)/);
    assert.match(step2, /Station ships on your own colony\/moon/);

    const owned = fleetComposer(
      fleetView({ voidforgeTitan: 1, worldEater: 1 }),
      false,
      blankFleetDraft(),
    );
    assert.match(owned, /Moon Destruction/);
    assert.match(owned, /Mini Planet Destruction/);
  });
});
