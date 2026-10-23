import { clampToStorage } from "./formulas.js";
import type {
  PlanetState,
  PlayerState,
  QueueKind,
  QueueItemBase,
  UniverseState,
} from "./types.js";
import { advanceUniverse } from "./world-arrival.js";
import { activePlanet } from "./world-bootstrap.js";
import { storageForPlanet } from "./world-boosts.js";
import type { ActionResult } from "./world-queues.js";
import {
  ensureQueueFrontStarted,
  refundResources,
} from "./world-queue-normalize.js";

function queueOnPlanet(
  planet: PlanetState,
  kind: Exclude<QueueKind, "research">,
): QueueItemBase[] {
  switch (kind) {
    case "building":
      return planet.buildQueue;
    case "ship":
      return planet.shipQueue;
    case "defense":
      return planet.defenseQueue;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unhandled planet queue kind: ${_exhaustive}`);
    }
  }
}

function setQueueOnPlanet(
  planet: PlanetState,
  kind: Exclude<QueueKind, "research">,
  queue: QueueItemBase[],
): void {
  switch (kind) {
    case "building":
      planet.buildQueue = queue as PlanetState["buildQueue"];
      break;
    case "ship":
      planet.shipQueue = queue as PlanetState["shipQueue"];
      break;
    case "defense":
      planet.defenseQueue = queue as PlanetState["defenseQueue"];
      break;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unhandled planet queue kind: ${_exhaustive}`);
    }
  }
}

function applyRefundToPlanet(
  universe: UniverseState,
  planet: PlanetState,
  cost: QueueItemBase["paidCost"],
  fraction: number,
  now: number,
): void {
  const refunded = refundResources(planet.resources, cost, fraction);
  planet.resources = clampToStorage(refunded, storageForPlanet(universe, planet, now));
}

/**
 * Cancel a queued item.
 * Front (started): 50% refund. Non-front / not started: full refund.
 * Next item starts immediately when front is cancelled.
 */
export function cancelQueueItem(
  universe: UniverseState,
  playerId: string,
  opts: {
    kind: QueueKind;
    itemId: string;
    planetId?: string;
  },
  now = Date.now(),
): ActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  advanceUniverse(universe, now);

  if (opts.kind === "research") {
    const queue = player.researchQueue;
    const index = queue.findIndex((q) => q.id === opts.itemId);
    if (index < 0) return { ok: false, error: "Queue item not found." };
    const item = queue[index]!;
    const planet = activePlanet(universe, player);
    if (!planet) return { ok: false, error: "Planet missing." };
    const fraction =
      index === 0 && item.startedAt != null && item.startedAt < now ? 0.5 : 1;
    applyRefundToPlanet(universe, planet, item.paidCost, fraction, now);
    queue.splice(index, 1);
    ensureQueueFrontStarted(queue, now);
    player.researchQueue = queue;
    universe.players[player.id] = player;
    universe.planets[planet.id] = planet;
    return { ok: true, planet };
  }

  const planetId = opts.planetId || player.activePlanetId || player.homePlanetId;
  if (!player.planetIds.includes(planetId)) {
    return { ok: false, error: "You do not own that planet." };
  }
  const planet = universe.planets[planetId];
  if (!planet) return { ok: false, error: "Planet missing." };

  const queue = queueOnPlanet(planet, opts.kind);
  const index = queue.findIndex((q) => q.id === opts.itemId);
  if (index < 0) return { ok: false, error: "Queue item not found." };
  const item = queue[index]!;
  const fraction =
    index === 0 && item.startedAt != null && item.startedAt < now ? 0.5 : 1;
  applyRefundToPlanet(universe, planet, item.paidCost, fraction, now);
  queue.splice(index, 1);
  ensureQueueFrontStarted(queue, now);
  setQueueOnPlanet(planet, opts.kind, queue);
  universe.planets[planet.id] = planet;
  return { ok: true, planet };
}

/**
 * Reorder a queue. Front item id must remain first (locked while started).
 */
export function reorderQueue(
  universe: UniverseState,
  playerId: string,
  opts: {
    kind: QueueKind;
    orderedIds: string[];
    planetId?: string;
  },
  now = Date.now(),
): ActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  advanceUniverse(universe, now);

  const applyReorder = <T extends QueueItemBase>(
    queue: T[],
    orderedIds: string[],
  ): { ok: true; queue: T[] } | { ok: false; error: string } => {
    if (queue.length === 0) {
      return { ok: false, error: "Queue is empty." };
    }
    if (orderedIds.length !== queue.length) {
      return { ok: false, error: "orderedIds must list every queue item once." };
    }
    const frontId = queue[0]!.id;
    if (orderedIds[0] !== frontId) {
      return {
        ok: false,
        error: "Front queue item is locked — cancel it instead of reordering.",
      };
    }
    const byId = new Map(queue.map((q) => [q.id, q]));
    if (new Set(orderedIds).size !== orderedIds.length) {
      return { ok: false, error: "orderedIds must be unique." };
    }
    const next: T[] = [];
    for (const id of orderedIds) {
      const item = byId.get(id);
      if (!item) return { ok: false, error: "orderedIds includes unknown item." };
      next.push(item);
    }
    ensureQueueFrontStarted(next, now);
    return { ok: true, queue: next };
  };

  if (opts.kind === "research") {
    const result = applyReorder(player.researchQueue, opts.orderedIds);
    if (!result.ok) return result;
    player.researchQueue = result.queue;
    universe.players[player.id] = player;
    const planet = activePlanet(universe, player);
    if (!planet) return { ok: false, error: "Planet missing." };
    return { ok: true, planet };
  }

  const planetId = opts.planetId || player.activePlanetId || player.homePlanetId;
  if (!player.planetIds.includes(planetId)) {
    return { ok: false, error: "You do not own that planet." };
  }
  const planet = universe.planets[planetId];
  if (!planet) return { ok: false, error: "Planet missing." };

  const current = queueOnPlanet(planet, opts.kind);
  const result = applyReorder(current, opts.orderedIds);
  if (!result.ok) return result;
  setQueueOnPlanet(planet, opts.kind, result.queue);
  universe.planets[planet.id] = planet;
  return { ok: true, planet };
}

export function stampQueueView(
  player: PlayerState,
  planet: PlanetState,
  now: number,
): void {
  const stamp = <T extends QueueItemBase>(queue: T[]): T[] => {
    let cursor = now;
    return queue.map((item, index) => {
      let remaining: number;
      if (index === 0 && item.startedAt != null) {
        remaining = Math.max(0, Math.ceil((item.completesAt - now) / 1000));
        cursor = Math.max(cursor, item.completesAt);
      } else {
        remaining = item.workSeconds;
        const startAt = cursor;
        item.completesAt = startAt + item.workSeconds * 1000;
        cursor = item.completesAt;
      }
      return { ...item, remainingSeconds: remaining };
    });
  };
  planet.buildQueue = stamp(planet.buildQueue);
  planet.shipQueue = stamp(planet.shipQueue);
  planet.defenseQueue = stamp(planet.defenseQueue);
  player.researchQueue = stamp(player.researchQueue);
}
