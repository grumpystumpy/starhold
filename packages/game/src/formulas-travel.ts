import {
  BUILDINGS,
  DEFENSES,
  MIN_FLIGHT_SECONDS,
  RESEARCH,
  SHIPS,
  SHIP_ORDER,
  DEFENSE_ORDER,
} from "./catalog.js";
import type {
  BuildingId,
  Coordinates,
  DefenseId,
  DefenseStock,
  EconomySnapshot,
  FleetShips,
  PlanetState,
  ResearchId,
  ResearchLevels,
  Resources,
  ShipId,
} from "./types.js";
import {
  buildingUpgradeCost,
  energyFactor,
  energyProduced,
  energyUsed,
  fieldsCap,
  fieldsRemaining,
  fieldsUsed,
  productionPerHour,
  researchUpgradeCost,
  storageFor,
} from "./formulas-build.js";
import { productionMultForSlot } from "./formulas-position.js";
import {
  helioBuoyEnergy,
  mantleLoomFieldsBonus,
  planetTemperatureK,
  solarTempFactor,
} from "./formulas-round3.js";

export function clampToStorage(
  resources: Resources,
  caps: Resources,
): Resources {
  return {
    metal: Math.min(resources.metal, caps.metal),
    crystal: Math.min(resources.crystal, caps.crystal),
    deuterium: Math.min(resources.deuterium, caps.deuterium),
  };
}

export function emptyResearch(): ResearchLevels {
  return {
    energyTech: 0,
    combustionDrive: 0,
    weaponsTech: 0,
    armourTech: 0,
    shieldingTech: 0,
    espionageTech: 0,
    astrophysics: 0,
    computerTech: 0,
    queueLogistics: 0,
    swarmHold: 0,
    gravityWell: 0,
  };
}

export function emptyDefenses(): DefenseStock {
  const out = {} as DefenseStock;
  for (const id of DEFENSE_ORDER) out[id] = 0;
  return out;
}

/** Unfloored cost/1000 for a ship stock (docked or in flight). */
export function shipStockPoints(
  ships: Partial<Record<ShipId, number>>,
): number {
  let points = 0;
  for (const [id, count] of Object.entries(ships)) {
    if (!count) continue;
    const c = SHIPS[id as ShipId].cost;
    points += ((c.metal + c.crystal + c.deuterium) * count) / 1000;
  }
  return points;
}

/** Unfloored buildings + docked ships + defenses (no research). */
export function planetPoints(planet: PlanetState): number {
  let points = 0;
  for (const [id, level] of Object.entries(planet.buildings)) {
    for (let L = 0; L < level; L++) {
      const c = buildingUpgradeCost(id as BuildingId, L);
      points += (c.metal + c.crystal + c.deuterium) / 1000;
    }
  }
  points += shipStockPoints(planet.ships);
  for (const [id, count] of Object.entries(planet.defenses ?? {})) {
    const c = DEFENSES[id as DefenseId].cost;
    points += ((c.metal + c.crystal + c.deuterium) * count) / 1000;
  }
  return points;
}

/** Unfloored research tree cost/1000 (once per empire). */
export function researchPoints(research: ResearchLevels): number {
  let points = 0;
  for (const [id, level] of Object.entries(research)) {
    for (let L = 0; L < level; L++) {
      const c = researchUpgradeCost(id as ResearchId, L);
      points += (c.metal + c.crystal + c.deuterium) / 1000;
    }
  }
  return points;
}

/** Single-planet hint (optional research). Prefer empirePoints for rankings. */
export function roughPoints(
  planet: PlanetState,
  research?: ResearchLevels,
): number {
  let points = planetPoints(planet);
  if (research) points += researchPoints(research);
  return Math.floor(points);
}

export function economySnapshot(
  planet: PlanetState,
  universeSpeed = 1,
  energyTechLevel = 0,
  boosts?: { mineOutput?: number; energyOutput?: number },
): EconomySnapshot {
  const used = fieldsUsed(planet);
  const energyMult = boosts?.energyOutput ?? 1;
  const slot = planet.coords.slot;
  return {
    productionPerHour: productionPerHour(
      planet,
      universeSpeed,
      energyTechLevel,
      boosts,
    ),
    temperatureK: planetTemperatureK(slot),
    energy: {
      produced: energyProduced(planet, energyMult),
      used: energyUsed(planet),
      factor: energyFactor(planet, energyMult),
      helioBuoy: helioBuoyEnergy(planet),
      solarTempFactor: solarTempFactor(slot),
    },
    storage: storageFor(planet),
    fields: {
      used,
      cap: fieldsCap(planet),
      remaining: fieldsRemaining(planet),
      mantleLoomBonus: mantleLoomFieldsBonus(planet),
    },
    positionMult: productionMultForSlot(slot),
  };
}

export function emptyFleetShips(): FleetShips {
  const out = {} as FleetShips;
  for (const id of SHIP_ORDER) out[id] = 0;
  return out;
}

export function normalizeFleetShips(ships: Partial<FleetShips>): FleetShips {
  const out = emptyFleetShips();
  for (const id of SHIP_ORDER) {
    out[id] = Math.max(0, Math.floor(ships[id] ?? 0));
  }
  return out;
}

export function fleetShipCount(ships: FleetShips): number {
  let n = 0;
  for (const id of SHIP_ORDER) n += ships[id] ?? 0;
  return n;
}

export function fleetCargoCapacity(ships: FleetShips): number {
  let cap = 0;
  for (const id of SHIP_ORDER) {
    cap += (ships[id] ?? 0) * SHIPS[id].cargo;
  }
  return cap;
}

/**
 * Map distance in abstract units.
 * Formula: |Δgalaxy|×100 + |Δsystem|×10 + |Δslot|
 */
export function coordDistance(a: Coordinates, b: Coordinates): number {
  return (
    Math.abs(a.galaxy - b.galaxy) * 100 +
    Math.abs(a.system - b.system) * 10 +
    Math.abs(a.slot - b.slot)
  );
}

export function coordsKey(c: Coordinates): string {
  return `${c.galaxy}:${c.system}:${c.slot}`;
}

/** Slowest hull in the fleet sets cruise speed (empty fleet → 1). */
export function fleetCruiseSpeed(ships: FleetShips): number {
  let min = Infinity;
  for (const id of SHIP_ORDER) {
    const n = ships[id] ?? 0;
    if (n > 0) min = Math.min(min, SHIPS[id].speed);
  }
  return Number.isFinite(min) ? min : 1;
}

/**
 * One-way flight seconds.
 * Combustion drive research multiplies cruise speed.
 */
export function flightSecondsOneWay(
  origin: Coordinates,
  target: Coordinates,
  ships: FleetShips,
  fleetSpeed: number,
  combustionDriveLevel = 0,
): number {
  const distance = Math.max(1, coordDistance(origin, target));
  const cruise =
    fleetCruiseSpeed(ships) * (1 + combustionDriveLevel * 0.1);
  const raw = Math.ceil(
    (distance * 1_000_000) / (cruise * Math.max(0.1, fleetSpeed)),
  );
  return Math.max(MIN_FLIGHT_SECONDS, raw);
}

/** Deuterium fuel for one-way leg. */
export function fuelCostOneWay(
  origin: Coordinates,
  target: Coordinates,
  ships: FleetShips,
): number {
  const distance = Math.max(1, coordDistance(origin, target));
  let fuel = 0;
  for (const id of SHIP_ORDER) {
    fuel += (ships[id] ?? 0) * SHIPS[id].fuelPerDistance * distance;
  }
  return Math.max(1, Math.ceil(fuel));
}
