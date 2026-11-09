import type {
  NextGoalSuggestion,
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
    const status = step.claimed ? "Claimed" : step.completed ? "Ready to claim" : "Not yet";
    const doneHint = step.completed && !step.claimed
      ? `<span class="hint" data-testid="onboarding-claim-hint-${escapeAttr(step.id)}">Already done. Claim the reward.</span>`
      : "";
    return `<li class="onboarding-step${step.id === nextId ? " is-next" : ""}" data-testid="onboarding-step-${escapeAttr(step.id)}" data-completed="${step.completed ? "true" : "false"}" data-claimed="${step.claimed ? "true" : "false"}">
      <div class="onboarding-step-copy">
        <strong>${escapeHtml(step.title)}</strong>
        <span class="hint">${escapeHtml(step.description)}</span>
        ${doneHint}
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

function progressText(briefing: OnboardingView): string {
  const ready = briefing.steps.filter((step) => step.completed && !step.claimed).length;
  const waiting = ready > 0 ? ` · ${fmt(ready)} ready to claim` : "";
  return `${fmt(briefing.completedCount)} / ${fmt(briefing.steps.length)} complete${waiting}`;
}

function nextGoalHtml(
  view: PlayerView,
  suggestion: NextGoalSuggestion | null | undefined,
): string {
  if (!suggestion) return "";
  const page = navPageFor(suggestion.targetNavPage);
  const href = hrefForPage(page, {
    playerId: view.player.id,
    planetId: view.planet.id,
  });
  return `<div class="next-goal" data-testid="next-goal" data-next-goal-id="${escapeAttr(suggestion.id)}">
    <p class="hint">Optional next step</p>
    <strong>${escapeHtml(suggestion.title)}</strong>
    <p class="hint" data-testid="next-goal-rationale">${escapeHtml(suggestion.rationale)}</p>
    <a href="${escapeAttr(href)}" data-nav="${escapeAttr(page)}" data-testid="next-goal-open">Open</a>
  </div>`;
}

/** Full checklist for Overview. Hidden once dismissed or fully claimed. */
export function onboardingPanelHtml(view: PlayerView, busy: boolean): string {
  const briefing = visible(view);
  if (!briefing) return "";
  return `<section class="panel onboarding-panel" data-testid="onboarding-panel">
    <h2>Commander briefing</h2>
    <p class="hint" data-testid="onboarding-progress">${progressText(briefing)}</p>
    <ul class="onboarding-steps">${stepList(view, briefing, busy, briefing.steps)}</ul>
    ${nextGoalHtml(view, briefing.suggestion)}
    <button type="button" data-onboarding-dismiss="true" data-testid="onboarding-dismiss" ${busy ? "disabled" : ""}>Dismiss tutorial</button>
  </section>`;
}

/**
 * Goals page: claimable steps plus the next milestone, or a restore link
 * when the briefing was dismissed with rewards still unclaimed.
 */
function restoreHtml(busy: boolean, label: string): string {
  return `<p class="hint"><button type="button" data-onboarding-dismiss="false" data-testid="onboarding-restore" ${busy ? "disabled" : ""}>${escapeHtml(label)}</button></p>`;
}

export function onboardingGoalsHtml(view: PlayerView, busy: boolean): string {
  const briefing = view.onboarding;
  if (!briefing) return "";
  if (briefing.dismissed) {
    if (briefing.allClaimed && !briefing.suggestion) return "";
    const label = briefing.allClaimed ? "Show next step" : "Show tutorial";
    return restoreHtml(busy, label);
  }
  const suggestion = nextGoalHtml(view, briefing.suggestion);
  if (briefing.allClaimed) {
    if (!suggestion) return "";
    return `<section class="panel onboarding-panel" data-testid="next-goal-panel">
      ${suggestion}
      <button type="button" data-onboarding-dismiss="true" data-testid="onboarding-dismiss" ${busy ? "disabled" : ""}>Hide suggestion</button>
    </section>`;
  }
  const next = briefing.steps.find((step) => !step.completed);
  const shown = briefing.steps.filter(
    (step) => (step.completed && !step.claimed) || step.id === next?.id,
  );
  return `<section class="panel onboarding-panel" data-testid="onboarding-goals">
    <h2>Commander briefing</h2>
    <p class="hint" data-testid="onboarding-progress">${progressText(briefing)}</p>
    <ul class="onboarding-steps">${stepList(view, briefing, busy, shown)}</ul>
    ${suggestion}
  </section>`;
}
