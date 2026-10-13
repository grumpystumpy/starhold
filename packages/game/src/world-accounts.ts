import type { PlayerState, UniverseState } from "./types.js";
import { ensureUniverseShape } from "./world-bootstrap.js";

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
