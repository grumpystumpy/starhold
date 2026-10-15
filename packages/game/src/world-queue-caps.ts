import {
  QUEUE_BASE_LENGTH,
  QUEUE_HARD_CAP,
} from "./catalog.js";
import { YARD_DEPTH_SKILL_ID } from "./catalog-skills.js";
import { flatBonusSteps } from "./formulas-levels.js";
import type {
  OfficerId,
  PlayerState,
  QueueKind,
} from "./types.js";
import { pruneExpiredOfficers } from "./world-boosts.js";
import { officerLevelOf, skillLevelOf } from "./world-progression.js";

function hasActiveOfficer(
  player: PlayerState,
  officerId: OfficerId,
  now: number,
): boolean {
  return pruneExpiredOfficers(player, now).some((o) => o.officerId === officerId);
}

/** Building / ship / defense queue length for a player (Round 2 caps). */
export function yardQueueCap(player: PlayerState, now = Date.now()): number {
  const logistics = player.research.queueLogistics ?? 0;
  let cap = QUEUE_BASE_LENGTH.building + Math.floor(logistics / 2);
  if (hasActiveOfficer(player, "quartermaster", now)) {
    cap += flatBonusSteps(Math.max(1, officerLevelOf(player, "quartermaster")));
  }
  cap += flatBonusSteps(skillLevelOf(player, YARD_DEPTH_SKILL_ID));
  return Math.min(QUEUE_HARD_CAP, Math.max(1, cap));
}

/** Empire research queue length (Round 2 caps). */
export function researchQueueCap(player: PlayerState, now = Date.now()): number {
  const logistics = player.research.queueLogistics ?? 0;
  let cap = QUEUE_BASE_LENGTH.research + Math.floor(logistics / 3);
  if (hasActiveOfficer(player, "archivist", now)) {
    cap += flatBonusSteps(Math.max(1, officerLevelOf(player, "archivist")));
  }
  return Math.min(QUEUE_HARD_CAP, Math.max(1, cap));
}

export function queueCapForKind(
  player: PlayerState,
  kind: QueueKind,
  now = Date.now(),
): number {
  switch (kind) {
    case "building":
    case "ship":
    case "defense":
      return yardQueueCap(player, now);
    case "research":
      return researchQueueCap(player, now);
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unhandled queue kind: ${_exhaustive}`);
    }
  }
}
