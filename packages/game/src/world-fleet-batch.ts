import { EXPEDITION_SLOT, MAP_GALAXIES, MAP_SYSTEMS } from "./catalog.js";
import { fleetShipCount, normalizeFleetShips } from "./formulas.js";
import type {
  FleetMission,
  FleetShips,
  UniverseState,
} from "./types.js";
import { ensureUniverseShape } from "./world-bootstrap.js";
import {
  expeditionPresetShips,
  getFleetPreset,
} from "./world-fleet-presets.js";
import { launchFleet } from "./world-launch.js";

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

  const now = opts.now ?? Date.now();
  const presetId = opts.presetId ?? "expedition";
  const fromPreset = getFleetPreset(player, presetId);
  const ships = normalizeFleetShips(
    opts.ships ??
      fromPreset?.ships ??
      expeditionPresetShips(player),
  );
  if (fleetShipCount(ships) < 1) {
    return { ok: false, error: "Expedition preset has no ships." };
  }

  const origin =
    (opts.originPlanetId
      ? universe.planets[opts.originPlanetId]
      : universe.planets[player.activePlanetId]) ??
    universe.planets[player.homePlanetId];
  if (!origin || origin.ownerPlayerId !== player.id) {
    return { ok: false, error: "Planet missing." };
  }

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

  // Hard cap: avoid pathological loops if slots are huge.
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
