import {
  PRODUCTION_MULT,
  type PlayerView,
} from "@starhold/game";
import { PLANET_ART, RESOURCE_ART } from "./assets";
import { fmt, fmtCoords } from "./format";
import { NAV_LABELS, NAV_PAGES, type NavPage } from "./nav";
import { flashHtml, resBlock } from "./render-chrome";
import { escapeAttr, escapeHtml } from "./render-escape";
import { storageFillTitle } from "./render-tooltips";

function resourceBar(view: PlayerView): string {
  const { planet, economy } = view;
  const shards = view.starshards ?? 0;
  return `
    <section class="resource-bar" aria-label="Resources" data-testid="resources">
      ${resBlock("metal", "Metal", planet.resources.metal, economy.productionPerHour.metal, economy.storage.metal, RESOURCE_ART.metal)}
      ${resBlock("crystal", "Crystal", planet.resources.crystal, economy.productionPerHour.crystal, economy.storage.crystal, RESOURCE_ART.crystal)}
      ${resBlock("deuterium", "Deuterium", planet.resources.deuterium, economy.productionPerHour.deuterium, economy.storage.deuterium, RESOURCE_ART.deuterium)}
      <div class="res energy" title="${escapeAttr(`Energy factor ${(economy.energy.factor * 100).toFixed(0)}% · produced ${fmt(economy.energy.produced)} · used ${fmt(economy.energy.used)}`)}" data-testid="res-energy">
        <span class="res-head"><img class="icon" src="${RESOURCE_ART.energy}" alt="" width="28" height="28" /><span class="label">Energy</span></span>
        <span class="value">${fmt(economy.energy.produced)} / ${fmt(economy.energy.used)}</span>
        <span class="sub">Factor ${(economy.energy.factor * 100).toFixed(0)}%</span>
      </div>
      <div class="res starshards" title="Starshards (premium in-game currency)" data-testid="res-starshards">
        <span class="res-head"><span class="label">Starshards</span></span>
        <span class="value">${fmt(shards)}</span>
        <span class="sub">earned in-game</span>
      </div>
    </section>`;
}

function leftNav(active: NavPage): string {
  return `
    <nav class="side-nav" aria-label="Game menu" data-testid="side-nav">
      <ul>
        ${NAV_PAGES.map(
          (id) =>
            `<li><button type="button" class="nav-link${id === active ? " active" : ""}" data-nav="${id}" data-testid="nav-${id}">${NAV_LABELS[id]}</button></li>`,
        ).join("")}
      </ul>
    </nav>`;
}

function planetSwitcher(
  view: PlayerView,
  busy: boolean,
): string {
  const bodies = view.ownedPlanets;
  if (bodies.length === 0) return "";
  return `
    <aside class="planet-rail" aria-label="Planets and moons" data-testid="planet-switch">
      <h2 class="rail-title">Empire</h2>
      <ul class="planet-list">
        ${bodies
          .map((p) => {
            const art = p.isMoon ? PLANET_ART.moon : PLANET_ART.rocky;
            const label = `${escapeHtml(p.name)}${p.isMoon ? " · Moon" : ""}${p.isHome ? " ★" : ""}`;
            return `<li>
              <button type="button" data-select-planet="${escapeAttr(p.id)}" data-testid="select-planet-${p.id}" class="planet-chip${p.isActive ? " active" : ""}" ${busy ? "disabled" : ""} title="${escapeAttr(fmtCoords(p.coords))}">
                <img class="thumb" src="${art}" alt="" width="36" height="36" />
                <span class="planet-chip-text">
                  <span class="planet-chip-name">${label}</span>
                  <span class="planet-chip-coords">${fmtCoords(p.coords)}</span>
                </span>
              </button>
            </li>`;
          })
          .join("")}
      </ul>
    </aside>`;
}

export function shellHtml(
  view: PlayerView,
  state: { error: string | null; notice: string | null; busy: boolean },
  activePage: NavPage,
  mainHtml: string,
): string {
  const { planet, universe } = view;
  const heroArt =
    planet.kind === "moon" ? PLANET_ART.moon : PLANET_ART.outpost;

  // Enrich resource blocks with storage titles via patch after — resBlock is shared.
  // Inject title attributes by wrapping amounts in the bar already.

  return `
    <div class="game-shell" data-testid="game-shell" data-page="${activePage}">
      <header class="topbar shell-top">
        <div class="topbar-brand">
          <img class="thumb thumb-lg" src="${heroArt}" alt="" width="56" height="56" />
          <div>
            <h1 class="brand">Starhold</h1>
            <div class="coords" data-testid="planet-coords">${escapeHtml(planet.name)}${planet.kind === "moon" ? " · Moon" : ""} · ${fmtCoords(planet.coords)} · ${escapeHtml(universe.name)} @ ${universe.speed}×${Number(PRODUCTION_MULT) > 1 ? ` · income ×${PRODUCTION_MULT} (test)` : ""}</div>
          </div>
        </div>
        <div class="topbar-actions">
          <button type="button" class="ghost" id="refresh-btn" data-testid="refresh-btn" ${state.busy ? "disabled" : ""}>Refresh</button>
        </div>
      </header>
      ${flashHtml(state.error, state.notice)}
      ${resourceBar(view)}
      <div class="shell-body">
        ${leftNav(activePage)}
        <main class="shell-main" data-testid="page-${activePage}" id="page-main">
          ${mainHtml}
        </main>
        ${planetSwitcher(view, state.busy)}
      </div>
    </div>`;
}

/** Patch res blocks with storage fill titles (amounts / cap / rate). */
export function enrichResourceTitles(view: PlayerView, html: string): string {
  const { planet, economy } = view;
  const map: Array<[string, number, number, number]> = [
    [
      "metal",
      planet.resources.metal,
      economy.storage.metal,
      economy.productionPerHour.metal,
    ],
    [
      "crystal",
      planet.resources.crystal,
      economy.storage.crystal,
      economy.productionPerHour.crystal,
    ],
    [
      "deuterium",
      planet.resources.deuterium,
      economy.storage.deuterium,
      economy.productionPerHour.deuterium,
    ],
  ];
  let out = html;
  for (const [cls, amount, cap, perHour] of map) {
    const title = storageFillTitle(amount, cap, perHour);
    out = out.replace(
      `class="res ${cls}" data-testid="res-${cls}"`,
      `class="res ${cls}" data-testid="res-${cls}" title="${title}"`,
    );
  }
  return out;
}
