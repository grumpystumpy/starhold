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
    const q = session.view.planet.buildQueue;
    const last = q?.length ? q[q.length - 1] : null;
    setFlash(
      "notice",
      last
        ? `Queued upgrade → level ${fmt(last.targetLevel)} (${fmt(q!.length)} in queue).`
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
    const shipName = SHIPS[shipId]?.name ?? shipId;
    setFlash(
      "notice",
      last
        ? `Queued ${fmt(last.count)}× ${shipName} · hangar will update when done.`
        : `Hangar: ${shipName} ×${fmt(hangar)}.`,
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
    const defenseName = DEFENSES[defenseId]?.name ?? defenseId;
    setFlash(
      "notice",
      last
        ? `Queued ${fmt(last.count)}× ${defenseName}.`
        : `Defense built: ${defenseName}.`,
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
  captureGameEvent("research_start", { research: researchId });
  try {
    session.view = await researchTech(session.view.player.id, researchId);
    const q = session.view.player.researchQueue;
    const last = q?.length ? q[q.length - 1] : null;
    const researchName = RESEARCH[researchId]?.name ?? researchId;
    setFlash(
      "notice",
      last
        ? `Researching → level ${fmt(last.targetLevel)}.`
        : `Research complete: ${researchName}.`,
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
