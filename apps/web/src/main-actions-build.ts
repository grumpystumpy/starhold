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
  try {
    session.view = await upgradeBuilding(session.view.player.id, buildingId);
    setFlash("notice", upgradeNotice(session.view));
  } catch (err) {
    const beforeLevel = session.view?.planet.buildings[buildingId] ?? 0;
    const beforeQueued =
      session.view?.planet.buildQueue.filter((item) => item.buildingId === buildingId)
        .length ?? 0;
    await settleMutation({
      err,
      failureFallback: "Upgrade failed.",
      applied: (view) =>
        (view.planet.buildings[buildingId] ?? 0) > beforeLevel ||
        view.planet.buildQueue.filter((item) => item.buildingId === buildingId).length >
          beforeQueued,
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
  try {
    session.view = await buildShip(session.view.player.id, shipId, count);
    setFlash("notice", shipNotice(session.view, shipId));
  } catch (err) {
    const beforeQueued =
      session.view?.planet.shipQueue.filter((item) => item.shipId === shipId).length ?? 0;
    const beforeHangar = session.view?.planet.ships[shipId] ?? 0;
    await settleMutation({
      err,
      failureFallback: "Build failed.",
      applied: (view) =>
        view.planet.shipQueue.filter((item) => item.shipId === shipId).length > beforeQueued ||
        (view.planet.ships[shipId] ?? 0) > beforeHangar,
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
  try {
    session.view = await buildDefense(session.view.player.id, defenseId, count);
    setFlash("notice", defenseNotice(session.view, defenseId));
  } catch (err) {
    const beforeQueued =
      session.view?.planet.defenseQueue.filter((item) => item.defenseId === defenseId)
        .length ?? 0;
    const beforeStock = session.view?.planet.defenses[defenseId] ?? 0;
    await settleMutation({
      err,
      failureFallback: "Defense build failed.",
      applied: (view) =>
        view.planet.defenseQueue.filter((item) => item.defenseId === defenseId).length >
          beforeQueued || (view.planet.defenses[defenseId] ?? 0) > beforeStock,
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
  try {
    session.view = await researchTech(session.view.player.id, researchId);
    setFlash("notice", researchNotice(session.view, researchId));
  } catch (err) {
    const beforeQueued =
      session.view?.player.researchQueue.filter((item) => item.researchId === researchId)
        .length ?? 0;
    const beforeLevel = session.view?.player.research[researchId] ?? 0;
    await settleMutation({
      err,
      failureFallback: "Research failed.",
      applied: (view) =>
        view.player.researchQueue.filter((item) => item.researchId === researchId).length >
          beforeQueued || (view.player.research[researchId] ?? 0) > beforeLevel,
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
