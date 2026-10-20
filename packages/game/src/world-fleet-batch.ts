import {
  EXPEDITION_SLOT,
  MAP_GALAXIES,
  MAP_SYSTEMS,
  SHIP_ORDER,
} from "./catalog.js";
import {
  classBonuses,
  empireExpeditionCap,
  fleetShipCount,
  isStationaryShip,
  maxExpeditions,
  maxFleetSlots,
  normalizeFleetShips,
} from "./formulas.js";
import type { FleetMission, FleetShips, UniverseState } from "./types.js";
import { playerBoosts } from "./world-boosts.js";
import { emptyShips, ensureUniverseShape } from "./world-bootstrap.js";
import { launchFleet } from "./world-launch.js";
import { empireDriftBeaconCount } from "./world-mini.js";

export type BatchFleetResult =
  | {
      ok: true;
      launched: FleetMission[];
      stoppedReason?: string;
    }
  | { ok: false; error: string };

function hangarHasComposition(
  hangar: Record<string, number>,
  ships: FleetShips,
): boolean {
  for (const [id, need] of Object.entries(ships)) {
    if ((need ?? 0) > 0 && (hangar[id] ?? 0) < (need ?? 0)) return false;
  }
  return fleetShipCount(ships) >= 1;
}

/**
 * Fill free expedition slots (and fleet slots) using the Expedition preset
 * (or explicit ships). Targets deep space for the given / origin system.
 */
export function launchMaxExpeditions(
  universe: UniverseState,
  opts: {
    playerId: string;
    originPlanetId?: string;
    galaxy?: number;
    system?: number;
    /** Override Expedition preset composition. */
    ships?: Partial<FleetShips>;
    presetId?: string;
    now?: number;
  },
): BatchFleetResult {
  ensureUniverseShape(universe);
  const player = universe.players[opts.playerId];
  if (!player) return { ok: false, error: "Unknown player." };

  const origin =
    (opts.originPlanetId
      ? universe.planets[opts.originPlanetId]
      : universe.planets[player.activePlanetId]) ??
    universe.planets[player.homePlanetId];
  if (!origin || origin.ownerPlayerId !== player.id) {
    return { ok: false, error: "Planet missing." };
  }

  const now = opts.now ?? Date.now();
  const galaxy = Math.min(
    MAP_GALAXIES,
    Math.max(1, Math.floor(opts.galaxy ?? origin.coords.galaxy)),
  );
  const system = Math.min(
    MAP_SYSTEMS,
    Math.max(1, Math.floor(opts.system ?? origin.coords.system)),
  );

  const launched: FleetMission[] = [];
  let stoppedReason: string | undefined;

  if (opts.ships !== undefined) {
    const ships = normalizeFleetShips(opts.ships);
    if (fleetShipCount(ships) < 1) {
      return { ok: false, error: "Expedition preset has no ships." };
    }

    for (let i = 0; i < 64; i++) {
      if (!hangarHasComposition(origin.ships, ships)) {
        stoppedReason = launched.length
          ? "Not enough ships in orbit for another expedition."
          : "Not enough ships in orbit for the Expedition preset.";
        break;
      }
      const result = launchFleet(universe, {
        playerId: player.id,
        mission: "expedition",
        ships,
        targetCoords: { galaxy, system, slot: EXPEDITION_SLOT },
        originPlanetId: origin.id,
        now: now + i,
      });
      if (!result.ok) {
        stoppedReason = result.error;
        break;
      }
      launched.push(result.fleet);
    }

    if (launched.length < 1) {
      return {
        ok: false,
        error: stoppedReason ?? "Could not launch any expeditions.",
      };
    }
    return { ok: true, launched, stoppedReason };
  }

  // "Send max expeditions" (opts.ships is undefined):
  // Split EVERY ship type on the origin planet evenly across open expedition slots.
  const activeExpeditions = Object.values(universe.fleets).filter(
    (f) => f.ownerPlayerId === player.id && f.mission === "expedition",
  ).length;
  const driftBeaconCount = empireDriftBeaconCount(universe, player.id);
  const expeditionCap =
    empireExpeditionCap(player, maxExpeditions) +
    driftBeaconCount;
  const freeExpeditionSlots = Math.max(0, expeditionCap - activeExpeditions);

  const boosts = playerBoosts(player, now);
  const cls = classBonuses(player.playerClass?.classId);
  const fleetSlotCap =
    maxFleetSlots(player.research.computerTech) +
    boosts.fleetSlots +
    cls.fleetSlots +
    driftBeaconCount;
  const activeFleets = Object.values(universe.fleets).filter(
    (f) => f.ownerPlayerId === player.id,
  ).length;
  const freeFleetSlots = Math.max(0, fleetSlotCap - activeFleets);

  const numOpenSlots = Math.min(freeExpeditionSlots, freeFleetSlots);

  if (numOpenSlots <= 0) {
    if (activeFleets >= fleetSlotCap) {
      return {
        ok: false,
        error: `Fleet slot limit reached (Fleet OS → ${fleetSlotCap} slots).`,
      };
    }
    return {
      ok: false,
      error: `Expedition limit reached (Stellar Cartography → ${expeditionCap} concurrent).`,
    };
  }

  const availableShips: Partial<FleetShips> = {};
  let totalMovable = 0;
  for (const id of SHIP_ORDER) {
    if (isStationaryShip(id)) continue;
    const have = Math.max(0, Math.floor(origin.ships[id] ?? 0));
    if (have > 0) {
      availableShips[id] = have;
      totalMovable += have;
    }
  }

  if (totalMovable < 1) {
    return {
      ok: false,
      error: "Not enough ships in orbit for the Expedition preset.",
    };
  }

  for (let i = 0; i < numOpenSlots; i++) {
    const slotShips: FleetShips = emptyShips();
    for (const id of SHIP_ORDER) {
      if (isStationaryShip(id)) continue;
      const count = availableShips[id] ?? 0;
      if (count <= 0) continue;
      const base = Math.floor(count / numOpenSlots);
      const rem = count % numOpenSlots;
      const share = base + (i < rem ? 1 : 0);
      if (share > 0) {
        slotShips[id] = share;
      }
    }

    if (fleetShipCount(slotShips) < 1) {
      continue;
    }

    const result = launchFleet(universe, {
      playerId: player.id,
      mission: "expedition",
      ships: slotShips,
      targetCoords: { galaxy, system, slot: EXPEDITION_SLOT },
      originPlanetId: origin.id,
      now: now + i,
    });

    if (!result.ok) {
      stoppedReason = result.error;
      break;
    }
    launched.push(result.fleet);
  }

  if (launched.length < 1) {
    return {
      ok: false,
      error: stoppedReason ?? "Could not launch any expeditions.",
    };
  }

  return { ok: true, launched, stoppedReason };
}

/**
 * Batch espionage: one Whisper Probe wave at every foreign-owned planet
 * (and moon) in the current system.
 */
export function batchScanSystem(
  universe: UniverseState,
  opts: {
    playerId: string;
    galaxy: number;
    system: number;
    probesPerTarget?: number;
    originPlanetId?: string;
    now?: number;
  },
): BatchFleetResult {
  ensureUniverseShape(universe);
  const player = universe.players[opts.playerId];
  if (!player) return { ok: false, error: "Unknown player." };

  const galaxy = Math.min(
    MAP_GALAXIES,
    Math.max(1, Math.floor(opts.galaxy)),
  );
  const system = Math.min(
    MAP_SYSTEMS,
    Math.max(1, Math.floor(opts.system)),
  );
  const probesPerTarget = Math.max(
    1,
    Math.floor(opts.probesPerTarget ?? 1),
  );
  const now = opts.now ?? Date.now();

  const origin =
    (opts.originPlanetId
      ? universe.planets[opts.originPlanetId]
      : universe.planets[player.activePlanetId]) ??
    universe.planets[player.homePlanetId];
  if (!origin || origin.ownerPlayerId !== player.id) {
    return { ok: false, error: "Planet missing." };
  }

  const targets = Object.values(universe.planets).filter(
    (p) =>
      p.coords.galaxy === galaxy &&
      p.coords.system === system &&
      p.ownerPlayerId &&
      p.ownerPlayerId !== player.id,
  );

  if (targets.length < 1) {
    return {
      ok: false,
      error: "No foreign-owned planets in this system to scan.",
    };
  }

  const ships = normalizeFleetShips({ probe: probesPerTarget });
  const launched: FleetMission[] = [];
  let stoppedReason: string | undefined;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!;
    if (!hangarHasComposition(origin.ships, ships)) {
      stoppedReason = launched.length
        ? "Out of Whisper Probes in orbit."
        : "Need Whisper Probes in orbit to scan.";
      break;
    }
    const result = launchFleet(universe, {
      playerId: player.id,
      mission: "espionage",
      ships,
      targetPlanetId: target.id,
      originPlanetId: origin.id,
      now: now + i,
    });
    if (!result.ok) {
      stoppedReason = result.error;
      break;
    }
    launched.push(result.fleet);
  }

  if (launched.length < 1) {
    return {
      ok: false,
      error: stoppedReason ?? "Could not launch any scans.",
    };
  }
  return { ok: true, launched, stoppedReason };
}
