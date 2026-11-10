import type { FleetMission, PlayerState, UniverseState } from "./types.js";
import { ensureUniverseShape } from "./world-bootstrap.js";

/** True only when the save field is present. Absent means off. */
export function isVacationMode(
  player: { vacationMode?: { startedAt?: number } } | null | undefined,
): boolean {
  const startedAt = player?.vacationMode?.startedAt;
  return typeof startedAt === "number" && Number.isFinite(startedAt);
}

/** When vacation was turned on, or null when it is off. */
export function vacationStartedAt(
  player: { vacationMode?: { startedAt?: number } } | null | undefined,
): number | null {
  return isVacationMode(player) ? player!.vacationMode!.startedAt! : null;
}

/**
 * True when this Joint Strike was opened before the defender turned vacation on.
 * A missing group or an off defender is false.
 */
export function acsGroupPredatesVacation(
  universe: UniverseState,
  groupId: string | null | undefined,
  defender: PlayerState | null | undefined,
): boolean {
  const start = vacationStartedAt(defender);
  if (start == null || !groupId) return false;
  const createdAt = universe.acsGroups?.[groupId]?.createdAt;
  return typeof createdAt === "number" && createdAt < start;
}

/**
 * True when this hostile fleet was launched before vacation, or it is joining
 * a Joint Strike that was opened before vacation.
 */
export function fleetPredatesVacation(
  universe: UniverseState,
  fleet: Pick<FleetMission, "departedAt" | "acsGroupId">,
  defender: PlayerState | null | undefined,
): boolean {
  const start = vacationStartedAt(defender);
  if (start == null) return true;
  if (fleet.departedAt < start) return true;
  return acsGroupPredatesVacation(universe, fleet.acsGroupId, defender);
}

export type VacationModeResult =
  | { ok: true; player: PlayerState }
  | { ok: false; error: string };

/**
 * Turn vacation mode on or off. Off deletes the field so older saves and
 * a toggled-off commander stay absent. Does not recall fleets.
 */
export function setVacationMode(
  universe: UniverseState,
  playerId: string,
  enabled: boolean,
  now = Date.now(),
): VacationModeResult {
  ensureUniverseShape(universe);
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Player not found." };
  if (enabled) {
    if (!isVacationMode(player)) player.vacationMode = { startedAt: now };
  } else {
    delete player.vacationMode;
  }
  return { ok: true, player };
}

export const VACATION_SEND_BLOCKED =
  "Vacation mode is on. New fleets cannot launch.";

export const VACATION_ATTACK_BLOCKED =
  "That commander is in vacation mode.";

export type ClaimPlayerResult =
  | { ok: true; player: PlayerState }
  | { ok: false; error: string; code?: "not_found" | "already_claimed" | "conflict" };

/**
 * Bind an anonymous (or unlinked) player to an account id.
 * Idempotent when already linked to the same account.
 */
export function claimPlayerToAccount(
  universe: UniverseState,
  playerId: string,
  accountId: string,
): ClaimPlayerResult {
  ensureUniverseShape(universe);
  const trimmedAccount = accountId.trim();
  if (!trimmedAccount) {
    return { ok: false, error: "accountId required.", code: "not_found" };
  }
  const player = universe.players[playerId];
  if (!player) {
    return { ok: false, error: "Player not found.", code: "not_found" };
  }
  if (player.accountId && player.accountId !== trimmedAccount) {
    return {
      ok: false,
      error: "That commander is already linked to another account.",
      code: "already_claimed",
    };
  }
  const conflict = Object.values(universe.players).find(
    (p) => p.id !== player.id && p.accountId === trimmedAccount,
  );
  if (conflict) {
    return {
      ok: false,
      error: "This account already owns another commander.",
      code: "conflict",
    };
  }
  player.accountId = trimmedAccount;
  return { ok: true, player };
}

/** Find the commander bound to an account, if any. */
export function playerForAccount(
  universe: UniverseState,
  accountId: string,
): PlayerState | null {
  const trimmed = accountId.trim();
  if (!trimmed) return null;
  return (
    Object.values(universe.players).find((p) => p.accountId === trimmed) ??
    null
  );
}
