import type { GoalCadence, GoalRewardView, GoalView, PlayerView } from "@starhold/game";
import { fmt } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";

/** Reward line for a goal. Numbers use thousands separators. */
export function goalRewardText(reward: GoalRewardView): string {
  if (reward.starshards > 0) {
    return `${fmt(reward.starshards)} Starshards`;
  }
  const parts: string[] = [];
  if (reward.metal) parts.push(`${fmt(reward.metal)} metal`);
  if (reward.crystal) parts.push(`${fmt(reward.crystal)} crystal`);
  if (reward.deuterium) parts.push(`${fmt(reward.deuterium)} deuterium`);
  return parts.join(" · ") || "none";
}

function goalsFor(goals: GoalView[], cadence: GoalCadence): GoalView[] {
  switch (cadence) {
    case "daily":
      return goals.filter((goal) => goal.cadence === "daily");
    case "weekly":
      return goals.filter((goal) => goal.cadence === "weekly");
    default: {
      const _exhaustive: never = cadence;
      return _exhaustive;
    }
  }
}

function goalRow(goal: GoalView, busy: boolean): string {
  const pct =
    goal.target <= 0
      ? 0
      : Math.max(0, Math.min(100, Math.round((goal.progress / goal.target) * 100)));
  const reward = goalRewardText(goal.reward);
  const status = goal.claimed
    ? "Claimed"
    : goal.progress >= goal.target
      ? "Ready"
      : "In progress";
  const canClaim = !busy && !goal.claimed && goal.progress >= goal.target;
  return `<li class="goal-row" data-testid="goal-${escapeAttr(goal.id)}">
    <div class="goal-copy">
      <strong>${escapeHtml(goal.title)}</strong>
      <span class="hint">${escapeHtml(goal.detail)}</span>
      <div class="goal-meter" role="meter" aria-valuemin="0" aria-valuemax="${goal.target}" aria-valuenow="${goal.progress}" aria-label="${escapeAttr(goal.title)}">
        <span style="width:${pct}%"></span>
      </div>
      <span class="hint" data-testid="goal-progress-${escapeAttr(goal.id)}">${fmt(goal.progress)} / ${fmt(goal.target)}</span>
    </div>
    <div class="goal-actions">
      <span class="hint" data-testid="goal-reward-${escapeAttr(goal.id)}">${escapeHtml(reward)}</span>
      <span class="hint" data-testid="goal-status-${escapeAttr(goal.id)}">${status}</span>
      <button type="button" data-claim-goal="${escapeAttr(goal.id)}" data-testid="claim-goal-${escapeAttr(goal.id)}" ${canClaim ? "" : "disabled"}>Claim</button>
    </div>
  </li>`;
}

function goalSection(
  title: string,
  hint: string,
  testId: string,
  rows: GoalView[],
  busy: boolean,
): string {
  const body =
    rows.length > 0
      ? rows.map((goal) => goalRow(goal, busy)).join("")
      : `<li class="hint">No goals in this period.</li>`;
  return `<section class="panel" data-testid="${testId}">
    <h2>${escapeHtml(title)}</h2>
    <p class="hint">${escapeHtml(hint)}</p>
    <ul class="goal-list">${body}</ul>
  </section>`;
}

export function goalsPageHtml(view: PlayerView, busy: boolean): string {
  const goals = view.goals ?? [];
  return `<div data-testid="goals-panel">
    ${goalSection(
      "Today",
      "Resets at 00:00 UTC. Progress from flights that resolve while you are away counts in the open day.",
      "goals-daily",
      goalsFor(goals, "daily"),
      busy,
    )}
    ${goalSection(
      "This week",
      "Resets Monday 00:00 UTC. Weekly counters stay when the day rolls.",
      "goals-weekly",
      goalsFor(goals, "weekly"),
      busy,
    )}
  </div>`;
}
