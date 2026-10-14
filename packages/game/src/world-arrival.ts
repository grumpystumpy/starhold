import { FOUNDATION_ARK_BOOTSTRAP, SHIPS, SHIP_ORDER } from "./catalog.js";
import {
  classBonuses,
  coordsKey,
  emptyDefenses,
  empireColonyCap,
  fleetShipCount,
  flightSecondsOneWay,
  levelBonuses,
  maxColonies,
  normalizeFleetShips,
  rollPlanetFields,
} from "./formulas.js";
import type { BuildingId } from "./types.js";
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
import {
  isUnclaimedMini,
  miniKindOf,
  playerKnowsMini,
  playerOwnsMiniKind,
  tickMiniDrift,
} from "./world-mini.js";
import { ownedPlanetCount } from "./world-moons.js";
import { playerBoosts } from "./world-boosts.js";
import { resolvePirateRaidArrival, tickPirates } from "./world-pirates.js";
import { pruneSpyReports } from "./world-spy-prune.js";
import {
  clearOccupationIfFleetGone,
  occupationForPlanet,
  occupationMineShares,
  pruneExpiredOccupations,
} from "./world-occupation.js";
import { resolveMiniPlanetChoice } from "./world-round2.js";
import {
  addCargoToPlanet,
  addShipsToPlanet,
  advanceFleetSwarmProduce,
  advancePlanet,
  advanceResearch,
  getDebris,
  subtractCargo,
} from "./world-tick.js";

/** Effective fleet speed: universe × officers/skills ÷ level time factor. */
function effectiveFleetSpeed(
  universe: UniverseState,
  ownerPlayerId: string,
  now: number,
): number {
  const owner = universe.players[ownerPlayerId];
  const boosts = playerBoosts(owner, now);
  const lb = levelBonuses(owner?.level ?? 1);
  return (
    universe.fleetSpeed *
    Math.max(0.01, boosts.fleetSpeed) /
    Math.max(0.01, lb.fleetTime)
  );
}

export function resolveFleetArrival(
  universe: UniverseState,
  fleet: FleetMission,
  now: number,
): void {
  const origin = universe.planets[fleet.originPlanetId];
  if (!origin) {
    clearOccupationIfFleetGone(universe, fleet);
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
      if (target && target.ownerPlayerId === fleet.ownerPlayerId) {
        addShipsToPlanet(target, fleet.ships);
        delete universe.fleets[fleet.id];
        return;
      }
    } else if (fleet.mission === "jump") {
      const target = fleet.targetPlanetId
        ? universe.planets[fleet.targetPlanetId]
        : null;
      if (
        !target ||
        target.kind !== "moon" ||
        target.ownerPlayerId !== fleet.ownerPlayerId
      ) {
        delete universe.fleets[fleet.id];
        return;
      }
      addShipsToPlanet(target, fleet.ships);
      delete universe.fleets[fleet.id];
      return;
    } else if (fleet.mission === "colonize") {
      const occupied = planetAtCoords(universe, fleet.targetCoords);
      const hasCradle = (fleet.ships.colonyShip ?? 0) >= 1;
      const hasArk = (fleet.ships.foundationArk ?? 0) >= 1;
      if (!owner) {
        delete universe.fleets[fleet.id];
        return;
      } else if (
        occupied &&
        isUnclaimedMini(occupied) &&
        playerKnowsMini(universe, owner.id, occupied.id, now) &&
        hasCradle &&
        ownedPlanetCount(universe, owner.id) <
          empireColonyCap(owner, universe, maxColonies) &&
        !(
          (miniKindOf(occupied) === "fortress" ||
            miniKindOf(occupied) === "relic") &&
          playerOwnsMiniKind(universe, owner.id, miniKindOf(occupied))
        )
      ) {
        // Claim unoccupied mini — Colonizer only (Micah).
        const remaining = normalizeFleetShips(fleet.ships);
        remaining.colonyShip = Math.max(0, remaining.colonyShip - 1);
        occupied.buildings.solarPlant = Math.max(
          occupied.buildings.solarPlant ?? 0,
          1,
        );
        occupied.ownerPlayerId = owner.id;
        occupied.name = `${owner.name}'s Colony`;
        if (occupied.colonizedAt == null) occupied.colonizedAt = now;
        if (!occupied.discoveredBy) occupied.discoveredBy = [];
        if (!occupied.discoveredBy.includes(owner.id)) {
          occupied.discoveredBy.push(owner.id);
        }
        if (!owner.discoveredMiniIds) owner.discoveredMiniIds = [];
        if (!owner.discoveredMiniIds.includes(occupied.id)) {
          owner.discoveredMiniIds.push(occupied.id);
        }
        addShipsToPlanet(occupied, remaining);
        universe.planets[occupied.id] = occupied;
        if (!owner.planetIds.includes(occupied.id)) {
          owner.planetIds.push(occupied.id);
        }
        universe.players[owner.id] = owner;
        delete universe.fleets[fleet.id];
        return;
      } else if (occupied) {
        // Slot taken — fleet returns with Colonizer intact.
      } else if (!hasCradle && !hasArk) {
      } else if (
        ownedPlanetCount(universe, owner.id) >=
        empireColonyCap(owner, universe, maxColonies)
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
          buildQueue: [],
          shipQueue: [],
          defenseQueue: [],
        };
        const remaining = normalizeFleetShips(fleet.ships);
        if (hasArk) {
          remaining.foundationArk = Math.max(0, remaining.foundationArk - 1);
          for (const [bid, level] of Object.entries(FOUNDATION_ARK_BOOTSTRAP)) {
            colony.buildings[bid as BuildingId] = level ?? 0;
          }
        } else {
          remaining.colonyShip = Math.max(0, remaining.colonyShip - 1);
          colony.buildings.solarPlant = 1;
        }
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
    } else if (fleet.mission === "pirateRaid") {
      resolvePirateRaidArrival(universe, fleet, now);
    }

    const returnSecs = flightSecondsOneWay(
      fleet.targetCoords,
      origin.coords,
      fleet.ships,
      effectiveFleetSpeed(universe, fleet.ownerPlayerId, now),
      drive,
    );
    if (fleetShipCount(fleet.ships) <= 0) {
      clearOccupationIfFleetGone(universe, fleet);
      delete universe.fleets[fleet.id];
      return;
    }
    fleet.phase = "returning";
    fleet.arrivesAt = now + returnSecs * 1000;
    universe.fleets[fleet.id] = fleet;
    return;
  }

  // Default direct-capture if capital fleet left resolve pending until return.
  if (fleet.reportId && fleet.mission === "raid") {
    const report = universe.reports[fleet.reportId];
    if (
      report?.miniResolveAvailable &&
      !report.miniResolved &&
      report.outcome === "attacker_win"
    ) {
      resolveMiniPlanetChoice(
        universe,
        fleet.ownerPlayerId,
        fleet.id,
        "capture",
      );
    }
  }

  clearOccupationIfFleetGone(universe, fleet);
  const live = universe.fleets[fleet.id];
  if (!live) return;
  addShipsToPlanet(origin, live.ships);
  addCargoToPlanet(origin, live.cargo);
  delete universe.fleets[live.id];
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
  for (const fleet of Object.values(universe.fleets)) {
    if (fleet.swarmProduce) advanceFleetSwarmProduce(fleet, now);
  }
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
  pruneExpiredOccupations(universe, now);
  for (const player of Object.values(universe.players)) {
    advanceResearch(universe, player, now);
  }
  for (const id of Object.keys(universe.planets)) {
    const planet = universe.planets[id];
    const owner = universe.players[planet.ownerPlayerId];
    const energyTech = owner?.research.energyTech ?? 0;
    const boosts = playerBoosts(owner, now);
    const lb = levelBonuses(owner?.level ?? 1);
    const before = { ...planet.resources };
    // Stack: base → research (energyTech) → level → officers → skills.
    const advanced = advancePlanet(
      planet,
      universe.speed,
      now,
      energyTech,
      {
        mineOutput:
          lb.production *
          boosts.mineOutput *
          classBonuses(owner?.playerClass?.classId).mineOutput,
        energyOutput: boosts.energyOutput,
      },
      owner,
    );
    if (owner) universe.players[owner.id] = owner;
    const occ = occupationForPlanet(universe, id, now);
    if (occ && occ.occupierPlayerId !== planet.ownerPlayerId) {
      const gained = {
        metal: Math.max(0, advanced.resources.metal - before.metal),
        crystal: Math.max(0, advanced.resources.crystal - before.crystal),
        deuterium: Math.max(
          0,
          advanced.resources.deuterium - before.deuterium,
        ),
      };
      const shares = occupationMineShares(gained);
      subtractCargo(advanced, {
        metal: gained.metal - shares.owner.metal,
        crystal: gained.crystal - shares.owner.crystal,
        deuterium: gained.deuterium - shares.owner.deuterium,
      });
      const occupier = universe.players[occ.occupierPlayerId];
      const payPlanetId =
        occupier?.activePlanetId ?? occupier?.homePlanetId ?? null;
      if (payPlanetId && universe.planets[payPlanetId]) {
        addCargoToPlanet(universe.planets[payPlanetId], shares.occupier);
      }
    }
    universe.planets[id] = advanced;
  }
  for (const fleet of Object.values(universe.fleets)) {
    advanceFleetSwarmProduce(fleet, now);
  }
  advanceFleets(universe, now);
  tickMiniDrift(universe, now);
  tickPirates(universe, now);
  pruneSpyReports(universe, now);
}
