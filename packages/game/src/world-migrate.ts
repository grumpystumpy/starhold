import { UNIVERSE_SCHEMA_VERSION } from "./catalog.js";
import type { UniverseState } from "./types.js";
import { createUniverse, ensureUniverseShape } from "./world-bootstrap.js";

export function universeSchemaVersion(universe: UniverseState): number {
  return universe.schemaVersion ?? 1;
}

/**
 * Load-path helper:
 * - Current schema: shape-normalize in place.
 * - Schema 2 → 3 (Round 2): additive backfill (levels, …), no map reset.
 * - Older schemas (prototype / v1): full universe reset + archive.
 * Idempotent — never half-applies a map resize in place.
 */
export function migrateOrResetUniverse(
  data: UniverseState,
  opts?: { name?: string; speed?: number; fleetSpeed?: number },
): {
  universe: UniverseState;
  didReset: boolean;
  archived: UniverseState | null;
} {
  const version = universeSchemaVersion(data);
  if (version >= UNIVERSE_SCHEMA_VERSION && data.id) {
    ensureUniverseShape(data);
    return { universe: data, didReset: false, archived: null };
  }

  // Additive Round 2 bump: keep players/map, backfill missing fields.
  if (version === 2 && UNIVERSE_SCHEMA_VERSION >= 3 && data.id) {
    ensureUniverseShape(data);
    data.schemaVersion = UNIVERSE_SCHEMA_VERSION;
    return { universe: data, didReset: false, archived: null };
  }

  const fresh = createUniverse(
    opts?.name ?? data.name ?? "Alpha Drift",
    opts?.speed ?? data.speed ?? 1,
    opts?.fleetSpeed ?? data.fleetSpeed ?? data.speed ?? 1,
  );
  ensureUniverseShape(fresh);
  return { universe: fresh, didReset: true, archived: data };
}

/** Archive key helper for Upstash / KV. */
export function archiveUniverseKey(
  universeId: string,
  ts = Date.now(),
): string {
  return `starhold:universe:archive:${universeId}:${ts}`;
}
