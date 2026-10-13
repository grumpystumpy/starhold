import type {
  BuildingId,
  DefenseId,
  ResearchId,
  ShipId,
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
  try {
    session.view = await upgradeBuilding(session.view.player.id, buildingId);
    const q = session.view.planet.buildQueue;
    const last = q?.length ? q[q.length - 1] : null;
    setFlash(
      "notice",
      last
        ? `Queued upgrade → level ${last.targetLevel} (${q!.length} in queue).`
        : "Upgrade complete.",
    );
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Upgrade failed.",
    );
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
    const q = session.view.planet.shipQueue;
    const last = q?.length ? q[q.length - 1] : null;
    const hangar = session.view.planet.ships[shipId] ?? 0;
    setFlash(
      "notice",
      last
        ? `Queued ${last.count}× ${shipId} · hangar will update when done.`
        : `Hangar: ${shipId} ×${hangar}.`,
    );
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Build failed.",
    );
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
    const q = session.view.planet.defenseQueue;
    const last = q?.length ? q[q.length - 1] : null;
    setFlash(
      "notice",
      last
        ? `Queued ${last.count}× ${defenseId}.`
        : `Defense built: ${defenseId}.`,
    );
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Defense build failed.",
    );
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
  try {
    session.view = await researchTech(session.view.player.id, researchId);
    const q = session.view.player.researchQueue;
    const last = q?.length ? q[q.length - 1] : null;
    setFlash(
      "notice",
      last
        ? `Researching → level ${last.targetLevel}.`
        : `Research complete: ${researchId}.`,
    );
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Research failed.",
    );
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
    setFlash(
      "error",
      err instanceof Error ? err.message : "Cancel failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
