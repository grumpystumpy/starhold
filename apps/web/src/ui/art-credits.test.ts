import "../test-dom";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createUniverse, joinUniverse, playerView } from "@starhold/game";
import { ART_CREDITS } from "./art-credits";
import {
  BACKGROUND_ART,
  BUILDING_ART,
  DEFENSE_ART,
  PLANET_ART,
  RESEARCH_ART,
  RESOURCE_ART,
  SHIP_ART,
  UI_ART,
  planetArtFor,
} from "./assets";
import { accountMenuFromPath } from "./nav";
import { creditsPageHtml } from "./render-credits";
import { researchRow, shipRow } from "./render-chrome-rows";
import { dashboardHtml } from "./render-dashboard";
import { session } from "../session";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(here, "../../public");
const repoRoot = path.resolve(here, "../../../..");

function referencedPaths(): string[] {
  return [
    ...Object.values(BUILDING_ART),
    ...Object.values(SHIP_ART),
    ...Object.values(DEFENSE_ART),
    ...Object.values(RESOURCE_ART),
    ...Object.values(PLANET_ART),
    ...Object.values(RESEARCH_ART),
    ...Object.values(BACKGROUND_ART),
    ...Object.values(UI_ART),
    planetArtFor({ isMini: true }),
    planetArtFor({ kind: "moon" }),
    planetArtFor({ variant: "chip" }),
    planetArtFor({ variant: "hero" }),
  ];
}

describe("art credits", () => {
  it("points every referenced plate at a file with a credits entry", () => {
    const credits = readFileSync(path.join(repoRoot, "docs/ART_CREDITS.md"), "utf8");
    const css = readFileSync(path.join(here, "styles-base.css"), "utf8");
    const listed = new Set(ART_CREDITS.map((entry) => entry.path));
    const used = new Set(referencedPaths());
    assert.deepEqual([...used].sort(), [...listed].sort());
    for (const assetPath of used) {
      const disk = path.join(publicRoot, assetPath.replace(/^\//, ""));
      assert.equal(existsSync(disk), true, `missing ${assetPath}`);
      assert.equal(credits.includes(`\`${assetPath}\``), true, `credits md missing ${assetPath}`);
    }
    assert.equal(css.includes(BACKGROUND_ART.galaxy), true);
    assert.equal(css.includes(BACKGROUND_ART.join), true);
  });

  it("prints the game-icons.net CC BY credit on the Credits page", () => {
    const html = creditsPageHtml();
    assert.match(html, /data-testid="credits-panel"/);
    assert.match(html, /Icons made by Lorc\. Available on https:\/\/game-icons\.net/);
    assert.match(html, /Icons made by Delapouite\. Available on https:\/\/game-icons\.net/);
    assert.match(html, /https:\/\/creativecommons\.org\/licenses\/by\/3\.0\//);
    assert.match(html, /CC BY 3\.0/);
    assert.match(html, /Modified: recolored and the full-canvas background path removed/);
    assert.match(html, /width="48"/);
    assert.match(html, /alt="Power Discipline"/);
    assert.match(html, /NASA does not endorse Starhold/);
    for (const entry of ART_CREDITS) {
      if (entry.group !== "game-icons") continue;
      assert.match(html, new RegExp(entry.attribution.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.equal(entry.license, "CC BY 3.0");
    }
  });

  it("routes Credits beside Security and shows research and ship plates", () => {
    assert.equal(accountMenuFromPath("/credits"), "credits");
    assert.equal(accountMenuFromPath("/security"), "security");
    const universe = createUniverse("Art UI", 8);
    const joined = joinUniverse(universe, "Painter", 170_000_000);
    const view = playerView(universe, joined.player.id, 170_000_000);
    const research = researchRow("energyTech", view, false);
    assert.match(research, /src="\/assets\/research\/power-discipline\.svg"/);
    assert.match(research, /alt="Power Discipline"/);
    assert.match(research, /width="48" height="48"/);
    const ship = shipRow("scout", view.planet, false);
    assert.match(ship, /src="\/assets\/ships\/scout\.webp"/);
    assert.match(ship, /alt="Recon Drone"/);
    const previous = session.accountMenu;
    session.accountMenu = "credits";
    try {
      const page = dashboardHtml(
        view,
        { error: null, notice: null, busy: false },
        null,
        "overview",
      );
      assert.match(page, /data-testid="credits-panel"/);
      assert.match(page, /data-testid="nav-credits"/);
      assert.match(page, /class="nav-link active"/);
    } finally {
      session.accountMenu = previous;
    }
  });
});
