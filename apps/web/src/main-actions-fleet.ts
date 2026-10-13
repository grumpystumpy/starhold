import type {
  Coordinates,
  FleetShips,
  MissionType,
  Resources,
} from "@starhold/game";
import { launchFleetMission } from "./api";
import {
  clearFlash,
  schedulePaint,
  session,
  setFlash,
} from "./session";

export async function doLaunchFleet(opts: {
  mission: MissionType;
  ships: Partial<FleetShips>;
  targetPlanetId?: string;
  targetCoords?: Coordinates;
  asteroidId?: string;
  cargo?: Partial<Resources>;
}): Promise<void> {
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
    session.view = await launchFleetMission(session.view.player.id, opts);
    const live = session.view.fleets?.[0];
    setFlash(
      "notice",
      live
        ? `Fleet ${live.mission} launched · ETA ${Math.ceil((live.arrivesAt - session.view.now) / 1000)}s.`
        : `Fleet ${opts.mission} launched.`,
    );
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Launch failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
