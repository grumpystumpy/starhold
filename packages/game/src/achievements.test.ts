import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ACHIEVEMENTS } from "./data/tuning.js";
import { emptyDefenses, emptyFleetShips } from "./formulas.js";
import { recordCombatReport } from "./combat-share.js";
import { bindTickBudget } from "./tick-budget.js";
import type { FleetMission, UniverseState } from "./types.js";
import {
  createUniverse,
  evaluatePlayerAchievements,
  joinUniverse,
  migrateOrResetUniverse,
  noteAchievementCount,
  playerStateTickDue,
  playerView,
} from "./world.js";
import { resolveExpeditionArrival } from "./world-expedition.js";

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);

function reward(id: string): number {
  const row = ACHIEVEMENTS.find((item) => item.id === id);
  assert.ok(row, id);
  return row.starshards;
}

function fresh(name = "Achiever") {
  const universe = createUniverse(`${name} uni`, 1);
  const joined = joinUniverse(universe, name, NOW);
  return { universe, player: joined.player, planet: joined.planet };
}

describe("achievement catalog", () => {
  it("lists 12 one-time rows with small Starshard rewards", () => {
    assert.equal(ACHIEVEMENTS.length, 12);
    const ids = new Set(ACHIEVEMENTS.map((row) => row.id));
    assert.equal(ids.size, 12);
    for (const id of [
      "firstMoon",
      "firstColony",
      "shipsDestroyed1000",
      "firstPirateBase",
      "highscoreTop10",
      "expeditions10",
    ]) {
      assert.equal(ids.has(id), true, id);
    }
    for (const row of ACHIEVEMENTS) {
      assert.ok(row.starshards > 0 && row.starshards <= 30, row.id);
      assert.ok(row.target > 0, row.id);
    }
  });
});

describe("achievement unlocks", () => {
  it("pays retro credit once from data the save already holds", () => {
    const { universe, player, planet } = fresh();
    const moonId = "moon_retro";
    const moon = structuredClone(planet);
    moon.id = moonId;
    moon.kind = "moon";
    moon.name = "Retro Moon";
    moon.parentPlanetId = planet.id;
    universe.planets[moonId] = moon;
    player.planetIds.push(moonId);

    const colony = structuredClone(planet);
    colony.id = "plnt_colony";
    colony.kind = "planet";
    colony.name = "Colony";
    colony.coords = { ...planet.coords, slot: planet.coords.slot + 1 };
    universe.planets[colony.id] = colony;
    player.planetIds.push(colony.id);

    player.research.energyTech = 1;
    player.combatStats = { lostValue: 0, destroyedValue: 0, wins: 10, losses: 1 };
    player.allianceId = "ally_retro";
    player.officerLevels = { engineer: 1 };
    player.level = 5;
    player.starshards = 0;
    delete player.achievements;

    evaluatePlayerAchievements(universe, player, NOW, { rank: 1, rivals: 1 });
    const paid = [
      "firstMoon",
      "firstColony",
      "firstResearch",
      "firstVictory",
      "victories10",
      "firstAlliance",
      "officerHired",
      "commanderLevel5",
    ];
    const expected = paid.reduce((sum, id) => sum + reward(id), 0);
    assert.equal(player.starshards, expected);
    assert.equal(
      player.achievements?.unlocked.some((row) => row.id === "highscoreTop10"),
      false,
    );
    assert.equal(
      player.achievements?.unlocked.some((row) => row.id === "shipsDestroyed1000"),
      false,
    );
    assert.equal(player.achievements?.shipsDestroyed, undefined);

    evaluatePlayerAchievements(universe, player, NOW + 1, { rank: 1, rivals: 1 });
    assert.equal(player.starshards, expected);
    assert.equal(player.achievements?.unlocked.length, paid.length);
  });

  it("does not rebuild ship or pirate counts from stored reports", () => {
    const { universe, player, planet } = fresh("Reports");
    universe.reports = {
      old: {
        id: "old",
        at: NOW,
        missionId: "m",
        attackerPlayerId: player.id,
        defenderPlayerId: "npc_pirates",
        attackerName: player.name,
        defenderName: "Pirates",
        targetCoords: planet.coords,
        attackerBefore: emptyFleetShips(),
        attackerAfter: emptyFleetShips(),
        defenderBefore: { ...emptyFleetShips(), scout: 5000 },
        defenderAfter: emptyFleetShips(),
        defensesBefore: emptyDefenses(),
        defensesAfter: emptyDefenses(),
        loot: { metal: 0, crystal: 0, deuterium: 0 },
        debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
        outcome: "attacker_win",
        rounds: 1,
        summary: "old",
      },
    };
    evaluatePlayerAchievements(universe, player, NOW, { rank: null, rivals: 1 });
    assert.equal(player.achievements?.shipsDestroyed ?? 0, 0);
    assert.equal(player.achievements?.pirateBasesDestroyed ?? 0, 0);
    assert.equal(
      player.achievements?.unlocked.some((row) => row.id === "shipsDestroyed1000"),
      false,
    );
    assert.equal(player.starshards ?? 0, 0);
  });

  it("counts enemy hulls from the combat report and ignores defenses", () => {
    const { universe, player, planet } = fresh("Hulls");
    const ally = joinUniverse(universe, "Wing", NOW + 1);
    const before = emptyFleetShips();
    before.scout = 5;
    const after = emptyFleetShips();
    after.scout = 0;
    const defenses = emptyDefenses();
    defenses.rocketLauncher = 20;
    recordCombatReport(universe, {
      id: "rpt_hulls",
      at: NOW,
      missionId: "m",
      attackerPlayerId: player.id,
      defenderPlayerId: "npc_pirates",
      acsParticipantIds: [player.id, ally.player.id],
      attackerName: player.name,
      defenderName: "Pirates",
      targetCoords: planet.coords,
      attackerBefore: emptyFleetShips(),
      attackerAfter: emptyFleetShips(),
      defenderBefore: before,
      defenderAfter: after,
      defensesBefore: defenses,
      defensesAfter: emptyDefenses(),
      loot: { metal: 0, crystal: 0, deuterium: 0 },
      debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
      outcome: "attacker_win",
      rounds: 1,
      summary: "hulls",
    });
    assert.equal(player.achievements?.shipsDestroyed, 3);
    assert.equal(ally.player.achievements?.shipsDestroyed, 2);
    assert.equal(player.starshards ?? 0, 0);

    noteAchievementCount(player, "shipsDestroyed", 997);
    evaluatePlayerAchievements(universe, player, NOW, { rank: 40, rivals: 2 });
    assert.equal(player.achievements?.shipsDestroyed, 1000);
    assert.equal(player.starshards, reward("shipsDestroyed1000") + reward("firstVictory"));
    const again = player.starshards;
    evaluatePlayerAchievements(universe, player, NOW + 5, { rank: 40, rivals: 2 });
    assert.equal(player.starshards, again);
  });

  it("counts finished expeditions and a destroyed pirate base once", () => {
    const { universe, player, planet } = fresh("Runs");
    const fleet = {
      id: "xpd_ach",
      ownerPlayerId: player.id,
      originPlanetId: planet.id,
      targetPlanetId: null,
      targetPlayerId: null,
      targetCoords: { galaxy: planet.coords.galaxy, system: planet.coords.system, slot: 16 },
      mission: "expedition",
      ships: { ...emptyFleetShips(), scout: 1 },
      cargo: { metal: 0, crystal: 0, deuterium: 0 },
      departedAt: NOW,
      arrivesAt: NOW,
      phase: "outbound",
      reportId: null,
    } as FleetMission;
    for (let i = 0; i < 10; i++) {
      fleet.id = `xpd_ach_${i}`;
      fleet.arrivesAt = NOW + i;
      resolveExpeditionArrival(universe, fleet, NOW + i);
    }
    assert.equal(player.achievements?.expeditions, 10);
    noteAchievementCount(player, "pirateBasesDestroyed", 1);
    noteAchievementCount(player, "pirateBasesDestroyed", 1);
    evaluatePlayerAchievements(universe, player, NOW, { rank: null, rivals: 1 });
    assert.equal(
      player.achievements?.unlocked.filter((row) => row.id === "expeditions10").length,
      1,
    );
    assert.equal(
      player.achievements?.unlocked.filter((row) => row.id === "firstPirateBase").length,
      1,
    );
    const shards = player.starshards ?? 0;
    assert.ok(shards >= reward("expeditions10") + reward("firstPirateBase"));
    evaluatePlayerAchievements(universe, player, NOW + 1, { rank: null, rivals: 1 });
    assert.equal(player.starshards, shards);
  });

  it("pays top 10 only when another commander is on the board", () => {
    const { universe, player } = fresh("Solo");
    const alone = playerView(universe, player.id, NOW);
    const solo = alone.achievements?.find((row) => row.id === "highscoreTop10");
    assert.equal(solo?.unlocked, false);
    assert.equal(solo?.showProgress, false);
    assert.equal(solo?.note, "Needs another commander.");
    assert.equal(alone.starshards, 0);
    assert.equal(alone.achievements?.length, 12);

    joinUniverse(universe, "Rival", NOW + 1);
    universe.planets[player.homePlanetId]!.buildings.metalMine = 12;
    const ranked = playerView(universe, player.id, NOW + 2);
    const top = ranked.achievements?.find((row) => row.id === "highscoreTop10");
    assert.equal(top?.unlocked, true);
    assert.match(top?.note ?? "", /Current rank: 1/);
    const held = ranked.starshards;
    const second = playerView(universe, player.id, NOW + 3);
    assert.equal(second.starshards, held);
  });
});

describe("achievement save compat", () => {
  it("loads a main in-flight save without reset and keeps the fleet", () => {
    const path = fileURLToPath(
      new URL("./fixtures/pre-whats-new-inflight.json", import.meta.url),
    );
    const raw = JSON.parse(readFileSync(path, "utf8")) as UniverseState;
    const fleetId = Object.keys(raw.fleets)[0];
    assert.ok(fleetId);
    const savedFleet = raw.fleets[fleetId]!;
    const ownerId = savedFleet.ownerPlayerId;
    assert.equal(raw.players[ownerId]!.achievements, undefined);
    assert.equal(savedFleet.phase, "outbound");

    const loaded = migrateOrResetUniverse(structuredClone(raw));
    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.players[ownerId]!.achievements, undefined);
    assert.equal(loaded.universe.fleets[fleetId]!.ships.scout, 1);
    assert.equal(loaded.universe.fleets[fleetId]!.phase, "outbound");

    const homeId = loaded.universe.players[ownerId]!.homePlanetId;
    const quietAt = loaded.universe.planets[homeId]!.lastTickAt + 1000;
    assert.ok(savedFleet.arrivesAt > quietAt);
    bindTickBudget(() => ({
      raids: 0,
      levelUps: 0,
      fleets: 0,
      driftSteps: 0,
      seedSystems: 0,
      seedMinis: 0,
      seedPirates: 0,
      lazyPlanets: true,
    }));
    try {
      const due = playerStateTickDue(loaded.universe, ownerId, quietAt);
      playerView(loaded.universe, ownerId, quietAt, undefined, undefined, {
        skipUniverseTick: !due,
      });
    } finally {
      bindTickBudget(() => undefined);
    }

    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.fleets[fleetId]!.mission, "deploy");
    assert.equal(loaded.universe.fleets[fleetId]!.phase, "outbound");
    assert.equal(loaded.universe.fleets[fleetId]!.ships.scout, 1);
    assert.ok(loaded.universe.players[ownerId]!.achievements);
    assert.equal(loaded.universe.players[ownerId]!.name, "Hold");
  });
});
