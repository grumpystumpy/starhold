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
  it("renders empire points and debris without planet points", () => {
    const view = {
      galaxy: {
        galaxy: 1,
        system: 2,
        slots: [
          {
            coords: { galaxy: 1, system: 2, slot: 3 },
            planetId: "owned",
            playerId: "player",
            playerName: "Commander",
            allianceTag: null,
            pointsHint: 47,
            empirePoints: 900,
            debris: { metal: 1200, crystal: 340 },
            isOwn: false,
            hasMoon: false,
            moonId: null,
            isMini: false,
            activity: "planet",
            artId: "normal-1",
            artUrl: "/art.webp",
            artThumbUrl: "/thumb.webp",
          },
          {
            coords: { galaxy: 1, system: 2, slot: 4 },
            planetId: "unowned",
            playerId: null,
            playerName: "Unclaimed",
            allianceTag: null,
            pointsHint: 47,
            debris: null,
            isOwn: false,
            hasMoon: false,
            moonId: null,
            isMini: false,
            activity: "planet",
            artId: "normal-2",
            artUrl: "/art.webp",
            artThumbUrl: "/thumb.webp",
          },
        ],
        minis: [],
        asteroids: [],
      },
    } as unknown as PlayerView;

    const html = galaxyPanel(view, false);

    assert.match(html, /900 pts/);
    assert.match(html, /debris 1,200\/340/);
    assert.doesNotMatch(html, /47 pts/);
  });

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

  it("renders spy and attack only for foreign planets and colonize only for empty slots 1–15", () => {
    const slots = [
      {
        coords: { galaxy: 1, system: 2, slot: 3 },
        planetId: "foreign",
        playerId: "rival",
        playerName: "Rival",
        isOwn: false,
      },
      {
        coords: { galaxy: 1, system: 2, slot: 4 },
        planetId: "own",
        playerId: "player",
        playerName: "Commander",
        isOwn: true,
      },
      {
        coords: { galaxy: 1, system: 2, slot: 15 },
        planetId: null,
        playerId: null,
        playerName: null,
        isOwn: false,
      },
      {
        coords: { galaxy: 1, system: 2, slot: 16 },
        planetId: null,
        playerId: null,
        playerName: null,
        isOwn: false,
      },
    ].map((slot) => ({
      ...slot,
      allianceTag: null,
      pointsHint: 0,
      debris: null,
      hasMoon: false,
      moonId: null,
      isMini: false,
      activity: slot.planetId ? "planet" : "empty",
      artId: "normal-1",
      artUrl: "/art.webp",
      artThumbUrl: "/thumb.webp",
    }));
    const view = {
      galaxy: {
        galaxy: 1,
        system: 2,
        slots,
        minis: [],
        asteroids: [],
      },
    } as unknown as PlayerView;

    const html = galaxyPanel(view, false);

    assert.match(html, /data-galaxy-spy="3" data-testid="galaxy-spy-3"/);
    assert.match(html, /data-galaxy-attack="3" data-testid="galaxy-attack-3"/);
    assert.doesNotMatch(html, /data-galaxy-colonize="3"/);
    assert.doesNotMatch(html, /data-galaxy-(?:spy|attack)="4"/);
    assert.doesNotMatch(html, /data-galaxy-colonize="4"/);
    assert.match(html, /data-galaxy-colonize="15" data-testid="galaxy-colonize-15"/);
    assert.doesNotMatch(html, /data-galaxy-(?:spy|attack)="15"/);
    assert.doesNotMatch(html, /data-galaxy-colonize="16"/);
    assert.doesNotMatch(html, /data-galaxy-(?:spy|attack)="16"/);

    const busyHtml = galaxyPanel(view, true);
    assert.match(busyHtml, /data-galaxy-spy="3"[^>]*disabled/);
    assert.match(busyHtml, /data-galaxy-attack="3"[^>]*disabled/);
    assert.match(busyHtml, /data-galaxy-colonize="15"[^>]*disabled/);
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
