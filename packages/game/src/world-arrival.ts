import { FOUNDATION_ARK_BOOTSTRAP, SHIPS, SHIP_ORDER } from "./catalog.js";
import { invalidateArtContext } from "./planet-art.js";
import {
  classBonuses,
  allianceBonusesForPlayer,
  coordsKey,
  emptyDefenses,
  empireColonyCap,
  fleetCargoCapacity,
  fleetShipCount,
  flightSecondsOneWay,
  levelBonuses,
  maxColonies,
  normalizeFleetShips,
  recyclerHullScale,
  rollPlanetFields,
  travelBonusMult,
} from "./formulas.js";
import type { BuildingId } from "./types.js";
import type {
  FleetMission,
  FleetShips,
  PlanetState,
  UniverseState,
} from "./types.js";
import {
  handleAcsOutboundArrival,
  tickAcsGroups,
} from "./world-acs.js";
import { resolveRaidArrival } from "./world-arrival-raid.js";
import { isNewbieBonusActive, NEWBIE_PRODUCTION_MULT } from "./world-protection.js";
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
  captureMiniPlanet,
  isMiniPlanet,
  isUnclaimedMini,
  miniKindOf,
  playerKnowsMini,
  playerOwnsMiniKind,
  tickMiniDrift,
} from "./world-mini.js";
import { ownedPlanetCount } from "./world-moons.js";
import { playerBoosts } from "./world-boosts.js";
import {
  resolveAlienRaidArrival,
  resolvePirateRaidArrival,
  tickPirates,
} from "./world-pirates.js";
import { rollSeasons } from "./world-seasons.js";
import { pruneSpyReports } from "./world-spy-prune.js";
import {
  clearOccupationIfFleetGone,
  occupationForPlanet,
  occupationMineShares,
  pruneExpiredOccupations,
  startOccupation,
} from "./world-occupation.js";
import { formatEventCount, pushEventLog } from "./world-event-log.js";
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
import {
  bindPlanetSync,
  consumeTickBudget,
  tickBudget,
} from "./tick-budget.js";
import { continueUniverseSeed } from "./world-seed.js";

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
  advancePlanetNow(universe, fleet.originPlanetId, now);
  if (fleet.targetPlanetId) advancePlanetNow(universe, fleet.targetPlanetId, now);
  const origin = universe.planets[fleet.originPlanetId];
  if (!origin) {
    clearOccupationIfFleetGone(universe, fleet);
    delete universe.fleets[fleet.id];
    return;
  }
  const owner = universe.players[fleet.ownerPlayerId];
  const drive = owner?.research.combustionDrive ?? 0;

  if (fleet.phase === "holding") {
    if (fleet.acsGroupId) {
      handleAcsOutboundArrival(universe, fleet, now);
    } else {
      fleet.phase = "returning";
      fleet.arrivesAt = now + 1;
      universe.fleets[fleet.id] = fleet;
    }
    return;
  }

  if (fleet.phase === "outbound") {
    if (
      fleet.acsGroupId &&
      (fleet.mission === "raid" || fleet.mission === "pirateRaid")
    ) {
      if (handleAcsOutboundArrival(universe, fleet, now)) {
        return;
      }
    }
    if (fleet.mission === "raid") {
      const target = fleet.targetPlanetId
        ? universe.planets[fleet.targetPlanetId]
        : null;
      if (!target) {
        delete universe.fleets[fleet.id];
        return;
      }
      resolveRaidArrival(universe, fleet, target, now);
    } else if (fleet.mission === "occupy") {
      const target = fleet.targetPlanetId
        ? universe.planets[fleet.targetPlanetId]
        : null;
      if (!target || !isMiniPlanet(target)) {
        delete universe.fleets[fleet.id];
        return;
      }
      let won = false;
      if (target.ownerPlayerId && target.ownerPlayerId !== fleet.ownerPlayerId) {
        resolveRaidArrival(universe, fleet, target, now);
        const report = fleet.reportId ? universe.reports[fleet.reportId] : null;
        won = report?.outcome === "attacker_win";
      } else if (!target.ownerPlayerId) {
        won = true;
      }
      if (won && (fleet.ships.swarmMothership ?? 0) >= 1) {
        const cap = captureMiniPlanet(universe, fleet.ownerPlayerId, target);
        if (cap.ok) {
          startOccupation(universe, fleet.ownerPlayerId, fleet.id, now);
        }
      }
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
      addCargoToPlanet(universe, target, fleet.cargo, now);
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
        const cap = fleetCargoCapacityForHarvest(
          fleet.ships,
          owner?.research?.cargoHoldTech ?? 0,
        );
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
        const cap = fleetCargoCapacityForHarvest(
          fleet.ships,
          owner?.research?.cargoHoldTech ?? 0,
        );
        fleet.cargo = harvestAsteroidField(universe, asteroidId, cap);
      }
    } else if (fleet.mission === "expedition") {
      resolveExpeditionArrival(universe, fleet, now);
    } else if (fleet.mission === "pirateRaid") {
      resolvePirateRaidArrival(universe, fleet, now);
    } else if (fleet.mission === "alienRaid") {
      resolveAlienRaidArrival(universe, fleet, now);
    }

    const returnBonus = travelBonusMult(
      universe,
      fleet.ownerPlayerId,
      origin.id,
      fleet.targetPlanetId,
    );
    const returnSecs = flightSecondsOneWay(
      fleet.targetCoords,
      origin.coords,
      fleet.ships,
      effectiveFleetSpeed(universe, fleet.ownerPlayerId, now) *
        returnBonus.fleetSpeed,
      drive,
      recyclerHullScale(returnBonus.recyclerSpeed),
      owner?.research?.fleetSpeedTech ?? 0,
    );
    if (fleetShipCount(fleet.ships) <= 0) {
      clearOccupationIfFleetGone(universe, fleet);
      delete universe.fleets[fleet.id];
      return;
    }
    universe.fleets[fleet.id] = {
      ...fleet,
      phase: "returning",
      arrivesAt: now + returnSecs * 1000,
    };
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
  addCargoToPlanet(universe, origin, live.cargo, now);
  if (owner) {
    const hulls = SHIP_ORDER.filter((id) => (live.ships[id] ?? 0) > 0)
      .map(
        (id) =>
          `${formatEventCount(live.ships[id] ?? 0)}× ${SHIPS[id].name}`,
      )
      .join(", ");
    pushEventLog(owner, {
      kind: "fleetReturn",
      createdAt: live.arrivesAt,
      title: `Fleet returned to ${origin.name}`,
      body: hulls ? `${live.mission} · ${hulls}` : live.mission,
      href: "#messages",
      meta: {
        mission: live.mission,
        planetId: origin.id,
        fleetId: live.id,
      },
    });
    universe.players[owner.id] = owner;
  }
  delete universe.fleets[live.id];
}

export function fleetCargoCapacityForHarvest(
  ships: FleetShips,
  cargoHoldLevel = 0,
): number {
  return fleetCargoCapacity(ships, cargoHoldLevel);
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
    if (!consumeTickBudget("fleets")) break;
    const live = universe.fleets[fleet.id];
    if (!live || live.arrivesAt > now) continue;
    resolveFleetArrival(universe, live, now);
  }
}

function planetQueueDue(planet: PlanetState, now: number): boolean {
  const queues = [planet.buildQueue, planet.shipQueue, planet.defenseQueue];
  for (const queue of queues) {
    const front = queue?.[0];
    if (front && front.startedAt != null && front.completesAt <= now) return true;
  }
  return false;
}

function ownedPlanetIds(universe: UniverseState): Set<string> {
  const ids = new Set<string>();
  for (const player of Object.values(universe.players)) {
    for (const id of player.planetIds ?? []) ids.add(id);
    if (player.homePlanetId) ids.add(player.homePlanetId);
    if (player.activePlanetId) ids.add(player.activePlanetId);
  }
  return ids;
}

/** Advance one planet's queues, production, and occupation siphon to `now`. */
export function advancePlanetNow(
  universe: UniverseState,
  id: string,
  now: number,
): void {
  const planet = universe.planets[id];
  if (!planet) return;
  const owner = universe.players[planet.ownerPlayerId];
  const energyTech = owner?.research.energyTech ?? 0;
  const boosts = playerBoosts(owner, now);
  const lb = levelBonuses(owner?.level ?? 1);
  const cls = classBonuses(owner?.playerClass?.classId);
  const ally = allianceBonusesForPlayer(universe, owner?.id);
  const before = { ...planet.resources };
  const advanced = advancePlanet(
    planet,
    universe.speed,
    now,
    energyTech,
    {
      mineOutput:
        lb.production *
        boosts.mineOutput *
        cls.mineOutput *
        ally.mineOutput *
        (isNewbieBonusActive(universe, owner, now)
          ? NEWBIE_PRODUCTION_MULT
          : 1),
      energyOutput: boosts.energyOutput * cls.energyOutput,
    },
    owner,
  );
  if (owner) universe.players[owner.id] = owner;
  const occ = occupationForPlanet(universe, id, now);
  if (occ && occ.occupierPlayerId !== planet.ownerPlayerId) {
    const gained = {
      metal: Math.max(0, advanced.resources.metal - before.metal),
      crystal: Math.max(0, advanced.resources.crystal - before.crystal),
      deuterium: Math.max(0, advanced.resources.deuterium - before.deuterium),
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
      addCargoToPlanet(universe, universe.planets[payPlanetId]!, shares.occupier, now);
    }
  }
  universe.planets[id] = advanced;
}

bindPlanetSync(advancePlanetNow);

export function advanceUniverse(universe: UniverseState, now = Date.now()): void {
  invalidateArtContext(universe);
  ensureUniverseShape(universe);
  if (universe.seedCursor && !universe.seedCursor.done) {
    const budget = tickBudget();
    const deferTick = continueUniverseSeed(universe, now, {
      systems: budget?.seedSystems ?? 10_000,
      minis: budget?.seedMinis ?? 10_000,
      pirates: budget?.seedPirates ?? 10_000,
    });
    if (deferTick) return;
  }
  rollSeasons(universe, now);
  pruneExpiredOccupations(universe, now);
  for (const player of Object.values(universe.players)) {
    advanceResearch(universe, player, now);
  }
  const budget = tickBudget();
  const focus = budget?.lazyPlanets ? ownedPlanetIds(universe) : null;
  for (const id of Object.keys(universe.planets)) {
    const planet = universe.planets[id];
    if (!planet) continue;
    if (focus && !focus.has(id) && !planetQueueDue(planet, now)) continue;
    advancePlanetNow(universe, id, now);
  }
  for (const fleet of Object.values(universe.fleets)) {
    advanceFleetSwarmProduce(fleet, now);
  }
  tickAcsGroups(universe, now);
  advanceFleets(universe, now);
  tickMiniDrift(universe, now);
  tickPirates(universe, now);
  pruneSpyReports(universe, now);
}
