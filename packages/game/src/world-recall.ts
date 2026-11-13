import type { FleetMission, UniverseState } from "./types.js";
import { leaveAcsFleet } from "./world-acs.js";
import { advanceUniverse } from "./world-arrival.js";
import { ensureUniverseShape } from "./world-bootstrap.js";

export type RecallFleetResult =
  | { ok: true; fleet: FleetMission }
  | { ok: false; error: string };

const NPC_OWNERS = new Set(["npc_pirates", "npc_aliens"]);

function isNpcOrPirateFleet(fleet: FleetMission): boolean {
  return NPC_OWNERS.has(fleet.ownerPlayerId) || Boolean(fleet.originPirateBaseId);
}

/**
 * Turn the caller's outbound fleet around. It arrives home after the time it
 * has already flown. Fuel already spent stays spent. Joint Strike fleets
 * detach through `leaveAcsFleet` first so a group under the minimum cancels.
 */
export function recallFleet(
  universe: UniverseState,
  playerId: string,
  fleetId: string,
  now = Date.now(),
): RecallFleetResult {
  ensureUniverseShape(universe);
  advanceUniverse(universe, now);
  const fleet = universe.fleets[fleetId];
  if (!fleet || fleet.ownerPlayerId !== playerId) {
    return { ok: false, error: "Fleet not found." };
  }
  if (isNpcOrPirateFleet(fleet)) {
    return { ok: false, error: "NPC fleets cannot be recalled." };
  }
  if (fleet.reportId) {
    return { ok: false, error: "Fleet is already resolved." };
  }
  if (fleet.phase !== "outbound") {
    return { ok: false, error: "Only an outbound fleet can be recalled." };
  }
  if (fleet.acsGroupId) {
    const left = leaveAcsFleet(universe, playerId, fleetId, now);
    if (!left.ok) return left;
  }
  const live = universe.fleets[fleetId];
  if (!live || live.ownerPlayerId !== playerId) {
    return { ok: false, error: "Fleet not found." };
  }
  if (live.phase !== "outbound") {
    return { ok: false, error: "Only an outbound fleet can be recalled." };
  }
  const flown = Math.max(1, now - live.departedAt);
  live.phase = "returning";
  live.arrivesAt = now + flown;
  universe.fleets[live.id] = live;
  return { ok: true, fleet: live };
}
