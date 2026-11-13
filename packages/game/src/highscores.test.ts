import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HIGHSCORE_CATEGORY_CAP } from "./catalog.js";
import { researchUpgradeCost } from "./formulas-build.js";
import {
  buildingPoints,
  categoryPointTotals,
  defenseStockPoints,
  emptyDefenses,
  emptyFleetShips,
  planetPoints,
  researchPoints,
  roughPoints,
  shipStockPoints,
} from "./formulas.js";
import {
  allianceRankBoard,
  appendHighscoreRankHistory,
  bindAllianceRankSource,
  categoryHighscoreBoards,
  createAlliance,
  createUniverse,
  empirePoints,
  galaxyViewFor,
  HIGHSCORE_RANK_HISTORY_DAYS,
  highscoresBoard,
  joinAlliance,
  joinUniverse,
  launchFleet,
  playerView,
  utcHighscoreDay,
} from "./world.js";
import { emptyBuildings } from "./world-bootstrap.js";
import { graduateNewbieProtection } from "./test-graduate.js";
import { recordCombatReport } from "./combat-share.js";
import { bindHighscoreSource } from "./world-view.js";

describe("P2 highscores", () => {
  it("shows an owner's empire total and debris in the galaxy row", () => {
    const universe = createUniverse("Galaxy Points", 8);
    const joined = joinUniverse(universe, "Galaxy Scorer", 149_000_000);
    const player = universe.players[joined.player.id]!;
    player.research.energyTech = 5;
    const planet = universe.planets[joined.planet.id]!;
    universe.debris[`${planet.coords.galaxy}:${planet.coords.system}:${planet.coords.slot}`] = {
      coords: planet.coords,
      metal: 1200,
      crystal: 340,
    };

    const row = galaxyViewFor(
      universe,
      player.id,
      planet.coords.galaxy,
      planet.coords.system,
    ).slots.find((slot) => slot.planetId === planet.id);

    assert.ok(row);
    assert.equal(row.empirePoints, empirePoints(universe, player));
    assert.notEqual(row.empirePoints, planetPoints(planet));
    assert.deepEqual(row.debris, { metal: 1200, crystal: 340 });
  });

  it("has no debris for an empty field and builds from a legacy state without debris", () => {
    const universe = createUniverse("Legacy Galaxy", 8);
    const joined = joinUniverse(universe, "Legacy Viewer", 149_000_001);
    const player = universe.players[joined.player.id]!;
    const planet = universe.planets[joined.planet.id]!;
    player.research.energyTech = 3;
    planet.buildings.metalMine = 14;
    planet.resources.metal = 4321;
    delete (universe as Partial<typeof universe>).debris;

    const galaxy = galaxyViewFor(
      universe,
      joined.player.id,
      planet.coords.galaxy,
      planet.coords.system,
    );

    const row = galaxy.slots.find((slot) => slot.planetId === planet.id);
    assert.ok(row);
    assert.equal(row.debris, null);
    assert.equal(player.research.energyTech, 3);
    assert.equal(planet.buildings.metalMine, 14);
    assert.equal(planet.resources.metal, 4321);
    assert.deepEqual(universe.debris, {});
  });

  it("counts research once across two colonies", () => {
    const universe = createUniverse("Score Drift", 8);
    const a = joinUniverse(universe, "Scorer", 150_000_000);
    const player = universe.players[a.player.id];
    player.research.energyTech = 5;
    player.research.weaponsTech = 4;
    player.research.armourTech = 3;

    const home = universe.planets[a.planet.id];
    home.buildings.metalMine = 8;
    home.buildings.crystalMine = 6;
    home.buildings.solarPlant = 6;
    home.ships.scout = 10;
    const colonyId = "colony-score-1";
    universe.planets[colonyId] = {
      id: colonyId,
      ownerPlayerId: player.id,
      name: "Colony",
      coords: {
        galaxy: home.coords.galaxy,
        system: home.coords.system,
        slot: home.coords.slot === 1 ? 2 : 1,
      },
      resources: { metal: 0, crystal: 0, deuterium: 0 },
      lastTickAt: home.lastTickAt,
      buildings: {
        ...emptyBuildings(),
        metalMine: 5,
        crystalMine: 4,
        solarPlant: 4,
      },
      ships: emptyFleetShips(),
      defenses: emptyDefenses(),
      buildQueue: [],
      shipQueue: [],
      defenseQueue: [],
    };
    player.planetIds.push(colonyId);

    const rp = researchPoints(player.research);
    const homePts = planetPoints(home);
    const colonyPts = planetPoints(universe.planets[colonyId]);
    const empire = empirePoints(universe, player);

    assert.ok(rp > 1);
    assert.ok(colonyPts > 1);
    assert.equal(empire, Math.floor(homePts + colonyPts + rp));
    // Naive per-planet roughPoints would count research twice.
    const naive =
      roughPoints(home, player.research) +
      roughPoints(universe.planets[colonyId], player.research);
    assert.ok(naive > empire);
  });

  it("includes in-flight ships in empire points", () => {
    const universe = createUniverse("Fleet Score", 8);
    const a = joinUniverse(universe, "Flyer", 151_000_000);
    const b = joinUniverse(universe, "Target", 151_000_001);
    graduateNewbieProtection(universe, universe.players[b.player.id]!);
    universe.planets[a.planet.id].ships.scout = 3;
    universe.planets[a.planet.id].resources.deuterium = 5_000;
    const before = empirePoints(universe, universe.players[a.player.id]);

    const launch = launchFleet(universe, {
      playerId: a.player.id,
      mission: "raid",
      targetPlanetId: b.planet.id,
      targetCoords: b.planet.coords,
      ships: { scout: 2 },
      now: 151_000_100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    const after = empirePoints(universe, universe.players[a.player.id]);
    // Two scouts left the hangar but remain in the fleet — points unchanged.
    assert.equal(after, before);
    assert.ok(Object.keys(universe.fleets).length >= 1);
  });

  it("ranks by points with playerId tie-break", () => {
    const universe = createUniverse("Rank Drift", 8);
    const early = joinUniverse(universe, "Alpha", 152_000_000);
    const late = joinUniverse(universe, "Bravo", 152_000_001);
    universe.planets[early.planet.id].ships.scout = 5;
    universe.players[late.player.id].research.energyTech = 3;

    const board = highscoresBoard(universe);
    assert.equal(board.length, 2);
    assert.equal(board[0].rank, 1);
    assert.equal(board[1].rank, 2);
    assert.ok(board[0].points >= board[1].points);
    if (board[0].points === board[1].points) {
      assert.ok(board[0].playerId < board[1].playerId);
    }

    const view = playerView(universe, early.player.id, 152_000_200);
    assert.ok(view.highscores.length >= 2);
    assert.equal(view.highscores[0].rank, 1);
    const self = view.highscores.find((h) => h.playerId === early.player.id);
    assert.ok(self);
    assert.equal(self!.points, empirePoints(universe, universe.players[early.player.id]));
    assert.equal(self!.planetCount, 1);

    // energyTech L1+L2+L3 costs should beat 5 scouts or not — just ensure board is sorted.
    for (let i = 1; i < view.highscores.length; i++) {
      assert.ok(view.highscores[i - 1].points >= view.highscores[i].points);
    }

    // Sanity: research helper matches catalog costs.
    let expectedResearch = 0;
    for (let L = 0; L < 3; L++) {
      const c = researchUpgradeCost("energyTech", L);
      expectedResearch += (c.metal + c.crystal + c.deuterium) / 1000;
    }
    assert.equal(
      researchPoints(universe.players[late.player.id].research),
      expectedResearch,
    );
  });

  it("ranks alliances by points then tag and caps the member loop", () => {
    const universe = createUniverse("Ally Ranks", 8);
    const low = joinUniverse(universe, "Low");
    const high = joinUniverse(universe, "High");
    assert.equal(createAlliance(universe, low.player.id, "Bravo", "bbb").ok, true);
    assert.equal(createAlliance(universe, high.player.id, "Alpha", "aaa").ok, true);
    const lowId = playerView(universe, low.player.id).alliance!.id;
    const highId = playerView(universe, high.player.id).alliance!.id;
    universe.players[high.player.id]!.research.energyTech = 4;
    const ranked = allianceRankBoard(universe);
    assert.equal(ranked[0]?.allianceId, highId);
    assert.equal(ranked[1]?.allianceId, lowId);
    assert.equal(ranked[0]?.tag, "AAA");
    assert.ok((ranked[0]?.points ?? 0) > (ranked[1]?.points ?? 0));
    assert.equal(
      ranked[0]?.averagePoints,
      Math.floor((ranked[0]?.points ?? 0) / (ranked[0]?.memberCount ?? 1)),
    );

    const tieA = joinUniverse(universe, "TieA");
    const tieB = joinUniverse(universe, "TieB");
    assert.equal(createAlliance(universe, tieA.player.id, "Zulu", "zzz").ok, true);
    assert.equal(createAlliance(universe, tieB.player.id, "Yankee", "yyy").ok, true);
    const zid = playerView(universe, tieA.player.id).alliance!.id;
    const yid = playerView(universe, tieB.player.id).alliance!.id;
    const planetA = universe.planets[tieA.player.homePlanetId]!;
    const planetB = universe.planets[tieB.player.homePlanetId]!;
    planetB.buildings = { ...planetA.buildings };
    planetB.ships = { ...planetA.ships };
    planetB.defenses = { ...planetA.defenses };
    planetB.resources = { ...planetA.resources };
    universe.players[tieB.player.id]!.research = {
      ...universe.players[tieA.player.id]!.research,
    };
    assert.equal(
      empirePoints(universe, universe.players[tieA.player.id]!),
      empirePoints(universe, universe.players[tieB.player.id]!),
    );
    const tied = allianceRankBoard(universe);
    const y = tied.find((row) => row.allianceId === yid);
    const z = tied.find((row) => row.allianceId === zid);
    assert.ok(y && z);
    assert.ok(y.rank < z.rank);

    const stuffed = universe.alliances![lowId]!;
    for (let i = 0; i < 20; i++) {
      stuffed.members[`ghost${i}`] = {
        playerId: `ghost${i}`,
        role: "member",
        joinedAt: i + 1,
      };
    }
    const capped = allianceRankBoard(universe).find((row) => row.allianceId === lowId);
    assert.equal(capped?.memberCount, 16);
    const recruit = joinUniverse(universe, "Shown");
    assert.equal(joinAlliance(universe, recruit.player.id, { allianceId: highId }).ok, true);
    const view = playerView(universe, recruit.player.id);
    assert.ok(view.allianceHighscores?.some((row) => row.tag === "AAA"));
    assert.ok(
      view.highscores.some(
        (row) => row.playerId === recruit.player.id && row.allianceTag === "AAA",
      ),
    );
    bindAllianceRankSource(() => []);
    try {
      assert.deepEqual(playerView(universe, recruit.player.id).allianceHighscores, []);
    } finally {
      bindAllianceRankSource(undefined);
    }
  });

  it("uses the supplied cached combat halls in player views", () => {
    const universe = createUniverse("Cached Combat Halls", 9);
    const player = joinUniverse(universe, "Cache Viewer", 160_000_000);
    const hallOfFame = [{
      at: 1,
      attackerName: "Attacker",
      defenderName: "Defender",
      targetCoords: { galaxy: 1, system: 1, slot: 8 },
      outcome: "attacker_win" as const,
      destroyedValue: 123,
      shareCode: "sh_cached",
    }];
    const hallOfShame = [{
      rank: 1,
      playerId: player.player.id,
      name: player.player.name,
      lostValue: 456,
    }];
    bindHighscoreSource(() => ({
      rows: highscoresBoard(universe),
      hallOfFame,
      hallOfShame,
    }));
    try {
      const view = playerView(universe, player.player.id, 160_000_100);
      assert.deepEqual(view.hallOfFame, hallOfFame);
      assert.deepEqual(view.hallOfShame, hallOfShame);
    } finally {
      bindHighscoreSource(undefined);
    }
  });

  it("builds both halls from the universe when no score cache is bound", () => {
    bindHighscoreSource(undefined);
    const universe = createUniverse("Live Halls", 10);
    const attacker = joinUniverse(universe, "Live Atk", 161_000_000).player;
    const defender = joinUniverse(universe, "Live Def", 161_000_001).player;
    const attackerBefore = emptyFleetShips();
    const attackerAfter = emptyFleetShips();
    const defenderBefore = emptyFleetShips();
    const defenderAfter = emptyFleetShips();
    attackerBefore.scout = 3;
    attackerAfter.scout = 2;
    defenderBefore.interceptor = 2;
    defenderAfter.interceptor = 1;
    recordCombatReport(universe, {
      id: "live-hall",
      at: 161_000_100,
      missionId: "live-mission",
      attackerPlayerId: attacker.id,
      defenderPlayerId: defender.id,
      attackerName: attacker.name,
      defenderName: defender.name,
      targetCoords: { galaxy: 1, system: 1, slot: 8 },
      attackerBefore,
      attackerAfter,
      defenderBefore,
      defenderAfter,
      defensesBefore: emptyDefenses(),
      defensesAfter: emptyDefenses(),
      loot: { metal: 0, crystal: 0, deuterium: 0 },
      debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
      outcome: "attacker_win",
      rounds: 1,
      summary: "Live",
    });
    const view = playerView(universe, attacker.id, 161_000_200);
    assert.equal(view.hallOfFame[0]?.attackerName, "Live Atk");
    assert.ok((view.hallOfFame[0]?.destroyedValue ?? 0) > 0);
    assert.equal(view.hallOfShame[0]?.playerId, defender.id);
    assert.ok((view.hallOfShame[0]?.lostValue ?? 0) > (view.hallOfShame[1]?.lostValue ?? 0));
  });

  it("ranks category boards from the existing cost rules and keeps them off the player view", () => {
    const universe = createUniverse("Category Boards", 8);
    const miner = joinUniverse(universe, "Miner", 170_000_000);
    const flyer = joinUniverse(universe, "Flyer", 170_000_001);
    const minerPlayer = universe.players[miner.player.id]!;
    const flyerPlayer = universe.players[flyer.player.id]!;
    minerPlayer.research.energyTech = 4;
    const home = universe.planets[miner.planet.id]!;
    const flyerHome = universe.planets[flyer.planet.id]!;
    home.buildings.metalMine = 8;
    home.defenses.laserBattery = 6;
    flyerHome.ships.scout = 12;
    flyerHome.resources.deuterium = 8_000;
    const colonyId = "colony-category";
    universe.planets[colonyId] = {
      ...home,
      id: colonyId,
      name: "Colony",
      coords: {
        galaxy: home.coords.galaxy,
        system: home.coords.system,
        slot: home.coords.slot === 1 ? 2 : 1,
      },
      buildings: { ...home.buildings, metalMine: 3 },
      ships: emptyFleetShips(),
      defenses: emptyDefenses(),
    };
    minerPlayer.planetIds.push(colonyId);

    const totals = categoryPointTotals(universe, minerPlayer);
    assert.equal(
      totals.buildings,
      Math.floor(buildingPoints(home) + buildingPoints(universe.planets[colonyId]!)),
    );
    assert.equal(totals.defense, Math.floor(defenseStockPoints(home)));
    assert.equal(totals.research, Math.floor(researchPoints(minerPlayer.research)));
    assert.equal(totals.fleet, Math.floor(shipStockPoints(home.ships)));
    assert.ok(totals.buildings > 0);
    assert.ok(totals.defense > 0);
    assert.ok(totals.research > 0);
    const beforeFleet = categoryPointTotals(universe, flyerPlayer).fleet;
    flyerHome.ships.scout = 8;
    universe.fleets["category-flight"] = {
      id: "category-flight",
      ownerPlayerId: flyer.player.id,
      ships: { scout: 4 },
    } as (typeof universe.fleets)[string];
    assert.equal(categoryPointTotals(universe, flyerPlayer).fleet, beforeFleet);

    const boards = categoryHighscoreBoards(universe);
    assert.equal(boards.buildings[0]?.playerId, miner.player.id);
    assert.equal(boards.defense[0]?.playerId, miner.player.id);
    assert.equal(boards.research[0]?.playerId, miner.player.id);
    assert.equal(boards.fleet[0]?.playerId, flyer.player.id);
    assert.equal(boards.buildings[0]?.points, totals.buildings);
    assert.equal(boards.fleet[0]?.rank, 1);
    assert.ok(boards.buildings[0]!.points >= boards.buildings[1]!.points);
    for (const id of ["buildings", "fleet", "research", "defense"] as const) {
      assert.ok(boards[id].length <= HIGHSCORE_CATEGORY_CAP);
      assert.equal(boards[id][0]?.rank, 1);
    }

    const tied = createUniverse("Category Tie", 8);
    const left = joinUniverse(tied, "Left", 170_000_300);
    const right = joinUniverse(tied, "Right", 170_000_301);
    universeCopyBuildings(tied, left.planet.id, right.planet.id);
    tied.players[right.player.id]!.research = { ...tied.players[left.player.id]!.research };
    const tiedBoards = categoryHighscoreBoards(tied);
    const first = tiedBoards.research[0]!;
    const second = tiedBoards.research[1]!;
    assert.equal(first.points, second.points);
    assert.ok(first.playerId < second.playerId);

    delete universe.fleets["category-flight"];
    flyerHome.ships.scout = 12;
    const view = playerView(universe, miner.player.id, 170_000_400);
    assert.equal("categoryHighscores" in view, false);
    assert.equal(view.highscores.find((row) => row.playerId === miner.player.id)?.points, empirePoints(universe, minerPlayer));
  });

  it("keeps each category board to the top 100 commanders", () => {
    const universe = createUniverse("Category Cap", 8);
    let lowestId = "";
    let highestId = "";
    for (let i = 0; i < HIGHSCORE_CATEGORY_CAP + 1; i++) {
      const joined = joinUniverse(universe, `Cap${i}`, 171_000_000 + i);
      const planet = universe.planets[joined.planet.id]!;
      if (i === 0) {
        planet.buildings = emptyBuildings();
        lowestId = joined.player.id;
      } else {
        planet.buildings = { ...emptyBuildings(), metalMine: 10 + i };
        if (i === HIGHSCORE_CATEGORY_CAP) highestId = joined.player.id;
      }
    }
    const boards = categoryHighscoreBoards(universe);
    assert.equal(boards.buildings.length, HIGHSCORE_CATEGORY_CAP);
    assert.equal(boards.buildings[0]?.playerId, highestId);
    assert.equal(boards.buildings[0]?.rank, 1);
    assert.ok((boards.buildings[0]?.points ?? 0) > (boards.buildings[1]?.points ?? 0));
    assert.equal(boards.buildings.some((row) => row.playerId === lowestId), false);
  });
});

describe("highscore daily rank history", () => {
  it("keeps current rank math free of history and caps snapshots at 7 UTC days", () => {
    assert.equal(HIGHSCORE_RANK_HISTORY_DAYS, 7);
    const universe = createUniverse("Rank History", 8);
    joinUniverse(universe, "Ada", 170_000_000_000);
    joinUniverse(universe, "Bea", 170_000_000_001);
    const board = highscoresBoard(universe);
    assert.ok(board.length >= 2);
    assert.equal(board[0]?.rankHistory, undefined);
    assert.equal(board[0]!.rank, 1);

    const day = utcHighscoreDay(Date.UTC(2026, 10, 10));
    assert.equal(day, "2026-11-10");
    const first = appendHighscoreRankHistory(undefined, day, 2);
    assert.deepEqual(first, [{ day, rank: 2 }]);
    const sameDay = appendHighscoreRankHistory(first, day, 1);
    assert.deepEqual(sameDay, [{ day, rank: 1 }]);
    assert.equal(new Set(sameDay.map((point) => point.day)).size, 1);

    const prior = Array.from({ length: HIGHSCORE_RANK_HISTORY_DAYS }, (_, index) => ({
      day: `2026-11-${String(index + 1).padStart(2, "0")}`,
      rank: HIGHSCORE_RANK_HISTORY_DAYS - index,
    }));
    const eighth = appendHighscoreRankHistory(
      [{ day: "nope", rank: 1 }, ...prior],
      "2026-11-08",
      1,
    );
    assert.equal(eighth.length, 7);
    assert.equal(eighth[0]?.day, "2026-11-02");
    assert.equal(eighth[0]?.rank, prior[1]?.rank);
    assert.equal(eighth[6]?.day, "2026-11-08");
    assert.equal(eighth[6]?.rank, 1);
    assert.equal(new Set(eighth.map((point) => point.day)).size, 7);
  });
});

function universeCopyBuildings(
  universe: ReturnType<typeof createUniverse>,
  fromId: string,
  toId: string,
): void {
  const from = universe.planets[fromId]!;
  const to = universe.planets[toId]!;
  to.buildings = { ...from.buildings };
  to.ships = { ...from.ships };
  to.defenses = { ...from.defenses };
}
