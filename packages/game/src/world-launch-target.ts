import {
  EXPEDITION_SLOT,
  MAP_GALAXIES,
  MAP_SLOTS,
  MAP_SYSTEMS,
  MINI_SLOT_MAX,
  MINI_SLOT_MIN,
  NEWBIE_PROTECTION_POINTS,
} from "./catalog.js";
import {
  empireColonyCap,
  empireExpeditionCap,
  maxColonies,
  maxExpeditions,
} from "./formulas.js";
import { canCollectDebris } from "./formulas-round2.js";
import { ownedPlanetCount } from "./world-moons.js";
import type {
  Coordinates,
  FleetShips,
  MissionType,
  PlanetState,
  PlayerState,
  UniverseState,
} from "./types.js";
import { planetAtCoords } from "./world-bootstrap.js";
import {
  empireDriftBeaconExpeditionBonus,
  isMiniPlanet,
  isUnclaimedMini,
  playerKnowsMini,
} from "./world-mini.js";
import { alienBaseAtCoords, pirateBaseAtCoords } from "./world-pirates.js";
import { isNewbieProtected } from "./world-protection.js";
import { getDebris } from "./world-tick.js";

export type LaunchTargetResult =
  | {
      ok: true;
      targetCoords: Coordinates;
      targetPlanet: PlanetState | null;
      targetPlayerId: string | null;
      targetAsteroidId: string | null;
      targetPirateBaseId: string | null;
      targetAlienBaseId: string | null;
    }
  | { ok: false; error: string };

export function resolveLaunchTarget(
  universe: UniverseState,
  player: PlayerState,
  origin: PlanetState,
  mission: MissionType,
  ships: FleetShips,
  targetPlanetId: string | undefined,
  targetCoordsOpt: Coordinates | undefined,
  targetAsteroidIdOpt?: string,
  targetPirateBaseIdOpt?: string,
  targetAlienBaseIdOpt?: string,
): LaunchTargetResult {
  let targetCoords: Coordinates;
  let targetPlanet: PlanetState | null = null;
  let targetPlayerId: string | null = null;
  let targetAsteroidId: string | null = null;
  let targetPirateBaseId: string | null = null;
  let targetAlienBaseId: string | null = null;

  if (mission === "expedition") {
    if (!targetCoordsOpt) {
      return { ok: false, error: "targetCoords required for expedition." };
    }
    targetCoords = { ...targetCoordsOpt };
    if (
      targetCoords.galaxy < 1 ||
      targetCoords.galaxy > MAP_GALAXIES ||
      targetCoords.system < 1 ||
      targetCoords.system > MAP_SYSTEMS ||
      targetCoords.slot !== EXPEDITION_SLOT
    ) {
      return {
        ok: false,
        error: `Expedition requires deep-space slot ${EXPEDITION_SLOT}.`,
      };
    }
    const activeExpeditions = Object.values(universe.fleets).filter(
      (f) => f.ownerPlayerId === player.id && f.mission === "expedition",
    ).length;
    const cap =
      empireExpeditionCap(player, maxExpeditions) +
      empireDriftBeaconExpeditionBonus(universe, player.id);
    if (activeExpeditions >= cap) {
      return {
        ok: false,
        error: `Expedition limit reached (Stellar Cartography → ${cap} concurrent).`,
      };
    }
    return {
      ok: true,
      targetCoords,
      targetPlanet: null,
      targetPlayerId: null,
      targetAsteroidId: null,
      targetPirateBaseId: null,
      targetAlienBaseId: null,
    };
  }

  if (mission === "pirateRaid") {
    const pirateId = targetPirateBaseIdOpt?.trim();
    if (!pirateId) {
      return { ok: false, error: "pirateBaseId required for pirateRaid." };
    }
    const base = universe.pirateBases?.[pirateId];
    if (!base || base.destroyedAt != null) {
      return { ok: false, error: "Pirate base not found." };
    }
    targetPirateBaseId = pirateId;
    targetCoords = { ...base.coords };
    return {
      ok: true,
      targetCoords,
      targetPlanet: null,
      targetPlayerId: null,
      targetAsteroidId: null,
      targetPirateBaseId,
      targetAlienBaseId: null,
    };
  }

  if (mission === "alienRaid") {
    const alienId = targetAlienBaseIdOpt?.trim();
    if (!alienId) {
      return { ok: false, error: "alienBaseId required for alienRaid." };
    }
    const base = universe.alienBases?.[alienId];
    if (!base || base.destroyedAt != null) {
      return { ok: false, error: "Alien base not found." };
    }
    targetAlienBaseId = alienId;
    targetCoords = { ...base.coords };
    return {
      ok: true,
      targetCoords,
      targetPlanet: null,
      targetPlayerId: null,
      targetAsteroidId: null,
      targetPirateBaseId: null,
      targetAlienBaseId,
    };
  }

  if (mission === "harvestAsteroid") {
    const asteroidId = targetAsteroidIdOpt?.trim();
    if (!asteroidId) {
      return { ok: false, error: "asteroidId required for harvestAsteroid." };
    }
    const field = universe.asteroids?.[asteroidId];
    if (!field || field.richness <= 0) {
      return { ok: false, error: "Asteroid field not found." };
    }
    if ((ships.recycler ?? 0) < 1) {
      return { ok: false, error: "Asteroid harvest requires a Salvage Trawler." };
    }
    targetAsteroidId = asteroidId;
    targetCoords = { ...field.coords };
    return {
      ok: true,
      targetCoords,
      targetPlanet: null,
      targetPlayerId: null,
      targetAsteroidId,
      targetPirateBaseId: null,
      targetAlienBaseId: null,
    };
  }

  if (mission === "colonize" || mission === "harvest") {
    if (!targetCoordsOpt) {
      return {
        ok: false,
        error: "targetCoords required for colonize/harvest.",
      };
    }
    targetCoords = { ...targetCoordsOpt };
    const isMiniSlot =
      targetCoords.slot >= MINI_SLOT_MIN &&
      targetCoords.slot <= MINI_SLOT_MAX;
    if (
      targetCoords.galaxy < 1 ||
      targetCoords.galaxy > MAP_GALAXIES ||
      targetCoords.system < 1 ||
      targetCoords.system > MAP_SYSTEMS ||
      targetCoords.slot < 1 ||
      (targetCoords.slot > MAP_SLOTS && !isMiniSlot)
    ) {
      return { ok: false, error: "Coordinates out of map bounds." };
    }
    targetPlanet = planetAtCoords(universe, targetCoords);
    if (mission === "colonize") {
      if (pirateBaseAtCoords(universe, targetCoords)) {
        return { ok: false, error: "Pirate base occupies that slot." };
      }
      if (alienBaseAtCoords(universe, targetCoords)) {
        return { ok: false, error: "Alien base occupies that slot." };
      }
      const hasCradle = (ships.colonyShip ?? 0) >= 1;
      const hasArk = (ships.foundationArk ?? 0) >= 1;
      if (!hasCradle && !hasArk) {
        return {
          ok: false,
          error: "Colonize requires a Colonizer or Foundation Ark.",
        };
      }
      if (targetPlanet && isMiniPlanet(targetPlanet)) {
        if (!isUnclaimedMini(targetPlanet)) {
          return { ok: false, error: "Mini planet is already colonized." };
        }
        if (!playerKnowsMini(universe, player.id, targetPlanet.id)) {
          return {
            ok: false,
            error: "You have not discovered that mini planet yet.",
          };
        }
      } else if (targetPlanet) {
        return { ok: false, error: "Slot is already occupied." };
      } else if (isMiniSlot) {
        return { ok: false, error: "No mini planet at those coordinates." };
      }
      if (!isMiniSlot && pirateBaseAtCoords(universe, targetCoords)) {
        return { ok: false, error: "Pirate base occupies that slot." };
      }
      const colonyCap = empireColonyCap(player, universe, maxColonies);
      if (ownedPlanetCount(universe, player.id) >= colonyCap) {
        return {
          ok: false,
          error: `Colony limit reached (Stellar Cartography → ${colonyCap} worlds).`,
        };
      }
    } else {
      const field = getDebris(universe, targetCoords);
      if (!field || (field.metal <= 0 && field.crystal <= 0)) {
        return { ok: false, error: "No debris at those coordinates." };
      }
      if (!canCollectDebris(ships)) {
        return {
          ok: false,
          error: "Harvest requires a Salvage Trawler or Mothership.",
        };
      }
    }
  } else {
    if (!targetPlanetId) {
      return { ok: false, error: "targetPlanetId required." };
    }
    targetPlanet = universe.planets[targetPlanetId] ?? null;
    if (!targetPlanet) return { ok: false, error: "Target planet not found." };
    targetCoords = { ...targetPlanet.coords };
    targetPlayerId = targetPlanet.ownerPlayerId;

    if (mission === "transport") {
      if (targetPlanet.ownerPlayerId !== player.id) {
        return { ok: false, error: "Transport only between your planets." };
      }
      if (targetPlanet.id === origin.id) {
        return { ok: false, error: "Cannot transport to the same planet." };
      }
    } else if (mission === "deploy") {
      if (targetPlanet.id === origin.id) {
        return { ok: false, error: "Cannot deploy to the same planet." };
      }
    } else if (mission === "raid") {
      if (targetPlanet.id === origin.id) {
        return { ok: false, error: "Cannot send a fleet to your own planet." };
      }
      if (targetPlanet.ownerPlayerId === player.id) {
        return {
          ok: false,
          error: "Use transport or deploy to move between your own planets.",
        };
      }
      const defender = universe.players[targetPlanet.ownerPlayerId];
      if (defender && isNewbieProtected(universe, defender)) {
        const cap = NEWBIE_PROTECTION_POINTS.toLocaleString("en-US");
        return {
          ok: false,
          error: `Target is under newbie protection (under ${cap} points).`,
        };
      }
    } else if (mission === "espionage") {
      if (targetPlanet.ownerPlayerId === player.id) {
        return { ok: false, error: "Cannot spy on yourself." };
      }
      if ((ships.probe ?? 0) < 1) {
        return { ok: false, error: "Espionage requires a Whisper Probe." };
      }
    } else if (mission === "jump") {
      if (origin.kind !== "moon") {
        return { ok: false, error: "Fold Bridge hops must start from a moon." };
      }
      if ((origin.buildings.jumpGate ?? 0) < 1) {
        return { ok: false, error: "Origin moon needs Fold Bridge level 1." };
      }
      if (targetPlanet.kind !== "moon") {
        return { ok: false, error: "Fold Bridge hops must target a moon." };
      }
      if (targetPlanet.ownerPlayerId !== player.id) {
        return { ok: false, error: "Fold Bridge only links your own moons." };
      }
      if (targetPlanet.id === origin.id) {
        return { ok: false, error: "Cannot jump to the same moon." };
      }
      if ((targetPlanet.buildings.jumpGate ?? 0) < 1) {
        return { ok: false, error: "Target moon needs Fold Bridge level 1." };
      }
    }
  }

  return {
    ok: true,
    targetCoords,
    targetPlanet,
    targetPlayerId,
    targetAsteroidId,
    targetPirateBaseId,
      targetAlienBaseId: null,
  };
}
