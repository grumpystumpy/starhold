import { UNIVERSE_SCHEMA_VERSION } from "./catalog.js";
import { emptyPlayerClass } from "./formulas-round3.js";
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
 * Additive Round 3 migrator: playerClass defaults + gravityWell research.
 * Idempotent when schemaVersion >= 4. No map reset.
 */
export function migrateUniverseV3ToV4(universe: UniverseState): UniverseState {
  if ((universe.schemaVersion ?? 0) >= 4) {
    ensureUniverseShape(universe);
    return universe;
  }

  // Ensure v3 shape first if somehow still on 2.
  if ((universe.schemaVersion ?? 0) < 3) {
    migrateUniverseV2ToV3(universe);
  }

  for (const player of Object.values(universe.players)) {
    if (!player.playerClass) player.playerClass = emptyPlayerClass();
    if (player.research && player.research.gravityWell == null) {
      player.research.gravityWell = 0;
    }
  }

  for (const planet of Object.values(universe.planets)) {
    if (planet.buildings.mantleLoom == null) planet.buildings.mantleLoom = 0;
    if (planet.buildings.rigFoundry == null) planet.buildings.rigFoundry = 0;
    if (planet.buildings.riftSiphon == null) planet.buildings.riftSiphon = 0;
    if (planet.buildings.echoVault == null) planet.buildings.echoVault = 0;
    if (planet.buildings.anomalyForge == null) planet.buildings.anomalyForge = 0;
    if (planet.buildings.driftBeacon == null) planet.buildings.driftBeacon = 0;
    if (planet.flags?.mini && !planet.flags.miniKind) {
      planet.flags.miniKind = "standard";
    }
    if (planet.flags?.mini && planet.lastDriftAt == null) {
      planet.lastDriftAt = planet.lastTickAt ?? Date.now();
    }
  }

  universe.schemaVersion = 4;
  ensureUniverseShape(universe);
  return universe;
}

/**
 * Load-path helper:
 * - schema >= 4: shape-normalize in place
 * - schema 3: additive migrate to 4
 * - schema 2: additive migrate to 3 then 4
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

  if (version === 3 && data.id) {
    migrateUniverseV3ToV4(data);
    return { universe: data, didReset: false, archived: null };
  }

  if (version === 2 && data.id) {
    migrateUniverseV2ToV3(data);
    migrateUniverseV3ToV4(data);
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
