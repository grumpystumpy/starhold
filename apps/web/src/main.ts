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
let busy = false;
let pollTimer: number | undefined;

function paint(): void {
  renderApp(
    root,
    { view, error, busy },
    {
      onJoin: (name) => void doJoin(name),
      onUpgrade: (id) => void doUpgrade(id),
      onBuildShip: (id, count) => void doBuild(id, count),
      onRefresh: () => void doRefresh(),
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
    error = null;
    paint();
  } catch {
    // Keep last good frame; next tick may recover.
  }
}

async function doJoin(name: string): Promise<void> {
  busy = true;
  error = null;
  paint();
  try {
    view = await joinGame(name);
    localStorage.setItem(SESSION_KEY, view.player.id);
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
  paint();
  try {
    view = await upgradeBuilding(view.player.id, buildingId);
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
  paint();
  try {
    view = await buildShip(view.player.id, shipId, count);
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
