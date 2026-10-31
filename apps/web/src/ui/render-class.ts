import {
  CLASS_CHANGE_BASE_COST,
  CLASS_CHANGE_COST_PER_PRIOR,
  CLASS_CHANGE_COOLDOWN_MS,
  PLAYER_CLASS_BONUSES,
  PLAYER_CLASS_ORDER,
  SHIPS,
  SHIP_ORDER,
  classChangeCost,
  type PlayerClassId,
  type PlayerView,
} from "@starhold/game";
import { fmt, fmtEta, remainingSeconds } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";

function classBlurb(id: PlayerClassId): string {
  const b = PLAYER_CLASS_BONUSES[id];
  switch (id) {
    case "miner":
      return `Mines ×${b.mineOutput.toFixed(2)} · defense ×${b.defensePower.toFixed(2)} · defense build ×${b.defenseBuildTime.toFixed(2)}`;
    case "explorer":
      return `Expedition yield ×${b.expeditionYield.toFixed(2)} · research ×${b.researchTime.toFixed(2)} · probe speed ×${b.probeSpeed.toFixed(2)} · +${fmt(b.expeditionSlots)} expedition ${b.expeditionSlots === 1 ? "slot" : "slots"} · debris vs other classes ×${b.debrisVsOtherClass.toFixed(2)}`;
    case "fleeter":
      return `Attack ×${b.attack.toFixed(2)} · fleet speed ×${b.fleetSpeed.toFixed(2)} · ship build ×${b.shipBuildTime.toFixed(2)} · +${fmt(b.fleetSlots)} fleet slots`;
    case "expansionist":
      return `+${fmt(b.colonySlots)} colony slots · colonizer speed ×${b.colonyShipSpeed.toFixed(2)} · building ×${b.buildingBuildTime.toFixed(2)} · Moon Bridge CD ×${b.jumpGateCooldown.toFixed(2)} · +${fmt(b.colonyFields)} colony fields · own-world speed ×${b.ownWorldFleetSpeed.toFixed(2)}`;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function exclusiveHullNames(id: PlayerClassId): string {
  return SHIP_ORDER.filter((sid) => SHIPS[sid].classExclusive === id)
    .map((sid) => SHIPS[sid].name)
    .join(", ");
}

/** Overview class picker / change panel (Round 3 lane a). */
export function classPanelHtml(view: PlayerView, busy: boolean): string {
  const state = view.player.playerClass;
  const classId = state?.classId ?? null;
  const changeCount = state?.changeCount ?? 0;
  const lastChangeAt = state?.lastChangeAt ?? null;
  const balance = Math.floor(view.starshards ?? view.player.starshards ?? 0);
  const nextCost = classChangeCost(changeCount);
  const onCooldown =
    lastChangeAt != null &&
    view.now - lastChangeAt < CLASS_CHANGE_COOLDOWN_MS;
  const cooldownLeft = onCooldown
    ? remainingSeconds(lastChangeAt! + CLASS_CHANGE_COOLDOWN_MS, view.now)
    : 0;

  if (classId == null) {
    const cards = PLAYER_CLASS_ORDER.map((id) => {
      const def = PLAYER_CLASS_BONUSES[id];
      return `<li class="class-card" data-testid="class-card-${escapeAttr(id)}">
        <div>
          <strong>${escapeHtml(def.name)}</strong>
          <span class="hint">${escapeHtml(classBlurb(id))}</span>
          <span class="hint">Exclusive: ${escapeHtml(exclusiveHullNames(id))}</span>
        </div>
        <button type="button" data-choose-class="${escapeAttr(id)}" data-testid="choose-class-${escapeAttr(id)}" ${busy ? "disabled" : ""}>Choose</button>
      </li>`;
    }).join("");
    return `<section class="panel class-panel" data-testid="class-panel">
      <h2>Choose your class</h2>
      <p class="hint">Free once. Class-exclusive ships unlock after you pick. Change later costs Starshards (${fmt(CLASS_CHANGE_BASE_COST)} + ${fmt(CLASS_CHANGE_COST_PER_PRIOR)}× prior changes) with a 7-day cooldown.</p>
      <ul class="class-list">${cards}</ul>
    </section>`;
  }

  const current = PLAYER_CLASS_BONUSES[classId];
  const others = PLAYER_CLASS_ORDER.filter((id) => id !== classId)
    .map((id) => {
      const def = PLAYER_CLASS_BONUSES[id];
      const canAfford = balance >= nextCost;
      const disabled = busy || onCooldown || !canAfford;
      let label = `Change · ${fmt(nextCost)} ✦`;
      if (onCooldown) label = `Cooldown ${fmtEta(cooldownLeft)}`;
      else if (!canAfford) label = `Need ${fmt(nextCost)} ✦`;
      return `<li class="class-card" data-testid="class-card-${escapeAttr(id)}">
        <div>
          <strong>${escapeHtml(def.name)}</strong>
          <span class="hint">${escapeHtml(classBlurb(id))}</span>
          <span class="hint">Exclusive: ${escapeHtml(exclusiveHullNames(id))}</span>
        </div>
        <button type="button" data-change-class="${escapeAttr(id)}" data-testid="change-class-${escapeAttr(id)}" ${disabled ? "disabled" : ""}>${escapeHtml(label)}</button>
      </li>`;
    })
    .join("");

  return `<section class="panel class-panel" data-testid="class-panel">
    <h2>Class · ${escapeHtml(current.name)}</h2>
    <p class="hint" data-testid="class-current">${escapeHtml(classBlurb(classId))} · Exclusive: ${escapeHtml(exclusiveHullNames(classId))}</p>
    <p class="hint">Starshards ${fmt(balance)} · next change ${fmt(nextCost)} ✦${onCooldown ? ` · cooldown ${fmtEta(cooldownLeft)}` : ""}</p>
    <h3 class="subhead">Change class</h3>
    <ul class="class-list">${others}</ul>
  </section>`;
}
