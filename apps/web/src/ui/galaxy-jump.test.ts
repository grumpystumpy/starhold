import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { galaxyPanel } from "./render-fleets-panels";

describe("galaxy jump controls", () => {
  it("renders a mobile friendly coordinate form and wrapped galaxy controls", () => {
    const view = {
      galaxy: {
        galaxy: 9,
        system: 143,
        slots: [],
        minis: [],
        asteroids: [],
      },
    } as unknown as PlayerView;
    const html = galaxyPanel(view, false);
    assert.match(html, /<form data-galaxy-jump-form>/);
    assert.match(html, /inputmode="decimal" enterkeyhint="go" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"/);
    assert.match(html, /data-galaxy-galaxy-nav="next"[^>]*>Galaxy ▶/);
    assert.match(html, /data-galaxy-galaxy-nav="prev"[^>]*>◀ Galaxy/);
  });
});
