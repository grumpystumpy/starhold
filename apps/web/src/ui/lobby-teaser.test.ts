import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  joinScreenHtml,
  loadLobbyTeaser,
  lobbyTeaserHtml,
  resetLobbyTeaserCacheForTests,
} from "./render-chrome-join";

const base = {
  error: null,
  notice: null,
  busy: false,
  joinDraft: "",
};

describe("join lobby teaser", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetLobbyTeaserCacheForTests();
  });

  it("escapes commander names and lists at most five", () => {
    const html = lobbyTeaserHtml({
      commanders: 7,
      top: [
        { rank: 1, name: `<img src=x onerror=alert(1)>`, points: 1500 },
        { rank: 2, name: "Mira & Vale", points: 1200 },
        { rank: 3, name: "Cleo", points: 900 },
        { rank: 4, name: "Dax", points: 40 },
        { rank: 5, name: "Eve", points: 10 },
        { rank: 6, name: "ShouldHide", points: 1 },
      ],
    });
    assert.match(html, /data-testid="lobby-teaser"/);
    assert.match(html, /data-testid="lobby-commander-count"/);
    assert.match(html, /7 commanders/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /Mira &amp; Vale/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /ShouldHide/);
    assert.equal(html.match(/data-testid="lobby-commander"/g)?.length, 5);
    const one = lobbyTeaserHtml({ commanders: 1, top: [{ rank: 1, name: "Solo", points: 3 }] });
    assert.match(one, /1 commander</);
    assert.doesNotMatch(one, /1 commanders/);
  });

  it("leaves the join screen unchanged until a lobby response succeeds", () => {
    const html = joinScreenHtml(base);
    assert.match(html, /data-testid="join-form"/);
    assert.match(html, /data-testid="auth-form"/);
    assert.doesNotMatch(html, /data-testid="lobby-teaser"/);
  });

  it("keeps today's join screen when the lobby route fails", async () => {
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    const failed = await loadLobbyTeaser();
    assert.equal(failed, null);
    const html = joinScreenHtml(base);
    assert.doesNotMatch(html, /data-testid="lobby-teaser"/);

    resetLobbyTeaserCacheForTests();
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "unavailable" }), { status: 503 });
    assert.equal(await loadLobbyTeaser(), null);
  });

  it("fetches the public board once and ignores a bad body", async () => {
    let calls = 0;
    globalThis.fetch = async (input) => {
      calls += 1;
      assert.equal(String(input), "/api/lobby");
      return new Response(
        JSON.stringify({
          commanders: 6,
          top: [
            { rank: 1, name: "A", points: 6 },
            { rank: 2, name: "B", points: 5 },
            { rank: 3, name: "C", points: 4 },
            { rank: 4, name: "D", points: 3 },
            { rank: 5, name: "E", points: 2 },
            { rank: 6, name: "F", points: 1 },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const first = await loadLobbyTeaser();
    const second = await loadLobbyTeaser();
    assert.equal(calls, 1);
    assert.equal(first?.commanders, 6);
    assert.equal(first?.top.length, 5);
    assert.equal(first?.top[4]?.name, "E");
    assert.deepEqual(second, first);

    resetLobbyTeaserCacheForTests();
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ commanders: "many", top: [] }), { status: 200 });
    assert.equal(await loadLobbyTeaser(), null);
  });
});
