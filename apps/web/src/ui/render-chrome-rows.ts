import {
  DEFENSES,
  PLAYER_CLASS_BONUSES,
  RESEARCH,
  RESEARCH_ORDER,
  SHIPS,
  canAfford,
  classBonuses,
  defenseCost,
  defenseUnitBuildSeconds,
  levelBonuses,
  playerBoosts,
  previewResearchUpgrade,
  researchUpgradeSeconds,
  scaleResourceCost,
  shipUnitBuildSeconds,
  type DefenseId,
  type PlayerView,
  type ResearchId,
  type ShipId,
} from "@starhold/game";
import {
  DEFENSE_ART,
  RESEARCH_ART,
  SHIP_ART,
} from "./assets";
import { fmt, fmtCost, fmtEta } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";
import { blockedActionNote, costTooltip } from "./render-tooltips";

export function buildQuantityReason(opts: {
  count: number;
  locked: string | null;
  queue: string | null;
  cost: { metal: number; crystal: number; deuterium: number };
  have: { metal: number; crystal: number; deuterium: number };
}): string | null {
  if (opts.locked) return opts.locked;
  if (opts.queue) return opts.queue;
  const count = Math.max(1, Math.floor(opts.count) || 1);
  const short =
    opts.have.metal < opts.cost.metal * count ||
    opts.have.crystal < opts.cost.crystal * count ||
    opts.have.deuterium < opts.cost.deuterium * count;
  return short ? "Not enough resources." : null;
}

export function syncBuildCountReason(input: HTMLInputElement): void {
  const article = input.closest("article");
  const note = article?.querySelector<HTMLElement>("[data-build-reason]");
  const button = article?.querySelector<HTMLButtonElement>("button");
  if (!note || !button) return;
  const reason = buildQuantityReason({
    count: Number(input.value),
    locked: note.dataset.lockedReason || null,
    queue: note.dataset.queueReason || null,
    cost: {
      metal: Number(note.dataset.costMetal ?? 0),
      crystal: Number(note.dataset.costCrystal ?? 0),
      deuterium: Number(note.dataset.costDeuterium ?? 0),
    },
    have: {
      metal: Number(note.dataset.haveMetal ?? 0),
      crystal: Number(note.dataset.haveCrystal ?? 0),
      deuterium: Number(note.dataset.haveDeuterium ?? 0),
    },
  });
  note.textContent = reason ?? "";
  note.hidden = !reason;
  button.disabled = Boolean(reason);
  if (reason) button.setAttribute("aria-describedby", note.id);
  else button.removeAttribute("aria-describedby");
}

function quantityNote(
  testId: string,
  reason: string | null,
  locked: string | null,
  queue: string | null,
  cost: { metal: number; crystal: number; deuterium: number },
  have: { metal: number; crystal: number; deuterium: number },
): string {
  const id = testId;
  const attrs = [
    `data-build-reason`,
    `data-cost-metal="${cost.metal}"`,
    `data-cost-crystal="${cost.crystal}"`,
    `data-cost-deuterium="${cost.deuterium}"`,
    `data-have-metal="${have.metal}"`,
    `data-have-crystal="${have.crystal}"`,
    `data-have-deuterium="${have.deuterium}"`,
    locked ? `data-locked-reason="${escapeAttr(locked)}"` : "",
    queue ? `data-queue-reason="${escapeAttr(queue)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (!reason) {
    return `<p class="blocked-reason" role="status" id="${id}" data-testid="${id}" ${attrs} hidden></p>`;
  }
  return `<p class="blocked-reason" role="status" id="${id}" data-testid="${id}" ${attrs}>${escapeHtml(reason)}</p>`;
}

function shipRequirementLines(
  def: (typeof SHIPS)[ShipId],
  research: Partial<PlayerView["player"]["research"]>,
): string[] {
  const lines = [`Shipyard L${fmt(def.shipyardLevel)}+`];
  if (def.classExclusive) {
    lines.push(`${PLAYER_CLASS_BONUSES[def.classExclusive].name} class`);
  }
  for (const requiredId of RESEARCH_ORDER) {
    const requiredLevel = def.researchReq?.[requiredId];
    if (requiredLevel == null) continue;
    const have = research?.[requiredId] ?? 0;
    lines.push(
      `${RESEARCH[requiredId].name} L${fmt(requiredLevel)}+ (current L${fmt(have)})`,
    );
  }
  lines.push(
    `Cargo ${fmt(def.cargo)} · atk ${fmt(def.attack)} · Shield ${fmt(def.shield)} · Armor ${fmt(def.armor)} · Hull ${fmt(def.hull)}`,
  );
  return lines;
}

export function shipRow(
  id: ShipId,
  planet: PlayerView["planet"],
  _busy: boolean,
  costMult = 1,
  timeMult = 1,
  speed = 1,
  research: Partial<PlayerView["player"]["research"]> = {},
): string {
  const def = SHIPS[id];
  const count = planet.ships?.[id] ?? 0;
  const yard = planet.buildings.shipyard ?? 0;
  const cost = scaleResourceCost(def.cost, costMult);
  const locked = yard < def.shipyardLevel;
  const affordable = canAfford(planet.resources, cost);
  const queueFull = (planet.shipQueue?.length ?? 0) >= 8;
  let label = "Build";
  if (locked) label = "Locked";
  else if (queueFull) label = "Queue full";
  else if (!affordable) label = "Can't afford";
  const lockMsg = `Needs Shipyard level ${fmt(def.shipyardLevel)} (you have ${fmt(yard)}).`;
  const queueMsg = queueFull ? "Ship queue is full." : null;
  const blocked = buildQuantityReason({
    count: 1,
    locked: locked ? lockMsg : null,
    queue: queueMsg,
    cost,
    have: planet.resources,
  });

  const naniteLevel = Math.max(0, Math.floor(planet.buildings.chronoLathe ?? 0));
  const rigLevel = Math.max(0, Math.floor(planet.buildings.rigFoundry ?? 0));
  const anomalyLevel = Math.max(0, Math.floor(planet.buildings.anomalyForge ?? 0));
  const unitSecs = Math.max(
    1,
    Math.ceil(
      (shipUnitBuildSeconds(id, Math.max(1, yard), naniteLevel, rigLevel, anomalyLevel) *
        timeMult) /
        Math.max(0.01, speed),
    ),
  );

  const tip = costTooltip({
    action: `Build ${def.name}`,
    cost,
    timeSecs: unitSecs,
    detail: def.description,
    requires: shipRequirementLines(def, research),
    blocked,
  });
  // Locked hulls are disabled so mis-clicks cannot set busy and silence Upgrade.
  // Unlocked Build stays enabled during client busy (same reason as Upgrade).
  return `
    <article class="item item-thumb" data-testid="ship-${id}">
      <img class="thumb" src="${SHIP_ART[id]}" alt="${escapeAttr(def.name)}" width="48" height="48" />
      <div>
        <h3>${escapeHtml(def.name)} <span class="meta">Owned ${fmt(count)}</span> ${tip.html}</h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">${fmtCost(cost)} each · ${fmtEta(unitSecs)} · yard L${fmt(def.shipyardLevel)}+ · cargo ${fmt(def.cargo)} · atk ${fmt(def.attack)} · Shield ${fmt(def.shield)} · Armor ${fmt(def.armor)} · Hull ${fmt(def.hull)}${
          locked ? ` · ${escapeHtml(lockMsg)}` : ""
        }</div>
      </div>
      <div class="actions">
        <input type="number" min="1" max="999999" value="1" data-ship-count="${id}" data-testid="ship-count-${id}" ${locked ? "disabled" : ""} style="min-width:4rem;width:4.5rem" />
        <button type="button" data-ship="${id}" data-locked="${locked ? "1" : "0"}" data-testid="build-${id}" ${blocked ? "disabled" : ""} ${blocked ? `aria-describedby="blocked-build-${id}"` : ""} title="${tip.title}">${label}</button>
        ${quantityNote(`blocked-build-${id}`, blocked, locked ? lockMsg : null, queueMsg, cost, planet.resources)}
      </div>
    </article>
  `;
}

export function defenseRow(
  id: DefenseId,
  planet: PlayerView["planet"],
  _busy: boolean,
  timeMult = 1,
  speed = 1,
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
  const lockMsg = locked ? `Needs Shipyard level ${fmt(def.shipyardLevel)}` : null;
  const queueMsg = queueFull ? "Defense queue is full." : null;
  const blocked = buildQuantityReason({
    count: 1,
    locked: lockMsg,
    queue: queueMsg,
    cost,
    have: planet.resources,
  });

  const naniteLevel = Math.max(0, Math.floor(planet.buildings.chronoLathe ?? 0));
  const rigLevel = Math.max(0, Math.floor(planet.buildings.rigFoundry ?? 0));
  const unitSecs = Math.max(
    1,
    Math.ceil(
      (defenseUnitBuildSeconds(id, Math.max(1, yard), naniteLevel, rigLevel) *
        timeMult) /
        Math.max(0.01, speed),
    ),
  );

  const tip = costTooltip({
    action: `Build ${def.name}`,
    cost,
    timeSecs: unitSecs,
    detail: def.description,
    requires: [
      `Shipyard L${fmt(def.shipyardLevel)}+`,
      `Attack ${fmt(def.attack)} · Shield ${fmt(def.shield)} · Armor ${fmt(def.armor)} · Hull ${fmt(def.hull)}`,
    ],
    blocked,
  });
  return `
    <article class="item item-thumb" data-testid="defense-${id}">
      <img class="thumb" src="${DEFENSE_ART[id]}" alt="${escapeAttr(def.name)}" width="48" height="48" />
      <div>
        <h3>${escapeHtml(def.name)} <span class="meta">Owned ${fmt(have)}</span> ${tip.html}</h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">${fmtCost(cost)} each · ${fmtEta(unitSecs)} · yard L${fmt(def.shipyardLevel)}+ · atk ${fmt(def.attack)} · Shield ${fmt(def.shield)} · Armor ${fmt(def.armor)} · Hull ${fmt(def.hull)}</div>
      </div>
      <div class="actions">
        <input type="number" min="1" max="999999" value="1" data-defense-count="${id}" data-testid="defense-count-${id}" ${locked ? "disabled" : ""} style="min-width:4rem;width:4.5rem" />
        <button type="button" data-defense="${id}" data-locked="${locked ? "1" : "0"}" data-testid="build-defense-${id}" ${blocked ? "disabled" : ""} ${blocked ? `aria-describedby="blocked-defense-${id}"` : ""} title="${tip.title}">${label}</button>
        ${quantityNote(`blocked-defense-${id}`, blocked, lockMsg, queueMsg, cost, planet.resources)}
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

export function linkedResearchLab(view: PlayerView): number {
  const networkLevel = view.player.research?.researchNetwork ?? 0;
  const localLab = view.planet.buildings.researchLab ?? 0;
  if (networkLevel < 1) return localLab;

  const labs = view.ownedPlanets
    .filter((owned) => !owned.isMoon)
    .map((owned) => owned.researchLab);
  if (!view.ownedPlanets.some((owned) => owned.id === view.planet.id)) {
    labs.push(localLab);
  }
  return labs
    .sort((a, b) => b - a)
    .slice(0, networkLevel + 1)
    .reduce((total, level) => total + level, 0);
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
  const localLab = view.planet.buildings.researchLab ?? 0;
  const linkedLab = linkedResearchLab(view);
  const preview = previewResearchUpgrade(
    view.player,
    view.planet,
    id,
    lab,
    view.now,
    localLab,
  );
  const cost = preview.cost;
  const fallbackMult =
    (levelBonuses(view.player.level ?? 1).researchTime *
      classBonuses(view.player.playerClass?.classId).researchTime) /
    Math.max(0.01, playerBoosts(view.player, view.now).researchSpeed);
  const mult = view.researchTimeMult ?? fallbackMult;
  const secs = Math.max(
    1,
    Math.ceil(
      (researchUpgradeSeconds(id, preview.current, linkedLab) * mult) /
        view.universe.speed,
    ),
  );
  const blocked = preview.ok ? null : preview.error;
  const label = researchButtonLabel(blocked);
  const requiredResearch = RESEARCH_ORDER.flatMap((requiredId) => {
    const requiredLevel = def.requires?.[requiredId];
    return requiredLevel == null
      ? []
      : [
          `${RESEARCH[requiredId].name} L${fmt(requiredLevel)}+ (current L${fmt(view.player.research?.[requiredId] ?? 0)})`,
        ];
  });
  const tip = costTooltip({
    action: `Research ${def.name} → L${fmt(preview.current + 1)}`,
    cost,
    timeSecs: secs,
    detail: def.description,
    requires: [
      `Research Lab L${fmt(def.labLevel)}+`,
      ...requiredResearch,
      `Best lab L${fmt(lab)}`,
      `Current L${fmt(level)}`,
    ],
    blocked,
  });
  return `
    <article class="item item-thumb" data-testid="research-${id}">
      <img class="thumb" src="${RESEARCH_ART[id]}" alt="${escapeAttr(def.name)}" width="48" height="48" />
      <div>
        <h3>${escapeHtml(def.name)} <span class="meta" data-testid="research-level-${id}">L${fmt(level)}</span> ${tip.html}</h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">Next: ${fmtCost(cost)} · ${fmtEta(secs)}</div>
      </div>
      <div class="actions">
        <button type="button" data-research="${id}" data-locked="${blocked ? "1" : "0"}" data-testid="research-btn-${id}" ${blocked ? "disabled" : ""} ${blocked ? `aria-describedby="blocked-research-${id}"` : ""} title="${tip.title}">${label}</button>
        ${blockedActionNote(`blocked-research-${id}`, blocked)}
      </div>
    </article>
  `;
}
