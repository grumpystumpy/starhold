import { DEFENSES } from "./catalog.js";
import {
  buildingUpgradeCost,
  researchPoints,
  shipStockPoints,
} from "./formulas.js";
import type {
  BuildingId,
  CategoryBoards,
  CategoryRankEntry,
  DefenseId,
  PlanetState,
  UniverseState,
} from "./types.js";
import { allianceTagForPlayer } from "./world-alliances.js";

const CATEGORY_RANK_CAP = 100;

export function emptyCategoryBoards(): CategoryBoards {
  return { buildings: [], fleet: [], research: [], defense: [] };
}

/** Building upgrade costs / 1000. The building loop inside planetPoints. */
function buildingPoints(planet: PlanetState): number {
  let points = 0;
  for (const [id, level] of Object.entries(planet.buildings)) {
    for (let step = 0; step < level; step++) {
      const cost = buildingUpgradeCost(id as BuildingId, step);
      points += (cost.metal + cost.crystal + cost.deuterium) / 1000;
    }
  }
  return points;
}

/** Defense stock costs / 1000. The defense loop inside planetPoints. */
function defensePoints(planet: PlanetState): number {
  let points = 0;
  for (const [id, count] of Object.entries(planet.defenses ?? {})) {
    const cost = DEFENSES[id as DefenseId].cost;
    points += ((cost.metal + cost.crystal + cost.deuterium) * count) / 1000;
  }
  return points;
}

function rank(rows: Array<Omit<CategoryRankEntry, "rank">>): CategoryRankEntry[] {
  rows.sort(
    (a, b) => b.points - a.points || a.playerId.localeCompare(b.playerId),
  );
  return rows.slice(0, CATEGORY_RANK_CAP).map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
}

/**
 * Four empire boards. Research is counted once. Fleet includes docked ships
 * and in-flight fleets owned by the commander. Not stored on the universe.
 */
export function categoryHighscoreBoards(universe: UniverseState): CategoryBoards {
  const buildings: Array<Omit<CategoryRankEntry, "rank">> = [];
  const fleet: Array<Omit<CategoryRankEntry, "rank">> = [];
  const research: Array<Omit<CategoryRankEntry, "rank">> = [];
  const defense: Array<Omit<CategoryRankEntry, "rank">> = [];
  const fleets = Object.values(universe.fleets ?? {});

  for (const player of Object.values(universe.players)) {
    let buildingScore = 0;
    let fleetScore = 0;
    let defenseScore = 0;
    for (const planetId of player.planetIds ?? []) {
      const planet = universe.planets[planetId];
      if (!planet) continue;
      buildingScore += buildingPoints(planet);
      fleetScore += shipStockPoints(planet.ships);
      defenseScore += defensePoints(planet);
    }
    for (const mission of fleets) {
      if (mission.ownerPlayerId === player.id) {
        fleetScore += shipStockPoints(mission.ships);
      }
    }
    const tag = allianceTagForPlayer(universe, player);
    const base = {
      playerId: player.id,
      name: player.name,
      allianceTag: tag,
    };
    buildings.push({ ...base, points: Math.floor(buildingScore) });
    fleet.push({ ...base, points: Math.floor(fleetScore) });
    research.push({
      ...base,
      points: Math.floor(researchPoints(player.research)),
    });
    defense.push({ ...base, points: Math.floor(defenseScore) });
  }

  return {
    buildings: rank(buildings),
    fleet: rank(fleet),
    research: rank(research),
    defense: rank(defense),
  };
}
