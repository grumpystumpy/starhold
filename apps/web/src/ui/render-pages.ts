import {
  DEFENSE_ORDER,
  DEFENSES,
  MAP_GALAXIES,
  MAP_SYSTEMS,
  MINI_BUILDING_ORDER,
  MINI_FORTRESS_RELOCATE_ACCURACY,
  MINI_FORTRESS_RELOCATE_GALAXY_RANGE,
  MOON_BUILDING_ORDER,
  PLANET_NAME_MAX_LEN,
  RESEARCH_ORDER,
  SHIP_ORDER,
  SHIPS,
  shipClassAllowed,
  fortressRelocateDeutCost,
  fortressRelocateLandingWindow,
  type BuildingId,
  type DefenseId,
  type PlayerView,
  type ShipId,
} from "@starhold/game";
import { SHIP_ART, UI_ART } from "./assets";
import { fmt, fmtCompact, fmtCoords } from "./format";
import { planetDiscHtml } from "./planet-disc";
import type { NavPage } from "./nav";
import { classPanelHtml } from "./render-class";
import {
  buildingRow,
  defenseRow,
  researchRow,
  shipRow,
} from "./render-chrome";
import { escapeAttr, escapeHtml } from "./render-escape";
import {
  fleetComposer,
  fleetsInFlight,
  expeditionReportsHtml,
  galaxyPanel,
  hostileInboundHtml,
  reportsHtml,
  sensorContactsHtml,
  spyReportsHtml,
  type FleetDraft,
} from "./render-fleets";
import { alliancesPageHtml } from "./render-alliances";
import { recommendedNext } from "./render-helpers";
import { goalsPageHtml } from "./render-goals";
import { messagesPageHtml } from "./render-messages";
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
import { hrefForPage } from "./router";
import { infoTooltip } from "./render-tooltips";
import { seasonsPage } from "./render-seasons";

const RESOURCE_BUILDINGS: BuildingId[] = [
  "metalMine",
  "crystalMine",
  "deutSynth",
  "solarPlant",
  "metalStorage",
  "crystalStorage",
  "deutTank",
];

const FACILITY_BUILDINGS_PLANET: BuildingId[] = [
  "shipyard",
  "researchLab",
  "rigFoundry",
  "mantleLoom",
  "chronoLathe",
];
const FACILITY_BUILDINGS_MOON: BuildingId[] = MOON_BUILDING_ORDER.filter(
  (id) => !RESOURCE_BUILDINGS.includes(id),
);
const MINI_RESOURCE_BUILDINGS: BuildingId[] = [
  "metalMine",
  "crystalMine",
  "deutSynth",
  "solarPlant",
  "metalStorage",
  "crystalStorage",
  "deutTank",
];
const MINI_FACILITY_BUILDINGS: BuildingId[] = MINI_BUILDING_ORDER.filter(
  (id) => !MINI_RESOURCE_BUILDINGS.includes(id),
);

function overviewPage(view: PlayerView, busy: boolean): string {
  const { planet, economy } = view;
  const pm = economy.positionMult;
  const loomBonus = economy.fields.mantleLoomBonus ?? 0;
  const tempK = economy.temperatureK ?? 0;
  const helio = economy.energy.helioBuoy ?? 0;
  const solarTemp = economy.energy.solarTempFactor ?? 1;
  const title = view.player.cosmetics?.activeTitle?.trim() ?? "";
  const skin = view.player.cosmetics?.activePlanetSkinId ?? "";
  return `
    <section class="panel" data-testid="overview-panel">
      <h2>Overview</h2>
      <div class="overview-hero">
        <div class="planet-frame" data-testid="planet-skin-frame" data-planet-skin="${escapeAttr(skin)}">
          ${planetDiscHtml({
            src:
              planet.kind === "moon"
                ? view.planetArt.artThumbUrl
                : view.planetArt.artUrl,
            artId: view.planetArt.artId,
            size: planet.kind === "moon" ? 96 : 168,
            className:
              planet.kind === "moon"
                ? "planet-disc-hero planet-disc-hero-moon"
                : "planet-disc-hero",
            testId: "overview-planet-art",
            lazy: false,
          })}
        </div>
        <div>
          <p class="overview-commander" data-testid="commander-name">${escapeHtml(view.player.name)}</p>
          <p class="active-title" data-testid="active-title"${title ? "" : " hidden"}>${escapeHtml(title)}</p>
          <p class="overview-name" data-testid="overview-planet-name">${escapeHtml(planet.name)}${planet.flags?.mini ? " · Mini" : planet.kind === "moon" ? " · Moon" : ""}</p>
          <p class="coords">${fmtCoords(planet.coords)}</p>
          <p class="hint" data-testid="planet-fields">Fields ${fmt(economy.fields.used)} / ${fmt(economy.fields.cap)} · ${fmt(economy.fields.remaining)} free${loomBonus > 0 ? ` · Mantle Loom +${fmt(loomBonus)}` : ""}</p>
          <p class="hint" data-testid="planet-temperature">Temp ${fmt(tempK)} K · solar ×${solarTemp.toFixed(2)}${helio > 0 ? ` · Helio Buoy +${fmt(helio)}` : ""}</p>
        </div>
      </div>
      <form class="planet-rename" id="planet-rename-form" data-testid="planet-rename-form">
        <label for="planet-rename-input">Rename colony</label>
        <div class="planet-rename-row">
          <input id="planet-rename-input" name="planetName" type="text" maxlength="${PLANET_NAME_MAX_LEN}" minlength="2" value="${escapeAttr(planet.name)}" data-testid="planet-rename-input" ${busy ? "disabled" : ""} />
          <button type="submit" data-testid="planet-rename-btn" ${busy ? "disabled" : ""}>Rename</button>
        </div>
        <p class="hint">${PLANET_NAME_MAX_LEN} chars max · letters, numbers, spaces</p>
      </form>
      <p class="hint" data-testid="position-mult" title="Position production multipliers for this slot">
        Position × metal ${pm.metal.toFixed(2)} · crystal ${pm.crystal.toFixed(2)} · deut ${pm.deuterium.toFixed(2)} · energy ${pm.energy.toFixed(2)}
        ${infoTooltip({
          title: "Position multipliers",
          lines: [
            "Slot temperature changes mine and energy output.",
            `Metal ×${pm.metal.toFixed(2)} · crystal ×${pm.crystal.toFixed(2)} · deuterium ×${pm.deuterium.toFixed(2)} · energy ×${pm.energy.toFixed(2)}`,
          ],
          testId: "position-mult-tip",
        }).html}
      </p>
      <h3 class="subhead">Build queues</h3>
      ${overviewQueuesHtml(view)}
      <p class="hint" data-testid="recommended-next">${escapeHtml(recommendedNext(view))}</p>
    </section>
    ${classPanelHtml(view, busy)}`;
}

function buildingsPage(view: PlayerView, busy: boolean): string {
  const { planet, universe, now } = view;
  const isMini = Boolean(planet.flags?.mini);
  const resourceIds = isMini
    ? MINI_RESOURCE_BUILDINGS
    : planet.kind === "moon"
      ? RESOURCE_BUILDINGS.filter((id) =>
          MOON_BUILDING_ORDER.includes(id),
        )
      : RESOURCE_BUILDINGS;
  const facilityIds = isMini
    ? MINI_FACILITY_BUILDINGS
    : planet.kind === "moon"
      ? FACILITY_BUILDINGS_MOON
      : FACILITY_BUILDINGS_PLANET;
  return `
    <section class="panel" data-testid="buildings-panel">
      <h2>Buildings</h2>
      <p class="hint" data-testid="planet-fields">Fields ${fmt(view.economy.fields.used)} / ${fmt(view.economy.fields.cap)} · ${fmt(view.economy.fields.remaining)} free</p>
      ${
        isMini
          ? `<p class="hint" data-testid="mini-planet-hint">Mini planet — rich mines + specials${
              planet.flags?.miniKind && planet.flags.miniKind !== "standard"
                ? ` · ${planet.flags.miniKind}`
                : ""
            }.</p>`
          : ""
      }
      <h3 class="subhead">Extraction &amp; storage</h3>
      ${resourceIds.map((id) => buildingRow(id, planet, view.player, universe.speed, now, busy)).join("")}
      <h3 class="subhead">${isMini ? "Structures &amp; anomaly specials" : "Structures"}</h3>
      ${facilityIds.map((id) => buildingRow(id, planet, view.player, universe.speed, now, busy)).join("")}
      ${
        buildQueueHtml(planet, now) ||
        (isMini
          ? `<p class="hint">Minis allow normal buildings plus Rift Siphon, Echo Vault, Anomaly Forge, and Drift Beacon.</p>`
          : planet.kind === "moon"
          ? `<p class="hint">Moons have no mines — expand crater structures on the moon.</p>`
          : `<p class="hint">One construction at a time. Upgrade the Solar Array if mines stall.</p>`)
      }
      ${fortressRelocatePanel(view, busy)}
    </section>`;
}

function fortressRelocatePanel(view: PlayerView, busy: boolean): string {
  const { planet } = view;
  if (planet.flags?.miniKind !== "fortress") return "";
  const aimG = planet.coords.galaxy;
  const aimS = planet.coords.system;
  const window = fortressRelocateLandingWindow(aimG, aimS);
  const cost = fortressRelocateDeutCost(planet.coords, aimG, aimS);
  const gMin = Math.max(1, planet.coords.galaxy - MINI_FORTRESS_RELOCATE_GALAXY_RANGE);
  const gMax = Math.min(
    MAP_GALAXIES,
    planet.coords.galaxy + MINI_FORTRESS_RELOCATE_GALAXY_RANGE,
  );
  return `
    <h3 class="subhead">Fortress jump</h3>
    <p class="hint" data-testid="fortress-landing-window">
      Aim a system in galaxy ${gMin}–${gMax}. Landing window for current aim:
      <strong>${window.galaxy}:${window.systemMin}–${window.galaxy}:${window.systemMax}</strong>
      (±${MINI_FORTRESS_RELOCATE_ACCURACY} systems). Free mini slot on landing. Est. cost at current aim: ${fmt(cost)} deut.
    </p>
    <form id="fortress-relocate-form" class="inline-form" data-testid="fortress-relocate-form">
      <label>Galaxy <input id="fortress-aim-galaxy" name="galaxy" type="number" min="${gMin}" max="${gMax}" value="${aimG}" ${busy ? "disabled" : ""} /></label>
      <label>System <input id="fortress-aim-system" name="system" type="number" min="1" max="${MAP_SYSTEMS}" value="${aimS}" ${busy ? "disabled" : ""} /></label>
      <button type="submit" ${busy ? "disabled" : ""}>Jump</button>
    </form>
  `;
}

function researchPage(view: PlayerView, busy: boolean): string {
  const { player, now } = view;
  return `
    <section class="panel" data-testid="research-panel">
      <h2>Research</h2>
      ${RESEARCH_ORDER.map((id) => researchRow(id, view, busy)).join("")}
      ${
        researchQueueHtml(player, now) ||
        ((view.planet.buildings.researchLab ?? 0) < 1 &&
        view.ownedPlanets.every((p) => (p.researchLab ?? 0) < 1)
          ? `<p class="hint">Build a Research Lab first. One empire-wide project at a time.</p>`
          : `<p class="hint">One empire-wide project at a time.</p>`)
      }
    </section>`;
}

function shipCombatStrength(id: ShipId): number {
  const def = SHIPS[id];
  return (def?.attack ?? 0) + (def?.shield ?? 0) + (def?.hull ?? 0);
}

function defenseCombatStrength(id: DefenseId): number {
  const def = DEFENSES[id];
  return (def?.attack ?? 0) + (def?.shield ?? 0) + (def?.hull ?? 0);
}

const SHIP_ORDER_INDEX = new Map(SHIP_ORDER.map((id, index) => [id, index]));
const DEFENSE_ORDER_INDEX = new Map(
  DEFENSE_ORDER.map((id, index) => [id, index]),
);

function compareShipsWeakestFirst(a: ShipId, b: ShipId): number {
  const diff = shipCombatStrength(a) - shipCombatStrength(b);
  if (diff !== 0) return diff;
  return (SHIP_ORDER_INDEX.get(a) ?? 0) - (SHIP_ORDER_INDEX.get(b) ?? 0);
}

function compareDefensesWeakestFirst(a: DefenseId, b: DefenseId): number {
  const diff = defenseCombatStrength(a) - defenseCombatStrength(b);
  if (diff !== 0) return diff;
  return (DEFENSE_ORDER_INDEX.get(a) ?? 0) - (DEFENSE_ORDER_INDEX.get(b) ?? 0);
}

export const WEAKEST_FIRST_SHIPS: ShipId[] = [...SHIP_ORDER].sort(
  compareShipsWeakestFirst,
);

export const WEAKEST_FIRST_DEFENSES: DefenseId[] = [...DEFENSE_ORDER].sort(
  compareDefensesWeakestFirst,
);

export function shipyardPage(view: PlayerView, busy: boolean): string {
  const { planet, now } = view;
  const classId = view.player.playerClass?.classId ?? null;
  const buildable = WEAKEST_FIRST_SHIPS.filter((id) =>
    shipClassAllowed(id, classId),
  );
  const hangarEmpty = SHIP_ORDER.every((id) => (planet.ships[id] ?? 0) <= 0);
  return `
    <section class="panel" data-testid="hull-bay-panel">
      <h2>Shipyard</h2>
      ${
        classId == null
          ? `<p class="hint" data-testid="shipyard-need-class">Choose a class on Overview to unlock class-exclusive hulls.</p>`
          : ""
      }
      ${buildable.map((id) => shipRow(id, planet, busy)).join("")}
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
        ${SHIP_ORDER.map((id) => {
          const def = SHIPS[id];
          const count = planet.ships[id] ?? 0;
          const tip = infoTooltip({
            title: def.name,
            lines: [
              def.description,
              `In hangar ${fmt(count)} · cargo ${fmt(def.cargo)} · atk ${fmt(def.attack)}`,
            ],
            testId: `hangar-tip-${id}`,
          });
          return `<li data-testid="hangar-${id}"><span class="row-with-thumb"><img class="thumb" src="${SHIP_ART[id]}" alt="" width="36" height="36" />${escapeHtml(def.name)} ${tip.html}</span><span data-testid="hangar-count-${id}">${fmt(count)}</span></li>`;
        }).join("")}
      </ul>`
      }
    </section>`;
}

export function defensesPage(view: PlayerView, busy: boolean): string {
  const { planet, now } = view;
  return `
    <section class="panel" data-testid="defenses-panel">
      <h2>Defenses</h2>
      ${WEAKEST_FIRST_DEFENSES.map((id) => defenseRow(id, planet, busy)).join("")}
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
  const mailHref = hrefForPage("messages", {
    playerId: view.player.id,
    planetId: view.planet.id,
  });
  const mailCount =
    (view.reports?.length ?? 0) +
    (view.spyReports?.length ?? 0) +
    (view.expeditionReports?.length ?? 0) +
    (view.player.eventLog?.length ?? 0);
  return `
    <section class="panel" data-testid="fleets-panel">
      <h2>Fleets &amp; missions</h2>
      ${fleetComposer(view, busy, fleetDraft)}
      ${fleetsInFlight(fleets, view.roster, view.now)}
      ${hostileInboundHtml(view.hostileInbound ?? [], view.roster, view.now)}
      ${sensorContactsHtml(view.sensorContacts ?? [], view.roster, view.now)}
      ${reportsHtml(view.reports ?? [], view.player.id)}
      ${spyReportsHtml(view.spyReports ?? [], Boolean(view.alliance))}
      ${expeditionReportsHtml(view.expeditionReports ?? [])}
      <p class="hint" data-testid="fleet-messages-link">Reports and alerts (${fmt(mailCount)}) live in <a href="${escapeAttr(mailHref)}" data-nav="messages" data-testid="fleet-open-messages">Messages</a>.</p>
    </section>`;
}

function highscorePage(view: PlayerView): string {
  return `
    <section class="panel" data-testid="highscores">
      <h2>Highscores</h2>
      <p class="hint">One row per commander — their home planet only. Points still count the whole empire.</p>
      <ol class="highscores" data-testid="highscores-list">
        ${(view.highscores ?? [])
          .map(
            (h) =>
              `<li data-testid="highscore-${h.rank}" data-player-id="${escapeAttr(h.playerId)}" data-home-planet="${escapeAttr(h.homePlanetId)}"><span class="row-with-thumb"><span class="hs-rank">#${fmt(h.rank)}</span>${planetDiscHtml({ src: h.artThumbUrl, artId: h.artId, size: 32 })}${h.allianceTag ? `[${escapeHtml(h.allianceTag)}] ` : ""}${escapeHtml(h.name)}${h.playerId === view.player.id ? " (you)" : ""}</span><span>Home ${escapeHtml(h.planetName || "world")} · ${fmtCoords(h.coords)} · ${fmtCompact(h.points)} pts · Lv ${fmt(h.level ?? 1)} · ${fmt(h.xpTotal ?? 0)} XP</span></li>`,
          )
          .join("")}
      </ol>
    </section>
    <section class="panel">
      <h2>Universe roster</h2>
      <p class="hint">Home planets only.</p>
      <ul class="roster" data-testid="roster">
        ${view.roster
          .map(
            (r) =>
              `<li data-home-planet="${escapeAttr(r.planetId)}"><span class="row-with-thumb">${planetDiscHtml({ src: r.artThumbUrl, artId: r.artId, size: 32 })}${r.allianceTag ? `[${escapeHtml(r.allianceTag)}] ` : ""}${escapeHtml(r.name)}${r.id === view.player.id ? " (you)" : ""}</span><span>Home ${escapeHtml(r.planetName || "world")} · ${fmtCoords(r.coords)} · ${fmtCompact(r.pointsHint)} pts</span></li>`,
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
      return overviewPage(view, busy);
    case "goals":
      return goalsPageHtml(view, busy);
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
    case "alliances":
      return alliancesPageHtml(view, busy);
    case "seasons":
      return seasonsPage(view, busy);
    case "messages":
      return messagesPageHtml(view, { busy });
    default: {
      const _exhaustive: never = page;
      return _exhaustive;
    }
  }
}
