import "./test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";

describe("commander mail fetch", () => {
  it("does not call /api/mail unless the Messages page is open", async () => {
    const { session, setPaintImpl } = await import("./session");
    const { refreshCommanderMailIfOpen } = await import("./main-actions-session");
    setPaintImpl(() => {});
    session.view = { player: { id: "p1" } } as PlayerView;
    session.activePage = "overview";
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    try {
      await refreshCommanderMailIfOpen();
      assert.deepEqual(calls, []);
      session.activePage = "messages";
      await refreshCommanderMailIfOpen();
      assert.equal(calls.length, 1);
      assert.match(calls[0] ?? "", /\/api\/mail$/);
    } finally {
      globalThis.fetch = original;
      session.view = null;
      session.activePage = "overview";
    }
  });
});
