import type {
  BuildingId,
  Coordinates,
  DefenseId,
  FleetShips,
  MissionType,
  PlayerView,
  ResearchId,
  ShipId,
} from "@starhold/game";
import { renderApp } from "./ui/render";
import "./ui/styles.css";
import {
  SESSION_KEY,
  clearFlash,
  root,
  schedulePaint,
  session,
  setFlash,
  setPaintImpl,
  stripJoinParams,
} from "./session";
import { fetchState, selectPlanet, ApiError } from "./api";
import { shouldClearSavedPlayer } from "./auth-resume";
import {
  doBuild,
  doBuildDefense,
  doGalaxyNav,
  doJoin,
  doLaunchFleet,
  doRefresh,
  doResearch,
  doSelectPlanet,
  doUpgrade,
  resumeFromCookie,
  scheduleReconnect,
  IDLE_PAUSE_MS,
  POLL_INTERVAL_MS,
  silentRefresh,
  startPolling,
} from "./main-actions";
import { wireJointStrikeForm } from "./main-actions-alliances";
import { ensureDelegatedHandlers } from "./main-handlers";
import { initTelemetry } from "./telemetry";
import {
  ensurePopstateHandler,
  pageFromLocation,
  syncSessionUrl,
} from "./ui/router";

function paint(): void {
  renderApp(
    root,
    {
      view: session.view,
      error: session.error,
      notice: session.notice,
      busy: session.busy,
      joinDraft: session.joinDraft,
      emailDraft: session.emailDraft,
      passwordDraft: session.passwordDraft,
      claimEmailDraft: session.claimEmailDraft,
      claimCodeDraft: session.claimCodeDraft,
      claimPasswordDraft: session.claimPasswordDraft,
      accountEmail: session.account?.email ?? null,
      claimablePlayerId: session.claimablePlayerId,
      activePage: session.activePage,
    },
    {
      onJoinDraft: (name) => {
        session.joinDraft = name;
      },
      onJoin: (name) => void doJoin(name),
      onUpgrade: (id) => void doUpgrade(id),
      onBuildShip: (id, count) => void doBuild(id, count),
      onBuildDefense: (id, count) => void doBuildDefense(id, count),
      onResearch: (id) => void doResearch(id),
      onSelectPlanet: (id) => void doSelectPlanet(id),
      onGalaxyNav: (dir) => void doGalaxyNav(dir),
      onLaunchFleet: (opts) => void doLaunchFleet(opts),
      onRefresh: () => void doRefresh(),
      onDismissFlash: () => {
        clearFlash();
        schedulePaint();
      },
    },
  );
  ensureDelegatedHandlers();
  if (session.pendingAcsPrefill && session.activePage === "fleet") {
    if (wireJointStrikeForm(session.pendingAcsPrefill)) {
      session.pendingAcsPrefill = null;
    }
  }
}

setPaintImpl(paint);

async function resumePlayer(
  playerId: string,
  planetParam?: string | null,
): Promise<"ok" | "logout" | "retry"> {
  session.busy = true;
  schedulePaint();
  try {
    session.view = await fetchState(playerId);
    session.galaxySystem = session.view.planet.coords.system;
    localStorage.setItem(SESSION_KEY, playerId);
    const wantPlanet = planetParam?.trim();
    if (
      wantPlanet &&
      wantPlanet !== session.view.planet.id &&
      session.view.ownedPlanets.some((p) => p.id === wantPlanet)
    ) {
      session.view = await selectPlanet(playerId, wantPlanet);
      session.galaxySystem = session.view.planet.coords.system;
    }
    syncSessionUrl({ replace: true });
    startPolling(playerId);
    setFlash("notice", `Resumed ${session.view.player.name}.`);
    return "ok";
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    if (shouldClearSavedPlayer(status)) {
      localStorage.removeItem(SESSION_KEY);
      session.view = null;
      return "logout";
    }
    setFlash("notice", "Reconnecting…");
    scheduleReconnect();
    return "retry";
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

async function boot(): Promise<void> {
  void initTelemetry();
  ensureDelegatedHandlers();
  ensurePopstateHandler();
  session.activePage = pageFromLocation();
  paint();

  const params = new URLSearchParams(window.location.search);
  const playerIdParam = params.get("playerId")?.trim();
  const planetParam = params.get("planet")?.trim();
  const commanderParam = params.get("commander")?.trim();
  const authParam = params.get("auth")?.trim();
  const claimParam = params.get("claim")?.trim();

  // Legacy magic-link query params — clear and ignore.
  if (authParam || claimParam) {
    stripAuthParams();
  }

  // Cookie session wins over localStorage when present.
  if (!commanderParam && !playerIdParam) {
    const fromCookie = await resumeFromCookie();
    if (fromCookie === "ready") return;
    if (fromCookie === "account") {
      schedulePaint();
      // Stay on join for name / claim.
      return;
    }
    if (fromCookie === "retry") {
      setFlash("notice", "Reconnecting…");
      schedulePaint();
      scheduleReconnect();
      return;
    }
    if (fromCookie === "logout") {
      setFlash("error", "Signed out.");
      schedulePaint();
      return;
    }
  }

  if (playerIdParam) {
    const outcome = await resumePlayer(playerIdParam, planetParam);
    if (outcome === "ok") {
      stripJoinParams();
      syncSessionUrl({ replace: true });
      return;
    }
    if (outcome === "retry") return;
    setFlash("error", "Saved session expired — join again.");
    schedulePaint();
  }

  if (commanderParam) {
    session.joinDraft = commanderParam.slice(0, 24);
    schedulePaint();
    await doJoin(session.joinDraft);
    return;
  }

  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return;
  session.claimablePlayerId = saved;
  const outcome = await resumePlayer(saved, planetParam);
  if (outcome === "logout") {
    // Stay on join; session was stale.
  }
}

function stripAuthParams(): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of ["auth", "claim"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (!changed) return;
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", next || "/");
}


declare global {
  interface Window {
    /** Automation / playtest helpers — join without fighting the text input. */
    starhold?: {
      join: (name: string) => Promise<void>;
      upgrade: (buildingId: BuildingId) => Promise<void>;
      buildShip: (shipId: ShipId, count?: number) => Promise<void>;
      buildDefense: (defenseId: DefenseId, count?: number) => Promise<void>;
      research: (researchId: ResearchId) => Promise<void>;
      selectPlanet: (planetId: string) => Promise<void>;
      launchFleet: (
        targetPlanetId: string,
        mission: MissionType,
        ships: Partial<FleetShips>,
      ) => Promise<void>;
      launch: (opts: {
        mission: MissionType;
        ships: Partial<FleetShips>;
        targetPlanetId?: string;
        targetCoords?: Coordinates;
        asteroidId?: string;
        pirateBaseId?: string;
  alienBaseId?: string;
        cargo?: Partial<import("@starhold/game").Resources>;
      }) => Promise<void>;
      refresh: () => Promise<void>;
      poll: () => Promise<void>;
      pollIntervalMs: number;
      idlePauseMs: number;
      getState: () => {
        playerId: string | null;
        name: string | null;
        error: string | null;
        notice: string | null;
        ships: PlayerView["planet"]["ships"] | null;
        buildings: PlayerView["planet"]["buildings"] | null;
        defenses: PlayerView["planet"]["defenses"] | null;
        research: PlayerView["player"]["research"] | null;
        fleets: PlayerView["fleets"] | null;
        reports: PlayerView["reports"] | null;
        spyReports: PlayerView["spyReports"] | null;
        eventLog: PlayerView["player"]["eventLog"] | null;
        galaxy: PlayerView["galaxy"] | null;
        roster: PlayerView["roster"] | null;
      };
    };
  }
}

window.starhold = {
  join: (name) => doJoin(name),
  upgrade: (buildingId) => doUpgrade(buildingId),
  buildShip: (shipId, count = 1) => doBuild(shipId, count),
  buildDefense: (defenseId, count = 1) => doBuildDefense(defenseId, count),
  research: (researchId) => doResearch(researchId),
  selectPlanet: (planetId) => doSelectPlanet(planetId),
  launchFleet: (targetPlanetId, mission, ships) =>
    doLaunchFleet({ targetPlanetId, mission, ships }),
  launch: (opts) => doLaunchFleet(opts),
  refresh: () => doRefresh(),
  poll: () =>
    session.view ? silentRefresh(session.view.player.id) : Promise.resolve(),
  pollIntervalMs: POLL_INTERVAL_MS,
  idlePauseMs: IDLE_PAUSE_MS,
  getState: () => ({
    playerId: session.view?.player.id ?? null,
    name: session.view?.player.name ?? null,
    error: session.error,
    notice: session.notice,
    ships: session.view?.planet.ships ?? null,
    buildings: session.view?.planet.buildings ?? null,
    defenses: session.view?.planet.defenses ?? null,
    research: session.view?.player.research ?? null,
    fleets: session.view?.fleets ?? null,
    reports: session.view?.reports ?? null,
    spyReports: session.view?.spyReports ?? null,
    eventLog: session.view?.player.eventLog ?? null,
    galaxy: session.view?.galaxy ?? null,
    roster: session.view?.roster ?? null,
  }),
};

void boot();
