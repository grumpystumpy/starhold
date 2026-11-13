import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OnboardingView, PlayerView } from "@starhold/game";
import { pageHtml } from "./render-pages";

function briefing(partial: Partial<OnboardingView> = {}): OnboardingView {
  return {
    dismissed: false,
    allClaimed: false,
    completedCount: 1,
    steps: [
      {
        id: "metalMine1",
        title: "Ore Mine",
        description: "Ore Mine step",
        targetNavPage: "buildings",
        completed: true,
        claimed: false,
        reward: { starshards: 0, metal: 600, crystal: 250, deuterium: 0 },
      },
    ],
    ...partial,
  };
}

function overview(partial: {
  onboarding?: OnboardingView;
  dismissed?: boolean;
  owned?: PlayerView["ownedPlanets"];
  sensor?: number;
} = {}): PlayerView {
  return {
    player: {
      id: "p1",
      name: "Commander",
      cosmetics: {},
      research: {},
      midgameBriefingDismissed: partial.dismissed,
    },
    planet: {
      id: "pl1",
      name: "Home",
      kind: "planet",
      coords: { galaxy: 1, system: 1, slot: 1 },
      buildings: { sensorArray: partial.sensor ?? 0, jumpGate: 0, shipyard: 0, metalMine: 1 },
      buildQueue: [],
      shipQueue: [],
      defenseQueue: [],
      ships: {},
      defenses: {},
    },
    planetArt: { artId: "earth", artUrl: "", artThumbUrl: "" },
    economy: {
      fields: { used: 1, cap: 100, remaining: 99 },
      positionMult: { metal: 1, crystal: 1, deuterium: 1, energy: 1 },
      productionPerHour: { metal: 100, crystal: 50, deuterium: 20 },
      energy: { factor: 1, produced: 100, used: 50 },
      temperatureK: 250,
    },
    goals: [],
    onboarding: partial.onboarding,
    ownedPlanets: partial.owned ?? [
      { id: "pl1", isMoon: false, isMini: false, jumpGateLevel: 0, researchLab: 0 },
    ],
  } as unknown as PlayerView;
}

function card(html: string, id: string): string {
  const start = html.indexOf(`data-testid="midgame-card-${id}"`);
  assert.ok(start >= 0, id);
  const end = html.indexOf("</li>", start);
  return html.slice(start, end);
}

describe("mid-game briefing ui", () => {
  it("shows milestone cards after the commander briefing and links each page", () => {
    const open = pageHtml("overview", overview({ onboarding: briefing() }), false, null);
    assert.match(open, /data-testid="onboarding-panel"/);
    assert.doesNotMatch(open, /data-testid="midgame-briefing"/);

    const shown = pageHtml(
      "overview",
      overview({ onboarding: briefing({ dismissed: true }) }),
      false,
      null,
    );
    assert.doesNotMatch(shown, /data-testid="onboarding-panel"/);
    assert.match(shown, /data-testid="midgame-briefing"/);
    assert.match(shown, /No rewards/);
    assert.match(shown, /data-testid="midgame-dismiss"/);
    assert.match(shown, /Hide milestones/);
    assert.match(card(shown, "extraColony"), /data-completed="false"/);
    assert.match(card(shown, "extraColony"), /A second world for mines/);
    assert.match(card(shown, "extraColony"), /data-nav="galaxy"/);
    assert.match(card(shown, "extraColony"), /href="\/galaxy\?playerId=p1&amp;planet=pl1"/);
    assert.match(card(shown, "firstMoon"), /data-nav="fleet"/);
    assert.match(card(shown, "systemScanner"), /data-nav="buildings"/);
    assert.match(card(shown, "systemScanner"), /Scans nearby systems/);
    assert.match(card(shown, "moonBridge"), /Both moons need a Moon Bridge/);
    const strike = card(shown, "jointStrike");
    assert.doesNotMatch(strike, /data-completed/);
    assert.doesNotMatch(strike, /Done|Not yet/);
    assert.match(strike, /15 minutes/);
    assert.match(strike, /data-nav="fleet"/);

    const finished = pageHtml(
      "overview",
      overview({ onboarding: briefing({ allClaimed: true }) }),
      false,
      null,
    );
    assert.match(finished, /data-testid="midgame-briefing"/);
    assert.doesNotMatch(finished, /data-testid="onboarding-panel"/);

    const goals = pageHtml(
      "goals",
      overview({ onboarding: briefing({ dismissed: true }) }),
      false,
      null,
    );
    assert.doesNotMatch(goals, /data-testid="midgame-briefing"/);
  });

  it("marks cards from owned worlds and hides the guide after dismiss", () => {
    const done = pageHtml(
      "overview",
      overview({
        onboarding: briefing({ dismissed: true }),
        owned: [
          { id: "pl1", isMoon: false, isMini: false, jumpGateLevel: 0, researchLab: 1 },
          { id: "pl2", isMoon: false, isMini: false, jumpGateLevel: 0, researchLab: 0 },
          {
            id: "moon1",
            isMoon: true,
            isMini: false,
            jumpGateLevel: 1,
            sensorArrayLevel: 2,
            researchLab: 0,
          },
        ] as PlayerView["ownedPlanets"],
      }),
      false,
      null,
    );
    assert.match(card(done, "extraColony"), /data-completed="true"/);
    assert.match(card(done, "firstMoon"), /data-completed="true"/);
    assert.match(card(done, "systemScanner"), /data-completed="true"/);
    assert.match(card(done, "moonBridge"), /data-completed="true"/);
    assert.doesNotMatch(card(done, "jointStrike"), /data-completed/);

    const hidden = pageHtml(
      "overview",
      overview({
        onboarding: briefing({ allClaimed: true }),
        dismissed: true,
      }),
      false,
      null,
    );
    assert.doesNotMatch(hidden, /data-testid="midgame-briefing"/);

    const busy = pageHtml(
      "overview",
      overview({ onboarding: briefing({ dismissed: true }) }),
      true,
      null,
    );
    assert.match(busy, /data-testid="midgame-dismiss"[^>]*disabled/);
  });
});
