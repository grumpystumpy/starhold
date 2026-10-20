import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { PlayerView } from "@starhold/game";
import { galaxyPanel } from "./render-fleets-panels";

const mainSource = readFileSync(
  fileURLToPath(new URL("../main.ts", import.meta.url)),
  "utf8",
);

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

  it("clears a stale galaxy selection when startup resumes a player", () => {
    const resumePlayer = mainSource.match(
      /async function resumePlayer\([\s\S]*?\n}\n/,
    )?.[0];
    assert.ok(resumePlayer, "startup resumePlayer function exists");
    assert.match(
      resumePlayer,
      /session\.galaxySystem = session\.view\.planet\.coords\.system;\s*session\.galaxyGalaxy = null;/,
    );
  });
});
