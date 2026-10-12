import type { BuildingId, PlayerView, ShipId } from "@starhold/game";
import { buildShip, fetchState, joinGame, upgradeBuilding } from "./api";
import { renderApp } from "./ui/render";
import "./ui/styles.css";

const SESSION_KEY = "starhold.playerId";

const rootEl = document.querySelector<HTMLElement>("#app");
if (!rootEl) {
  throw new Error("#app missing");
}
const root: HTMLElement = rootEl;

let view: PlayerView | null = null;
let error: string | null = null;
let notice: string | null = null;
let busy = false;
let joinDraft = "";
let pollTimer: number | undefined;

function paint(): void {
  renderApp(
    root,
    { view, error, notice, busy, joinDraft },
    {
      onJoinDraft: (name) => {
        joinDraft = name;
      },
      onJoin: (name) => void doJoin(name),
      onUpgrade: (id) => void doUpgrade(id),
      onBuildShip: (id, count) => void doBuild(id, count),
      onRefresh: () => void doRefresh(),
      onDismissFlash: () => {
        error = null;
        notice = null;
        paint();
      },
    },
  );
}

function startPolling(playerId: string): void {
  stopPolling();
  pollTimer = window.setInterval(() => {
    void silentRefresh(playerId);
  }, 1000);
}

function stopPolling(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

async function silentRefresh(playerId: string): Promise<void> {
  try {
    view = await fetchState(playerId);
    // Do not clear error/notice here — polls used to wipe API reject messages
    // before players could read them.
    paint();
  } catch {
    // Keep last good frame; next tick may recover.
  }
}

async function doJoin(name: string): Promise<void> {
  const trimmed = name.trim();
  joinDraft = name;
  if (!trimmed) {
    error = "Commander name is required.";
    notice = null;
    paint();
    return;
  }
  busy = true;
  error = null;
  notice = null;
  paint();
  try {
    view = await joinGame(trimmed);
    joinDraft = view.player.name;
    localStorage.setItem(SESSION_KEY, view.player.id);
    notice = `Joined as ${view.player.name}.`;
    startPolling(view.player.id);
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not join.";
    view = null;
  } finally {
    busy = false;
    paint();
  }
}

async function doRefresh(): Promise<void> {
  if (!view) return;
  busy = true;
  paint();
  try {
    view = await fetchState(view.player.id);
    error = null;
  } catch (err) {
    error = err instanceof Error ? err.message : "Refresh failed.";
  } finally {
    busy = false;
    paint();
  }
}

async function doUpgrade(buildingId: BuildingId): Promise<void> {
  if (!view) return;
  busy = true;
  error = null;
  notice = null;
  paint();
  try {
    view = await upgradeBuilding(view.player.id, buildingId);
    const q = view.planet.buildQueue;
    notice = q
      ? `Queued upgrade → level ${q.targetLevel}.`
      : "Upgrade complete.";
  } catch (err) {
    error = err instanceof Error ? err.message : "Upgrade failed.";
  } finally {
    busy = false;
    paint();
  }
}

async function doBuild(shipId: ShipId, count: number): Promise<void> {
  if (!view) return;
  busy = true;
  error = null;
  notice = null;
  paint();
  try {
    view = await buildShip(view.player.id, shipId, count);
    const q = view.planet.shipQueue;
    notice = q
      ? `Queued ${q.count}× ship build.`
      : "Ships added to hangar.";
  } catch (err) {
    error = err instanceof Error ? err.message : "Build failed.";
  } finally {
    busy = false;
    paint();
  }
}

async function boot(): Promise<void> {
  paint();
  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return;
  busy = true;
  paint();
  try {
    view = await fetchState(saved);
    startPolling(saved);
  } catch {
    localStorage.removeItem(SESSION_KEY);
    view = null;
  } finally {
    busy = false;
    paint();
  }
}

void boot();
