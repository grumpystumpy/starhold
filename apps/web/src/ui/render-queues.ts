import {
  BUILDINGS,
  DEFENSES,
  RESEARCH,
  SHIPS,
  type PlayerView,
} from "@starhold/game";
import { fmt, fmtEta, remainingSeconds } from "./format";
import { escapeHtml } from "./render-escape";

function etaSpan(completesAt: number, now: number): string {
  const secs = remainingSeconds(completesAt, now);
  return `<span class="eta" data-eta-until="${completesAt}" data-testid="eta">${fmtEta(secs)}</span>`;
}

function queueItemEta(
  item: { completesAt: number; remainingSeconds?: number; startedAt: number | null },
  index: number,
  now: number,
  cursorMs: { value: number },
): string {
  if (index === 0 && item.startedAt != null) {
    cursorMs.value = Math.max(cursorMs.value, item.completesAt);
    return etaSpan(item.completesAt, now);
  }
  const secs =
    item.remainingSeconds ??
    Math.max(1, Math.ceil((item.completesAt - cursorMs.value) / 1000));
  const until = cursorMs.value + secs * 1000;
  cursorMs.value = until;
  return etaSpan(until, now);
}

export function buildQueueHtml(
  planet: PlayerView["planet"],
  now: number,
): string {
  const queue = planet.buildQueue ?? [];
  if (queue.length === 0) return "";
  const cursor = { value: now };
  const rows = queue
    .map((q, i) => {
      const name = BUILDINGS[q.buildingId]?.name ?? q.buildingId;
      return `<li class="queue-item" data-testid="build-queue-item" data-queue-id="${escapeHtml(q.id)}">
        <span>${i === 0 ? "Building" : "Queued"} ${escapeHtml(name)} → L${fmt(q.targetLevel)} · ${queueItemEta(q, i, now, cursor)} left</span>
        <button type="button" class="btn ghost queue-cancel" data-queue-cancel="building" data-queue-item="${escapeHtml(q.id)}" data-testid="cancel-build-${escapeHtml(q.id)}">Cancel</button>
      </li>`;
    })
    .join("");
  return `<div class="queue queue-list" data-testid="build-queue"><ol>${rows}</ol></div>`;
}

export function shipQueueHtml(
  planet: PlayerView["planet"],
  now: number,
): string {
  const queue = planet.shipQueue ?? [];
  if (queue.length === 0) return "";
  const cursor = { value: now };
  const rows = queue
    .map((q, i) => {
      const name = SHIPS[q.shipId]?.name ?? q.shipId;
      return `<li class="queue-item" data-testid="ship-queue-item" data-queue-id="${escapeHtml(q.id)}">
        <span>${i === 0 ? "Assembling" : "Queued"} ${fmt(q.count)}× ${escapeHtml(name)} · ${queueItemEta(q, i, now, cursor)} left</span>
        <button type="button" class="btn ghost queue-cancel" data-queue-cancel="ship" data-queue-item="${escapeHtml(q.id)}" data-testid="cancel-ship-${escapeHtml(q.id)}">Cancel</button>
      </li>`;
    })
    .join("");
  return `<div class="queue queue-list" data-testid="ship-queue"><ol>${rows}</ol></div>`;
}

export function defenseQueueHtml(
  planet: PlayerView["planet"],
  now: number,
): string {
  const queue = planet.defenseQueue ?? [];
  if (queue.length === 0) return "";
  const cursor = { value: now };
  const rows = queue
    .map((q, i) => {
      const name = DEFENSES[q.defenseId]?.name ?? q.defenseId;
      return `<li class="queue-item" data-testid="defense-queue-item" data-queue-id="${escapeHtml(q.id)}">
        <span>${i === 0 ? "Building" : "Queued"} ${fmt(q.count)}× ${escapeHtml(name)} · ${queueItemEta(q, i, now, cursor)} left</span>
        <button type="button" class="btn ghost queue-cancel" data-queue-cancel="defense" data-queue-item="${escapeHtml(q.id)}" data-testid="cancel-defense-${escapeHtml(q.id)}">Cancel</button>
      </li>`;
    })
    .join("");
  return `<div class="queue queue-list" data-testid="defense-queue"><ol>${rows}</ol></div>`;
}

export function researchQueueHtml(
  player: PlayerView["player"],
  now: number,
): string {
  const queue = player.researchQueue ?? [];
  if (queue.length === 0) return "";
  const cursor = { value: now };
  const rows = queue
    .map((q, i) => {
      const name = RESEARCH[q.researchId]?.name ?? q.researchId;
      return `<li class="queue-item" data-testid="research-queue-item" data-queue-id="${escapeHtml(q.id)}">
        <span>${i === 0 ? "Researching" : "Queued"} ${escapeHtml(name)} → L${fmt(q.targetLevel)} · ${queueItemEta(q, i, now, cursor)} left</span>
        <button type="button" class="btn ghost queue-cancel" data-queue-cancel="research" data-queue-item="${escapeHtml(q.id)}" data-testid="cancel-research-${escapeHtml(q.id)}">Cancel</button>
      </li>`;
    })
    .join("");
  return `<div class="queue queue-list" data-testid="research-queue"><ol>${rows}</ol></div>`;
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
