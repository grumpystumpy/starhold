import { UNIVERSE_SCHEMA_VERSION } from "./catalog.js";
import type { PirateBase, UniverseState } from "./types.js";
import { createUniverse, ensureUniverseShape } from "./world-bootstrap.js";
import {
  normalizeBuildQueue,
  normalizeDefenseQueue,
  normalizeResearchQueue,
  normalizeShipQueue,
} from "./world-queue-normalize.js";

export function universeSchemaVersion(universe: UniverseState): number {
  return universe.schemaVersion ?? 1;
}

/**
 * Additive Round 2 migrator: wrap legacy single queues into arrays,
 * seed progress / mini / occupation stubs, pirate level alias.
 * Idempotent when schemaVersion >= 3.
 */
export function migrateUniverseV2ToV3(
  universe: UniverseState,
  now = Date.now(),
): UniverseState {
  if ((universe.schemaVersion ?? 0) >= 3) {
    ensureUniverseShape(universe);
    return universe;
  }

  for (const player of Object.values(universe.players)) {
    player.researchQueue = normalizeResearchQueue(player.researchQueue, now);
    if ((player as { level?: number }).level == null) {
      (player as { level?: number }).level = 1;
    }
    if ((player as { xp?: number }).xp == null) {
      (player as { xp?: number }).xp = 0;
    }
    if ((player as { xpTotal?: number }).xpTotal == null) {
      (player as { xpTotal?: number }).xpTotal = 0;
    }
    if ((player as { discoveredMiniIds?: string[] }).discoveredMiniIds == null) {
      (player as { discoveredMiniIds?: string[] }).discoveredMiniIds = [];
    }
    if (player.research && player.research.queueLogistics == null) {
      player.research.queueLogistics = 0;
    }
  }

  for (const planet of Object.values(universe.planets)) {
    planet.buildQueue = normalizeBuildQueue(planet.buildQueue, now);
    planet.shipQueue = normalizeShipQueue(planet.shipQueue, now);
    planet.defenseQueue = normalizeDefenseQueue(planet.defenseQueue, now);
  }

  if ((universe as { occupations?: Record<string, unknown> }).occupations == null) {
    (universe as { occupations?: Record<string, unknown> }).occupations = {};
  }
  if ((universe as { miniPlanetIds?: string[] }).miniPlanetIds == null) {
    (universe as { miniPlanetIds?: string[] }).miniPlanetIds = [];
  }

  if (universe.pirateBases) {
    for (const base of Object.values(universe.pirateBases) as PirateBase[]) {
      const tier = base.tier ?? 0;
      if ((base as { level?: number }).level == null) {
        (base as { level?: number }).level = tier;
      }
      if ((base as { techs?: unknown }).techs == null) {
        (base as { techs?: unknown }).techs = {
          weapons: 0,
          armour: 0,
          shielding: 0,
        };
      }
      if ((base as { lastFreeSpawnAt?: number }).lastFreeSpawnAt == null) {
        (base as { lastFreeSpawnAt?: number }).lastFreeSpawnAt =
          base.lastGrewAt ?? now;
      }
    }
  }

  universe.schemaVersion = 3;
  ensureUniverseShape(universe);
  return universe;
}

/**
 * Load-path helper:
 * - schema >= 3: shape-normalize in place
 * - schema 2: additive migrate to 3 (queues + levels; no archive / no map reset)
 * - schema < 2: full universe reset (prototype 1×9×8 → contract map)
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

  if (version === 2 && data.id) {
    migrateUniverseV2ToV3(data);
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
