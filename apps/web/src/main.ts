import type {
  BuildingId,
  FleetShips,
  MissionType,
  PlayerView,
  ShipId,
} from "@starhold/game";
import {
  buildShip,
  fetchState,
  joinGame,
  launchFleetMission,
  upgradeBuilding,
} from "./api";
import { renderApp } from "./ui/render";
import "./ui/styles.css";

const SESSION_KEY = "starhold.playerId";
/** Keep reject/success flashes readable across 1s polls. */
const FLASH_TTL_MS = 12_000;

const rootEl = document.querySelector<HTMLElement>("#app");
if (!rootEl) {
  throw new Error("#app missing");
}
const root: HTMLElement = rootEl;

let view: PlayerView | null = null;
let error: string | null = null;
let notice: string | null = null;
let flashUntil = 0;
let busy = false;
let joinDraft = "";
let pollTimer: number | undefined;
let flashTimer: number | undefined;
/** Defer full paints while a pointer is down so polls cannot swallow clicks. */
let pointersDown = 0;
let paintQueued = false;
let handlersBound = false;

function setFlash(kind: "error" | "notice", message: string): void {
  if (kind === "error") {
    error = message;
    notice = null;
  } else {
    notice = message;
    error = null;
  }
  flashUntil = Date.now() + FLASH_TTL_MS;
  if (flashTimer !== undefined) window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    if (Date.now() >= flashUntil) {
      error = null;
      notice = null;
      schedulePaint();
    }
  }, FLASH_TTL_MS + 50);
}

function clearFlash(): void {
  error = null;
  notice = null;
  flashUntil = 0;
  if (flashTimer !== undefined) {
    window.clearTimeout(flashTimer);
    flashTimer = undefined;
  }
}

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
      onLaunchFleet: (target, mission, ships) =>
        void doLaunchFleet(target, mission, ships),
      onRefresh: () => void doRefresh(),
      onDismissFlash: () => {
        clearFlash();
        schedulePaint();
      },
    },
  );
  ensureDelegatedHandlers();
}

function schedulePaint(): void {
  if (pointersDown > 0) {
    paintQueued = true;
    return;
  }
  paintQueued = false;
  paint();
}

function readFleetForm(): {
  targetPlanetId: string;
  mission: MissionType;
  ships: Partial<FleetShips>;
} | null {
  const form = root.querySelector<HTMLFormElement>("#fleet-form");
  if (!form) return null;
  const target = form.querySelector<HTMLSelectElement>("#fleet-target");
  const missionEl = form.querySelector<HTMLInputElement>(
    'input[name="fleet-mission"]:checked',
  );
  if (!target?.value) return null;
  const ships: Partial<FleetShips> = {};
  for (const id of ["scout", "hauler", "interceptor"] as ShipId[]) {
    const input = form.querySelector<HTMLInputElement>(
      `[data-fleet-count="${id}"]`,
    );
    ships[id] = Math.max(0, Math.floor(Number(input?.value) || 0));
  }
  const mission: MissionType =
    missionEl?.value === "raid" ? "raid" : "deploy";
  return { targetPlanetId: target.value, mission, ships };
}

function ensureDelegatedHandlers(): void {
  if (handlersBound) return;
  handlersBound = true;

  root.addEventListener("pointerdown", () => {
    pointersDown += 1;
  });
  const endPointer = () => {
    pointersDown = Math.max(0, pointersDown - 1);
    if (pointersDown === 0 && paintQueued) {
      paintQueued = false;
      paint();
    }
  };
  root.addEventListener("pointerup", endPointer);
  root.addEventListener("pointercancel", endPointer);
  window.addEventListener("blur", () => {
    pointersDown = 0;
    if (paintQueued) {
      paintQueued = false;
      paint();
    }
  });

  // Event delegation survives child replacement; combined with paint deferral
  // this keeps Upgrade/Build clicks from being lost to 1s polls.
  root.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;

    if (target.closest("[data-dismiss-flash]")) {
      clearFlash();
      schedulePaint();
      return;
    }

    const upgradeBtn = target.closest<HTMLElement>("[data-upgrade]");
    if (upgradeBtn?.dataset.upgrade) {
      ev.preventDefault();
      void doUpgrade(upgradeBtn.dataset.upgrade as BuildingId);
      return;
    }

    const shipBtn = target.closest<HTMLElement>("[data-ship]");
    if (shipBtn?.dataset.ship) {
      ev.preventDefault();
      const shipId = shipBtn.dataset.ship as ShipId;
      const countInput = root.querySelector<HTMLInputElement>(
        `[data-ship-count="${shipId}"]`,
      );
      const count = Math.max(1, Math.min(50, Number(countInput?.value) || 1));
      void doBuild(shipId, count);
      return;
    }

    if (target.closest("#refresh-btn")) {
      ev.preventDefault();
      void doRefresh();
    }
  });

  root.addEventListener("submit", (ev) => {
    const form = ev.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.id === "join-form") {
      ev.preventDefault();
      const input = form.querySelector<HTMLInputElement>("#commander");
      const value = input?.value ?? joinDraft;
      joinDraft = value;
      void doJoin(value);
      return;
    }

    if (form.id === "fleet-form") {
      ev.preventDefault();
      const draft = readFleetForm();
      if (!draft) {
        setFlash("error", "Pick a target and ships.");
        schedulePaint();
        return;
      }
      void doLaunchFleet(draft.targetPlanetId, draft.mission, draft.ships);
    }
  });

  root.addEventListener("input", (ev) => {
    const el = ev.target;
    if (el instanceof HTMLInputElement && el.id === "commander") {
      joinDraft = el.value;
    }
  });
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
    // Do not clear error/notice — polls must not wipe reject messages.
    schedulePaint();
  } catch (err) {
    // Surface persistent connectivity loss without clearing an active reject.
    if (!error || Date.now() >= flashUntil) {
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

async function doJoin(name: string): Promise<void> {
  const trimmed = name.trim();
  joinDraft = name;
  if (!trimmed) {
    setFlash("error", "Commander name is required.");
    schedulePaint();
    return;
  }
  busy = true;
  clearFlash();
  schedulePaint();
  try {
    view = await joinGame(trimmed);
    joinDraft = view.player.name;
    localStorage.setItem(SESSION_KEY, view.player.id);
    setFlash("notice", `Joined as ${view.player.name}.`);
    // Drop one-shot deep-link params so refresh uses session id.
    stripJoinParams();
    startPolling(view.player.id);
  } catch (err) {
    error = null;
    setFlash(
      "error",
      err instanceof Error ? err.message : "Could not join.",
    );
    view = null;
  } finally {
    busy = false;
    schedulePaint();
  }
}

async function doRefresh(): Promise<void> {
  if (!view) return;
  busy = true;
  schedulePaint();
  try {
    view = await fetchState(view.player.id);
    // Manual refresh keeps flashes until TTL / dismiss.
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Refresh failed.",
    );
  } finally {
    busy = false;
    schedulePaint();
  }
}

async function doUpgrade(buildingId: BuildingId): Promise<void> {
  if (!view || busy) return;
  busy = true;
  clearFlash();
  schedulePaint();
  try {
    view = await upgradeBuilding(view.player.id, buildingId);
    const q = view.planet.buildQueue;
    setFlash(
      "notice",
      q ? `Queued upgrade → level ${q.targetLevel}.` : "Upgrade complete.",
    );
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Upgrade failed.",
    );
  } finally {
    busy = false;
    schedulePaint();
  }
}

async function doBuild(shipId: ShipId, count: number): Promise<void> {
  if (!view || busy) return;
  busy = true;
  clearFlash();
  schedulePaint();
  try {
    view = await buildShip(view.player.id, shipId, count);
    const q = view.planet.shipQueue;
    const hangar = view.planet.ships[shipId] ?? 0;
    setFlash(
      "notice",
      q
        ? `Queued ${q.count}× ${shipId} · hangar will update when done.`
        : `Hangar: ${shipId} ×${hangar}.`,
    );
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Build failed.",
    );
  } finally {
    busy = false;
    schedulePaint();
  }
}

async function doLaunchFleet(
  targetPlanetId: string,
  mission: MissionType,
  ships: Partial<FleetShips>,
): Promise<void> {
  if (!view || busy) return;
  busy = true;
  clearFlash();
  schedulePaint();
  try {
    view = await launchFleetMission(
      view.player.id,
      targetPlanetId,
      mission,
      ships,
    );
    const live = view.fleets?.[0];
    setFlash(
      "notice",
      live
        ? `Fleet ${live.mission} launched · ETA ${Math.ceil((live.arrivesAt - view.now) / 1000)}s.`
        : `Fleet ${mission} launched.`,
    );
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Launch failed.",
    );
  } finally {
    busy = false;
    schedulePaint();
  }
}

function stripJoinParams(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("commander") && !url.searchParams.has("playerId")) {
    return;
  }
  url.searchParams.delete("commander");
  url.searchParams.delete("playerId");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", next || "/");
}

async function resumePlayer(playerId: string): Promise<boolean> {
  busy = true;
  schedulePaint();
  try {
    view = await fetchState(playerId);
    localStorage.setItem(SESSION_KEY, playerId);
    startPolling(playerId);
    setFlash("notice", `Resumed ${view.player.name}.`);
    return true;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    view = null;
    return false;
  } finally {
    busy = false;
    schedulePaint();
  }
}

async function boot(): Promise<void> {
  ensureDelegatedHandlers();
  paint();

  const params = new URLSearchParams(window.location.search);
  const playerIdParam = params.get("playerId")?.trim();
  const commanderParam = params.get("commander")?.trim();

  if (playerIdParam) {
    const ok = await resumePlayer(playerIdParam);
    if (ok) {
      stripJoinParams();
      return;
    }
    setFlash("error", "Saved session expired — join again.");
    schedulePaint();
  }

  if (commanderParam) {
    joinDraft = commanderParam.slice(0, 24);
    schedulePaint();
    await doJoin(joinDraft);
    return;
  }

  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return;
  const ok = await resumePlayer(saved);
  if (!ok) {
    // Stay on join; session was stale.
  }
}

declare global {
  interface Window {
    /** Automation / playtest helpers — join without fighting the text input. */
    starhold?: {
      join: (name: string) => Promise<void>;
      upgrade: (buildingId: BuildingId) => Promise<void>;
      buildShip: (shipId: ShipId, count?: number) => Promise<void>;
      launchFleet: (
        targetPlanetId: string,
        mission: MissionType,
        ships: Partial<FleetShips>,
      ) => Promise<void>;
      refresh: () => Promise<void>;
      getState: () => {
        playerId: string | null;
        name: string | null;
        error: string | null;
        notice: string | null;
        ships: PlayerView["planet"]["ships"] | null;
        fleets: PlayerView["fleets"] | null;
        reports: PlayerView["reports"] | null;
        roster: PlayerView["roster"] | null;
      };
    };
  }
}

window.starhold = {
  join: (name) => doJoin(name),
  upgrade: (buildingId) => doUpgrade(buildingId),
  buildShip: (shipId, count = 1) => doBuild(shipId, count),
  launchFleet: (targetPlanetId, mission, ships) =>
    doLaunchFleet(targetPlanetId, mission, ships),
  refresh: () => doRefresh(),
  getState: () => ({
    playerId: view?.player.id ?? null,
    name: view?.player.name ?? null,
    error,
    notice,
    ships: view?.planet.ships ?? null,
    fleets: view?.fleets ?? null,
    reports: view?.reports ?? null,
    roster: view?.roster ?? null,
  }),
};

void boot();
