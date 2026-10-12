import {
  BUILDING_ORDER,
  SHIP_ORDER,
  BUILDINGS,
  PRODUCTION_MULT,
  SHIPS,
  fuelCostOneWay,
  type BuildingId,
  type FleetShips,
  type MissionType,
  type PlayerView,
  type ShipId,
} from "@starhold/game";
import {
  BUILDING_ART,
  DEFENSE_ART,
  PLANET_ART,
  RESOURCE_ART,
  SHIP_ART,
  UI_ART,
} from "./assets";
import { fmt, fmtCoords, fmtEta, remainingSeconds } from "./format";
import {
  fleetComposer,
  fleetsInFlight,
  reportsHtml,
  salvageFleetForm,
} from "./render-fleets";
import {
  buildingRow,
  flashHtml,
  renderJoin,
  resBlock,
  shipRow,
} from "./render-chrome";
import { escapeHtml } from "./render-escape";

void fuelCostOneWay;

/** Session path hint so mines-first play still sees yard → scout → fleet mission. */
function recommendedNext(planet: PlayerView["planet"]): string {
  const yard = planet.buildings.shipyard ?? 0;
  const scouts = planet.ships.scout ?? 0;
  if (yard < 1) {
    return "Recommended next: raise the Shipyard (then bank a Scout) so fleet missions unlock this session.";
  }
  if (scouts < 1 && !planet.shipQueue) {
    return "Recommended next: build a Scout Skiff, then open Fleets & missions.";
  }
  if (scouts >= 1) {
    return "Recommended next: launch a fleet mission to a roster rival (deploy or attack).";
  }
  return "Recommended next: wait for the shipyard queue, then launch a fleet mission.";
}

export type UiHandlers = {
  onJoinDraft: (name: string) => void;
  onJoin: (name: string) => void;
  onUpgrade: (buildingId: BuildingId) => void;
  onBuildShip: (shipId: ShipId, count: number) => void;
  onLaunchFleet: (
    targetPlanetId: string,
    mission: MissionType,
    ships: Partial<FleetShips>,
  ) => void;
  onRefresh: () => void;
  onDismissFlash: () => void;
};

/**
 * Render UI. Interactive actions are handled by event delegation in main.ts
 * so 1s poll re-renders do not drop click listeners mid-gesture.
 */
export function renderApp(
  root: HTMLElement,
  state: {
    view: PlayerView | null;
    error: string | null;
    notice: string | null;
    busy: boolean;
    joinDraft: string;
  },
  _handlers: UiHandlers,
): void {
  if (!state.view) {
    renderJoin(root, state);
    return;
  }

  const { view } = state;
  const { planet, economy, player, universe, roster } = view;
  const fleets = view.fleets ?? [];
  const reports = view.reports ?? [];
  const now = view.now;
  const hangarEmpty = SHIP_ORDER.every((id) => (planet.ships[id] ?? 0) <= 0);
  const fleetDraft = salvageFleetForm(root);

  root.innerHTML = `
    <header class="topbar">
      <div class="topbar-brand">
        <img class="thumb thumb-lg" src="${PLANET_ART.outpost}" alt="" width="56" height="56" />
        <div>
          <h1 class="brand">Starhold</h1>
          <div class="coords" data-testid="planet-coords">${escapeHtml(planet.name)} · ${fmtCoords(planet.coords)} · ${escapeHtml(universe.name)} @ ${universe.speed}×${Number(PRODUCTION_MULT) > 1 ? ` · income ×${PRODUCTION_MULT} (test)` : ""}</div>
        </div>
      </div>
      <div>
        <button type="button" class="ghost" id="refresh-btn" data-testid="refresh-btn" ${state.busy ? "disabled" : ""}>Refresh</button>
      </div>
    </header>
    ${flashHtml(state.error, state.notice)}
    <section class="resources" aria-label="Resources" data-testid="resources">
      ${resBlock("metal", "Metal", planet.resources.metal, economy.productionPerHour.metal, economy.storage.metal, RESOURCE_ART.metal)}
      ${resBlock("crystal", "Crystal", planet.resources.crystal, economy.productionPerHour.crystal, economy.storage.crystal, RESOURCE_ART.crystal)}
      ${resBlock("deuterium", "Deuterium", planet.resources.deuterium, economy.productionPerHour.deuterium, economy.storage.deuterium, RESOURCE_ART.deuterium)}
      <div class="res energy">
        <span class="res-head"><img class="icon" src="${RESOURCE_ART.energy}" alt="" width="28" height="28" /><span class="label">Energy</span></span>
        <span class="value">${fmt(economy.energy.produced)} / ${fmt(economy.energy.used)}</span>
        <span class="sub">Factor ${(economy.energy.factor * 100).toFixed(0)}%</span>
      </div>
    </section>
    <div class="layout">
      <section class="panel">
        <h2>Buildings</h2>
        ${BUILDING_ORDER.map((id) => buildingRow(id, planet, universe.speed, now, state.busy)).join("")}
        ${
          planet.buildQueue
            ? `<div class="queue" data-testid="build-queue">Building ${escapeHtml(BUILDINGS[planet.buildQueue.buildingId].name)} → L${planet.buildQueue.targetLevel} · ${fmtEta(remainingSeconds(planet.buildQueue.completesAt, now))} left</div>`
            : `<p class="hint">One construction at a time. Upgrade the Solar Array if mines stall.</p>`
        }
        <p class="hint" data-testid="recommended-next">${escapeHtml(recommendedNext(planet))}</p>
      </section>
      <div>
        <section class="panel" data-testid="hull-bay-panel">
          <h2>Hull bay</h2>
          ${SHIP_ORDER.map((id) => shipRow(id, planet, state.busy)).join("")}
          ${
            planet.shipQueue
              ? `<div class="queue" data-testid="ship-queue">Assembling ${planet.shipQueue.count}× ${escapeHtml(SHIPS[planet.shipQueue.shipId].name)} · ${fmtEta(remainingSeconds(planet.shipQueue.completesAt, now))} left</div>`
              : `<p class="hint">Raise the Shipyard to unlock heavier hulls.</p>`
          }
        </section>
        <section class="panel" data-testid="hangar-panel">
          <h2>Hangar</h2>
          ${
            hangarEmpty
              ? `<div class="empty-hangar" data-testid="hangar-empty"><img src="${UI_ART.emptyHangar}" alt="Empty hangar" width="128" height="96" /><p class="hint">No hulls docked — build at the Shipyard.</p></div>`
              : `<ul class="roster" data-testid="hangar">
            ${SHIP_ORDER.map(
              (id) =>
                `<li data-testid="hangar-${id}"><span class="row-with-thumb"><img class="thumb" src="${SHIP_ART[id]}" alt="" width="36" height="36" />${escapeHtml(SHIPS[id].name)}</span><span>${planet.ships[id] ?? 0}</span></li>`,
            ).join("")}
          </ul>`
          }
        </section>
        <section class="panel" data-testid="fleets-panel">
          <h2>Fleets &amp; missions</h2>
          ${fleetComposer(view, state.busy, fleetDraft)}
          ${fleetsInFlight(fleets, roster, now)}
          ${reportsHtml(reports, player.id)}
        </section>
        <section class="panel">
          <h2>Defenses <span class="meta">(preview art)</span></h2>
          <div class="defense-row">
            <article class="item item-thumb">
              <img class="thumb" src="${DEFENSE_ART.laser}" alt="" width="48" height="48" />
              <div>
                <h3>Laser Battery</h3>
                <p>Static guns — buildable defenses land in a later slice.</p>
              </div>
            </article>
            <article class="item item-thumb">
              <img class="thumb" src="${DEFENSE_ART.shield}" alt="" width="48" height="48" />
              <div>
                <h3>Shield Dome</h3>
                <p>Planetary shield concept art for the combat path ahead.</p>
              </div>
            </article>
          </div>
        </section>
        <section class="panel">
          <h2>Universe roster</h2>
          <ul class="roster" data-testid="roster">
            ${roster
              .map(
                (r) =>
                  `<li><span class="row-with-thumb"><img class="thumb" src="${PLANET_ART.rocky}" alt="" width="32" height="32" />${escapeHtml(r.name)}${r.id === player.id ? " (you)" : ""}</span><span>${fmtCoords(r.coords)} · ~${r.pointsHint} pts</span></li>`,
              )
              .join("")}
          </ul>
        </section>
      </div>
    </div>
  `;
}
