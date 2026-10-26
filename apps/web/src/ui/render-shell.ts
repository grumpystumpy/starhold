import {
  PRODUCTION_MULT,
  unreadEventCount,
  type PlayerView,
} from "@starhold/game";
import { RESOURCE_ART } from "./assets";
import { fmt, fmtCoords } from "./format";
import { planetDiscHtml } from "./planet-disc";
import { NAV_LABELS, NAV_PAGES, type NavPage } from "./nav";
import { flashHtml, resBlock } from "./render-chrome";
import { escapeAttr, escapeHtml } from "./render-escape";
import { hrefForPage } from "./router";
import { session } from "../session";
import { infoTooltip, storageFillTitle } from "./render-tooltips";

function resourceBar(view: PlayerView, busy: boolean): string {
  const { planet, economy } = view;
  const shards = view.starshards ?? 0;
  const canClaim = Boolean(view.dailyLoginAvailable) && !busy;
  const metalTip = infoTooltip({
    title: "Metal",
    lines: [
      "Primary build and hull material.",
      "Hover/tap the bar for live storage fill (amount / cap / rate).",
    ],
    testId: "res-tip-metal",
  });
  const crystalTip = infoTooltip({
    title: "Crystal",
    lines: [
      "Used for research, electronics, and advanced hulls.",
      "Hover/tap the bar for live storage fill (amount / cap / rate).",
    ],
    testId: "res-tip-crystal",
  });
  const deutTip = infoTooltip({
    title: "Deuterium",
    lines: [
      "Fuel for fleets and some facilities.",
      "Hover/tap the bar for live storage fill (amount / cap / rate).",
    ],
    testId: "res-tip-deuterium",
  });
  const energyTip = infoTooltip({
    title: "Energy",
    lines: [
      "Powers mines; deficit slows production (factor < 100%).",
      "Produced vs used shown on the bar; expand Solar Array if short.",
    ],
    testId: "res-tip-energy",
  });
  const shardsTip = infoTooltip({
    title: "Starshards",
    lines: [
      "Premium in-game currency (no real money).",
      "Earn from expeditions, pirates, and daily login.",
      "Spend in the Shop on resources, officers, and skills.",
    ],
    testId: "res-tip-starshards",
  });
  return `
    <section class="resource-bar" aria-label="Resources" data-testid="resources">
      ${resBlock("metal", `Metal ${metalTip.html}`, planet.resources.metal, economy.productionPerHour.metal, economy.storage.metal, RESOURCE_ART.metal)}
      ${resBlock("crystal", `Crystal ${crystalTip.html}`, planet.resources.crystal, economy.productionPerHour.crystal, economy.storage.crystal, RESOURCE_ART.crystal)}
      ${resBlock("deuterium", `Deuterium ${deutTip.html}`, planet.resources.deuterium, economy.productionPerHour.deuterium, economy.storage.deuterium, RESOURCE_ART.deuterium)}
      <div class="res energy${economy.energy.factor < 1 ? " deficit" : ""}" title="${escapeAttr(`Energy factor ${(economy.energy.factor * 100).toFixed(0)}% · produced ${fmt(economy.energy.produced)} · used ${fmt(economy.energy.used)}`)}" data-testid="res-energy">
        <span class="res-head"><img class="icon" src="${RESOURCE_ART.energy}" alt="" width="28" height="28" /><span class="label">Energy ${energyTip.html}</span></span>
        <span class="value">${fmt(economy.energy.produced)} / ${fmt(economy.energy.used)}</span>
        <span class="sub">Factor ${(economy.energy.factor * 100).toFixed(0)}%</span>
      </div>
      <div class="res starshards" title="Starshards (premium in-game currency)" data-testid="res-starshards">
        <span class="res-head"><span class="label">Starshards ${shardsTip.html}</span></span>
        <span class="value" data-testid="starshards-balance">${fmt(shards)}</span>
        <span class="sub">earned in-game</span>
        <button type="button" class="ghost claim-daily" data-claim-daily data-testid="claim-daily" ${canClaim ? "" : "disabled"}>${view.dailyLoginAvailable ? "Claim daily +15" : "Daily claimed"}</button>
      </div>
    </section>`;
}

function navQuery(view: PlayerView): { playerId: string; planetId: string } {
  return { playerId: view.player.id, planetId: view.planet.id };
}

function planetDropdown(view: PlayerView, busy: boolean): string {
  const bodies =
    view.ownedPlanets.length > 0
      ? view.ownedPlanets
      : [
          {
            id: view.planet.id,
            name: view.planet.name,
            coords: view.planet.coords,
            isHome: true,
            isActive: true,
            isMoon: view.planet.kind === "moon",
            isMini: Boolean(view.planet.flags?.mini),
          },
        ];
  const options = bodies
    .map((p) => {
      const label = `${p.name}${p.isMini ? " · Mini" : p.isMoon ? " · Moon" : ""}${p.isHome ? " ★" : ""} (${fmtCoords(p.coords)})`;
      const selected = p.isActive || p.id === view.planet.id ? " selected" : "";
      return `<option value="${escapeAttr(p.id)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
  return `<label class="nav-dropdown-wrap" data-testid="planet-dropdown-wrap"><span class="nav-dropdown-label">Colony</span><select class="nav-dropdown" data-planet-select data-testid="planet-dropdown" aria-label="Planets, moons, and mini planets" ${busy ? "disabled" : ""}>${options}</select></label>`;
}

function leftNav(view: PlayerView, active: NavPage): string {
  const q = navQuery(view);
  return `
    <nav class="side-nav" aria-label="Game menu" data-testid="side-nav">
      <ul>
        ${NAV_PAGES.map((id) => {
          const href = hrefForPage(id, q);
          const unread = id === "messages" ? unreadEventCount(view.player) : 0;
          const badge =
            unread > 0
              ? `<span class="nav-badge" data-testid="nav-messages-badge">${fmt(unread)}</span>`
              : "";
          return `<li><a href="${escapeAttr(href)}" class="nav-link${id === active ? " active" : ""}" data-nav="${id}" data-testid="nav-${id}">${NAV_LABELS[id]}${badge}</a></li>`;
        }).join("")}
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
            const label = `${escapeHtml(p.name)}${p.isMini ? " · Mini" : p.isMoon ? " · Moon" : ""}${p.isHome ? " ★" : ""}`;
            const disc = planetDiscHtml({
              src: p.artThumbUrl,
              artId: p.artId,
              size: p.isMoon ? 28 : 36,
              className: p.isMoon ? "planet-disc-moon" : undefined,
            });
            return `<li>
              <button type="button" data-select-planet="${escapeAttr(p.id)}" data-testid="select-planet-${p.id}" class="planet-chip${p.isActive ? " active" : ""}" ${busy ? "disabled" : ""} title="${escapeAttr(fmtCoords(p.coords))}">
                ${disc}
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
  const heroArt = planetDiscHtml({
    src: view.planetArt.artThumbUrl,
    artId: view.planetArt.artId,
    size: planet.kind === "moon" ? 44 : 56,
    className:
      planet.kind === "moon"
        ? "planet-disc-top planet-disc-moon"
        : "planet-disc-top",
    lazy: false,
  });

  // Enrich resource blocks with storage titles via patch after — resBlock is shared.
  // Inject title attributes by wrapping amounts in the bar already.

  const progress = view.progress ?? {
    level: view.player.level ?? 1,
    xp: view.player.xp ?? 0,
    xpToNext: 100,
    xpTotal: view.player.xpTotal ?? 0,
  };
  const xpPct = Math.min(
    100,
    Math.floor((progress.xp / Math.max(1, progress.xpToNext)) * 100),
  );

  const coordLink = `<a href="/galaxy?galaxy=${planet.coords.galaxy}&amp;system=${planet.coords.system}" class="coord-link" data-galaxy-coords="${fmtCoords(planet.coords)}">${fmtCoords(planet.coords)}</a>`;
  return `
    <div class="game-shell" data-testid="game-shell" data-page="${activePage}" data-planet-id="${escapeAttr(planet.id)}" data-busy="${state.busy ? "1" : "0"}">
      <header class="topbar shell-top">
        ${planetDropdown(view, state.busy)}
        <div class="topbar-brand">
          ${heroArt}
          <div>
            <h1 class="brand">Starhold</h1>
            <div class="coords" data-testid="planet-coords">${escapeHtml(planet.name)}${planet.flags?.mini ? " · Mini" : planet.kind === "moon" ? " · Moon" : ""} · ${coordLink} · ${escapeHtml(universe.name)} @ ${universe.speed}×${Number(PRODUCTION_MULT) > 1 ? ` · income ×${PRODUCTION_MULT} (test)` : ""}</div>
          </div>
        </div>
        ${view.newbieBonusEndsAt != null && view.newbieBonusEndsAt - view.now > 0 ? `<div class="topbar-newbie-badge" data-testid="newbie-bonus-badge">Newbie bonus: +50% prod · +100% def (${Math.ceil((view.newbieBonusEndsAt - view.now) / (60 * 60 * 1000))}h left)</div>` : ""}
        <div class="topbar-progress" data-testid="player-level" title="Lifetime XP ${fmt(progress.xpTotal)}">
          <span class="level-label">Lv ${fmt(progress.level)} ${infoTooltip({
            title: `Commander level ${fmt(progress.level)}`,
            lines: [
              `Progress ${fmt(progress.xp)} / ${fmt(progress.xpToNext)} XP to next level.`,
              `Lifetime XP ${fmt(progress.xpTotal)}.`,
              "XP comes from buildings, fleets, defenses, and research.",
            ],
            testId: "level-tip",
          }).html}</span>
          <div class="xp-bar" data-testid="xp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${progress.xpToNext}" aria-valuenow="${progress.xp}" aria-label="Experience">
            <div class="xp-fill" style="width:${xpPct}%"></div>
            <span class="xp-text">${fmt(progress.xp)} / ${fmt(progress.xpToNext)}</span>
          </div>
        </div>
      </header>
      <div data-flash-slot>${flashHtml(state.error, state.notice)}</div>
      <button type="button" class="idle-pause" data-testid="idle-pause"${session.idlePaused ? "" : " hidden"}>Paused, tap to resume</button>
      ${resourceBar(view, state.busy)}
      <div class="shell-body">
        ${leftNav(view, activePage)}
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
