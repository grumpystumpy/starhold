import { SHIP_ORDER } from "./catalog.js";
import {
  classBonuses,
  emptyFleetShips,
  fleetCargoCapacity,
  fleetCombatPower,
  grantPlayerXp,
  normalizeFleetShips,
  vaultScoutExpeditionMult,
  xpForExpedition,
  xpForMiniPlanetDiscovery,
} from "./formulas.js";
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
  expeditionStarshardsAmount,
  grantStarshards,
} from "./world-boosts.js";
import {
  discoverMiniPlanet,
  empireRelicExpeditionFindMult,
  pickOrSeedMiniForDiscovery,
} from "./world-mini.js";

/** Deterministic 0..99 roll from fleet id + arrival time. */
export function expeditionRoll(fleetId: string, at: number): number {
  let h = at >>> 0;
  for (let i = 0; i < fleetId.length; i++) {
    h = (Math.imul(h, 31) + fleetId.charCodeAt(i)) >>> 0;
  }
  return h % 100;
}

/**
 * Expedition outcome table (v1 + mini):
 * 0–39 resources, 40–54 ships, 55–67 nothing, 68–69 miniPlanet (2%),
 * 70–74 starshards (5%), 75–99 pirates.
 */
export function expeditionKindFromRoll(roll: number): ExpeditionKind {
  if (roll < 40) return "resources";
  if (roll < 55) return "ships";
  if (roll < 68) return "nothing";
  if (roll < 70) return "miniPlanet";
  if (roll < 75) return "starshards";
  return "pirates";
}

function scaleShipsKeep(ships: FleetShips, keepRatio: number): FleetShips {
  const out = emptyFleetShips();
  const ratio = Math.min(1, Math.max(0, keepRatio));
  for (const id of SHIP_ORDER) {
    out[id] = Math.floor((ships[id] ?? 0) * ratio);
  }
  return normalizeFleetShips(out);
}

function resourceFind(
  ships: FleetShips,
  roll: number,
): Resources {
  const cap = fleetCargoCapacity(ships);
  if (cap <= 0) {
    return { metal: 0, crystal: 0, deuterium: 0 };
  }
  const power = Math.max(1, fleetCombatPower(ships));
  const budget = Math.min(
    cap,
    Math.floor(80 + (cap * 0.35 + power * 0.5) * (0.55 + (roll % 20) / 40)),
  );
  const metal = Math.floor(budget * 0.55);
  const crystal = Math.floor(budget * 0.3);
  let deuterium = budget - metal - crystal;
  if (deuterium < 0) deuterium = 0;
  let total = metal + crystal + deuterium;
  if (total > cap) deuterium = Math.max(0, deuterium - (total - cap));
  return { metal, crystal, deuterium };
}

export function resolveExpeditionArrival(
  universe: UniverseState,
  fleet: FleetMission,
  now: number,
): void {
  if (!universe.expeditionReports) universe.expeditionReports = {};
  const roll = expeditionRoll(fleet.id, fleet.arrivesAt);
  const kind = expeditionKindFromRoll(roll);
  const before = normalizeFleetShips(fleet.ships);
  let cargoGained: Resources = { metal: 0, crystal: 0, deuterium: 0 };
  const shipsDelta: Partial<FleetShips> = {};
  let starshardsGained = 0;
  let miniPlanetId: string | undefined;
  let miniCoords: Coordinates | undefined;
  let summary: string;

  const ownerForYield = universe.players[fleet.ownerPlayerId];
  const yieldMult =
    classBonuses(ownerForYield?.playerClass?.classId).expeditionYield *
    vaultScoutExpeditionMult(before) *
    empireRelicExpeditionFindMult(universe, fleet.ownerPlayerId);

  switch (kind) {
    case "resources": {
      cargoGained = resourceFind(before, roll);
      cargoGained = {
        metal: Math.floor(cargoGained.metal * yieldMult),
        crystal: Math.floor(cargoGained.crystal * yieldMult),
        deuterium: Math.floor(cargoGained.deuterium * yieldMult),
      };
      fleet.cargo = { ...cargoGained };
      summary = `Anomaly yield: ${cargoGained.metal}m / ${cargoGained.crystal}c / ${cargoGained.deuterium}d.`;
      break;
    }
    case "ships": {
      if (roll % 2 === 0) {
        const n = 1 + (roll % 3);
        fleet.ships.scout = (fleet.ships.scout ?? 0) + n;
        shipsDelta.scout = n;
        summary = `Salvage drones joined the fleet (+${n} Scout Skiff).`;
      } else {
        fleet.ships.hauler = (fleet.ships.hauler ?? 0) + 1;
        shipsDelta.hauler = 1;
        summary = "Derelict freighter claimed (+1 Ore Hauler).";
      }
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
        Math.floor(expeditionStarshardsAmount(roll) * yieldMult),
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
      const after = scaleShipsKeep(before, 0.7);
      for (const id of SHIP_ORDER) {
        const delta = (after[id] ?? 0) - (before[id] ?? 0);
        if (delta !== 0) shipsDelta[id as ShipId] = delta;
      }
      fleet.ships = after;
      const crumb = Math.min(40, fleetCargoCapacity(after));
      cargoGained = {
        metal: Math.floor(crumb * 0.5),
        crystal: Math.floor(crumb * 0.3),
        deuterium: Math.max(0, crumb - Math.floor(crumb * 0.5) - Math.floor(crumb * 0.3)),
      };
      fleet.cargo = { ...cargoGained };
      summary = `Pirate ambush — ~30% hulls lost. Scrap salvage ${cargoGained.metal}m/${cargoGained.crystal}c/${cargoGained.deuterium}d.`;
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
        discoverMiniPlanet(universe, fleet.ownerPlayerId, found.id);
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

  // Non-empty expedition outcomes grant XP (contract v1).
  if (kind !== "nothing") {
    const owner = universe.players[fleet.ownerPlayerId];
    if (owner) {
      grantPlayerXp(owner, xpForExpedition());
      if (kind === "miniPlanet" && miniPlanetId) {
        grantPlayerXp(owner, xpForMiniPlanetDiscovery());
      }
      universe.players[owner.id] = owner;
    }
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
    starshardsGained: starshardsGained || undefined,
    miniPlanetId,
    miniCoords,
    summary,
  };
  universe.expeditionReports[reportId] = report;
  fleet.reportId = reportId;
}
