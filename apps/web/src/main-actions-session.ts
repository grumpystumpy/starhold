import { MAP_SYSTEMS } from "@starhold/game";
import { fetchState, joinGame, selectPlanet } from "./api";
import {
  SESSION_KEY,
  clearFlash,
  schedulePaint,
  session,
  setFlash,
  stripJoinParams,
} from "./session";

export function startPolling(playerId: string): void {
  stopPolling();
  session.pollTimer = window.setInterval(() => {
    void silentRefresh(playerId);
  }, 1000);
}

export function stopPolling(): void {
  if (session.pollTimer !== undefined) {
    window.clearInterval(session.pollTimer);
    session.pollTimer = undefined;
  }
}

export async function silentRefresh(playerId: string): Promise<void> {
  try {
    const g = session.view?.galaxy.galaxy;
    const s = session.galaxySystem ?? session.view?.galaxy.system;
    session.view = await fetchState(playerId, g, s);
    schedulePaint();
  } catch (err) {
    if (!session.error || Date.now() >= session.flashUntil) {
      setFlash(
        "error",
        err instanceof Error
          ? `Server unreachable: ${err.message}`
          : "Server unreachable.",
      );
      schedulePaint();
    }
  }
}

export async function doJoin(name: string): Promise<void> {
  const trimmed = name.trim();
  session.joinDraft = name;
  if (!trimmed) {
    setFlash("error", "Commander name is required.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await joinGame(trimmed);
    session.galaxySystem = session.view.planet.coords.system;
    session.joinDraft = session.view.player.name;
    localStorage.setItem(SESSION_KEY, session.view.player.id);
    setFlash("notice", `Joined as ${session.view.player.name}.`);
    stripJoinParams();
    startPolling(session.view.player.id);
  } catch (err) {
    session.error = null;
    setFlash(
      "error",
      err instanceof Error ? err.message : "Could not join.",
    );
    session.view = null;
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doRefresh(): Promise<void> {
  if (!session.view) return;
  session.busy = true;
  schedulePaint();
  try {
    session.view = await fetchState(
      session.view.player.id,
      session.view.galaxy.galaxy,
      session.galaxySystem ?? session.view.galaxy.system,
    );
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Refresh failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doGalaxyNav(dir: "prev" | "next"): Promise<void> {
  if (!session.view) return;
  const current = session.galaxySystem ?? session.view.galaxy.system;
  const next =
    dir === "next"
      ? current >= MAP_SYSTEMS
        ? 1
        : current + 1
      : current <= 1
        ? MAP_SYSTEMS
        : current - 1;
  session.galaxySystem = next;
  session.busy = true;
  schedulePaint();
  try {
    session.view = await fetchState(
      session.view.player.id,
      session.view.galaxy.galaxy,
      next,
    );
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Galaxy nav failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doSelectPlanet(planetId: string): Promise<void> {
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
    session.view = await selectPlanet(session.view.player.id, planetId);
    session.galaxySystem = session.view.planet.coords.system;
    setFlash("notice", `Switched to ${session.view.planet.name}.`);
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Planet switch failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
