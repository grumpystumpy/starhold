import type { UniverseState } from "./types.js";
import { ensureEventLog } from "./world-event-log.js";

export type MessageCategory = "all" | "combat" | "spy" | "alerts";

const CATEGORIES: readonly MessageCategory[] = [
  "all",
  "combat",
  "spy",
  "alerts",
];

export function isMessageCategory(value: string): value is MessageCategory {
  return (CATEGORIES as readonly string[]).includes(value);
}

/**
 * Remove one inbox category for a player.
 * Alerts are that player's event log. Spy and expedition reports belong to
 * the player and are deleted. Combat reports are shared, so they are hidden
 * for this player and removed only when the other participant is gone or
 * has already deleted them.
 */
export function deletePlayerMessages(
  universe: UniverseState,
  playerId: string,
  category: MessageCategory,
): { ok: true; removed: number } | { ok: false; error: string } {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!isMessageCategory(category)) {
    return { ok: false, error: "Unknown message category." };
  }

  let removed = 0;
  const want = (bucket: Exclude<MessageCategory, "all">): boolean =>
    category === "all" || category === bucket;

  if (want("alerts")) {
    const log = ensureEventLog(player);
    removed += log.length;
    player.eventLog = [];
  }

  if (want("spy")) {
    for (const [id, report] of Object.entries(universe.spyReports ?? {})) {
      if (report.spyPlayerId !== playerId) continue;
      delete universe.spyReports[id];
      removed += 1;
    }
  }

  if (want("combat")) {
    if (!universe.expeditionReports) universe.expeditionReports = {};
    for (const [id, report] of Object.entries(universe.expeditionReports)) {
      if (report.playerId !== playerId) continue;
      delete universe.expeditionReports[id];
      removed += 1;
    }

    if (!Array.isArray(player.hiddenReportIds)) player.hiddenReportIds = [];
    const hidden = new Set(player.hiddenReportIds);
    for (const [id, report] of Object.entries(universe.reports ?? {})) {
      const involved =
        report.attackerPlayerId === playerId ||
        report.defenderPlayerId === playerId;
      if (!involved || hidden.has(id)) continue;
      const otherId =
        report.attackerPlayerId === playerId
          ? report.defenderPlayerId
          : report.attackerPlayerId;
      const other = otherId ? universe.players[otherId] : undefined;
      const otherHidden = other?.hiddenReportIds?.includes(id) ?? false;
      if (!other || otherHidden || otherId === playerId) {
        delete universe.reports[id];
        if (other?.hiddenReportIds) {
          other.hiddenReportIds = other.hiddenReportIds.filter((x) => x !== id);
        }
      } else if (!hidden.has(id)) {
        hidden.add(id);
        player.hiddenReportIds.push(id);
      }
      removed += 1;
    }
  }

  universe.players[playerId] = player;
  return { ok: true, removed };
}
