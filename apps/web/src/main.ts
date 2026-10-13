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
import { fetchState } from "./api";
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
  silentRefresh,
  startPolling,
} from "./main-actions";
import { ensureDelegatedHandlers } from "./main-handlers";

function paint(): void {
  renderApp(
    root,
    {
      view: session.view,
      error: session.error,
      notice: session.notice,
      busy: session.busy,
      joinDraft: session.joinDraft,
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
}

setPaintImpl(paint);

async function resumePlayer(playerId: string): Promise<boolean> {
  session.busy = true;
  schedulePaint();
  try {
    session.view = await fetchState(playerId);
    session.galaxySystem = session.view.planet.coords.system;
    localStorage.setItem(SESSION_KEY, playerId);
    startPolling(playerId);
    setFlash("notice", `Resumed ${session.view.player.name}.`);
    return true;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    session.view = null;
    return false;
  } finally {
    session.busy = false;
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
    session.joinDraft = commanderParam.slice(0, 24);
    schedulePaint();
    await doJoin(session.joinDraft);
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
        cargo?: Partial<import("@starhold/game").Resources>;
      }) => Promise<void>;
      refresh: () => Promise<void>;
      poll: () => Promise<void>;
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
    galaxy: session.view?.galaxy ?? null,
    roster: session.view?.roster ?? null,
  }),
};

void boot();
