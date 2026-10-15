import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SEASON_COMBAT_PVE_WIN,
  SEASON_COMBAT_WIN,
  SEASON_ECONOMY_SPEND_DIV,
} from "./catalog.js";
import { buildingUpgradeCost, researchUpgradeCost } from "./formulas-build.js";
import { emptyFleetShips } from "./formulas.js";
import {
  activePirateBases,
  addSeasonEconomySpend,
  advanceUniverse,
  claimSeasonReward,
  createUniverse,
  graduateNewbieProtection,
  grantSeasonPoints,
  isSeasonPvpMission,
  joinUniverse,
  launchFleet,
  migrateOrResetUniverse,
  playerView,
  queueBuildingUpgrade,
  queueResearch,
  queueShipBuild,
  rollSeasons,
  setSeasonSkin,
  setSeasonTitle,
} from "./world.js";

const OCT = Date.UTC(2026, 9, 14, 12, 0, 0);
const NOV = Date.UTC(2026, 10, 1, 12, 0, 0);

function spendOf(cost: { metal: number; crystal: number; deuterium: number }): number {
  return cost.metal + cost.crystal + cost.deuterium;
}

describe("monthly seasons", () => {
  it("treats raid and ACS as PvP season missions", () => {
    assert.equal(isSeasonPvpMission("raid"), true);
    assert.equal(isSeasonPvpMission("acs"), true);
    assert.equal(isSeasonPvpMission("deploy"), false);
    assert.equal(isSeasonPvpMission("pirateRaid"), false);
  });

  it("scores a raid win against another commander and ignores a loss", () => {
    const universe = createUniverse("Season Raid", 8);
    const raider = joinUniverse(universe, "Raider", OCT);
    const victim = joinUniverse(universe, "Victim", OCT + 1);
    graduateNewbieProtection(universe, universe.players[victim.player.id]!);
    const winner = universe.planets[raider.planet.id]!;
    winner.ships.scout = 5;
    winner.ships.hauler = 1;
    winner.resources.deuterium = 500;
    universe.planets[victim.planet.id]!.resources.metal = 2000;
    universe.planets[victim.planet.id]!.ships.scout = 0;

    const launch = launchFleet(
      universe,
      raider.player.id,
      victim.planet.id,
      "raid",
      { scout: 5, hauler: 1 },
      OCT + 100,
    );
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    advanceUniverse(universe, launch.fleet.arrivesAt);
    assert.equal(
      universe.players[raider.player.id]!.season?.combat,
      SEASON_COMBAT_WIN,
    );
    assert.equal(universe.players[victim.player.id]!.season?.combat, 0);
    assert.equal(universe.players[raider.player.id]!.season?.pirateKills, 0);

    const weak = createUniverse("Season Loss", 8);
    const attacker = joinUniverse(weak, "Weak", OCT);
    const wall = joinUniverse(weak, "Wall", OCT + 1);
    graduateNewbieProtection(weak, weak.players[wall.player.id]!);
    weak.planets[attacker.planet.id]!.ships.scout = 1;
    weak.planets[attacker.planet.id]!.resources.deuterium = 500;
    weak.planets[wall.planet.id]!.ships.interceptor = 12;
    const lost = launchFleet(
      weak,
      attacker.player.id,
      wall.planet.id,
      "raid",
      { scout: 1 },
      OCT + 100,
    );
    assert.equal(lost.ok, true);
    if (!lost.ok) return;
    advanceUniverse(weak, lost.fleet.arrivesAt);
    const report = Object.values(weak.reports).find(
      (row) => row.attackerPlayerId === attacker.player.id,
    );
    assert.equal(report?.outcome, "defender_win");
    assert.equal(weak.players[attacker.player.id]!.season?.combat, 0);
  });

  it("scores pirate-base wins as PvE combat and a pirate kill", () => {
    const universe = createUniverse("Season Pirates", 8);
    const base = activePirateBases(universe)[0]!;
    base.tier = 0;
    base.ships = emptyFleetShips();
    base.resources = { metal: 2000, crystal: 1000, deuterium: 200 };
    const { player, planet } = joinUniverse(universe, "Hunter", OCT);
    const body = universe.planets[planet.id]!;
    body.ships.cruiser = 5;
    body.ships.interceptor = 10;
    body.buildings.deutTank = 3;
    body.resources.deuterium = 80_000;
    const launch = launchFleet(universe, {
      playerId: player.id,
      mission: "pirateRaid",
      ships: { cruiser: 3, interceptor: 5 },
      pirateBaseId: base.id,
      now: OCT + 100,
    });
    assert.equal(launch.ok, true);
    if (!launch.ok) return;
    advanceUniverse(universe, launch.fleet.arrivesAt);
    const season = universe.players[player.id]!.season!;
    assert.equal(season.combat, SEASON_COMBAT_PVE_WIN);
    assert.equal(season.pirateKills, 1);
    assert.ok(universe.pirateBases?.[base.id]?.destroyedAt != null);
  });

  it("banks building and research spend into economy points", () => {
    const universe = createUniverse("Season Econ", 8);
    const { player, planet } = joinUniverse(universe, "Builder", OCT);
    universe.planets[planet.id]!.resources = {
      metal: 80_000,
      crystal: 80_000,
      deuterium: 80_000,
    };
    const queued = queueBuildingUpgrade(universe, player.id, "shipyard", OCT);
    assert.equal(queued.ok, true);
    const completesAt = universe.planets[planet.id]!.buildQueue[0]!.completesAt;
    advanceUniverse(universe, completesAt);
    const buildCost = buildingUpgradeCost("shipyard", 0);
    const buildSpend = spendOf(buildCost);
    const season = universe.players[player.id]!.season!;
    assert.equal(season.economy, Math.floor(buildSpend / SEASON_ECONOMY_SPEND_DIV));
    assert.equal(season.economyRemainder, buildSpend % SEASON_ECONOMY_SPEND_DIV);

    addSeasonEconomySpend(
      universe.players[player.id]!,
      { metal: 600, crystal: 0, deuterium: 0 },
      completesAt + 1,
    );
    const bank = (buildSpend % SEASON_ECONOMY_SPEND_DIV) + 600;
    assert.equal(
      universe.players[player.id]!.season!.economy,
      Math.floor(buildSpend / SEASON_ECONOMY_SPEND_DIV) + Math.floor(bank / SEASON_ECONOMY_SPEND_DIV),
    );
    assert.equal(
      universe.players[player.id]!.season!.economyRemainder,
      bank % SEASON_ECONOMY_SPEND_DIV,
    );

    universe.planets[planet.id]!.buildings.researchLab = 1;
    const researchAt = completesAt + 10;
    assert.equal(
      queueResearch(universe, player.id, "energyTech", researchAt).ok,
      true,
    );
    const researchDone =
      universe.players[player.id]!.researchQueue[0]!.completesAt;
    const before = universe.players[player.id]!.season!.economy;
    const beforeRem = universe.players[player.id]!.season!.economyRemainder ?? 0;
    advanceUniverse(universe, researchDone);
    const researchSpend = spendOf(researchUpgradeCost("energyTech", 0));
    const nextBank = beforeRem + researchSpend;
    assert.equal(
      universe.players[player.id]!.season!.economy,
      before + Math.floor(nextBank / SEASON_ECONOMY_SPEND_DIV),
    );
    assert.equal(
      universe.players[player.id]!.season!.economyRemainder,
      nextBank % SEASON_ECONOMY_SPEND_DIV,
    );
  });

  it("counts finished ships toward the economy score", () => {
    const universe = createUniverse("Season Ships", 8);
    const { player, planet } = joinUniverse(universe, "Yard", OCT);
    const body = universe.planets[planet.id]!;
    body.buildings.shipyard = 1;
    body.resources = { metal: 20_000, crystal: 20_000, deuterium: 5_000 };
    const queued = queueShipBuild(universe, player.id, "scout", 4, OCT + 5);
    assert.equal(queued.ok, true);
    const completesAt = universe.planets[planet.id]!.shipQueue[0]!.completesAt;
    const before = universe.players[player.id]!.season!.economy;
    advanceUniverse(universe, completesAt);
    const spend = 4 * (220 + 80);
    assert.equal(
      universe.players[player.id]!.season!.economy,
      before + Math.floor(spend / SEASON_ECONOMY_SPEND_DIV),
    );
    assert.equal(
      universe.players[player.id]!.season!.economyRemainder,
      spend % SEASON_ECONOMY_SPEND_DIV,
    );
    assert.equal(universe.planets[planet.id]!.ships.scout, 4);
  });

  it("seals the previous month once, then claims each placement once", () => {
    const universe = createUniverse("Season Seal", 8);
    const names = ["Ace", "Bea", "Cy", "Dee", "Eve", "Fay"];
    const scores = [60, 50, 40, 30, 20, 10];
    const ids: string[] = [];
    for (let i = 0; i < names.length; i++) {
      const joined = joinUniverse(universe, names[i]!, OCT + i);
      ids.push(joined.player.id);
      const granted = grantSeasonPoints(
        universe,
        joined.player.id,
        { combat: scores[i]! },
        OCT,
      );
      assert.equal(granted.ok, true);
    }

    const early = claimSeasonReward(universe, ids[0]!, "combat", OCT);
    assert.equal(early.ok, false);

    rollSeasons(universe, NOV);
    const sealed = universe.seasons?.["2026-10"];
    assert.ok(sealed?.sealedAt);
    assert.equal(sealed!.boards.combat[0]?.playerId, ids[0]);
    assert.equal(sealed!.boards.combat[0]?.score, 60);
    assert.equal(sealed!.boards.combat[5]?.playerId, ids[5]);
    for (const id of ids) {
      assert.equal(universe.players[id]!.season?.seasonId, "2026-11");
      assert.equal(universe.players[id]!.season?.combat, 0);
      assert.equal(universe.players[id]!.seasonArchive?.["2026-10"]?.combat, scores[ids.indexOf(id)]);
    }

    const sealedAt = sealed!.sealedAt;
    const topScore = sealed!.boards.combat[0]!.score;
    grantSeasonPoints(universe, ids[0]!, { combat: 99 }, NOV);
    rollSeasons(universe, NOV + 86_400_000);
    assert.equal(universe.seasons?.["2026-10"]?.sealedAt, sealedAt);
    assert.equal(universe.seasons?.["2026-10"]?.boards.combat[0]?.score, topScore);
    assert.equal(universe.players[ids[0]!]!.season?.combat, 99);

    const champion = claimSeasonReward(universe, ids[0]!, "combat", NOV);
    assert.equal(champion.ok, true);
    const ace = universe.players[ids[0]!]!;
    assert.deepEqual(ace.cosmetics?.titles, ["Season Champion"]);
    assert.equal(ace.cosmetics?.activeTitle, "Season Champion");
    assert.deepEqual(ace.cosmetics?.planetSkinIds, ["season-champion-2026-10"]);
    assert.equal(ace.cosmetics?.activePlanetSkinId, "season-champion-2026-10");
    assert.equal(claimSeasonReward(universe, ids[0]!, "combat", NOV).ok, false);
    assert.equal(
      setSeasonTitle(universe, ids[0]!, "Season Pilot Oct", NOV).ok,
      false,
    );
    assert.equal(setSeasonTitle(universe, ids[0]!, "", NOV).ok, true);
    assert.equal(ace.cosmetics?.activeTitle, null);
    assert.equal(
      setSeasonTitle(universe, ids[0]!, "Season Champion", NOV).ok,
      true,
    );
    assert.equal(setSeasonSkin(universe, ids[0]!, "missing-skin", NOV).ok, false);
    assert.equal(setSeasonSkin(universe, ids[0]!, "", NOV).ok, true);
    assert.equal(ace.cosmetics?.activePlanetSkinId, null);
    assert.equal(
      setSeasonSkin(universe, ids[0]!, "season-champion-2026-10", NOV).ok,
      true,
    );

    const contender = claimSeasonReward(universe, ids[2]!, "combat", NOV);
    assert.equal(contender.ok, true);
    assert.equal(
      universe.players[ids[2]!]!.cosmetics?.activeTitle,
      "Season Contender",
    );
    assert.equal(
      universe.players[ids[2]!]!.cosmetics?.activePlanetSkinId,
      "season-contender-2026-10",
    );

    const pilot = claimSeasonReward(universe, ids[5]!, "combat", NOV);
    assert.equal(pilot.ok, true);
    const fay = universe.players[ids[5]!]!;
    assert.equal(fay.cosmetics?.activeTitle, "Season Pilot Oct");
    assert.deepEqual(fay.cosmetics?.planetSkinIds, []);
    assert.equal(claimSeasonReward(universe, ids[5]!, "economy", NOV).ok, false);

    const view = playerView(universe, ids[0]!, NOV);
    assert.equal(view.seasonLeaderboard.seasonId, "2026-11");
    assert.equal(view.seasonLeaderboard.scores.combat, 99);
    assert.equal(view.seasonLeaderboard.ranks.combat, 1);
    assert.equal(view.seasonLeaderboard.claims[0]?.seasonId, "2026-10");
    assert.equal(view.seasonLeaderboard.claims[0]?.offers[0]?.claimed, true);
    assert.equal(view.player.cosmetics?.activeTitle, "Season Champion");
  });

  it("backfills season fields on a schema 4 universe without resetting it", () => {
    const universe = createUniverse("Season Keep", 8);
    const { player } = joinUniverse(universe, "Keeper", OCT);
    const planetId = player.homePlanetId;
    universe.schemaVersion = 4;
    delete universe.players[player.id]!.season;
    delete universe.players[player.id]!.cosmetics;
    delete universe.players[player.id]!.seasonArchive;
    delete universe.seasons;
    const result = migrateOrResetUniverse(universe);
    assert.equal(result.didReset, false);
    assert.equal(result.universe.schemaVersion, 5);
    assert.equal(result.universe.players[player.id]?.name, "Keeper");
    assert.equal(result.universe.players[player.id]?.homePlanetId, planetId);
    rollSeasons(result.universe, OCT);
    assert.equal(result.universe.players[player.id]?.season?.seasonId, "2026-10");
    assert.equal(result.universe.players[player.id]?.season?.combat, 0);
    assert.deepEqual(result.universe.players[player.id]?.cosmetics?.titles, []);
    assert.ok(result.universe.seasons);
    assert.equal(Object.keys(result.universe.players).length, 1);
  });
});
