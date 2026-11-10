import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { goalRewardText, goalsPageHtml } from "./render-goals";
import { pageHtml } from "./render-pages";

describe("goal reward text", () => {
  it("formats resource and Starshard rewards with commas and no underscores", () => {
    const resources = goalRewardText({
      starshards: 0,
      metal: 2000,
      crystal: 1000,
      deuterium: 500,
    });
    assert.equal(resources, "2k metal · 1k crystal · 500 deuterium");
    assert.equal(resources.includes("_"), false);

    const weekly = goalRewardText({
      starshards: 0,
      metal: 12000,
      crystal: 6000,
      deuterium: 3000,
    });
    assert.equal(
      weekly,
      "12k metal · 6k crystal · 3k deuterium",
    );

    const shards = goalRewardText({
      starshards: 25,
      metal: 0,
      crystal: 0,
      deuterium: 0,
    });
    assert.equal(shards, "25 Starshards");
    assert.equal(shards.includes("_"), false);
  });

  it("renders overview with count of daily missions ready to claim", () => {
    const mockView = {
      player: { id: "p1", name: "Commander", cosmetics: {}, research: {} },
      planet: {
        id: "pl1",
        name: "Home",
        coords: { galaxy: 1, system: 1, slot: 1 },
        buildings: { shipyard: 1, metalMine: 1, solarPlant: 1 },
        buildQueue: [],
        shipQueue: [],
        defenseQueue: [],
        ships: { scout: 0 },
        defenses: {},
      },
      planetArt: { artId: "earth", artUrl: "", artThumbUrl: "" },
      economy: {
        fields: { used: 10, cap: 100, remaining: 90 },
        positionMult: { metal: 1, crystal: 1, deuterium: 1, energy: 1 },
        productionPerHour: { metal: 100, crystal: 50, deuterium: 20 },
        energy: { factor: 1, produced: 100, used: 50 },
      },
      goals: [
        {
          id: "dailyBuildingUpgrades",
          cadence: "daily",
          title: "Building upgrades",
          detail: "desc",
          progress: 3,
          target: 3,
          claimed: false,
          reward: { starshards: 0, metal: 1500, crystal: 750, deuterium: 250 },
        },
        {
          id: "dailyResearch",
          cadence: "daily",
          title: "Research project",
          detail: "desc",
          progress: 1,
          target: 1,
          claimed: true, // claimed -> not ready
          reward: { starshards: 15, metal: 0, crystal: 0, deuterium: 0 },
        },
        {
          id: "dailyShips",
          cadence: "daily",
          title: "Fleet construction",
          detail: "desc",
          progress: 10,
          target: 10,
          claimed: false,
          reward: { starshards: 0, metal: 2500, crystal: 1250, deuterium: 500 },
        },
      ],
    } as unknown as PlayerView;

    const html = pageHtml("overview", mockView, false, null);
    assert.ok(html.includes('data-testid="overview-daily-missions-ready"'));
    assert.ok(html.includes("Daily missions ready to claim:"));
    // 2 daily missions ready (1 is claimed)
    assert.ok(html.includes("<strong>2</strong>"));
  });

  it("renders goals page with all daily goals", () => {
    const mockView = {
      goals: [
        {
          id: "dailyBuildingUpgrades",
          cadence: "daily",
          title: "Building upgrades",
          detail: "desc",
          progress: 2,
          target: 3,
          claimed: false,
          reward: { starshards: 0, metal: 1500, crystal: 750, deuterium: 250 },
        },
        {
          id: "dailyResearch",
          cadence: "daily",
          title: "Research project",
          detail: "desc",
          progress: 1,
          target: 1,
          claimed: false,
          reward: { starshards: 15, metal: 0, crystal: 0, deuterium: 0 },
        },
      ],
    } as unknown as PlayerView;

    const html = goalsPageHtml(mockView, false);
    assert.ok(html.includes('data-testid="goal-dailyBuildingUpgrades"'));
    assert.ok(html.includes('data-testid="goal-dailyResearch"'));
  });

  it("renders the weekly board beside the daily ready count", () => {
    const mockView = {
      player: { id: "p1", name: "Commander", cosmetics: {}, research: {} },
      planet: {
        id: "pl1",
        name: "Home",
        coords: { galaxy: 1, system: 1, slot: 1 },
        buildings: { shipyard: 1, metalMine: 1, solarPlant: 1 },
        buildQueue: [],
        shipQueue: [],
        defenseQueue: [],
        ships: { scout: 0 },
        defenses: {},
      },
      planetArt: { artId: "earth", artUrl: "", artThumbUrl: "" },
      economy: {
        fields: { used: 10, cap: 100, remaining: 90 },
        positionMult: { metal: 1, crystal: 1, deuterium: 1, energy: 1 },
        productionPerHour: { metal: 100, crystal: 50, deuterium: 20 },
        energy: { factor: 1, produced: 100, used: 50 },
      },
      goals: [
        {
          id: "weeklyBuildingUpgrades",
          cadence: "weekly",
          title: "Weekly building upgrades",
          detail: "Finish building upgrades this week across your empire.",
          progress: 12,
          target: 12,
          claimed: false,
          reward: { starshards: 0, metal: 9000, crystal: 4500, deuterium: 1500 },
        },
        {
          id: "weeklyResearch",
          cadence: "weekly",
          title: "Weekly research projects",
          detail: "Finish research projects this week across your empire.",
          progress: 4,
          target: 4,
          claimed: true,
          reward: { starshards: 60, metal: 0, crystal: 0, deuterium: 0 },
        },
      ],
    } as unknown as PlayerView;

    const overview = pageHtml("overview", mockView, false, null);
    assert.ok(overview.includes('data-testid="overview-daily-missions-ready"'));
    assert.ok(overview.includes('data-testid="overview-weekly-missions-ready"'));
    assert.ok(overview.includes("Weekly missions ready to claim:"));
    assert.ok(overview.includes('data-testid="overview-weekly-goals-link"'));
    const dailyCount = overview.match(
      /data-testid="overview-daily-missions-ready"[\s\S]*?<strong>([^<]+)<\/strong>/,
    );
    const weeklyCount = overview.match(
      /data-testid="overview-weekly-missions-ready"[\s\S]*?<strong>([^<]+)<\/strong>/,
    );
    assert.equal(dailyCount?.[1], "0");
    assert.equal(weeklyCount?.[1], "1");

    const goals = goalsPageHtml(mockView, false);
    assert.ok(goals.includes('data-testid="goals-weekly"'));
    assert.ok(goals.includes('data-testid="goal-weeklyBuildingUpgrades"'));
    assert.ok(goals.includes("Resets Monday 00:00 UTC"));
    assert.equal(goals.includes("_"), false);
  });
});
