import { EXPEDITION_AMBUSH_DEBRIS_RATE, EXPEDITION_SLOT, SHIPS, SHIP_ORDER } from "./catalog.js";
import {
  classBonuses,
  allianceBonusesForPlayer,
  destroyedShipResources,
  emptyFleetShips,
  fleetCargoCapacity,
  grantPlayerXp,
  normalizeFleetShips,
  vaultScoutExpeditionMult,
  xpForExpedition,
  xpForMiniPlanetDiscovery,
} from "./formulas.js";
import { hashSeed } from "./formulas-position.js";
import type {
  Coordinates,
  ExpeditionKind,
  ExpeditionReport,
  FleetMission,
  FleetShips,
  Resources,
  ShipId,
  UniverseState,
} from "./types.js";
import {
  grantStarshards,
} from "./world-boosts.js";

/** OGame-style expedition find scaling constants. */
export const EXPEDITION_STRUCTURAL_CAP = 10_000;
export const EXPEDITION_RESOURCE_MULT = 15;
export const EXPEDITION_BASE_RESOURCE_FIND = 0;
export const EXPEDITION_STARSHARDS_MIN = 5;
export const EXPEDITION_STARSHARDS_MAX = 25;
export const EXPEDITION_RESOURCE_ROLL_BASE = 0.55;
export const EXPEDITION_RESOURCE_ROLL_RANGE = 20;
export const EXPEDITION_RESOURCE_ROLL_DIVISOR = 40;

export const EXPEDITION_BLACK_HOLE_CHANCE = 0.002;
export const EXPEDITION_BLACK_HOLE_ROLL_SPACE = 1_000_000;

export const EXPEDITION_RESOURCES_ROLL_MAX = 40;
export const EXPEDITION_SHIPS_ROLL_MAX = 55;
export const EXPEDITION_NOTHING_ROLL_MAX = 68;
export const EXPEDITION_MINI_PLANET_ROLL_MAX = 70;
export const EXPEDITION_STARSHARDS_ROLL_MAX = 75;
export const EXPEDITION_NEW_PIRATE_BASE_CHANCE = 0.02;
export const EXPEDITION_NEW_PIRATE_BASE_ROLL_COUNT = 2;
export const EXPEDITION_NEW_PIRATE_BASE_ROLL_MAX = 77;
export const EXPEDITION_NEW_ALIEN_BASE_CHANCE = 0.007;
export const EXPEDITION_NEW_ALIEN_BASE_ROLL_COUNT = 0.7;
export const EXPEDITION_NEW_ALIEN_BASE_ROLL_MAX = 77.7;
export const EXPEDITION_PIRATES_CHANCE = 0.223;
export const EXPEDITION_PIRATES_ROLL_MAX = 100;
export const EXPEDITION_NPC_BASE_TIER = 0;

import { noteGoalMetric } from "./world-goals.js";
import { addDebris } from "./world-tick.js";
import {
  discoverMiniPlanet,
  empireRelicExpeditionFindMult,
  pickOrSeedMiniForDiscovery,
} from "./world-mini.js";
import {
  createAlienBase,
  createPirateBase,
  findFreeSlotInGalaxy,
  tryAlienExpeditionFind,
} from "./world-pirates.js";

/** Deterministic 0..99 roll from fleet id + arrival time. */
export function expeditionRoll(fleetId: string, at: number): number {
  let h = at >>> 0;
  for (let i = 0; i < fleetId.length; i++) {
    h = (Math.imul(h, 31) + fleetId.charCodeAt(i)) >>> 0;
  }
  const base = h % 100;
  if (base === EXPEDITION_NEW_PIRATE_BASE_ROLL_MAX) {
    return base + (hashSeed(`alienBase:${fleetId}:${at}`) % 10) / 10;
  }
  return base;
}

/** Check deterministic black hole roll before table lookup. */
export function expeditionBlackHoleRoll(fleetId: string, at: number): boolean {
  const threshold = Math.floor(EXPEDITION_BLACK_HOLE_CHANCE * EXPEDITION_BLACK_HOLE_ROLL_SPACE);
  const h = hashSeed(`blackHole:${fleetId}:${at}`);
  return (h % EXPEDITION_BLACK_HOLE_ROLL_SPACE) < threshold;
}

/**
 * Expedition outcome table (v1 + mini + new NPC bases):
 * 0–39 resources, 40–54 ships, 55–67 nothing, 68–69 miniPlanet (2%),
 * 70–74 starshards (5%), 75–76 newPirateBase (2%), 77–77.6 newAlienBase (0.7%),
 * and 77.7–99 pirates (22.3%).
 */
export function expeditionKindFromRoll(roll: number): ExpeditionKind {
  if (roll < EXPEDITION_RESOURCES_ROLL_MAX) return "resources";
  if (roll < EXPEDITION_SHIPS_ROLL_MAX) return "ships";
  if (roll < EXPEDITION_NOTHING_ROLL_MAX) return "nothing";
  if (roll < EXPEDITION_MINI_PLANET_ROLL_MAX) return "miniPlanet";
  if (roll < EXPEDITION_STARSHARDS_ROLL_MAX) return "starshards";
  if (roll < EXPEDITION_NEW_PIRATE_BASE_ROLL_MAX) return "newPirateBase";
  if (roll < EXPEDITION_NEW_ALIEN_BASE_ROLL_MAX) return "newAlienBase";
  return "pirates";
}

/** Alliance Explorer's shifts the table toward good outcomes and away from pirates. */
export function expeditionKindForShift(
  roll: number,
  shift: number,
): ExpeditionKind {
  const s = Math.max(0, Math.floor(shift));
  if (s <= 0) return expeditionKindFromRoll(roll);
  if (roll < s) return "resources";
  return expeditionKindFromRoll(roll - s);
}

function scaleShipsKeep(ships: FleetShips, keepRatio: number): FleetShips {
  const out = emptyFleetShips();
  const ratio = Math.min(1, Math.max(0, keepRatio));
  for (const id of SHIP_ORDER) {
    out[id] = Math.floor((ships[id] ?? 0) * ratio);
  }
  return normalizeFleetShips(out);
}

/** Total structural (hull) points of a fleet. */
export function fleetStructurePoints(ships: FleetShips): number {
  let total = 0;
  for (const id of SHIP_ORDER) {
    const count = ships[id] ?? 0;
    if (count > 0 && SHIPS[id]) {
      total += count * SHIPS[id].hull;
    }
  }
  return total;
}

export function resourceFind(
  ships: FleetShips,
  roll: number,
): Resources {
  const intRoll = Math.floor(roll);
  const cap = fleetCargoCapacity(ships);
  if (cap <= 0) {
    return { metal: 0, crystal: 0, deuterium: 0 };
  }
  const sp = fleetStructurePoints(ships);
  const effectiveSp = Math.min(sp, EXPEDITION_STRUCTURAL_CAP);
  const rollFactor =
    EXPEDITION_RESOURCE_ROLL_BASE +
    (intRoll % EXPEDITION_RESOURCE_ROLL_RANGE) / EXPEDITION_RESOURCE_ROLL_DIVISOR;
  const rawBudget =
    EXPEDITION_BASE_RESOURCE_FIND +
    effectiveSp * EXPEDITION_RESOURCE_MULT * rollFactor;
  const budget = Math.min(cap, Math.floor(rawBudget));

  const metal = Math.floor(budget * 0.55);
  const crystal = Math.floor(budget * 0.3);
  let deuterium = budget - metal - crystal;
  if (deuterium < 0) deuterium = 0;
  let total = metal + crystal + deuterium;
  if (total > cap) deuterium = Math.max(0, deuterium - (total - cap));
  return { metal, crystal, deuterium };
}

export function expeditionStarshardsFind(
  ships: FleetShips,
  roll: number,
): number {
  const intRoll = Math.floor(roll);
  const sp = fleetStructurePoints(ships);
  const effectiveSp = Math.min(sp, EXPEDITION_STRUCTURAL_CAP);
  const range = EXPEDITION_STARSHARDS_MAX - EXPEDITION_STARSHARDS_MIN + 1;
  const base = EXPEDITION_STARSHARDS_MIN + (intRoll % range);
  const scaled = (base * effectiveSp) / EXPEDITION_STRUCTURAL_CAP;
  return Math.max(1, Math.floor(scaled));
}

function shipUnitCost(shipId: ShipId): number {
  const cost = SHIPS[shipId].cost;
  return cost.metal + cost.crystal + cost.deuterium;
}

export function expeditionShipsFind(
  before: FleetShips,
  roll: number,
): { shipId: ShipId; count: number } {
  const intRoll = Math.floor(roll);
  const excluded = new Set<ShipId>([
    "voidforgeTitan",
    "worldEater",
    "swarmMothership",
  ]);
  let maxSentCost = 0;
  for (const id of SHIP_ORDER) {
    if (!excluded.has(id) && (before[id] ?? 0) > 0) {
      maxSentCost = Math.max(maxSentCost, shipUnitCost(id));
    }
  }

  const pool = SHIP_ORDER.filter(
    (id) =>
      !excluded.has(id) &&
      shipUnitCost(id) > 0 &&
      shipUnitCost(id) <= maxSentCost,
  );
  if (pool.length === 0) pool.push("scout");

  const rollIndex = ((intRoll % pool.length) + pool.length) % pool.length;
  const shipId = pool[rollIndex]!;
  const structureLimit = Math.max(
    SHIPS[shipId].hull,
    Math.floor(
      Math.min(fleetStructurePoints(before), EXPEDITION_STRUCTURAL_CAP) * 0.5,
    ),
  );
  const count = Math.max(
    1,
    Math.min(1 + (intRoll % 3), Math.floor(structureLimit / SHIPS[shipId].hull)),
  );
  return { shipId, count };
}

export function resolveExpeditionArrival(
  universe: UniverseState,
  fleet: FleetMission,
  now: number,
): void {
  if (!universe.expeditionReports) universe.expeditionReports = {};
  const isBlackHole = expeditionBlackHoleRoll(fleet.id, fleet.arrivesAt);
  const roll = expeditionRoll(fleet.id, fleet.arrivesAt);
  const ownerForYield = universe.players[fleet.ownerPlayerId];
  const ally = allianceBonusesForPlayer(universe, fleet.ownerPlayerId);
  const kind = isBlackHole
    ? "blackHole"
    : expeditionKindForShift(roll, ally.expeditionRollShift);
  const before = normalizeFleetShips(fleet.ships);
  let cargoGained: Resources = { metal: 0, crystal: 0, deuterium: 0 };
  const shipsDelta: Partial<FleetShips> = {};
  let starshardsGained = 0;
  let debrisCreated: Resources | undefined;
  let miniPlanetId: string | undefined;
  let miniCoords: Coordinates | undefined;
  let newPirateBaseId: string | undefined;
  let newAlienBaseId: string | undefined;
  let newBaseCoords: Coordinates | undefined;
  let summary = "";

  const yieldMult =
    classBonuses(ownerForYield?.playerClass?.classId).expeditionYield *
    vaultScoutExpeditionMult(before) *
    empireRelicExpeditionFindMult(universe, fleet.ownerPlayerId);
  const amountMult = yieldMult * ally.expeditionAmount;

  const applyPirateAmbush = () => {
    const after = scaleShipsKeep(before, 0.7);
    for (const id of SHIP_ORDER) {
      const delta = (after[id] ?? 0) - (before[id] ?? 0);
      if (delta !== 0) shipsDelta[id as ShipId] = delta;
    }
    fleet.ships = after;
    const lost = destroyedShipResources(before, after);
    debrisCreated = {
      metal: Math.floor(lost.metal * EXPEDITION_AMBUSH_DEBRIS_RATE),
      crystal: Math.floor(lost.crystal * EXPEDITION_AMBUSH_DEBRIS_RATE),
      deuterium: 0,
    };
    addDebris(universe, {
      galaxy: fleet.targetCoords.galaxy,
      system: fleet.targetCoords.system,
      slot: EXPEDITION_SLOT,
    }, debrisCreated);
    const crumb = Math.min(
      40,
      fleetCargoCapacity(after, ownerForYield?.research?.cargoHoldTech ?? 0),
    );
    cargoGained = {
      metal: Math.floor(crumb * 0.5),
      crystal: Math.floor(crumb * 0.3),
      deuterium: Math.max(0, crumb - Math.floor(crumb * 0.5) - Math.floor(crumb * 0.3)),
    };
    fleet.cargo = { ...cargoGained };
    summary = `Pirate ambush — ~30% hulls lost. Scrap salvage ${cargoGained.metal}m/${cargoGained.crystal}c/${cargoGained.deuterium}d.`;
  };

  switch (kind) {
    case "blackHole": {
      fleet.ships = emptyFleetShips();
      fleet.cargo = { metal: 0, crystal: 0, deuterium: 0 };
      for (const id of SHIP_ORDER) {
        if ((before[id] ?? 0) > 0) {
          shipsDelta[id as ShipId] = -(before[id] ?? 0);
        }
      }
      summary = "Fleet lost in a black hole — all ships and cargo destroyed.";
      break;
    }
    case "resources": {
      cargoGained = resourceFind(before, roll);
      cargoGained = {
        metal: Math.floor(cargoGained.metal * amountMult),
        crystal: Math.floor(cargoGained.crystal * amountMult),
        deuterium: Math.floor(cargoGained.deuterium * amountMult),
      };
      fleet.cargo = { ...cargoGained };
      summary = `Anomaly yield: ${cargoGained.metal}m / ${cargoGained.crystal}c / ${cargoGained.deuterium}d.`;
      break;
    }
    case "ships": {
      const found = expeditionShipsFind(before, roll);
      const n = Math.max(1, Math.floor(found.count * ally.expeditionAmount));
      fleet.ships[found.shipId] = (fleet.ships[found.shipId] ?? 0) + n;
      shipsDelta[found.shipId] = n;
      summary = `Expedition salvage joined the fleet (+${n} ${SHIPS[found.shipId].name}).`;
      fleet.ships = normalizeFleetShips(fleet.ships);
      break;
    }
    case "nothing": {
      fleet.cargo = { metal: 0, crystal: 0, deuterium: 0 };
      summary = "Empty void — instruments found nothing of value.";
      break;
    }
    case "starshards": {
      fleet.cargo = { metal: 0, crystal: 0, deuterium: 0 };
      starshardsGained = Math.max(
        1,
        Math.floor(expeditionStarshardsFind(before, roll) * amountMult),
      );
      const owner = universe.players[fleet.ownerPlayerId];
      if (owner) {
        grantStarshards(owner, starshardsGained);
        universe.players[owner.id] = owner;
      }
      summary = `Rare stellar fragment cache — +${starshardsGained} Starshards.`;
      break;
    }
    case "pirates": {
      applyPirateAmbush();
      break;
    }
    case "newPirateBase": {
      fleet.cargo = { metal: 0, crystal: 0, deuterium: 0 };
      if (!universe.pirateBases) universe.pirateBases = {};
      const site = findFreeSlotInGalaxy(
        universe,
        fleet.targetCoords.galaxy,
        `${fleet.id}:new-pirate-base:${now}`,
      );
      if (site) {
        const base = createPirateBase(
          universe.seed ?? universe.id,
          site.galaxy,
          site.system,
          site.slot,
          now,
          EXPEDITION_NPC_BASE_TIER,
        );
        universe.pirateBases[base.id] = base;
        newPirateBaseId = base.id;
        newBaseCoords = { ...base.coords };
        summary = `New pirate base ${base.name} spawned at ${site.galaxy}:${site.system}:${site.slot}.`;
      } else {
        applyPirateAmbush();
      }
      break;
    }
    case "newAlienBase": {
      fleet.cargo = { metal: 0, crystal: 0, deuterium: 0 };
      if (!universe.alienBases) universe.alienBases = {};
      const site = findFreeSlotInGalaxy(
        universe,
        fleet.targetCoords.galaxy,
        `${fleet.id}:new-alien-base:${now}`,
      );
      if (site) {
        const base = createAlienBase(
          universe,
          site.galaxy,
          site.system,
          site.slot,
          now,
          fleet.ownerPlayerId,
          EXPEDITION_NPC_BASE_TIER,
        );
        universe.alienBases[base.id] = base;
        newAlienBaseId = base.id;
        newBaseCoords = { ...base.coords };
        summary = `New alien base ${base.name} spawned at ${site.galaxy}:${site.system}:${site.slot}.`;
      } else {
        applyPirateAmbush();
      }
      break;
    }
    case "miniPlanet": {
      fleet.cargo = { metal: 0, crystal: 0, deuterium: 0 };
      const found = pickOrSeedMiniForDiscovery(
        universe,
        fleet.ownerPlayerId,
        fleet.targetCoords,
        fleet.id,
        now,
      );
      if (found) {
        discoverMiniPlanet(universe, fleet.ownerPlayerId, found.id, now);
        miniPlanetId = found.id;
        miniCoords = { ...found.coords };
        summary = `Anomalous gravity well charted — mini planet at ${found.coords.galaxy}:${found.coords.system}:${found.coords.slot} (coords to you only).`;
      } else {
        summary =
          "Sensors brushed a ghost mass, but the drift signature faded before coords locked.";
      }
      break;
    }
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unhandled expedition kind: ${_exhaustive}`);
    }
  }

  // Rare alien find (0.001%) — independent of other outcomes; settle slot-1.
  const alien = tryAlienExpeditionFind(universe, fleet, now);
  if (alien) {
    summary =
      (summary ? summary + " " : "") +
      `Alien signal traced — ${alien.name} settled at ${alien.coords.galaxy}:${alien.coords.system}:${alien.coords.slot}.`;
  }

  const owner = universe.players[fleet.ownerPlayerId];
  if (owner) {
    // Non-empty expedition outcomes grant XP (contract v1).
    if (kind !== "nothing" && kind !== "blackHole") {
      grantPlayerXp(owner, xpForExpedition());
      if (kind === "miniPlanet" && miniPlanetId) {
        grantPlayerXp(owner, xpForMiniPlanetDiscovery());
      }
    }
    // Outbound arrival counts as a run, including an empty find.
    // `now` is the lazy catch-up clock, so offline flights credit the open period.
    noteGoalMetric(owner, "expedition", 1, now);
    universe.players[owner.id] = owner;
  }

  const reportId = `xpd_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const report: ExpeditionReport = {
    id: reportId,
    at: now,
    missionId: fleet.id,
    playerId: fleet.ownerPlayerId,
    targetCoords: { ...fleet.targetCoords },
    kind,
    cargoGained,
    shipsDelta,
    debrisCreated,
    starshardsGained: starshardsGained || undefined,
    miniPlanetId,
    miniCoords,
    newPirateBaseId,
    newAlienBaseId,
    newBaseCoords,
    summary,
  };
  universe.expeditionReports[reportId] = report;
  fleet.reportId = reportId;
}
