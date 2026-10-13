import { SHIPS, SHIP_ORDER } from "./catalog.js";
import {
  coordsKey,
  emptyDefenses,
  fleetShipCount,
  flightSecondsOneWay,
  maxColonies,
  normalizeFleetShips,
  rollPlanetFields,
} from "./formulas.js";
import type {
  FleetMission,
  FleetShips,
  PlanetState,
  UniverseState,
} from "./types.js";
import { resolveRaidArrival } from "./world-arrival-raid.js";
import { harvestAsteroidField } from "./world-asteroids.js";
import {
  emptyBuildings,
  emptyCargo,
  emptyShips,
  ensureUniverseShape,
  fieldsSeedForCoords,
  planetAtCoords,
} from "./world-bootstrap.js";
import { resolveEspionage } from "./world-espionage.js";
import { resolveExpeditionArrival } from "./world-expedition.js";
import { ownedPlanetCount } from "./world-moons.js";
import { pruneSpyReports } from "./world-spy-prune.js";
import {
  addCargoToPlanet,
  addShipsToPlanet,
  advancePlanet,
  advanceResearch,
  getDebris,
} from "./world-tick.js";

export function resolveFleetArrival(
  universe: UniverseState,
  fleet: FleetMission,
  now: number,
): void {
  const origin = universe.planets[fleet.originPlanetId];
  if (!origin) {
    delete universe.fleets[fleet.id];
    return;
  }
  const owner = universe.players[fleet.ownerPlayerId];
  const drive = owner?.research.combustionDrive ?? 0;

  if (fleet.phase === "outbound") {
    if (fleet.mission === "raid") {
      const target = fleet.targetPlanetId
        ? universe.planets[fleet.targetPlanetId]
        : null;
      if (!target) {
        delete universe.fleets[fleet.id];
        return;
      }
      resolveRaidArrival(universe, fleet, target, now);
    } else if (fleet.mission === "espionage") {
      const target = fleet.targetPlanetId
        ? universe.planets[fleet.targetPlanetId]
        : null;
      if (!target) {
        delete universe.fleets[fleet.id];
        return;
      }
      resolveEspionage(universe, fleet, target, now);
    } else if (fleet.mission === "transport") {
      const target = fleet.targetPlanetId
        ? universe.planets[fleet.targetPlanetId]
        : null;
      if (!target || target.ownerPlayerId !== fleet.ownerPlayerId) {
        delete universe.fleets[fleet.id];
        return;
      }
      addCargoToPlanet(target, fleet.cargo);
      fleet.cargo = emptyCargo();
      addShipsToPlanet(target, fleet.ships);
      delete universe.fleets[fleet.id];
      return;
    } else if (fleet.mission === "deploy") {
      const target = fleet.targetPlanetId
        ? universe.planets[fleet.targetPlanetId]
        : null;
      // Park on own colonies — dock ships, no return leg.
      if (target && target.ownerPlayerId === fleet.ownerPlayerId) {
        addShipsToPlanet(target, fleet.ships);
        delete universe.fleets[fleet.id];
        return;
      }
      // Rival visit: fall through to return-leg scheduling below.
    } else if (fleet.mission === "colonize") {
      const occupied = planetAtCoords(universe, fleet.targetCoords);
      if (occupied) {
      } else if ((fleet.ships.colonyShip ?? 0) < 1) {
      } else if (!owner) {
        delete universe.fleets[fleet.id];
        return;
      } else if (
        ownedPlanetCount(universe, owner.id) >=
        maxColonies(owner.research.astrophysics)
      ) {
      } else {
        const planetId = `plnt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const colonyCoords = { ...fleet.targetCoords };
        const colony: PlanetState = {
          id: planetId,
          ownerPlayerId: owner.id,
          name: `${owner.name}'s Colony`,
          coords: colonyCoords,
          kind: "planet",
          parentPlanetId: null,
          moonId: null,
          fieldsCap: rollPlanetFields(
            colonyCoords.slot,
            fieldsSeedForCoords(universe.seed ?? universe.id, colonyCoords),
          ),
          resources: { metal: 500, crystal: 500, deuterium: 0 },
          lastTickAt: now,
          buildings: emptyBuildings(),
          ships: emptyShips(),
          defenses: emptyDefenses(),
          buildQueue: null,
          shipQueue: null,
          defenseQueue: null,
        };
        colony.buildings.solarPlant = 1;
        const remaining = normalizeFleetShips(fleet.ships);
        remaining.colonyShip = Math.max(0, remaining.colonyShip - 1);
        addShipsToPlanet(colony, remaining);
        universe.planets[planetId] = colony;
        owner.planetIds.push(planetId);
        universe.players[owner.id] = owner;
        delete universe.fleets[fleet.id];
        return;
      }
    } else if (fleet.mission === "harvest") {
      const field = getDebris(universe, fleet.targetCoords);
      if (field) {
        const cap = fleetCargoCapacityForHarvest(fleet.ships);
        const takeMetal = Math.min(field.metal, cap);
        let remainingCap = cap - takeMetal;
        const takeCrystal = Math.min(field.crystal, remainingCap);
        fleet.cargo = {
          metal: takeMetal,
          crystal: takeCrystal,
          deuterium: 0,
        };
        field.metal -= takeMetal;
        field.crystal -= takeCrystal;
        if (field.metal <= 0 && field.crystal <= 0) {
          delete universe.debris[coordsKey(fleet.targetCoords)];
        }
      }
    } else if (fleet.mission === "harvestAsteroid") {
      const asteroidId = fleet.targetAsteroidId;
      if (asteroidId) {
        const cap = fleetCargoCapacityForHarvest(fleet.ships);
        fleet.cargo = harvestAsteroidField(universe, asteroidId, cap);
      }
    } else if (fleet.mission === "expedition") {
      resolveExpeditionArrival(universe, fleet, now);
    }

    const returnSecs = flightSecondsOneWay(
      fleet.targetCoords,
      origin.coords,
      fleet.ships,
      universe.fleetSpeed,
      drive,
    );
    if (fleetShipCount(fleet.ships) <= 0) {
      delete universe.fleets[fleet.id];
      return;
    }
    fleet.phase = "returning";
    fleet.arrivesAt = now + returnSecs * 1000;
    universe.fleets[fleet.id] = fleet;
    return;
  }

  addShipsToPlanet(origin, fleet.ships);
  addCargoToPlanet(origin, fleet.cargo);
  delete universe.fleets[fleet.id];
}

export function fleetCargoCapacityForHarvest(ships: FleetShips): number {
  let cap = 0;
  for (const id of SHIP_ORDER) {
    cap += (ships[id] ?? 0) * SHIPS[id].cargo;
  }
  return cap;
}

export function advanceFleets(universe: UniverseState, now: number): void {
  ensureUniverseShape(universe);
  const due = Object.values(universe.fleets)
    .filter((f) => f.arrivesAt <= now)
    .sort((a, b) => a.arrivesAt - b.arrivesAt);
  for (const fleet of due) {
    const live = universe.fleets[fleet.id];
    if (!live || live.arrivesAt > now) continue;
    resolveFleetArrival(universe, live, now);
  }
}

export function advanceUniverse(universe: UniverseState, now = Date.now()): void {
  ensureUniverseShape(universe);
  for (const player of Object.values(universe.players)) {
    advanceResearch(universe, player, now);
  }
  for (const id of Object.keys(universe.planets)) {
    const planet = universe.planets[id];
    const owner = universe.players[planet.ownerPlayerId];
    const energyTech = owner?.research.energyTech ?? 0;
    universe.planets[id] = advancePlanet(
      planet,
      universe.speed,
      now,
      energyTech,
    );
  }
  advanceFleets(universe, now);
  pruneSpyReports(universe, now);
}
