import type { PlayerState, UniverseState } from "./types.js";
import { ensureUniverseShape } from "./world-bootstrap.js";

/** True only when the save field is explicitly on. Absent means off. */
export function isVacationMode(
  player: { vacationMode?: boolean } | null | undefined,
): boolean {
  return player?.vacationMode === true;
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
): VacationModeResult {
  ensureUniverseShape(universe);
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Player not found." };
  if (enabled) player.vacationMode = true;
  else delete player.vacationMode;
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
