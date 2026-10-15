import { OFFICERS } from "./catalog-officers.js";
import { SKILLS } from "./catalog-skills.js";
import { OFFICER_MAX_LEVEL, SKILL_MAX_LEVEL } from "./catalog.js";
import type { OfficerId, PlayerState } from "./types.js";

function clampLevel(level: number, max: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(max, Math.max(0, Math.floor(level)));
}

/**
 * Fill skill and officer levels on older saves.
 * An unlocked skill or an officer who is currently hired becomes level 1.
 * Higher levels already stored are kept. Nothing else on the player changes.
 */
export function ensureProgressionLevels(player: PlayerState): void {
  if (!player.skillLevels || typeof player.skillLevels !== "object") {
    player.skillLevels = {};
  }
  for (const id of player.skillsUnlocked ?? []) {
    if (!SKILLS[id]) continue;
    if ((player.skillLevels[id] ?? 0) < 1) player.skillLevels[id] = 1;
  }
  for (const [id, level] of Object.entries(player.skillLevels)) {
    if (!SKILLS[id]) {
      delete player.skillLevels[id];
      continue;
    }
    const clamped = clampLevel(level, SKILL_MAX_LEVEL);
    if (clamped < 1) delete player.skillLevels[id];
    else player.skillLevels[id] = clamped;
  }
  player.skillsUnlocked = Object.keys(player.skillLevels);

  if (!player.officerLevels || typeof player.officerLevels !== "object") {
    player.officerLevels = {};
  }
  for (const hire of player.officers ?? []) {
    if (!OFFICERS[hire.officerId]) continue;
    if ((player.officerLevels[hire.officerId] ?? 0) < 1) {
      player.officerLevels[hire.officerId] = 1;
    }
  }
  for (const [id, level] of Object.entries(player.officerLevels)) {
    const officerId = id as OfficerId;
    if (!OFFICERS[officerId]) {
      delete player.officerLevels[officerId];
      continue;
    }
    const clamped = clampLevel(level, OFFICER_MAX_LEVEL);
    if (clamped < 1) delete player.officerLevels[officerId];
    else player.officerLevels[officerId] = clamped;
  }

  if (!Array.isArray(player.hiddenReportIds)) player.hiddenReportIds = [];
}

/** Skill level, treating a legacy unlock list entry as level 1. */
export function skillLevelOf(player: PlayerState, skillId: string): number {
  const stored = player.skillLevels?.[skillId];
  if (typeof stored === "number" && stored >= 1) {
    return Math.min(SKILL_MAX_LEVEL, Math.floor(stored));
  }
  if ((player.skillsUnlocked ?? []).includes(skillId)) return 1;
  return 0;
}

/** Officer training level. A live hire with no stored level is level 1. */
export function officerLevelOf(player: PlayerState, officerId: OfficerId): number {
  const stored = player.officerLevels?.[officerId];
  if (typeof stored === "number" && stored >= 1) {
    return Math.min(OFFICER_MAX_LEVEL, Math.floor(stored));
  }
  if ((player.officers ?? []).some((hire) => hire.officerId === officerId)) {
    return 1;
  }
  return 0;
}
