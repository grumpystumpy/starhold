import {
  DEFENSE_ORDER,
  MOON_BUILDING_ORDER,
  RESEARCH_ORDER,
  SHIP_ORDER,
  SHIPS,
  type BuildingId,
  type PlayerView,
} from "@starhold/game";
import { PLANET_ART, SHIP_ART, UI_ART } from "./assets";
import { fmt, fmtCoords } from "./format";
import type { NavPage } from "./nav";
import {
  buildingRow,
  defenseRow,
  researchRow,
  shipRow,
} from "./render-chrome";
import { escapeAttr, escapeHtml } from "./render-escape";
import {
  expeditionReportsHtml,
  fleetComposer,
  fleetsInFlight,
  galaxyPanel,
  reportsHtml,
  sensorContactsHtml,
  spyReportsHtml,
  type FleetDraft,
} from "./render-fleets";
import { recommendedNext } from "./render-helpers";
import {
  officersPanelHtml,
  skillsPanelHtml,
} from "./render-officers-skills";
import {
  buildQueueHtml,
  defenseQueueHtml,
  overviewQueuesHtml,
  researchQueueHtml,
  shipQueueHtml,
} from "./render-queues";

const RESOURCE_BUILDINGS: BuildingId[] = [
  "metalMine",
  "crystalMine",
  "deutSynth",
  "solarPlant",
  "metalStorage",
  "crystalStorage",
  "deutTank",
];

const FACILITY_BUILDINGS_PLANET: BuildingId[] = ["shipyard", "researchLab"];
const FACILITY_BUILDINGS_MOON: BuildingId[] = MOON_BUILDING_ORDER.filter(
  (id) => !RESOURCE_BUILDINGS.includes(id),
);

function stubPanel(title: string, body: string, testId: string): string {
  return `
    <section class="panel" data-testid="${testId}">
      <h2>${escapeHtml(title)}</h2>
      <p class="hint">${escapeHtml(body)}</p>
    </section>`;
}

function overviewPage(view: PlayerView): string {
  const { planet, economy } = view;
  const pm = economy.positionMult;
  return `
    <section class="panel" data-testid="overview-panel">
      <h2>Overview</h2>
      <div class="overview-hero">
        <img class="thumb thumb-lg" src="${planet.kind === "moon" ? PLANET_ART.moon : PLANET_ART.outpost}" alt="" width="72" height="72" />
        <div>
          <p class="overview-name">${escapeHtml(planet.name)}${planet.kind === "moon" ? " · Moon" : ""}</p>
          <p class="coords">${fmtCoords(planet.coords)}</p>
          <p class="hint" data-testid="planet-fields">Fields ${economy.fields.used} / ${economy.fields.cap} · ${economy.fields.remaining} free</p>
        </div>
      </div>
      <p class="hint" data-testid="position-mult" title="Position production multipliers for this slot">
        Position × metal ${pm.metal.toFixed(2)} · crystal ${pm.crystal.toFixed(2)} · deut ${pm.deuterium.toFixed(2)} · energy ${pm.energy.toFixed(2)}
      </p>
      <h3 class="subhead">Build queues</h3>
      ${overviewQueuesHtml(view)}
      <p class="hint" data-testid="recommended-next">${escapeHtml(recommendedNext(view))}</p>
    </section>`;
}

function buildingsPage(view: PlayerView, busy: boolean): string {
  const { planet, universe, now } = view;
  const resourceIds =
    planet.kind === "moon"
      ? RESOURCE_BUILDINGS.filter((id) =>
          MOON_BUILDING_ORDER.includes(id),
        )
      : RESOURCE_BUILDINGS;
  const facilityIds =
    planet.kind === "moon"
      ? FACILITY_BUILDINGS_MOON
      : FACILITY_BUILDINGS_PLANET;
  return `
    <section class="panel" data-testid="buildings-panel">
      <h2>Buildings</h2>
      <p class="hint" data-testid="planet-fields">Fields ${view.economy.fields.used} / ${view.economy.fields.cap} · ${view.economy.fields.remaining} free</p>
      <h3 class="subhead">Extraction &amp; storage</h3>
      ${resourceIds.map((id) => buildingRow(id, planet, universe.speed, now, busy)).join("")}
      <h3 class="subhead">Structures</h3>
      ${facilityIds.map((id) => buildingRow(id, planet, universe.speed, now, busy)).join("")}
      ${
        buildQueueHtml(planet, now) ||
        (planet.kind === "moon"
          ? `<p class="hint">Moons have no mines — expand crater structures on the moon.</p>`
          : `<p class="hint">One construction at a time. Upgrade the Solar Array if mines stall.</p>`)
      }
    </section>`;
}

function researchPage(view: PlayerView, busy: boolean): string {
  const { player, now } = view;
  return `
    <section class="panel" data-testid="research-panel">
      <h2>Research</h2>
      ${RESEARCH_ORDER.map((id) => researchRow(id, view, busy)).join("")}
      ${
        researchQueueHtml(player, now) ||
        `<p class="hint">Build a Research Lab first. One empire-wide project at a time.</p>`
      }
    </section>`;
}

function shipyardPage(view: PlayerView, busy: boolean): string {
  const { planet, now } = view;
  const hangarEmpty = SHIP_ORDER.every((id) => (planet.ships[id] ?? 0) <= 0);
  return `
    <section class="panel" data-testid="hull-bay-panel">
      <h2>Shipyard</h2>
      ${SHIP_ORDER.map((id) => shipRow(id, planet, busy)).join("")}
      ${
        shipQueueHtml(planet, now) ||
        `<p class="hint">Raise the Shipyard facility to unlock hulls.</p>`
      }
    </section>
    <section class="panel" data-testid="hangar-panel">
      <h2>Hangar</h2>
      ${
        hangarEmpty
          ? `<div class="empty-hangar" data-testid="hangar-empty"><img src="${UI_ART.emptyHangar}" alt="Empty hangar" width="128" height="96" /><p class="hint">No hulls docked — build above.</p></div>`
          : `<ul class="roster" data-testid="hangar">
        ${SHIP_ORDER.map(
          (id) =>
            `<li data-testid="hangar-${id}"><span class="row-with-thumb"><img class="thumb" src="${SHIP_ART[id]}" alt="" width="36" height="36" />${escapeHtml(SHIPS[id].name)}</span><span>${planet.ships[id] ?? 0}</span></li>`,
        ).join("")}
      </ul>`
      }
    </section>`;
}

function defensesPage(view: PlayerView, busy: boolean): string {
  const { planet, now } = view;
  return `
    <section class="panel" data-testid="defenses-panel">
      <h2>Defenses</h2>
      ${DEFENSE_ORDER.map((id) => defenseRow(id, planet, busy)).join("")}
      ${
        defenseQueueHtml(planet, now) ||
        `<p class="hint">Static guns fight with your hangar on raids.</p>`
      }
    </section>`;
}

function fleetPage(
  view: PlayerView,
  busy: boolean,
  fleetDraft: FleetDraft | null,
): string {
  const fleets = view.fleets ?? [];
  const reports = view.reports ?? [];
  const spyReports = view.spyReports ?? [];
  const expeditionReports = view.expeditionReports ?? [];
  return `
    <section class="panel" data-testid="fleets-panel">
      <h2>Fleets &amp; missions</h2>
      ${fleetComposer(view, busy, fleetDraft)}
      ${fleetsInFlight(fleets, view.roster, view.now)}
      ${sensorContactsHtml(view.sensorContacts ?? [], view.roster, view.now)}
      ${reportsHtml(reports, view.player.id)}
      ${spyReportsHtml(spyReports)}
      ${expeditionReportsHtml(expeditionReports)}
    </section>`;
}

function highscorePage(view: PlayerView): string {
  return `
    <section class="panel" data-testid="highscores">
      <h2>Highscores</h2>
      <p class="hint">Empire points — buildings, fleets, defenses, and research (once). Level and lifetime XP shown.</p>
      <ol class="highscores" data-testid="highscores-list">
        ${(view.highscores ?? [])
          .map(
            (h) =>
              `<li data-testid="highscore-${h.rank}" data-player-id="${escapeAttr(h.playerId)}"><span class="row-with-thumb"><span class="hs-rank">#${h.rank}</span><img class="thumb" src="${PLANET_ART.rocky}" alt="" width="32" height="32" />${escapeHtml(h.name)}${h.playerId === view.player.id ? " (you)" : ""}</span><span>${h.points} pts · Lv ${h.level ?? 1} · ${fmt(h.xpTotal ?? 0)} XP · ${fmtCoords(h.coords)} · ${h.planetCount} world${h.planetCount === 1 ? "" : "s"}</span></li>`,
          )
          .join("")}
      </ol>
    </section>
    <section class="panel">
      <h2>Universe roster</h2>
      <ul class="roster" data-testid="roster">
        ${view.roster
          .map(
            (r) =>
              `<li><span class="row-with-thumb"><img class="thumb" src="${PLANET_ART.rocky}" alt="" width="32" height="32" />${escapeHtml(r.name)}${r.id === view.player.id ? " (you)" : ""}</span><span>${fmtCoords(r.coords)} · ${r.pointsHint} pts</span></li>`,
          )
          .join("")}
      </ul>
    </section>`;
}

export function pageHtml(
  page: NavPage,
  view: PlayerView,
  busy: boolean,
  fleetDraft: FleetDraft | null,
): string {
  switch (page) {
    case "overview":
      return overviewPage(view);
    case "buildings":
      return buildingsPage(view, busy);
    case "research":
      return researchPage(view, busy);
    case "shipyard":
      return shipyardPage(view, busy);
    case "defenses":
      return defensesPage(view, busy);
    case "fleet":
      return fleetPage(view, busy, fleetDraft);
    case "galaxy":
      return galaxyPanel(view, busy);
    case "officers":
      return officersPanelHtml(view, busy);
    case "skills":
      return skillsPanelHtml(view, busy);
    case "highscore":
      return highscorePage(view);
    case "messages":
      return stubPanel(
        "Messages",
        "Combat, espionage, and empire mail will land here. Check Fleet for reports for now.",
        "messages-stub",
      );
    default: {
      const _exhaustive: never = page;
      return _exhaustive;
    }
  }
}
