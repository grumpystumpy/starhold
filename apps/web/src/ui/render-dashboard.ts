import {
  BUILDING_ORDER,
  DEFENSE_ORDER,
  RESEARCH_ORDER,
  SHIP_ORDER,
  BUILDINGS,
  DEFENSES,
  PRODUCTION_MULT,
  RESEARCH,
  SHIPS,
  type PlayerView,
} from "@starhold/game";
import {
  PLANET_ART,
  RESOURCE_ART,
  UI_ART,
  SHIP_ART,
} from "./assets";
import { fmt, fmtCoords, fmtEta, remainingSeconds } from "./format";
import {
  fleetComposer,
  fleetsInFlight,
  galaxyPanel,
  reportsHtml,
  spyReportsHtml,
  type FleetDraft,
} from "./render-fleets";
import {
  buildingRow,
  defenseRow,
  flashHtml,
  researchRow,
  resBlock,
  shipRow,
} from "./render-chrome";
import { escapeAttr, escapeHtml } from "./render-escape";
import { recommendedNext } from "./render-helpers";

export function dashboardHtml(
  view: PlayerView,
  state: { error: string | null; notice: string | null; busy: boolean },
  fleetDraft: FleetDraft | null,
): string {
  const { planet, economy, player, universe, roster } = view;
  const fleets = view.fleets ?? [];
  const reports = view.reports ?? [];
  const spyReports = view.spyReports ?? [];
  const now = view.now;
  const hangarEmpty = SHIP_ORDER.every((id) => (planet.ships[id] ?? 0) <= 0);

  const planetSwitcher =
    view.ownedPlanets.length > 1
      ? `<div class="planet-switch" data-testid="planet-switch">
          ${view.ownedPlanets
            .map(
              (p) =>
                `<button type="button" data-select-planet="${escapeAttr(p.id)}" data-testid="select-planet-${p.id}" class="${p.isActive ? "active" : ""}" ${state.busy ? "disabled" : ""}>${escapeHtml(p.name)}${p.isHome ? " ★" : ""}</button>`,
            )
            .join("")}
        </div>`
      : "";

  return `
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
    ${planetSwitcher}
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
        <p class="hint" data-testid="recommended-next">${escapeHtml(recommendedNext(view))}</p>
      </section>
      <div>
        <section class="panel" data-testid="research-panel">
          <h2>Research</h2>
          ${RESEARCH_ORDER.map((id) => researchRow(id, view, state.busy)).join("")}
          ${
            player.researchQueue
              ? `<div class="queue" data-testid="research-queue">Researching ${escapeHtml(RESEARCH[player.researchQueue.researchId].name)} → L${player.researchQueue.targetLevel} · ${fmtEta(remainingSeconds(player.researchQueue.completesAt, now))} left</div>`
              : `<p class="hint">Build a Research Lab first. One empire-wide project at a time.</p>`
          }
        </section>
        <section class="panel" data-testid="hull-bay-panel">
          <h2>Hull bay</h2>
          ${SHIP_ORDER.map((id) => shipRow(id, planet, state.busy)).join("")}
          ${
            planet.shipQueue
              ? `<div class="queue" data-testid="ship-queue">Assembling ${planet.shipQueue.count}× ${escapeHtml(SHIPS[planet.shipQueue.shipId].name)} · ${fmtEta(remainingSeconds(planet.shipQueue.completesAt, now))} left</div>`
              : `<p class="hint">Raise the Shipyard to unlock hulls (probes, recyclers, colony ships).</p>`
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
        <section class="panel" data-testid="defenses-panel">
          <h2>Defenses</h2>
          ${DEFENSE_ORDER.map((id) => defenseRow(id, planet, state.busy)).join("")}
          ${
            planet.defenseQueue
              ? `<div class="queue" data-testid="defense-queue">Building ${planet.defenseQueue.count}× ${escapeHtml(DEFENSES[planet.defenseQueue.defenseId].name)} · ${fmtEta(remainingSeconds(planet.defenseQueue.completesAt, now))} left</div>`
              : `<p class="hint">Static guns fight with your hangar on raids.</p>`
          }
        </section>
        ${galaxyPanel(view, state.busy)}
        <section class="panel" data-testid="fleets-panel">
          <h2>Fleets &amp; missions</h2>
          ${fleetComposer(view, state.busy, fleetDraft)}
          ${fleetsInFlight(fleets, roster, now)}
          ${reportsHtml(reports, player.id)}
          ${spyReportsHtml(spyReports)}
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
