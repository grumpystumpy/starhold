import { UNIVERSE_SCHEMA_VERSION } from "./catalog.js";
import type { UniverseState } from "./types.js";
import { createUniverse, ensureUniverseShape } from "./world-bootstrap.js";

export function universeSchemaVersion(universe: UniverseState): number {
  return universe.schemaVersion ?? 1;
}

/**
 * Load-path helper: current schema keeps the blob (shape-normalized);
 * older schemas (prototype 1×9×8) trigger a full universe reset.
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
