import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  FIELD_BAND,
  FIELD_CENTER_BY_SLOT,
  FIELD_MIN,
  productionMultForSlot,
  temperatureKForSlot,
  type PlayerClassId,
  type PlayerView,
} from "@starhold/game";
import "../test-dom";
import { galaxyPanel } from "./render-fleets-panels";

const mainSource = readFileSync(
  fileURLToPath(new URL("../main.ts", import.meta.url)),
  "utf8",
);

describe("galaxy jump controls", () => {
  it("shows NPC attack buttons with base coordinates in action order and hides missing bases", () => {
    const view = {
      galaxy: {
        galaxy: 2,
        system: 9,
        slots: [],
        minis: [],
        asteroids: [],
        pirateBase: {
          id: "pirate-1",
          name: "Pirate base",
          coords: { galaxy: 2, system: 9, slot: 17 },
          level: 2,
          tier: 2,
          threatHint: "moderate",
          active: true,
        },
        alienBase: {
          id: "alien-1",
          name: "Alien base",
          coords: { galaxy: 2, system: 9, slot: 18 },
          level: 3,
          tier: 3,
          threatHint: "high",
          active: true,
        },
      },
    } as unknown as PlayerView;

    const html = galaxyPanel(view, false);
    const buttonOrder = [
      "galaxy-max-expeditions",
      "galaxy-attack-pirates",
      "galaxy-attack-aliens",
      "galaxy-scan-system",
    ];
    const buttonIndexes = buttonOrder.map((testId) =>
      html.indexOf(`data-testid="${testId}"`),
    );
    assert.ok(
      buttonIndexes.every(
        (index, position) =>
          index >= 0 &&
          (position === 0 || index > buttonIndexes[position - 1]!),
      ),
    );
    assert.match(
      html,
      /data-galaxy-attack-pirates="2:9:17"[^>]*data-galaxy-pirate-base="pirate-1"[^>]*data-testid="galaxy-attack-pirates"/,
    );
    assert.match(
      html,
      /data-galaxy-attack-aliens="2:9:18"[^>]*data-galaxy-alien-base="alien-1"[^>]*data-testid="galaxy-attack-aliens"/,
    );

    const missingBases = galaxyPanel(
      {
        galaxy: {
          ...view.galaxy,
          pirateBase: null,
          alienBase: null,
        },
      } as unknown as PlayerView,
      false,
    );
    assert.doesNotMatch(missingBases, /data-testid="galaxy-attack-(?:pirates|aliens)"/);

    const busyHtml = galaxyPanel(view, true);
    assert.match(busyHtml, /data-testid="galaxy-attack-pirates"[^>]*disabled/);
    assert.match(busyHtml, /data-testid="galaxy-attack-aliens"[^>]*disabled/);
  });

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
    assert.match(html, /debris 1\.2k\/340/);
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
    assert.match(html, /data-testid="galaxy-nav-row-galaxy"[^>]*>[\s\S]*?data-testid="galaxy-galaxy-prev"[\s\S]*?data-testid="galaxy-galaxy-next"/);
    assert.match(html, /data-testid="galaxy-nav-row-coords"[^>]*>[\s\S]*?#galaxy-jump|id="galaxy-jump"/);
    assert.match(html, /data-testid="galaxy-nav-row-system"[^>]*>[\s\S]*?data-testid="galaxy-prev"[\s\S]*?data-testid="galaxy-next"/);

    // Assert System row is on TOP, Coords in MIDDLE, Galaxy row BELOW
    assert.match(
      html,
      /data-testid="galaxy-nav-row-system"[\s\S]*?data-testid="galaxy-nav-row-coords"[\s\S]*?data-testid="galaxy-nav-row-galaxy"/,
    );
    // Assert placeholder is x:xxx and maintains type=text and inputmode=decimal
    assert.match(html, /placeholder="x:xxx"/);
    assert.match(html, /type="text"/);
    assert.match(html, /inputmode="decimal"/);
  });

  it("handles jump form submit with valid 9:143 coordinates and invalid ab:cd input", async () => {
    const { parseGalaxyCoords } = await import("../galaxy-coords");

    // Valid coordinates typing 9:143
    const validResult = parseGalaxyCoords("9:143", 1);
    assert.deepEqual(validResult, { galaxy: 9, system: 143 });

    // Invalid coordinates typing ab:cd
    const invalidResult = parseGalaxyCoords("ab:cd", 1);
    assert.ok("error" in invalidResult);
    assert.equal(
      invalidResult.error,
      "Use galaxy:system, like 9:143 (galaxy 1–10, system 1–399)",
    );
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

  it("shows empty-slot temperature, multipliers, and field band only for Expansionist", () => {
    const slots = [1, 8, 4].map((slot) => ({
      coords: { galaxy: 1, system: 2, slot },
      planetId: slot === 4 ? "owned" : null,
      playerId: slot === 4 ? "player" : null,
      playerName: slot === 4 ? "Commander" : null,
      allianceTag: null,
      pointsHint: 0,
      debris: null,
      isOwn: slot === 4,
      hasMoon: false,
      moonId: null,
      isMini: false,
      activity: slot === 4 ? "planet" : "empty",
      artId: "normal-1",
      artUrl: "/art.webp",
      artThumbUrl: "/thumb.webp",
    }));
    const climateFor = (slot: number): string => {
      const mult = productionMultForSlot(slot);
      const center = FIELD_CENTER_BY_SLOT[slot] ?? FIELD_CENTER_BY_SLOT[8]!;
      const low = Math.max(FIELD_MIN, center - FIELD_BAND);
      const high = Math.max(FIELD_MIN, center + FIELD_BAND);
      return `Temp ${temperatureKForSlot(slot)} K · metal ×${mult.metal.toFixed(2)} · crystal ×${mult.crystal.toFixed(2)} · deuterium ×${mult.deuterium.toFixed(2)} · energy ×${mult.energy.toFixed(2)} · fields ${low}–${high}`;
    };
    assert.equal(
      climateFor(1),
      "Temp 220 K · metal ×1.00 · crystal ×1.30 · deuterium ×0.70 · energy ×1.30 · fields 250–280",
    );
    assert.equal(
      climateFor(8),
      "Temp 90 K · metal ×1.00 · crystal ×1.00 · deuterium ×1.00 · energy ×1.00 · fields 370–400",
    );
    assert.equal(Math.max(FIELD_MIN, 265 - FIELD_BAND), 250);

    const panelFor = (classId: PlayerClassId | null | undefined) => {
      const player =
        classId === undefined
          ? undefined
          : {
              playerClass:
                classId === null
                  ? { classId: null, chosenAt: null, changeCount: 0, lastChangeAt: null }
                  : { classId, chosenAt: 1, changeCount: 0, lastChangeAt: null },
            };
      return galaxyPanel(
        {
          galaxy: { galaxy: 1, system: 2, slots, minis: [], asteroids: [] },
          ...(player ? { player } : {}),
        } as unknown as PlayerView,
        false,
      );
    };

    const expansionist = panelFor("expansionist");
    const slotLi = (html: string, slot: number) => {
      const match = html.match(
        new RegExp(
          `<li class="galaxy-slot[^"]*" data-testid="galaxy-slot-${slot}"[\\s\\S]*?</li>`,
        ),
      );
      assert.ok(match, `slot ${slot} row`);
      return match[0];
    };
    const emptyHot = slotLi(expansionist, 1);
    const emptyMid = slotLi(expansionist, 8);
    const occupied = slotLi(expansionist, 4);
    assert.match(emptyHot, /data-testid="galaxy-slot-climate-1"/);
    assert.match(emptyHot, new RegExp(climateFor(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(emptyMid, /data-testid="galaxy-slot-climate-8"/);
    assert.match(emptyMid, /fields 370–400/);
    assert.doesNotMatch(occupied, /galaxy-slot-climate/);
    assert.match(occupied, /<span class="galaxy-slot-label"><button type="button" class="commander-name"[^>]*>Commander<\/button> \(you\)<\/span>/);

    for (const classId of ["miner", "explorer", "fleeter", null, undefined] as const) {
      const html = panelFor(classId);
      assert.doesNotMatch(html, /galaxy-slot-climate/, `${String(classId)} sees no preview`);
      assert.doesNotMatch(html, /Temp 220 K/, `${String(classId)} sees no temperature`);
      assert.doesNotMatch(html, /fields 250–280/, `${String(classId)} sees no field band`);
      assert.match(html, /<span class="galaxy-slot-label">Empty<\/span>/);
    }
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

  it("jumps with one state GET and keeps coordinates through polls and actions", async () => {
    const handlerSource = readFileSync(
      fileURLToPath(new URL("../main-handlers-click.ts", import.meta.url)),
      "utf8",
    );
    assert.match(
      handlerSource,
      /data-galaxy-jump-form[\s\S]*?submitGalaxyJump\(raw\)/,
    );

    const { session, setPaintImpl } = await import("../session");
    const { submitGalaxyJump } = await import("../main-handlers-click");
    const { doRefresh, silentRefresh } = await import("../main-actions-session");
    const { doUpgrade } = await import("../main-actions-build");

    function located(galaxy: number, system: number): PlayerView {
      return {
        now: 1_700_000_000_000,
        player: { id: "p1", name: "Commander", research: {}, researchQueue: [] },
        planet: {
          id: "pl1",
          name: "Home",
          coords: { galaxy: 1, system: 4, slot: 1 },
          buildings: {},
          buildQueue: [],
          shipQueue: [],
          defenseQueue: [],
          ships: {},
          defenses: {},
        },
        galaxy: { galaxy, system },
        fleets: [],
      } as unknown as PlayerView;
    }

    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      urls.push(`${method} ${url}`);
      if (method === "POST") {
        return new Response(JSON.stringify(located(1, 4)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      const query = new URL(url, "http://127.0.0.1");
      return new Response(
        JSON.stringify(
          located(
            Number(query.searchParams.get("galaxy") ?? "1"),
            Number(query.searchParams.get("system") ?? "4"),
          ),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    setPaintImpl(() => {});
    session.view = located(1, 4);
    session.galaxyGalaxy = null;
    session.galaxySystem = null;
    session.busy = false;
    session.error = null;
    session.notice = null;

    const stateGets = () => urls.filter((line) => line.startsWith("GET ") && line.includes("/api/state"));

    try {
      await submitGalaxyJump("ab:cd");
      assert.deepEqual(urls, []);
      assert.equal(
        session.error,
        "Use galaxy:system, like 9:143 (galaxy 1–10, system 1–399)",
      );

      session.error = null;
      await submitGalaxyJump("1:4");
      assert.deepEqual(stateGets(), []);
      assert.equal(session.galaxyGalaxy, null);
      assert.equal(session.galaxySystem, null);

      await submitGalaxyJump("9:143");
      const jumpGets = stateGets();
      assert.equal(jumpGets.length, 1);
      assert.match(jumpGets[0], /[?&]galaxy=9(?:&|$)/);
      assert.match(jumpGets[0], /[?&]system=143(?:&|$)/);
      assert.match(jumpGets[0], /[?&]scanners=1(?:&|$)/);
      assert.equal(urls.filter((line) => line.startsWith("POST ")).length, 0);
      assert.equal(session.galaxyGalaxy, 9);
      assert.equal(session.galaxySystem, 143);

      urls.length = 0;
      await silentRefresh(session.view.player.id);
      const pollGets = stateGets();
      assert.equal(pollGets.length, 1);
      assert.match(pollGets[0], /[?&]galaxy=9(?:&|$)/);
      assert.match(pollGets[0], /[?&]system=143(?:&|$)/);
      assert.doesNotMatch(pollGets[0], /scanners=1/);
      assert.equal(session.galaxyGalaxy, 9);
      assert.equal(session.galaxySystem, 143);

      urls.length = 0;
      await doUpgrade("metalMine");
      assert.equal(session.view.galaxy.galaxy, 1);
      assert.equal(session.view.galaxy.system, 4);
      assert.equal(session.galaxyGalaxy, 9);
      assert.equal(session.galaxySystem, 143);
      assert.equal(stateGets().length, 0);

      urls.length = 0;
      await doRefresh();
      const afterAction = stateGets();
      assert.equal(afterAction.length, 1);
      assert.match(afterAction[0], /[?&]galaxy=9(?:&|$)/);
      assert.match(afterAction[0], /[?&]system=143(?:&|$)/);
      assert.doesNotMatch(afterAction[0], /scanners=1/);
      assert.equal(session.galaxyGalaxy, 9);
      assert.equal(session.galaxySystem, 143);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
