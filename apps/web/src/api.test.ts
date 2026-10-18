import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, parse } from "./api";

describe("safe JSON parse", () => {
  it("turns an HTML error page into a retryable error without the parser text", async () => {
    const res = new Response("<html><title>Error 502</title></html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    await assert.rejects(parse(res), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.retryable, true);
      assert.equal(err.status, 502);
      assert.match(err.message, /retry/i);
      assert.doesNotMatch(err.message, /expected pattern|SyntaxError|JSON\.parse|Unexpected token/i);
      return true;
    });
  });

  it("turns an empty body into a friendly error", async () => {
    const res = new Response("", { status: 200 });
    await assert.rejects(parse(res), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.match(err.message, /unreadable response/i);
      assert.doesNotMatch(err.message, /expected pattern|SyntaxError/i);
      return true;
    });
  });

  it("keeps a JSON error message and marks 401 as not retryable", async () => {
    const res = new Response(JSON.stringify({ error: "Sign in required." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(parse(res), (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 401);
      assert.equal(err.retryable, false);
      assert.equal(err.message, "Sign in required.");
      return true;
    });
  });

  it("returns parsed JSON when the response is ok", async () => {
    const res = new Response(JSON.stringify({ ok: true, n: 2 }), { status: 200 });
    const body = await parse<{ ok: boolean; n: number }>(res);
    assert.deepEqual(body, { ok: true, n: 2 });
  });
});
