import {
  RESEARCH,
  RESEARCH_ORDER,
  previewResearchUpgrade,
  type PlayerView,
  type ResearchId,
} from "@starhold/game";
import { RESEARCH_ART } from "./assets";
import { fmt } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";
import { bestResearchLab } from "./render-chrome-rows";

export interface ResearchNodeState {
  id: ResearchId;
  name: string;
  level: number;
  labReq: number;
  requires: Partial<Record<ResearchId, number>>;
  status: "researched" | "available" | "locked";
  lockReason: string | null;
  blocked: string | null;
  tier: number;
}

export function evaluateResearchNode(
  id: ResearchId,
  view: PlayerView,
  tier: number,
): ResearchNodeState {
  const def = RESEARCH[id];
  const level = view.player.research?.[id] ?? 0;
  const lab = bestResearchLab(view);
  const localLab = view.planet.buildings.researchLab ?? 0;
  const preview = previewResearchUpgrade(
    view.player,
    view.planet,
    id,
    lab,
    view.now,
    localLab,
  );

  const reqEntries = Object.entries(def.requires ?? {}) as [ResearchId, number][];
  const unmetReqs: string[] = [];

  for (const [reqId, reqLevel] of reqEntries) {
    const current = view.player.research?.[reqId] ?? 0;
    if (current < reqLevel) {
      unmetReqs.push(`${RESEARCH[reqId].name} L${fmt(reqLevel)} (current L${fmt(current)})`);
    }
  }

  let lockReason: string | null = null;
  if (unmetReqs.length > 0) {
    lockReason = `Requires ${unmetReqs.join(", ")}.`;
  } else if (lab < def.labLevel) {
    lockReason = `Requires Research Lab L${fmt(def.labLevel)} (highest L${fmt(lab)}).`;
  }

  let status: "researched" | "available" | "locked" = "available";
  if (lockReason) {
    status = "locked";
  } else if (level > 0) {
    status = "researched";
  }

  const blocked = preview.ok ? null : (lockReason ?? preview.error);

  return {
    id,
    name: def.name,
    level,
    labReq: def.labLevel,
    requires: def.requires ?? {},
    status,
    lockReason,
    blocked,
    tier,
  };
}

export const RESEARCH_TIERS: { tier: number; label: string; ids: ResearchId[] }[] = [
  {
    tier: 0,
    label: "Tier 1 · Foundations",
    ids: ["energyTech", "computerTech", "armourTech", "espionageTech", "weaponsTech"],
  },
  {
    tier: 1,
    label: "Tier 2 · Applications",
    ids: [
      "combustionDrive",
      "shieldingTech",
      "queueLogistics",
      "metallurgistTech",
      "crystalizerTech",
      "deutSynthesisTech",
    ],
  },
  {
    tier: 2,
    label: "Tier 3 · Advanced Systems",
    ids: ["cargoHoldTech", "fleetSpeedTech", "astrophysics", "gravityWell"],
  },
  {
    tier: 3,
    label: "Tier 4 · Deep Expansion",
    ids: ["swarmHold", "researchNetwork"],
  },
];

export function researchTreeMapHtml(view: PlayerView, busy: boolean): string {
  const nodeStates = new Map<ResearchId, ResearchNodeState>();
  for (const tierGroup of RESEARCH_TIERS) {
    for (const id of tierGroup.ids) {
      nodeStates.set(id, evaluateResearchNode(id, view, tierGroup.tier));
    }
  }

  const tiersHtml = RESEARCH_TIERS.map((tierGroup) => {
    const cardsHtml = tierGroup.ids
      .map((id) => {
        const state = nodeStates.get(id)!;
        const isLocked = state.status === "locked";
        const isResearched = state.status === "researched";
        const def = RESEARCH[id];

        const reqPills = Object.entries(def.requires ?? {})
          .map(([reqId, reqLvl]) => {
            const current = view.player.research?.[reqId as ResearchId] ?? 0;
            const met = current >= reqLvl;
            const shortName = RESEARCH[reqId as ResearchId].name;
            return `<span class="tree-req-pill ${met ? "met" : "unmet"}" title="${escapeAttr(`${shortName} L${reqLvl} (have L${current})`)}">${escapeHtml(shortName)} L${fmt(reqLvl)}</span>`;
          })
          .join("");

        const labMet = bestResearchLab(view) >= def.labLevel;
        const labPill = `<span class="tree-req-pill ${labMet ? "met" : "unmet"}" title="${escapeAttr(`Lab L${def.labLevel}`)}">Lab L${fmt(def.labLevel)}</span>`;

        const titleText = isLocked
          ? (state.lockReason ?? "Prerequisites not met")
          : `${def.name} L${fmt(state.level)} — Tap to research`;

        return `
          <button
            type="button"
            class="tree-node tree-node-${state.status}"
            data-research="${id}"
            data-locked="${state.blocked ? "1" : "0"}"
            data-testid="research-tree-node-${id}"
            title="${escapeAttr(titleText)}"
            ${busy && !isLocked ? "" : ""}
          >
            <div class="tree-node-header">
              <img class="thumb" src="${RESEARCH_ART[id]}" alt="${escapeAttr(def.name)}" width="36" height="36" />
              <div class="tree-node-title-group">
                <span class="tree-node-name">${escapeHtml(def.name)}</span>
                <span class="tree-node-level" data-testid="research-tree-level-${id}">L${fmt(state.level)}</span>
              </div>
            </div>
            <div class="tree-node-reqs">
              ${labPill}
              ${reqPills}
            </div>
            <div class="tree-node-footer">
              <span class="tree-node-badge tree-node-badge-${state.status}">
                ${isLocked ? "Locked" : isResearched ? "Researched" : "Available"}
              </span>
            </div>
          </button>
        `;
      })
      .join("");

    return `
      <div class="tree-tier" data-testid="research-tree-tier-${tierGroup.tier}">
        <h4 class="tree-tier-label">${escapeHtml(tierGroup.label)}</h4>
        <div class="tree-tier-nodes">
          ${cardsHtml}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="research-tree-wrap" data-testid="research-tree-map">
      <div class="tree-header">
        <h3 class="subhead">Technology Prerequisite Tree</h3>
        <p class="hint">Empire-wide research tree map. Tap an available node to research or inspect requirements.</p>
      </div>
      <div class="tree-grid">
        ${tiersHtml}
      </div>
    </div>
  `;
}
