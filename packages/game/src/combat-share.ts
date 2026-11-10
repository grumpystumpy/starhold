import {
  DEFENSE_ORDER,
  DEFENSES,
  SHIP_ORDER,
  SHIPS,
} from "./catalog.js";
import type {
  CombatReport,
  CombatRoundLog,
  DefenseStock,
  FleetShips,
  HallOfFameEntry,
  HallOfShameEntry,
  PublicCombatReport,
  UniverseState,
} from "./types.js";
import { noteAchievementCount } from "./world-achievements.js";

function fmtNum(n: number): string {
  return Math.floor(n).toLocaleString("en-US");
}

function unitLine(
  ships: Partial<FleetShips> | undefined,
  defenses?: Partial<DefenseStock>,
): string {
  const parts: string[] = [];
  for (const id of SHIP_ORDER) {
    const n = ships?.[id] ?? 0;
    if (n > 0) parts.push(`${fmtNum(n)}× ${SHIPS[id].name}`);
  }
  if (defenses) {
    for (const id of DEFENSE_ORDER) {
      const n = defenses[id] ?? 0;
      if (n > 0) parts.push(`${fmtNum(n)}× ${DEFENSES[id].name}`);
    }
  }
  return parts.length ? parts.join(", ") : "none";
}

/** Mint a short share code unique within universe.reports. */
export function mintCombatShareCode(universe: UniverseState): string {
  for (let i = 0; i < 8; i++) {
    const code = `sh_${Math.random().toString(36).slice(2, 8)}`;
    const clash = Object.values(universe.reports ?? {}).some(
      (r) => r.shareCode === code,
    );
    if (!clash) return code;
  }
  return `sh_${Date.now().toString(36)}`;
}

function unitValue<T extends string>(
  order: readonly T[],
  counts: Partial<Record<T, number>> | undefined,
  costs: Record<T, { cost: { metal: number; crystal: number; deuterium: number } }>,
): number {
  return order.reduce((sum, id) => {
    const cost = costs[id].cost;
    return sum + (counts?.[id] ?? 0) * (cost.metal + cost.crystal + cost.deuterium);
  }, 0);
}

function shipLossValue(
  before: Partial<FleetShips> | undefined,
  after: Partial<FleetShips> | undefined,
): number {
  let value = 0;
  for (const id of SHIP_ORDER) {
    const lost = Math.max(0, (before?.[id] ?? 0) - (after?.[id] ?? 0));
    const cost = SHIPS[id].cost;
    value += lost * (cost.metal + cost.crystal + cost.deuterium);
  }
  return value;
}

function defenseLosses(report: CombatReport): Partial<DefenseStock> {
  if (report.defensesDestroyed) return report.defensesDestroyed;
  const lost: Partial<DefenseStock> = {};
  for (const id of DEFENSE_ORDER) {
    const count = Math.max(
      0,
      (report.defensesBefore?.[id] ?? 0) - (report.defensesAfter?.[id] ?? 0),
    );
    if (count > 0) lost[id] = count;
  }
  return lost;
}

function defenseLossValue(report: CombatReport): number {
  return unitValue(DEFENSE_ORDER, defenseLosses(report), DEFENSES);
}

/** Value of all ships and defenses destroyed during this battle. */
export function combatReportDestroyedValue(report: CombatReport): number {
  return (
    shipLossValue(report.attackerBefore, report.attackerAfter) +
    shipLossValue(report.defenderBefore, report.defenderAfter) +
    defenseLossValue(report)
  );
}

function splitValue(total: number, count: number, index: number): number {
  return Math.floor(total / count) + (index < total % count ? 1 : 0);
}

function hullsLost(
  before: Partial<FleetShips> | undefined,
  after: Partial<FleetShips> | undefined,
): number {
  let total = 0;
  for (const id of SHIP_ORDER) {
    total += Math.max(0, (before?.[id] ?? 0) - (after?.[id] ?? 0));
  }
  return total;
}

function shipTotal(ships: Partial<FleetShips> | undefined): number {
  let total = 0;
  for (const id of SHIP_ORDER) total += ships?.[id] ?? 0;
  return total;
}

function compareHallOfFame(a: HallOfFameEntry, b: HallOfFameEntry): number {
  return (
    b.destroyedValue - a.destroyedValue ||
    b.at - a.at ||
    a.attackerName.localeCompare(b.attackerName)
  );
}

function hallFameKey(entry: HallOfFameEntry): string {
  if (entry.shareCode) return `share:${entry.shareCode}`;
  const coords = entry.targetCoords;
  return `fight:${entry.at}|${entry.attackerName}|${entry.defenderName}|${entry.outcome}|${coords.galaxy}:${coords.system}:${coords.slot}`;
}

/** Persist combat counters at the same time as a newly-created report. */
export function recordCombatReport(
  universe: UniverseState,
  report: CombatReport,
): void {
  report.shareCode ??= mintCombatShareCode(universe);
  if (!universe.reports) universe.reports = {};
  universe.reports[report.id] = report;

  const groupFleetIds = report.acsGroupId
    ? universe.acsGroups?.[report.acsGroupId]?.fleetIds ?? []
    : [];
  const groupParticipants = groupFleetIds
    .map((id) => universe.fleets[id]?.ownerPlayerId)
    .filter((id): id is string => Boolean(id));
  const attackers = [
    ...new Set(
      report.acsParticipantIds?.length
        ? report.acsParticipantIds
        : groupParticipants.length
          ? groupParticipants
          : [report.attackerPlayerId],
    ),
  ];
  const attackerLoss = shipLossValue(report.attackerBefore, report.attackerAfter);
  const defenderLoss = shipLossValue(report.defenderBefore, report.defenderAfter);
  const defenseLoss = defenseLossValue(report);
  const sides = [
    {
      ids: attackers,
      lost: attackerLoss,
      destroyed: defenderLoss + defenseLoss,
      hulls: hullsLost(report.defenderBefore, report.defenderAfter),
      won: report.outcome === "attacker_win",
      lostBattle: report.outcome === "defender_win",
    },
    {
      ids: [report.defenderPlayerId],
      lost: defenderLoss,
      destroyed: attackerLoss,
      hulls: hullsLost(report.attackerBefore, report.attackerAfter),
      won: report.outcome === "defender_win",
      lostBattle: report.outcome === "attacker_win",
    },
  ];
  for (const side of sides) {
    const count = side.ids.length;
    if (!count) continue;
    side.ids.forEach((id, index) => {
      const player = universe.players[id];
      if (!player) return;
      const stats = player.combatStats ?? {
        lostValue: 0,
        destroyedValue: 0,
        wins: 0,
        losses: 0,
      };
      stats.lostValue += splitValue(side.lost, count, index);
      stats.destroyedValue += splitValue(side.destroyed, count, index);
      if (side.won) stats.wins += 1;
      if (side.lostBattle) stats.losses += 1;
      player.combatStats = stats;
      const hullShare = splitValue(side.hulls, count, index);
      if (hullShare > 0) noteAchievementCount(player, "shipsDestroyed", hullShare);
    });
  }
}

/** Explicit allowlist prevents private report fields from crossing the API. */
export function publicCombatReport(report: CombatReport): PublicCombatReport | null {
  if (!report.shareCode) return null;
  return {
    shareCode: report.shareCode,
    at: report.at,
    attackerName: report.attackerName,
    defenderName: report.defenderName,
    ...(report.originCoords ? { originCoords: { ...report.originCoords } } : {}),
    targetCoords: { ...report.targetCoords },
    attackerBefore: { ...report.attackerBefore },
    attackerAfter: { ...report.attackerAfter },
    defenderBefore: { ...report.defenderBefore },
    defenderAfter: { ...report.defenderAfter },
    defensesBefore: { ...report.defensesBefore },
    defensesAfter: { ...report.defensesAfter },
    ...(report.defensesDestroyed
      ? { defensesDestroyed: { ...report.defensesDestroyed } }
      : {}),
    loot: { ...report.loot },
    debrisCreated: { ...report.debrisCreated },
    outcome: report.outcome,
    rounds: report.rounds,
  };
}

export function combatHallOfFame(
  universe: UniverseState,
): HallOfFameEntry[] {
  return Object.values(universe.reports ?? {})
    .filter(
      (report) =>
        Number.isFinite(report.at) &&
        typeof report.attackerName === "string" &&
        typeof report.defenderName === "string" &&
        report.targetCoords != null &&
        typeof report.outcome === "string",
    )
    .map((report) => ({
      at: report.at,
      attackerName: report.attackerName,
      defenderName: report.defenderName,
      targetCoords: { ...report.targetCoords },
      outcome: report.outcome,
      destroyedValue: combatReportDestroyedValue(report),
      ...(report.shareCode ? { shareCode: report.shareCode } : {}),
    }))
    .sort(compareHallOfFame)
    .slice(0, 20);
}

/**
 * Keep fights already on the cached board, then overlay battles loaded in this
 * working set. A partial save must not drop another commander's fight.
 */
export function mergeCombatHallOfFame(
  cached: readonly HallOfFameEntry[] | undefined,
  universe: UniverseState,
): HallOfFameEntry[] {
  const merged = new Map<string, HallOfFameEntry>();
  for (const entry of cached ?? []) merged.set(hallFameKey(entry), entry);
  for (const entry of combatHallOfFame(universe)) merged.set(hallFameKey(entry), entry);
  return [...merged.values()].sort(compareHallOfFame).slice(0, 20);
}

export function combatHallOfShame(
  universe: UniverseState,
): HallOfShameEntry[] {
  return Object.values(universe.players)
    .filter((player) => (player.combatStats?.lostValue ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.combatStats?.lostValue ?? 0) - (a.combatStats?.lostValue ?? 0) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 20)
    .map((player, index) => ({
      rank: index + 1,
      playerId: player.id,
      name: player.name,
      lostValue: player.combatStats?.lostValue ?? 0,
    }));
}

/**
 * Plaintext share card for chat paste (alliance chat wires later via shareCode).
 */
export function formatCombatShareCard(
  report: CombatReport,
  viewerPlayerId?: string,
): string {
  const role =
    viewerPlayerId && report.attackerPlayerId === viewerPlayerId
      ? "Attack"
      : viewerPlayerId && report.defenderPlayerId === viewerPlayerId
        ? "Defense"
        : "Battle";
  const coords = `${report.targetCoords.galaxy}:${report.targetCoords.system}:${report.targetCoords.slot}`;
  const lines: string[] = [
    `Starhold ${role} report ${report.shareCode ? `[${report.shareCode}]` : ""}`.trim(),
    `${report.attackerName} vs ${report.defenderName} @ ${coords}`,
    `Outcome: ${report.outcome.replaceAll("_", " ")} · ${report.rounds} round${report.rounds === 1 ? "" : "s"}`,
    `Attacker ships: ${fmtNum(shipTotal(report.attackerBefore))} before, ${fmtNum(shipTotal(report.attackerAfter))} after`,
    `Defender ships: ${fmtNum(shipTotal(report.defenderBefore))} before, ${fmtNum(shipTotal(report.defenderAfter))} after`,
  ];
  const lootTotal =
    (report.loot?.metal ?? 0) +
    (report.loot?.crystal ?? 0) +
    (report.loot?.deuterium ?? 0);
  if (lootTotal > 0) {
    lines.push(
      `Loot: ${fmtNum(report.loot.metal)}/${fmtNum(report.loot.crystal)}/${fmtNum(report.loot.deuterium)}`,
    );
  }
  const debris =
    (report.debrisCreated?.metal ?? 0) + (report.debrisCreated?.crystal ?? 0);
  if (debris > 0) {
    lines.push(
      `Debris field: ${fmtNum(report.debrisCreated.metal)}/${fmtNum(report.debrisCreated.crystal)}`,
    );
  }
  if (report.xpAwarded) {
    lines.push(
      `XP: atk +${fmtNum(report.xpAwarded.attacker)} · def +${fmtNum(report.xpAwarded.defender)}`,
    );
  }
  const log: CombatRoundLog[] = report.roundLog ?? [];
  if (log.length) {
    lines.push("Rounds:");
    for (const round of log) {
      const d =
        (round.debrisThisRound?.metal ?? 0) +
        (round.debrisThisRound?.crystal ?? 0);
      lines.push(
        `  R${round.round}: atk lost ${unitLine(round.attackerLosses.ships)} · def lost ${unitLine(round.defenderLosses.ships, round.defenderLosses.defenses)}${d > 0 ? ` · debris ${fmtNum(round.debrisThisRound.metal)}/${fmtNum(round.debrisThisRound.crystal)}` : ""}`,
      );
    }
  } else {
    lines.push(report.summary);
  }
  return lines.join("\n");
}
