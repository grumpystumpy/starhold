import {
  OFFICER_MAX_LEVEL,
  SKILL_MAX_LEVEL,
  levelUpCost,
  officerRenewalCost,
  officerRenewalDurationMs,
  scaleEffect,
  type OfficerEffect,
  type OfficerId,
  type PlayerView,
} from "@starhold/game";
import { fmt, fmtEta, fmtLabel, remainingSeconds } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";
import { infoTooltip } from "./render-tooltips";

function effectLine(effect: OfficerEffect, level: number): string {
  const scaled = scaleEffect(effect, Math.max(1, level));
  return effectLabel(scaled.kind, scaled.value);
}

function effectLabel(kind: string, value: number): string {
  switch (kind) {
    case "mineOutput":
      return `Mines ×${value.toFixed(2)}`;
    case "researchSpeed":
      return `Research ×${value.toFixed(2)}`;
    case "fleetSpeed":
      return `Fleet speed ×${value.toFixed(2)}`;
    case "fleetSlots":
      return `Fleet slots +${fmt(value)}`;
    case "defensePower":
      return `Defense ×${value.toFixed(2)}`;
    case "energyOutput":
      return `Energy ×${value.toFixed(2)}`;
    case "espionageLevel":
      return `Shadow Optics +${fmt(value)}`;
    default:
      return `${fmtLabel(kind)} ${value}`;
  }
}

function skillDisplayName(
  catalog: NonNullable<PlayerView["skillCatalog"]>,
  id: string,
): string {
  const hit = catalog.find((n) => n.id === id);
  return fmtLabel(hit?.name ?? id);
}

export function officersPanelHtml(
  view: PlayerView,
  busy: boolean,
): string {
  const catalog = view.officerCatalog ?? [];
  const active = new Map(
    (view.officers ?? []).map((o) => [o.officerId, o] as const),
  );
  const balance = view.starshards ?? 0;
  const rows = catalog
    .map((def) => {
      const officerId = def.id as OfficerId;
      const hire = active.get(officerId);
      const level = view.officerLevels?.[officerId] ?? 0;
      const renewals = view.officerRenewals?.[officerId] ?? 0;
      const hireCost = officerRenewalCost(def.cost, renewals);
      const hireDurationHours = officerRenewalDurationMs(renewals) / (60 * 60 * 1000);
      const effects = def.effects
        .map((e) => effectLine(e, level))
        .join(" · ");
      const status = hire
        ? `Level ${fmt(level)} / ${fmt(OFFICER_MAX_LEVEL)} · Active · ${fmtEta(remainingSeconds(hire.expiresAt, view.now))} left`
        : `Level ${fmt(level)} / ${fmt(OFFICER_MAX_LEVEL)} · Off duty`;
      const canAfford = balance >= hireCost;
      const raiseCost =
        level >= 1 && level < OFFICER_MAX_LEVEL
          ? levelUpCost(def.cost, level)
          : null;
      const canRaise = raiseCost != null && balance >= raiseCost;
      const tip = infoTooltip({
        title: def.name,
        lines: [
          def.description,
          level >= 1 ? `Now: ${effects}` : `At level 1: ${effects}`,
          `${hire ? "Renew" : "Hire"}: ${fmt(hireCost)} Starshards · lasts ${fmt(hireDurationHours)} hours`,
          raiseCost != null
            ? `Raise to level ${fmt(level + 1)}: ${fmt(raiseCost)} Starshards`
            : level >= OFFICER_MAX_LEVEL
              ? "Max level"
              : "Hire once to start at level 1, then raise the level.",
        ],
        blocked: canAfford ? null : "Not enough Starshards.",
        testId: `officer-tip-${def.id}`,
      });
      const raiseBtn =
        raiseCost == null
          ? level >= OFFICER_MAX_LEVEL
            ? `<span class="badge" data-testid="officer-max-${escapeAttr(def.id)}">Max level</span>`
            : ""
          : `<button type="button" data-raise-officer="${escapeAttr(def.id)}" data-testid="raise-officer-${escapeAttr(def.id)}" ${busy || !canRaise ? "disabled" : ""}>Raise · ${fmt(raiseCost)} ✦</button>`;
      return `<li class="officer-row" data-testid="officer-${escapeAttr(def.id)}">
        <div>
          <strong>${escapeHtml(def.name)} ${tip.html}</strong>
          <span class="hint">${escapeHtml(def.description)}</span>
          <span class="hint">${escapeHtml(effects)}</span>
          <span class="hint" data-testid="officer-level-${escapeAttr(def.id)}">${escapeHtml(status)}</span>
        </div>
        <span class="actions">
          <button type="button" data-activate-officer="${escapeAttr(def.id)}" data-testid="activate-officer-${escapeAttr(def.id)}" ${busy || !canAfford ? "disabled" : ""} title="${tip.title}">${hire ? "Renew" : "Hire"} · ${fmt(hireCost)} ✦</button>
          ${raiseBtn}
        </span>
      </li>`;
    })
    .join("");

  return `<section class="panel" data-testid="officers-panel" id="officers">
    <h2>Officers</h2>
    <p class="hint">Hire with Starshards (earned in-game only — no real money). First hire lasts 20 hours; each renewal costs 50% more and lasts 15% longer. Levels stay after duty ends, up to level 10.</p>
    <ul class="officer-list">${rows}</ul>
  </section>`;
}

export function skillsPanelHtml(view: PlayerView, busy: boolean): string {
  const catalog = view.skillCatalog ?? [];
  const levels = view.skillLevels ?? {};
  const balance = view.starshards ?? 0;
  const branches = ["economy", "military", "exploration"] as const;

  const sections = branches
    .map((branch) => {
      const nodes = catalog.filter((n) => n.branch === branch);
      const rows = nodes
        .map((def) => {
          const level = levels[def.id] ?? 0;
          const have = level >= 1;
          const maxed = level >= SKILL_MAX_LEVEL;
          const reqOk = def.requires.every((r) => (levels[r] ?? 0) >= 1);
          const nextCost = maxed ? null : levelUpCost(def.cost, level);
          const canBuy =
            nextCost != null && (level >= 1 || reqOk) && balance >= nextCost;
          const effects = def.effects
            .map((e) => effectLine(e, level))
            .join(" · ");
          const req =
            def.requires.length > 0
              ? `Requires ${def.requires.map((r) => skillDisplayName(catalog, r)).join(", ")}`
              : "Root node";
          const name = fmtLabel(def.name);
          const tip = infoTooltip({
            title: name,
            lines: [
              def.description,
              ...(effects
                ? [have ? `Now: ${effects}` : `At level 1: ${effects}`]
                : []),
              maxed
                ? `Level ${fmt(level)} / ${fmt(SKILL_MAX_LEVEL)}`
                : `${have ? "Raise" : "Unlock"}: ${fmt(nextCost ?? 0)} Starshards`,
            ],
            requires: def.requires.length
              ? def.requires.map((r) => skillDisplayName(catalog, r))
              : ["Root node"],
            blocked: maxed
              ? null
              : level < 1 && !reqOk
                ? "Unlock prerequisite skills first."
                : nextCost != null && balance < nextCost
                  ? "Not enough Starshards."
                  : null,
            testId: `skill-tip-${def.id}`,
          });
          const action = maxed
            ? `<span class="badge" data-testid="skill-owned-${escapeAttr(def.id)}">Max level</span>`
            : `<button type="button" data-unlock-skill="${escapeAttr(def.id)}" data-testid="unlock-skill-${escapeAttr(def.id)}" ${busy || !canBuy ? "disabled" : ""} title="${tip.title}">${have ? "Raise" : "Unlock"} · ${fmt(nextCost ?? 0)} ✦</button>`;
          return `<li class="skill-row ${have ? "unlocked" : ""}" data-testid="skill-${escapeAttr(def.id)}">
            <div>
              <strong>${escapeHtml(name)} ${tip.html}</strong>
              <span class="hint">${escapeHtml(def.description)}</span>
              <span class="hint">${escapeHtml(effects)}</span>
              <span class="hint" data-testid="skill-level-${escapeAttr(def.id)}">Level ${fmt(level)} / ${fmt(SKILL_MAX_LEVEL)}</span>
              <span class="hint">${escapeHtml(req)}</span>
            </div>
            ${action}
          </li>`;
        })
        .join("");
      const title =
        branch === "economy"
          ? "Economy"
          : branch === "military"
            ? "Military"
            : "Exploration";
      return `<div class="skill-branch" data-testid="skill-branch-${branch}">
        <h3>${title}</h3>
        <ul class="skill-list">${rows}</ul>
      </div>`;
    })
    .join("");

  return `<section class="panel" data-testid="skills-panel" id="skills">
    <h2>Skills</h2>
    <p class="hint">Permanent perks bought with Starshards. Each skill trains from level 1 to 10.</p>
    ${sections}
  </section>`;
}
