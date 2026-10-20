import {
  DEFENSES,
  RESEARCH,
  SHIPS,
  type BuildingId,
  type DefenseId,
  type ResearchId,
  type ShipId,
} from "@starhold/game";
import {
  buildDefense,
  buildShip,
  cancelQueueItem,
  researchTech,
  upgradeBuilding,
} from "./api";
import {
  clearFlash,
  schedulePaint,
  session,
  setFlash,
} from "./session";
import { fmt } from "./ui/format";
import { captureGameEvent } from "./telemetry";
import { settleMutation } from "./recover-action";

function upgradeNotice(view: NonNullable<typeof session.view>): string {
  const q = view.planet.buildQueue;
  const last = q?.length ? q[q.length - 1] : null;
  return last
    ? `Queued upgrade → level ${fmt(last.targetLevel)} (${fmt(q!.length)} in queue).`
    : "Upgrade complete.";
}

function shipNotice(view: NonNullable<typeof session.view>, shipId: ShipId): string {
  const q = view.planet.shipQueue;
  const last = q?.length ? q[q.length - 1] : null;
  const hangar = view.planet.ships[shipId] ?? 0;
  const shipName = SHIPS[shipId]?.name ?? shipId;
  return last
    ? `Queued ${fmt(last.count)}× ${shipName} · hangar will update when done.`
    : `Hangar: ${shipName} ×${fmt(hangar)}.`;
}

function defenseNotice(
  view: NonNullable<typeof session.view>,
  defenseId: DefenseId,
): string {
  const q = view.planet.defenseQueue;
  const last = q?.length ? q[q.length - 1] : null;
  const defenseName = DEFENSES[defenseId]?.name ?? defenseId;
  return last
    ? `Queued ${fmt(last.count)}× ${defenseName}.`
    : `Defense built: ${defenseName}.`;
}

function researchNotice(
  view: NonNullable<typeof session.view>,
  researchId: ResearchId,
): string {
  const q = view.player.researchQueue;
  const last = q?.length ? q[q.length - 1] : null;
  const researchName = RESEARCH[researchId]?.name ?? researchId;
  return last
    ? `Researching → level ${fmt(last.targetLevel)}.`
    : `Research complete: ${researchName}.`;
}

function queueItems(
  view: NonNullable<typeof session.view>,
  kind: "building" | "ship" | "defense" | "research",
): Array<{ id: string }> {
  if (kind === "research") return view.player.researchQueue;
  if (kind === "ship") return view.planet.shipQueue;
  if (kind === "defense") return view.planet.defenseQueue;
  return view.planet.buildQueue;
}

export async function doUpgrade(buildingId: BuildingId): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  captureGameEvent("build_start", { building: buildingId });

  const beforeQueue = session.view.planet.buildQueue.filter(
    (item) => item.buildingId === buildingId,
  );
  const beforeIds = new Set(beforeQueue.map((item) => item.id));
  const beforeLevel = session.view.planet.buildings[buildingId] ?? 0;
  const beforeTotal = beforeLevel + beforeQueue.length;

  try {
    session.view = await upgradeBuilding(session.view.player.id, buildingId);
    setFlash("notice", upgradeNotice(session.view));
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Upgrade failed.",
      applied: (view) => {
        const queueForBuilding = view.planet.buildQueue.filter(
          (item) => item.buildingId === buildingId,
        );
        const hasNewId = queueForBuilding.some((item) => !beforeIds.has(item.id));
        if (hasNewId) return true;

        const currentLevel = view.planet.buildings[buildingId] ?? 0;
        const currentTotal = currentLevel + queueForBuilding.length;
        return currentTotal - beforeTotal >= 1;
      },
      successNotice: upgradeNotice,
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doBuild(shipId: ShipId, count: number): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();

  const beforeQueue = session.view.planet.shipQueue.filter(
    (item) => item.shipId === shipId,
  );
  const beforeIds = new Set(beforeQueue.map((item) => item.id));
  const beforeQueued = beforeQueue.reduce(
    (sum, item) => sum + (item.count ?? 0),
    0,
  );
  const beforeHangar = session.view.planet.ships[shipId] ?? 0;
  const beforeTotal = beforeHangar + beforeQueued;

  try {
    session.view = await buildShip(session.view.player.id, shipId, count);
    setFlash("notice", shipNotice(session.view, shipId));
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Build failed.",
      applied: (view) => {
        const queueForShip = view.planet.shipQueue.filter(
          (item) => item.shipId === shipId,
        );
        const hasNewId = queueForShip.some((item) => !beforeIds.has(item.id));
        if (hasNewId) return true;

        const currentQueued = queueForShip.reduce(
          (sum, item) => sum + (item.count ?? 0),
          0,
        );
        const currentHangar = view.planet.ships[shipId] ?? 0;
        const currentTotal = currentHangar + currentQueued;
        return currentTotal - beforeTotal >= count;
      },
      successNotice: (view) => shipNotice(view, shipId),
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doBuildDefense(
  defenseId: DefenseId,
  count: number,
): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();

  const beforeQueue = session.view.planet.defenseQueue.filter(
    (item) => item.defenseId === defenseId,
  );
  const beforeIds = new Set(beforeQueue.map((item) => item.id));
  const beforeQueued = beforeQueue.reduce(
    (sum, item) => sum + (item.count ?? 0),
    0,
  );
  const beforeStock = session.view.planet.defenses[defenseId] ?? 0;
  const beforeTotal = beforeStock + beforeQueued;

  try {
    session.view = await buildDefense(session.view.player.id, defenseId, count);
    setFlash("notice", defenseNotice(session.view, defenseId));
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Defense build failed.",
      applied: (view) => {
        const queueForDefense = view.planet.defenseQueue.filter(
          (item) => item.defenseId === defenseId,
        );
        const hasNewId = queueForDefense.some((item) => !beforeIds.has(item.id));
        if (hasNewId) return true;

        const currentQueued = queueForDefense.reduce(
          (sum, item) => sum + (item.count ?? 0),
          0,
        );
        const currentStock = view.planet.defenses[defenseId] ?? 0;
        const currentTotal = currentStock + currentQueued;
        return currentTotal - beforeTotal >= count;
      },
      successNotice: (view) => defenseNotice(view, defenseId),
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doResearch(researchId: ResearchId): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  captureGameEvent("research_start", { research: researchId });

  const beforeQueue = session.view.player.researchQueue.filter(
    (item) => item.researchId === researchId,
  );
  const beforeIds = new Set(beforeQueue.map((item) => item.id));
  const beforeLevel = session.view.player.research[researchId] ?? 0;
  const beforeTotal = beforeLevel + beforeQueue.length;

  try {
    session.view = await researchTech(session.view.player.id, researchId);
    setFlash("notice", researchNotice(session.view, researchId));
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Research failed.",
      applied: (view) => {
        const queueForResearch = view.player.researchQueue.filter(
          (item) => item.researchId === researchId,
        );
        const hasNewId = queueForResearch.some((item) => !beforeIds.has(item.id));
        if (hasNewId) return true;

        const currentLevel = view.player.research[researchId] ?? 0;
        const currentTotal = currentLevel + queueForResearch.length;
        return currentTotal - beforeTotal >= 1;
      },
      successNotice: (view) => researchNotice(view, researchId),
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doCancelQueue(
  kind: "building" | "ship" | "defense" | "research",
  itemId: string,
): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await cancelQueueItem(
      session.view.player.id,
      kind,
      itemId,
      session.view.planet.id,
    );
    setFlash("notice", "Queue item cancelled.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Cancel failed.",
      applied: (view) => !queueItems(view, kind).some((item) => item.id === itemId),
      successNotice: () => "Queue item cancelled.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
