import type {
  BuildQueueItem,
  DefenseQueueItem,
  PlanetState,
  PlayerState,
  QueueItemBase,
  ResearchQueueItem,
  Resources,
  ShipQueueItem,
} from "./types.js";

export function newQueueItemId(now = Date.now()): string {
  return `q_${now.toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyPaidCost(): Resources {
  return { metal: 0, crystal: 0, deuterium: 0 };
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function hydrateBase(
  raw: Partial<QueueItemBase> & { completesAt?: number },
  kind: QueueItemBase["kind"],
  now: number,
): Pick<
  QueueItemBase,
  | "id"
  | "kind"
  | "enqueuedAt"
  | "completesAt"
  | "workSeconds"
  | "startedAt"
  | "paidCost"
> {
  const completesAt = typeof raw.completesAt === "number" ? raw.completesAt : now;
  const workSeconds =
    typeof raw.workSeconds === "number" && raw.workSeconds > 0
      ? raw.workSeconds
      : Math.max(1, Math.ceil(Math.max(0, completesAt - now) / 1000) || 1);
  const startedAt =
    raw.startedAt === null
      ? null
      : typeof raw.startedAt === "number"
        ? raw.startedAt
        : now;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newQueueItemId(now),
    kind,
    enqueuedAt:
      typeof raw.enqueuedAt === "number" ? raw.enqueuedAt : now,
    completesAt,
    workSeconds,
    startedAt,
    paidCost: raw.paidCost ?? emptyPaidCost(),
  };
}

export function normalizeBuildQueue(
  value: PlanetState["buildQueue"] | BuildQueueItem | null | undefined,
  now = Date.now(),
): BuildQueueItem[] {
  return asArray(value as BuildQueueItem | BuildQueueItem[] | null | undefined).map(
    (raw, index) => {
      const base = hydrateBase(raw, "building", now);
      if (index > 0 && raw.startedAt === undefined) {
        base.startedAt = null;
      }
      return {
        ...base,
        kind: "building" as const,
        buildingId: raw.buildingId,
        targetLevel: raw.targetLevel,
      };
    },
  );
}

export function normalizeShipQueue(
  value: PlanetState["shipQueue"] | ShipQueueItem | null | undefined,
  now = Date.now(),
): ShipQueueItem[] {
  return asArray(value as ShipQueueItem | ShipQueueItem[] | null | undefined).map(
    (raw, index) => {
      const base = hydrateBase(raw, "ship", now);
      if (index > 0 && raw.startedAt === undefined) {
        base.startedAt = null;
      }
      const count = Math.max(1, raw.count ?? 1);
      const unitSeconds =
        typeof raw.unitSeconds === "number" && raw.unitSeconds > 0
          ? raw.unitSeconds
          : Math.max(1e-9, base.workSeconds / count);
      const orderedCount =
        typeof raw.orderedCount === "number" && raw.orderedCount >= count
          ? Math.floor(raw.orderedCount)
          : count;
      return {
        ...base,
        kind: "ship" as const,
        shipId: raw.shipId,
        count,
        unitSeconds,
        orderedCount,
      };
    },
  );
}

export function normalizeDefenseQueue(
  value: PlanetState["defenseQueue"] | DefenseQueueItem | null | undefined,
  now = Date.now(),
): DefenseQueueItem[] {
  return asArray(
    value as DefenseQueueItem | DefenseQueueItem[] | null | undefined,
  ).map((raw, index) => {
    const base = hydrateBase(raw, "defense", now);
    if (index > 0 && raw.startedAt === undefined) {
      base.startedAt = null;
    }
    const count = Math.max(1, raw.count ?? 1);
    const unitSeconds =
      typeof raw.unitSeconds === "number" && raw.unitSeconds > 0
        ? raw.unitSeconds
        : Math.max(1e-9, base.workSeconds / count);
    const orderedCount =
      typeof raw.orderedCount === "number" && raw.orderedCount >= count
        ? Math.floor(raw.orderedCount)
        : count;
    return {
      ...base,
      kind: "defense" as const,
      defenseId: raw.defenseId,
      count,
      unitSeconds,
      orderedCount,
    };
  });
}

export function normalizeResearchQueue(
  value: PlayerState["researchQueue"] | ResearchQueueItem | null | undefined,
  now = Date.now(),
): ResearchQueueItem[] {
  return asArray(
    value as ResearchQueueItem | ResearchQueueItem[] | null | undefined,
  ).map((raw, index) => {
    const base = hydrateBase(raw, "research", now);
    if (index > 0 && raw.startedAt === undefined) {
      base.startedAt = null;
    }
    return {
      ...base,
      kind: "research" as const,
      researchId: raw.researchId,
      targetLevel: raw.targetLevel,
    };
  });
}

/**
 * Ensure front item is started; recompute completesAt from workSeconds.
 * `startAt` is used when a prior item finished mid-tick so the next item
 * inherits the freed slot time (needed for sub-second building chains).
 */
export function ensureQueueFrontStarted<T extends QueueItemBase>(
  queue: T[],
  now: number,
  startAt?: number,
): T[] {
  if (queue.length === 0) return queue;
  const front = queue[0]!;
  if (front.startedAt == null) {
    const t = startAt ?? now;
    front.startedAt = t;
    front.completesAt = t + front.workSeconds * 1000;
  }
  return queue;
}

export function annotateRemainingSeconds<T extends QueueItemBase>(
  queue: T[],
  now: number,
): T[] {
  let cursor = now;
  return queue.map((item, index) => {
    let remaining: number;
    if (index === 0 && item.startedAt != null) {
      remaining = Math.max(0, Math.ceil((item.completesAt - now) / 1000));
      cursor = Math.max(now, item.completesAt);
    } else {
      remaining = item.workSeconds;
      cursor += item.workSeconds * 1000;
    }
    return { ...item, remainingSeconds: remaining };
  });
}

export function refundResources(
  have: Resources,
  cost: Resources,
  fraction: number,
): Resources {
  const f = Math.max(0, Math.min(1, fraction));
  return {
    metal: have.metal + Math.floor(cost.metal * f),
    crystal: have.crystal + Math.floor(cost.crystal * f),
    deuterium: have.deuterium + Math.floor(cost.deuterium * f),
  };
}
