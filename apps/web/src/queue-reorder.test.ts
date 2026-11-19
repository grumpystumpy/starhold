import "./test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";

const { doReorderQueue } = await import("./main-actions-build");
const { session, setPaintImpl } = await import("./session");

function view(): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: { id: "p1", researchQueue: [] },
    planet: {
      id: "pl1",
      buildQueue: [
        { id: "q0", buildingId: "metalMine" },
        { id: "q1", buildingId: "crystalMine" },
        { id: "q2", buildingId: "solarPlant" },
      ],
      shipQueue: [],
      defenseQueue: [],
    },
  } as PlayerView;
}

describe("queue reorder action", () => {
  it("swaps the last two ids and does not send a move that would displace the front", async () => {
    setPaintImpl(() => {});
    const bodies: Array<{ orderedIds?: string[]; planetId?: string; kind?: string }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify(view()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      session.view = view();
      session.busy = false;
      session.error = null;
      session.notice = null;
      await doReorderQueue("building", "q1", "down");
      assert.equal(bodies.length, 1);
      assert.equal(bodies[0]?.kind, "building");
      assert.equal(bodies[0]?.planetId, "pl1");
      assert.deepEqual(bodies[0]?.orderedIds, ["q0", "q2", "q1"]);
      assert.equal(bodies[0]?.orderedIds?.[0], "q0");

      session.view = view();
      session.busy = false;
      await doReorderQueue("building", "q1", "up");
      await doReorderQueue("building", "q2", "down");
      await doReorderQueue("building", "q0", "down");
      assert.equal(bodies.length, 1);
    } finally {
      globalThis.fetch = original;
      session.view = null;
      session.busy = false;
    }
  });
});
