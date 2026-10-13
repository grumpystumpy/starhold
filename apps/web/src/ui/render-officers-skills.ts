import type { OfficerId, PlayerView } from "@starhold/game";
import { fmtEta, remainingSeconds } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";

function effectLabel(kind: string, value: number): string {
  switch (kind) {
    case "mineOutput":
      return `Mines ×${value.toFixed(2)}`;
    case "researchSpeed":
      return `Research ×${value.toFixed(2)}`;
    case "fleetSpeed":
      return `Fleet speed ×${value.toFixed(2)}`;
    case "fleetSlots":
      return `Fleet slots +${value}`;
    case "defensePower":
      return `Defense ×${value.toFixed(2)}`;
    case "energyOutput":
      return `Energy ×${value.toFixed(2)}`;
    case "espionageLevel":
      return `Shadow Optics +${value}`;
    default:
      return `${kind} ${value}`;
  }
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
      const hire = active.get(def.id as OfficerId);
      const effects = def.effects
        .map((e) => effectLabel(e.kind, e.value))
        .join(" · ");
      const status = hire
        ? `Active · ${fmtEta(remainingSeconds(hire.expiresAt, view.now))} left`
        : "Off duty";
      const canAfford = balance >= def.cost;
      return `<li class="officer-row" data-testid="officer-${escapeAttr(def.id)}">
        <div>
          <strong>${escapeHtml(def.name)}</strong>
          <span class="hint">${escapeHtml(def.description)}</span>
          <span class="hint">${escapeHtml(effects)}</span>
          <span class="hint" data-testid="officer-status-${escapeAttr(def.id)}">${escapeHtml(status)}</span>
        </div>
        <button type="button" data-activate-officer="${escapeAttr(def.id)}" data-testid="activate-officer-${escapeAttr(def.id)}" ${busy || !canAfford ? "disabled" : ""}>${hire ? "Renew" : "Hire"} · ${def.cost} ✦</button>
      </li>`;
    })
    .join("");

  return `<section class="panel" data-testid="officers-panel" id="officers">
    <h2>Officers</h2>
    <p class="hint">Hire with Starshards (earned in-game only — no real money). Each hire lasts 7 days.</p>
    <ul class="officer-list">${rows}</ul>
  </section>`;
}

export function skillsPanelHtml(view: PlayerView, busy: boolean): string {
  const catalog = view.skillCatalog ?? [];
  const unlocked = new Set(view.skillsUnlocked ?? []);
  const balance = view.starshards ?? 0;
  const branches = ["economy", "military", "exploration"] as const;

  const sections = branches
    .map((branch) => {
      const nodes = catalog.filter((n) => n.branch === branch);
      const rows = nodes
        .map((def) => {
          const have = unlocked.has(def.id);
          const reqOk = def.requires.every((r) => unlocked.has(r));
          const canBuy = !have && reqOk && balance >= def.cost;
          const effects = def.effects
            .map((e) => effectLabel(e.kind, e.value))
            .join(" · ");
          const req =
            def.requires.length > 0
              ? `Requires ${def.requires.join(", ")}`
              : "Root node";
          return `<li class="skill-row ${have ? "unlocked" : ""}" data-testid="skill-${escapeAttr(def.id)}">
            <div>
              <strong>${escapeHtml(def.name)}</strong>
              <span class="hint">${escapeHtml(def.description)}</span>
              <span class="hint">${escapeHtml(effects)}</span>
              <span class="hint">${escapeHtml(req)}</span>
            </div>
            ${
              have
                ? `<span class="badge" data-testid="skill-owned-${escapeAttr(def.id)}">Unlocked</span>`
                : `<button type="button" data-unlock-skill="${escapeAttr(def.id)}" data-testid="unlock-skill-${escapeAttr(def.id)}" ${busy || !canBuy ? "disabled" : ""}>Unlock · ${def.cost} ✦</button>`
            }
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
    <p class="hint">Permanent perks bought with Starshards.</p>
    ${sections}
  </section>`;
}

