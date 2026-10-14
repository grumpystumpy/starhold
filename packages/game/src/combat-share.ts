import { DEFENSE_ORDER, DEFENSES, SHIP_ORDER, SHIPS } from "./catalog.js";
import type {
  CombatReport,
  CombatRoundLog,
  DefenseStock,
  FleetShips,
  UniverseState,
} from "./types.js";

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
