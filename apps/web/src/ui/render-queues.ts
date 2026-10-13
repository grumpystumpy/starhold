import {
  BUILDINGS,
  DEFENSES,
  RESEARCH,
  SHIPS,
  type PlayerView,
} from "@starhold/game";
import { fmtEta, remainingSeconds } from "./format";
import { escapeHtml } from "./render-escape";

function etaSpan(completesAt: number, now: number): string {
  const secs = remainingSeconds(completesAt, now);
  return `<span class="eta" data-eta-until="${completesAt}" data-testid="eta">${fmtEta(secs)}</span>`;
}

export function buildQueueHtml(
  planet: PlayerView["planet"],
  now: number,
): string {
  if (!planet.buildQueue) return "";
  const q = planet.buildQueue;
  const name = BUILDINGS[q.buildingId].name;
  return `<div class="queue" data-testid="build-queue">Building ${escapeHtml(name)} → L${q.targetLevel} · ${etaSpan(q.completesAt, now)} left</div>`;
}

export function shipQueueHtml(
  planet: PlayerView["planet"],
  now: number,
): string {
  if (!planet.shipQueue) return "";
  const q = planet.shipQueue;
  const name = SHIPS[q.shipId].name;
  return `<div class="queue" data-testid="ship-queue">Assembling ${q.count}× ${escapeHtml(name)} · ${etaSpan(q.completesAt, now)} left</div>`;
}

export function defenseQueueHtml(
  planet: PlayerView["planet"],
  now: number,
): string {
  if (!planet.defenseQueue) return "";
  const q = planet.defenseQueue;
  const name = DEFENSES[q.defenseId].name;
  return `<div class="queue" data-testid="defense-queue">Building ${q.count}× ${escapeHtml(name)} · ${etaSpan(q.completesAt, now)} left</div>`;
}

export function researchQueueHtml(
  player: PlayerView["player"],
  now: number,
): string {
  if (!player.researchQueue) return "";
  const q = player.researchQueue;
  const name = RESEARCH[q.researchId].name;
  return `<div class="queue" data-testid="research-queue">Researching ${escapeHtml(name)} → L${q.targetLevel} · ${etaSpan(q.completesAt, now)} left</div>`;
}

/** Compact queue strip for Overview. */
export function overviewQueuesHtml(view: PlayerView): string {
  const { planet, player, now } = view;
  const parts = [
    buildQueueHtml(planet, now),
    shipQueueHtml(planet, now),
    defenseQueueHtml(planet, now),
    researchQueueHtml(player, now),
  ].filter(Boolean);
  if (parts.length === 0) {
    return `<p class="hint" data-testid="queues-empty">No active construction or research.</p>`;
  }
  return `<div class="queue-strip" data-testid="queues-overview">${parts.join("")}</div>`;
}
