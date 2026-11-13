import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import {
  buildQueueHtml,
  defenseQueueHtml,
  researchQueueHtml,
  shipQueueHtml,
} from "./render-queues";

function row(id: string): PlayerView["planet"]["buildQueue"][number] {
  return {
    id,
    buildingId: "metalMine",
    shipId: "scout",
    defenseId: "laserBattery",
    researchId: "energyTech",
    targetLevel: 2,
    count: 1,
    startedAt: null,
    completesAt: 5_000,
    workSeconds: 10,
    remainingSeconds: 4,
    paidCost: { metal: 1, crystal: 0, deuterium: 0 },
  } as PlayerView["planet"]["buildQueue"][number];
}

describe("queue reorder controls", () => {
  it("shows no move buttons on a 1- or 2-item queue and keeps Cancel", () => {
    const one = buildQueueHtml({ buildQueue: [row("only")] } as PlayerView["planet"], 1_000);
    const two = buildQueueHtml(
      { buildQueue: [row("front"), row("tail")] } as PlayerView["planet"],
      1_000,
    );
    assert.doesNotMatch(one, /data-queue-reorder/);
    assert.doesNotMatch(two, /data-queue-reorder/);
    assert.match(one, /data-testid="cancel-build-only"/);
    assert.match(two, /data-testid="cancel-build-front"/);
    assert.match(two, /data-testid="cancel-build-tail"/);
  });

  it("shows Up and Down only on the pending tail of a 3-item queue", () => {
    const html = buildQueueHtml(
      { buildQueue: [row("q0"), row("q1"), row("q2")] } as PlayerView["planet"],
      1_000,
    );
    assert.match(html, /data-testid="cancel-build-q0"/);
    assert.match(html, /data-testid="cancel-build-q1"/);
    assert.match(html, /data-testid="cancel-build-q2"/);
    assert.doesNotMatch(html, /data-testid="reorder-building-q0-up"/);
    assert.doesNotMatch(html, /data-testid="reorder-building-q0-down"/);
    assert.doesNotMatch(html, /data-testid="reorder-building-q1-up"/);
    assert.match(html, /data-testid="reorder-building-q1-down"/);
    assert.match(html, /data-queue-reorder="building"/);
    assert.match(html, /data-queue-dir="down"/);
    assert.match(html, /data-testid="reorder-building-q2-up"/);
    assert.doesNotMatch(html, /data-testid="reorder-building-q2-down"/);
  });

  it("uses the same pending-tail controls for ship, defense, and research", () => {
    const ships = shipQueueHtml(
      { shipQueue: [row("s0"), row("s1"), row("s2")] } as PlayerView["planet"],
      1_000,
    );
    const defenses = defenseQueueHtml(
      { defenseQueue: [row("d0"), row("d1"), row("d2")] } as PlayerView["planet"],
      1_000,
    );
    const research = researchQueueHtml(
      { researchQueue: [row("r0"), row("r1"), row("r2")] } as PlayerView["player"],
      1_000,
    );
    assert.doesNotMatch(ships, /reorder-ship-s0-/);
    assert.match(ships, /data-testid="reorder-ship-s1-down"/);
    assert.match(ships, /data-testid="reorder-ship-s2-up"/);
    assert.match(ships, /data-testid="cancel-ship-s1"/);
    assert.doesNotMatch(defenses, /reorder-defense-d1-up/);
    assert.match(defenses, /data-testid="reorder-defense-d1-down"/);
    assert.doesNotMatch(defenses, /reorder-defense-d2-down/);
    assert.match(defenses, /data-testid="cancel-defense-d0"/);
    assert.doesNotMatch(research, /reorder-research-r0-/);
    assert.match(research, /data-testid="reorder-research-r1-down"/);
    assert.match(research, /data-testid="reorder-research-r2-up"/);
    assert.match(research, /data-testid="cancel-research-r2"/);
  });
});
