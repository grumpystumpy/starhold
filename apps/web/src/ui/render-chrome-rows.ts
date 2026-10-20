import {
  DEFENSES,
  RESEARCH,
  SHIPS,
  canAfford,
  defenseCost,
  previewResearchUpgrade,
  researchUpgradeSeconds,
  type DefenseId,
  type PlayerView,
  type ResearchId,
  type ShipId,
} from "@starhold/game";
import {
  DEFENSE_ART,
  SHIP_ART,
} from "./assets";
import { fmt, fmtCost, fmtEta } from "./format";
import { escapeHtml } from "./render-escape";
import { costTooltip } from "./render-tooltips";

export function shipRow(
  id: ShipId,
  planet: PlayerView["planet"],
  _busy: boolean,
): string {
  const def = SHIPS[id];
  const count = planet.ships?.[id] ?? 0;
  const yard = planet.buildings.shipyard ?? 0;
  const locked = yard < def.shipyardLevel;
  const affordable = canAfford(planet.resources, def.cost);
  const queueFull = (planet.shipQueue?.length ?? 0) >= 8;
  let label = "Build";
  if (locked) label = "Locked";
  else if (queueFull) label = "Queue full";
  else if (!affordable) label = "Can't afford";
  const lockMsg = `Needs Shipyard level ${fmt(def.shipyardLevel)} (you have ${fmt(yard)}).`;
  const blocked = locked
    ? lockMsg
    : queueFull
      ? "Ship queue is full."
      : !affordable
        ? "Not enough resources."
        : null;
  const tip = costTooltip({
    action: `Build ${def.name}`,
    cost: def.cost,
    detail: def.description,
    requires: [
      `Shipyard L${fmt(def.shipyardLevel)}+`,
      `Cargo ${fmt(def.cargo)} · atk ${fmt(def.attack)}`,
    ],
    blocked,
  });
  // Locked hulls are disabled so mis-clicks cannot set busy and silence Upgrade.
  // Unlocked Build stays enabled during client busy (same reason as Upgrade).
  return `
    <article class="item item-thumb" data-testid="ship-${id}">
      <img class="thumb" src="${SHIP_ART[id]}" alt="" width="48" height="48" />
      <div>
        <h3>${escapeHtml(def.name)} <span class="meta">Owned ${fmt(count)}</span> ${tip.html}</h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">${fmtCost(def.cost)} each · yard L${fmt(def.shipyardLevel)}+ · cargo ${fmt(def.cargo)} · atk ${fmt(def.attack)}${
          locked ? ` · ${escapeHtml(lockMsg)}` : ""
        }</div>
      </div>
      <div class="actions">
        <input type="number" min="1" max="50" value="1" data-ship-count="${id}" data-testid="ship-count-${id}" ${locked ? "disabled" : ""} style="min-width:4rem;width:4.5rem" />
        <button type="button" data-ship="${id}" data-locked="${locked ? "1" : "0"}" data-testid="build-${id}" ${locked ? "disabled" : ""} title="${tip.title}">${label}</button>
      </div>
    </article>
  `;
}

export function defenseRow(
  id: DefenseId,
  planet: PlayerView["planet"],
  _busy: boolean,
): string {
  const def = DEFENSES[id];
  const have = planet.defenses?.[id] ?? 0;
  const yard = planet.buildings.shipyard ?? 0;
  const locked = yard < def.shipyardLevel;
  const cost = defenseCost(id, 1);
  const affordable = canAfford(planet.resources, cost);
  const queueFull = (planet.defenseQueue?.length ?? 0) >= 8;
  let label = "Build";
  if (locked) label = "Locked";
  else if (queueFull) label = "Queue full";
  else if (!affordable) label = "Can't afford";
  const blocked = locked
    ? `Needs Shipyard level ${fmt(def.shipyardLevel)}`
    : queueFull
      ? "Defense queue is full."
      : !affordable
        ? "Not enough resources."
        : null;
  const tip = costTooltip({
    action: `Build ${def.name}`,
    cost,
    detail: def.description,
    requires: [
      `Shipyard L${fmt(def.shipyardLevel)}+`,
      `Attack ${fmt(def.attack)}`,
    ],
    blocked,
  });
  return `
    <article class="item item-thumb" data-testid="defense-${id}">
      <img class="thumb" src="${DEFENSE_ART[id]}" alt="" width="48" height="48" />
      <div>
        <h3>${escapeHtml(def.name)} <span class="meta">Owned ${fmt(have)}</span> ${tip.html}</h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">${fmtCost(cost)} each · yard L${fmt(def.shipyardLevel)}+ · atk ${fmt(def.attack)}</div>
      </div>
      <div class="actions">
        <input type="number" min="1" max="50" value="1" data-defense-count="${id}" data-testid="defense-count-${id}" ${locked ? "disabled" : ""} style="min-width:4rem;width:4.5rem" />
        <button type="button" data-defense="${id}" data-locked="${locked ? "1" : "0"}" data-testid="build-defense-${id}" ${locked ? "disabled" : ""} title="${tip.title}">${label}</button>
      </div>
    </article>
  `;
}

/** Best Research Lab in the empire, including colonies that are not open. */
export function bestResearchLab(view: PlayerView): number {
  let best = view.planet.buildings.researchLab ?? 0;
  for (const owned of view.ownedPlanets) {
    if (typeof owned.researchLab === "number") {
      best = Math.max(best, owned.researchLab);
    }
  }
  return best;
}

function researchButtonLabel(error: string | null): string {
  if (!error) return "Research";
  if (error.includes("queue is full")) return "Queue full";
  const needs = error.match(/Needs Research Lab level (\d+)/);
  if (needs) return `Needs lab ${fmt(Number(needs[1]))}`;
  if (error.startsWith("Not enough")) return "Can't afford";
  return "Unavailable";
}

export function researchRow(
  id: ResearchId,
  view: PlayerView,
  _busy: boolean,
): string {
  const def = RESEARCH[id];
  const level = view.player.research?.[id] ?? 0;
  const lab = bestResearchLab(view);
  const preview = previewResearchUpgrade(
    view.player,
    view.planet,
    id,
    lab,
    view.now,
  );
  const cost = preview.cost;
  const secs = Math.ceil(
    researchUpgradeSeconds(id, preview.current, Math.max(1, lab)) /
      view.universe.speed,
  );
  const blocked = preview.ok ? null : preview.error;
  const label = researchButtonLabel(blocked);
  const tip = costTooltip({
    action: `Research ${def.name} → L${fmt(preview.current + 1)}`,
    cost,
    timeSecs: secs,
    detail: def.description,
    requires: [
      `Research Lab L${fmt(def.labLevel)}+`,
      `Best lab L${fmt(lab)}`,
      `Current L${fmt(level)}`,
    ],
    blocked,
  });
  return `
    <article class="item" data-testid="research-${id}">
      <div>
        <h3>${escapeHtml(def.name)} <span class="meta" data-testid="research-level-${id}">L${fmt(level)}</span> ${tip.html}</h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">Next: ${fmtCost(cost)} · ${fmtEta(secs)}</div>
      </div>
      <div class="actions">
        <button type="button" data-research="${id}" data-locked="${blocked ? "1" : "0"}" data-testid="research-btn-${id}" ${blocked ? "disabled" : ""} title="${tip.title}">${label}</button>
      </div>
    </article>
  `;
}
