import {
  PLAYER_ACTIVITY_STAMP_MS,
  PLAYER_INACTIVE_MS,
  PLAYER_LONG_INACTIVE_MS,
} from "./data/tuning.js";

/** Galaxy letter for a commander who has not loaded the game recently. */
export type InactivityMark = "i" | "I";

export interface ActivityStamp {
  lastActiveAt?: number;
}

function knownActivity(lastActiveAt: number | undefined): number | null {
  if (typeof lastActiveAt !== "number" || !Number.isFinite(lastActiveAt) || lastActiveAt <= 0) {
    return null;
  }
  return lastActiveAt;
}

/**
 * `i` at 7 days, `I` at 28. Missing, invalid, or future times are unmarked
 * so an old save is not treated as inactive.
 */
export function inactivityMark(
  lastActiveAt: number | undefined,
  now: number,
): InactivityMark | null {
  const at = knownActivity(lastActiveAt);
  if (at == null || !Number.isFinite(now)) return null;
  const age = now - at;
  if (age >= PLAYER_LONG_INACTIVE_MS) return "I";
  if (age >= PLAYER_INACTIVE_MS) return "i";
  return null;
}

/** True when an authenticated state read may write `lastActiveAt`. */
export function activityStampDue(lastActiveAt: number | undefined, now: number): boolean {
  if (!Number.isFinite(now) || now <= 0) return false;
  const at = knownActivity(lastActiveAt);
  if (at == null) return true;
  return now - at >= PLAYER_ACTIVITY_STAMP_MS;
}

/** Writes `lastActiveAt` when the hour gate is open. Returns whether it wrote. */
export function stampPlayerActivity(player: ActivityStamp, now: number): boolean {
  if (!activityStampDue(player.lastActiveAt, now)) return false;
  player.lastActiveAt = now;
  return true;
}
