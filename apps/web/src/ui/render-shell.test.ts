import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createUniverse, joinUniverse, playerView } from "@starhold/game";

const { shellHtml } = await import("./render-shell.js");

describe("newbie bonus header badge", () => {
  it("shows remaining time while active and omits the badge when forfeited or expired", () => {
    const now = 100_000_000;
    const universe = createUniverse("Header", 1);
    const { player } = joinUniverse(universe, "Fresh", now);
    const html = (at: number) => shellHtml(playerView(universe, player.id, at), { error: null, notice: null, busy: false }, "overview", "<div>Main</div>");
    assert.equal(playerView(universe, player.id, now).newbieBonusEndsAt, now + 96 * 60 * 60 * 1000);
    assert.match(html(now), /data-testid="newbie-bonus-badge"/);
    assert.match(html(now), /96h left/);
    assert.doesNotMatch(html(now + 96 * 60 * 60 * 1000), /data-testid="newbie-bonus-badge"/);
    universe.players[player.id]!.newbieForfeitedAt = now + 1;
    assert.doesNotMatch(html(now + 2), /data-testid="newbie-bonus-badge"/);
  });
});

describe("planet dropdown and coords link", () => {
  it("renders top-left colony dropdown and clickable coordinate link", () => {
    const now = 100_000_000;
    const universe = createUniverse("Header", 1);
    const { player } = joinUniverse(universe, "Commander", now);
    const view = playerView(universe, player.id, now);
    const html = shellHtml(view, { error: null, notice: null, busy: false }, "overview", "<div>Main</div>");
    assert.match(html, /data-testid="planet-dropdown-wrap"/);
    assert.match(html, /data-testid="planet-dropdown"/);
    assert.match(html, /class="coord-link"/);
  });
});
