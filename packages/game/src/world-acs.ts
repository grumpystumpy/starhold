import {
  ACS_GROUP_PRUNE_MS,
  ACS_HOLD_MAX_MS,
  ACS_JOIN_WINDOW_MS,
  ACS_MAX_FLEETS,
  ACS_MIN_FLEETS_TO_RESOLVE,
  SHIPS,
  SHIP_ORDER,
} from "./catalog.js";
import {
  fleetShipCount,
  flightSecondsOneWay,
  levelBonuses,
  normalizeFleetShips,
} from "./formulas.js";
import type {
  AcsGroup,
  Coordinates,
  FleetMission,
  FleetShips,
  MissionType,
  Resources,
  UniverseState,
} from "./types.js";
import { resolveRaidArrival } from "./world-arrival-raid.js";
import { playerBoosts } from "./world-boosts.js";
import { emptyCargo, ensureUniverseShape } from "./world-bootstrap.js";
import { resolvePirateRaidArrival } from "./world-pirates.js";
export type AcsActionResult =
  | { ok: true; fleet?: FleetMission }
  | { ok: false; error: string };

function cargoCap(ships: FleetShips): number {
  let cap = 0;
  for (const id of SHIP_ORDER) {
    cap += (ships[id] ?? 0) * SHIPS[id].cargo;
  }
  return cap;
}

function acsMap(universe: UniverseState): Record<string, AcsGroup> {
  if (!universe.acsGroups) universe.acsGroups = {};
  return universe.acsGroups;
}

function sameCoords(a: Coordinates, b: Coordinates): boolean {
  return a.galaxy === b.galaxy && a.system === b.system && a.slot === b.slot;
}

function mergeShips(parts: FleetShips[]): FleetShips {
  const out = normalizeFleetShips({});
  for (const ships of parts) {
    for (const id of SHIP_ORDER) {
      out[id] = (out[id] ?? 0) + (ships[id] ?? 0);
    }
  }
  return out;
}

function shipCount(ships: FleetShips): number {
  return fleetShipCount(ships);
}

/** Split combined survivor ships back onto member fleets by pre-fight share. */
function splitSurvivors(
  beforeParts: FleetShips[],
  afterCombined: FleetShips,
): FleetShips[] {
  const totals = beforeParts.map(shipCount);
  const totalBefore = totals.reduce((a, b) => a + b, 0);
  if (totalBefore <= 0) {
    return beforeParts.map(() => normalizeFleetShips({}));
  }
  const out: FleetShips[] = beforeParts.map(() => normalizeFleetShips({}));
  for (const id of SHIP_ORDER) {
    let remaining = afterCombined[id] ?? 0;
    for (let i = 0; i < beforeParts.length; i++) {
      if (i === beforeParts.length - 1) {
        out[i][id] = remaining;
        break;
      }
      const share = Math.floor(
        ((afterCombined[id] ?? 0) * totals[i]) / totalBefore,
      );
      out[i][id] = share;
      remaining -= share;
    }
  }
  return out;
}

function splitLootByCargo(
  loot: Resources,
  fleets: FleetMission[],
): Resources[] {
  const caps = fleets.map((f) => cargoCap(f.ships));
  const totalCap = caps.reduce((a, b) => a + b, 0);
  if (totalCap <= 0) {
    return fleets.map(() => emptyCargo());
  }
  const out: Resources[] = fleets.map(() => emptyCargo());
  for (const key of ["metal", "crystal", "deuterium"] as const) {
    let remaining = loot[key];
    for (let i = 0; i < fleets.length; i++) {
      if (i === fleets.length - 1) {
        out[i][key] = remaining;
        break;
      }
      const share = Math.floor((loot[key] * caps[i]) / totalCap);
      out[i][key] = share;
      remaining -= share;
    }
  }
  return out;
}

export function listOpenAcsForAlliance(
  universe: UniverseState,
  allianceId: string | null | undefined,
): AcsGroup[] {
  if (!allianceId) return [];
  ensureUniverseShape(universe);
  return Object.values(acsMap(universe)).filter(
    (g) => g.allianceId === allianceId && g.status === "open",
  );
}

export function maybeLockAcsGroup(
  universe: UniverseState,
  group: AcsGroup,
  now: number,
): void {
  if (group.status !== "open") return;
  const full = group.fleetIds.length >= ACS_MAX_FLEETS;
  const windowClosed = now >= group.joinClosesAt;
  if (!full && !windowClosed) return;
  lockAcsGroup(universe, group, now);
}

export function lockAcsGroup(
  universe: UniverseState,
  group: AcsGroup,
  now: number,
): void {
  if (group.status !== "open") return;
  group.status = "locked";
  let maxArrive = now;
  for (const fid of group.fleetIds) {
    const f = universe.fleets[fid];
    if (f) maxArrive = Math.max(maxArrive, f.arrivesAt);
  }
  group.resolvesAt = maxArrive;
  group.joinClosesAt = Math.min(group.joinClosesAt, now);
  acsMap(universe)[group.id] = group;
}

function holdFeasible(
  group: AcsGroup,
  newFleetArrivesAt: number,
  existingFleets: FleetMission[],
): boolean {
  const arrivals = existingFleets.map((f) => f.arrivesAt);
  arrivals.push(newFleetArrivesAt);
  const resolveAt = Math.max(...arrivals);
  for (const at of arrivals) {
    if (resolveAt - at > ACS_HOLD_MAX_MS) return false;
  }
  return true;
}

/** Attach a just-launched fleet as ACS leader (creates group) or joiner. */
export function attachFleetToAcs(
  universe: UniverseState,
  fleet: FleetMission,
  opts: {
    openAcs?: boolean;
    acsGroupId?: string;
  },
  now: number,
): AcsActionResult {
  ensureUniverseShape(universe);
  const player = universe.players[fleet.ownerPlayerId];
  if (!player?.allianceId) {
    return { ok: false, error: "Join an alliance to use Joint Strike (ACS)." };
  }
  if (fleet.mission !== "raid" && fleet.mission !== "pirateRaid") {
    return { ok: false, error: "ACS only supports raid and pirate raids." };
  }

  if (opts.acsGroupId) {
    const group = acsMap(universe)[opts.acsGroupId];
    if (!group || group.status !== "open") {
      return { ok: false, error: "ACS group is not open for joins." };
    }
    if (group.allianceId !== player.allianceId) {
      return { ok: false, error: "ACS is limited to your alliance." };
    }
    if (group.mission !== fleet.mission) {
      return { ok: false, error: "ACS mission mismatch." };
    }
    if (!sameCoords(group.targetCoords, fleet.targetCoords)) {
      return { ok: false, error: "ACS target mismatch." };
    }
    if (
      group.targetPlanetId !== fleet.targetPlanetId ||
      (group.targetPirateBaseId ?? null) !== (fleet.targetPirateBaseId ?? null)
    ) {
      return { ok: false, error: "ACS target mismatch." };
    }
    if (group.fleetIds.length >= ACS_MAX_FLEETS) {
      return { ok: false, error: `ACS is full (${ACS_MAX_FLEETS} fleets).` };
    }
    if (fleet.targetPlayerId) {
      const defender = universe.players[fleet.targetPlayerId];
      if (defender?.allianceId && defender.allianceId === player.allianceId) {
        return { ok: false, error: "Cannot ACS against your own alliance." };
      }
    }
    const members = group.fleetIds
      .map((id) => universe.fleets[id])
      .filter((f): f is FleetMission => Boolean(f));
    if (!holdFeasible(group, fleet.arrivesAt, members)) {
      return {
        ok: false,
        error: "Join would force a hold longer than the ACS hold limit.",
      };
    }
    group.fleetIds.push(fleet.id);
    fleet.acsGroupId = group.id;
    maybeLockAcsGroup(universe, group, now);
    acsMap(universe)[group.id] = group;
    universe.fleets[fleet.id] = fleet;
    return { ok: true, fleet };
  }

  if (!opts.openAcs) return { ok: true, fleet };

  if (fleet.targetPlayerId) {
    const defender = universe.players[fleet.targetPlayerId];
    if (defender?.allianceId && defender.allianceId === player.allianceId) {
      return { ok: false, error: "Cannot ACS against your own alliance." };
    }
  }

  const id = `acs_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const group: AcsGroup = {
    id,
    allianceId: player.allianceId,
    leaderPlayerId: player.id,
    mission: fleet.mission,
    targetCoords: { ...fleet.targetCoords },
    targetPlanetId: fleet.targetPlanetId,
    targetPlayerId: fleet.targetPlayerId,
    targetPirateBaseId: fleet.targetPirateBaseId ?? null,
    fleetIds: [fleet.id],
    createdAt: now,
    joinClosesAt: now + ACS_JOIN_WINDOW_MS,
    resolvesAt: null,
    status: "open",
  };
  fleet.acsGroupId = id;
  acsMap(universe)[id] = group;
  universe.fleets[fleet.id] = fleet;
  return { ok: true, fleet };
}

export function leaveAcsFleet(
  universe: UniverseState,
  playerId: string,
  fleetId: string,
  now = Date.now(),
): AcsActionResult {
  ensureUniverseShape(universe);
  const fleet = universe.fleets[fleetId];
  if (!fleet || fleet.ownerPlayerId !== playerId) {
    return { ok: false, error: "Fleet not found." };
  }
  if (!fleet.acsGroupId) {
    return { ok: false, error: "Fleet is not in an ACS group." };
  }
  const group = acsMap(universe)[fleet.acsGroupId];
  if (!group || group.status === "resolved" || group.status === "cancelled") {
    fleet.acsGroupId = null;
    return { ok: true, fleet };
  }
  if (group.status === "locked" && (group.resolvesAt ?? 0) <= now) {
    return { ok: false, error: "ACS is already resolving." };
  }
  group.fleetIds = group.fleetIds.filter((id) => id !== fleetId);
  fleet.acsGroupId = null;
  if (fleet.phase === "holding") {
    // Return home without fighting.
    fleet.phase = "returning";
    fleet.arrivesAt = now + Math.max(1, fleet.arrivesAt - fleet.departedAt);
  }
  if (group.fleetIds.length < ACS_MIN_FLEETS_TO_RESOLVE) {
    group.status = "cancelled";
  } else if (group.status === "locked") {
    let maxArrive = now;
    for (const fid of group.fleetIds) {
      const f = universe.fleets[fid];
      if (f) maxArrive = Math.max(maxArrive, f.arrivesAt);
    }
    group.resolvesAt = maxArrive;
  }
  acsMap(universe)[group.id] = group;
  universe.fleets[fleet.id] = fleet;
  return { ok: true, fleet };
}

export function lockAcsEarly(
  universe: UniverseState,
  playerId: string,
  acsGroupId: string,
  now = Date.now(),
): AcsActionResult {
  ensureUniverseShape(universe);
  const group = acsMap(universe)[acsGroupId];
  if (!group) return { ok: false, error: "ACS group not found." };
  if (group.leaderPlayerId !== playerId) {
    return { ok: false, error: "Only the ACS leader can lock early." };
  }
  if (group.status !== "open") {
    return { ok: false, error: "ACS is not open." };
  }
  lockAcsGroup(universe, group, now);
  return { ok: true };
}

/**
 * Called when an ACS fleet reaches target outbound.
 * Returns true if the fleet entered holding (caller should not fight yet).
 */
export function handleAcsOutboundArrival(
  universe: UniverseState,
  fleet: FleetMission,
  now: number,
): boolean {
  if (!fleet.acsGroupId) return false;
  const group = acsMap(universe)[fleet.acsGroupId];
  if (!group || group.status === "cancelled" || group.status === "resolved") {
    // Another fleet already resolved, or group cancelled — do not solo-fight.
    fleet.acsGroupId = null;
    if (
      (fleet.phase === "holding" || fleet.phase === "outbound") &&
      !fleet.reportId
    ) {
      fleet.phase = "returning";
      fleet.arrivesAt = now + 1;
    }
    universe.fleets[fleet.id] = fleet;
    return true;
  }
  maybeLockAcsGroup(universe, group, now);
  if (group.status === "open") {
    // First arrival while still open — lock so late joins stop.
    lockAcsGroup(universe, group, now);
  }
  const resolvesAt = group.resolvesAt ?? now;
  if (now < resolvesAt) {
    fleet.phase = "holding";
    fleet.arrivesAt = resolvesAt;
    universe.fleets[fleet.id] = fleet;
    return true;
  }
  resolveAcsGroup(universe, group, now);
  return true;
}

export function resolveAcsGroup(
  universe: UniverseState,
  group: AcsGroup,
  now: number,
): void {
  if (group.status === "resolved" || group.status === "cancelled") return;
  maybeLockAcsGroup(universe, group, now);
  if (group.status === "open") lockAcsGroup(universe, group, now);

  const fleets = group.fleetIds
    .map((id) => universe.fleets[id])
    .filter((f): f is FleetMission => Boolean(f));
  if (fleets.length < ACS_MIN_FLEETS_TO_RESOLVE) {
    group.status = "cancelled";
    acsMap(universe)[group.id] = group;
    return;
  }

  const beforeParts = fleets.map((f) => ({ ...f.ships }));
  const combined = mergeShips(beforeParts);
  const lead = fleets[0];
  const combinedFleet: FleetMission = {
    ...lead,
    id: lead.id,
    ships: combined,
    cargo: emptyCargo(),
    reportId: null,
  };

  if (group.mission === "pirateRaid") {
    resolvePirateRaidArrival(universe, combinedFleet, now);
  } else {
    const target = group.targetPlanetId
      ? universe.planets[group.targetPlanetId]
      : null;
    if (!target) {
      group.status = "cancelled";
      for (const f of fleets) {
        f.acsGroupId = null;
        f.phase = "returning";
        f.arrivesAt = now + 1;
      }
      acsMap(universe)[group.id] = group;
      return;
    }
    resolveRaidArrival(universe, combinedFleet, target, now);
  }

  const afterParts = splitSurvivors(beforeParts, combinedFleet.ships);
  for (let i = 0; i < fleets.length; i++) {
    fleets[i].ships = afterParts[i];
    fleets[i].reportId = combinedFleet.reportId;
    fleets[i].acsGroupId = group.id;
  }
  const lootShares = splitLootByCargo(combinedFleet.cargo, fleets);
  for (let i = 0; i < fleets.length; i++) {
    fleets[i].cargo = lootShares[i];
  }

  if (combinedFleet.reportId && universe.reports[combinedFleet.reportId]) {
    const report = universe.reports[combinedFleet.reportId];
    const names = fleets
      .map((f) => universe.players[f.ownerPlayerId]?.name ?? "Unknown")
      .join(", ");
    report.acsGroupId = group.id;
    report.acsParticipantIds = fleets.map((f) => f.ownerPlayerId);
    report.summary = `Joint Strike (ACS) [${names}]: ${report.summary}`;
    report.missionId = group.id;
  }

  group.status = "resolved";
  acsMap(universe)[group.id] = group;

  for (const f of fleets) {
    if (fleetShipCount(f.ships) <= 0) {
      delete universe.fleets[f.id];
      continue;
    }
    const origin = universe.planets[f.originPlanetId];
    const owner = universe.players[f.ownerPlayerId];
    const drive = owner?.research.combustionDrive ?? 0;
    const boosts = playerBoosts(owner, now);
    const lb = levelBonuses(owner?.level ?? 1);
    const speed =
      universe.fleetSpeed *
      Math.max(0.01, boosts.fleetSpeed) /
      Math.max(0.01, lb.fleetTime);
    const returnSecs = origin
      ? flightSecondsOneWay(f.targetCoords, origin.coords, f.ships, speed, drive)
      : 1;
    f.phase = "returning";
    f.arrivesAt = now + returnSecs * 1000;
    f.acsGroupId = null;
    universe.fleets[f.id] = f;
  }
}

export function tickAcsGroups(universe: UniverseState, now: number): void {
  ensureUniverseShape(universe);
  for (const group of Object.values(acsMap(universe))) {
    if (group.status === "open") {
      maybeLockAcsGroup(universe, group, now);
    }
    if (
      (group.status === "resolved" || group.status === "cancelled") &&
      now - group.createdAt > ACS_GROUP_PRUNE_MS
    ) {
      delete acsMap(universe)[group.id];
    }
  }
}

export function isAcsMission(mission: MissionType): mission is "raid" | "pirateRaid" {
  return mission === "raid" || mission === "pirateRaid";
}
