import type {
  OnboardingNavPage,
  OnboardingRewardView,
  OnboardingView,
  PlayerView,
} from "@starhold/game";
import { fmt } from "./format";
import type { NavPage } from "./nav";
import { escapeAttr, escapeHtml } from "./render-escape";
import { hrefForPage } from "./router";

export function onboardingRewardText(reward: OnboardingRewardView): string {
  const parts: string[] = [];
  if (reward.starshards) parts.push(`${fmt(reward.starshards)} Starshards`);
  if (reward.metal) parts.push(`${fmt(reward.metal)} metal`);
  if (reward.crystal) parts.push(`${fmt(reward.crystal)} crystal`);
  if (reward.deuterium) parts.push(`${fmt(reward.deuterium)} deuterium`);
  return parts.join(" · ") || "none";
}

function navPageFor(target: OnboardingNavPage): NavPage {
  switch (target) {
    case "fleets":
      return "fleet";
    case "buildings":
    case "research":
    case "shipyard":
    case "galaxy":
      return target;
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

function visible(view: PlayerView): OnboardingView | null {
  const briefing = view.onboarding;
  if (!briefing || briefing.dismissed || briefing.allClaimed) return null;
  return briefing;
}

function stepList(
  view: PlayerView,
  briefing: OnboardingView,
  busy: boolean,
  steps: OnboardingView["steps"],
): string {
  const nextId = briefing.steps.find((step) => !step.completed)?.id ?? "";
  return steps.map((step) => {
    const href = hrefForPage(navPageFor(step.targetNavPage), {
      playerId: view.player.id,
      planetId: view.planet.id,
    });
    const claim = !step.claimed && step.completed
      ? `<button type="button" data-onboarding-claim="${escapeAttr(step.id)}" data-testid="onboarding-claim-${escapeAttr(step.id)}" ${busy ? "disabled" : ""}>Claim reward</button>`
      : "";
    const status = step.claimed ? "Claimed" : step.completed ? "Ready" : "Not yet";
    return `<li class="onboarding-step${step.id === nextId ? " is-next" : ""}" data-testid="onboarding-step-${escapeAttr(step.id)}" data-completed="${step.completed ? "true" : "false"}" data-claimed="${step.claimed ? "true" : "false"}">
      <div class="onboarding-step-copy">
        <strong>${escapeHtml(step.title)}</strong>
        <span class="hint">${escapeHtml(step.description)}</span>
        <span class="hint">${escapeHtml(onboardingRewardText(step.reward))}</span>
      </div>
      <div class="onboarding-step-actions">
        <a href="${escapeAttr(href)}" data-nav="${escapeAttr(navPageFor(step.targetNavPage))}" data-testid="onboarding-jump-${escapeAttr(step.id)}">Open</a>
        <span class="hint">${status}</span>
        ${claim}
      </div>
    </li>`;
  }).join("");
}

/** Full checklist for Overview. Hidden once dismissed or fully claimed. */
export function onboardingPanelHtml(view: PlayerView, busy: boolean): string {
  const briefing = visible(view);
  if (!briefing) return "";
  const done = briefing.completedCount;
  const total = briefing.steps.length;
  return `<section class="panel onboarding-panel" data-testid="onboarding-panel">
    <h2>Commander briefing</h2>
    <p class="hint" data-testid="onboarding-progress">${fmt(done)} / ${fmt(total)} complete</p>
    <ul class="onboarding-steps">${stepList(view, briefing, busy, briefing.steps)}</ul>
    <button type="button" data-onboarding-dismiss="true" data-testid="onboarding-dismiss" ${busy ? "disabled" : ""}>Dismiss tutorial</button>
  </section>`;
}

/**
 * Goals page: claimable steps plus the next milestone, or a restore link
 * when the briefing was dismissed with rewards still unclaimed.
 */
export function onboardingGoalsHtml(view: PlayerView, busy: boolean): string {
  const briefing = view.onboarding;
  if (!briefing || briefing.allClaimed) return "";
  if (briefing.dismissed) {
    return `<p class="hint"><button type="button" data-onboarding-dismiss="false" data-testid="onboarding-restore" ${busy ? "disabled" : ""}>Show tutorial</button></p>`;
  }
  const next = briefing.steps.find((step) => !step.completed);
  const shown = briefing.steps.filter(
    (step) => (step.completed && !step.claimed) || step.id === next?.id,
  );
  return `<section class="panel onboarding-panel" data-testid="onboarding-goals">
    <h2>Commander briefing</h2>
    <p class="hint" data-testid="onboarding-progress">${fmt(briefing.completedCount)} / ${fmt(briefing.steps.length)} complete</p>
    <ul class="onboarding-steps">${stepList(view, briefing, busy, shown)}</ul>
  </section>`;
}
