import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { galaxyPanel } from "./render-fleets-panels";
import { session } from "../session";
import { syncScannerOverlayFromPlanet } from "../main-actions-session";
import { pageHtml } from "./render-pages";

describe("galaxy page rendering", () => {
  it("keeps one next-system button on initial render and re-render", () => {
    const view = {
      galaxy: {
        galaxy: 2,
        system: 10,
        slots: [],
        minis: [],
        asteroids: [],
      },
    } as unknown as PlayerView;

    const initial = pageHtml("galaxy", view, false, null);
    assert.equal((initial.match(/data-testid="galaxy-next"/g) ?? []).length, 1);

    // Galaxy navigation updates coordinates and paints the page again while
    // the clicked control is focused. Each render must still produce one.
    view.galaxy.system = 11;
    const rerendered = pageHtml("galaxy", view, true, null);
    assert.equal((rerendered.match(/data-testid="galaxy-next"/g) ?? []).length, 1);
  });

  it("renders data-testid=\"galaxy-system-bar\" and all 15 slots with OGameX-style row classes and actions", () => {
    const slots = Array.from({ length: 15 }, (_, i) => {
      const slot = i + 1;
      if (slot === 1) {
        return {
          coords: { galaxy: 1, system: 5, slot: 1 },
          planetId: "own-1",
          playerId: "p1",
          playerName: "Alpha",
          allianceTag: "ACE",
          empirePoints: 1200,
          isOwn: true,
          hasMoon: true,
          moonId: "m1",
          debris: { metal: 500, crystal: 200 },
          artId: "normal-1",
          artThumbUrl: "/thumb.webp",
          allianceMarker: null,
        };
      }
      if (slot === 2) {
        return {
          coords: { galaxy: 1, system: 5, slot: 2 },
          planetId: "p2-pl",
          playerId: "p2",
          playerName: "Rival",
          allianceTag: "FOE",
          empirePoints: 3400,
          isOwn: false,
          hasMoon: false,
          moonId: null,
          debris: null,
          artId: "normal-2",
          artThumbUrl: "/thumb.webp",
          allianceMarker: { note: "Raid target", markedBy: "Beta" },
        };
      }
      return {
        coords: { galaxy: 1, system: 5, slot },
        planetId: null,
        playerId: null,
        playerName: null,
        allianceTag: null,
        empirePoints: 0,
        isOwn: false,
        hasMoon: false,
        moonId: null,
        debris: null,
        artId: `normal-${slot}`,
        artThumbUrl: "/thumb.webp",
        allianceMarker: null,
      };
    });

    const view = {
      galaxy: {
        galaxy: 1,
        system: 5,
        slots,
        minis: [],
        asteroids: [],
      },
      alliance: { id: "a1", name: "Alliance", tag: "ACE" },
    } as unknown as PlayerView;

    // Slot 4: foreign planet with moon to test moonDestruction icon
    slots[3] = {
      coords: { galaxy: 1, system: 5, slot: 4 },
      planetId: "p4-pl",
      playerId: "p4",
      playerName: "EnemyWithMoon",
      allianceTag: null,
      empirePoints: 5000,
      isOwn: false,
      hasMoon: true,
      moonId: "m4",
      debris: null,
      artId: "normal-4",
      artThumbUrl: "/thumb.webp",
      allianceMarker: null,
    };

    const html = pageHtml("galaxy", view, false, null);

    assert.match(html, /data-testid="galaxy-system-bar"/);
    assert.match(html, /class="[^"]*galaxy-slot-own[^"]*"[^>]*data-testid="galaxy-slot-1"/);
    assert.match(html, /data-testid="galaxy-moon-art-1"/);
    assert.match(html, /data-testid="galaxy-debris-1"/);
    assert.match(html, /debris 500\/200/);
    assert.match(
      html,
      /<button type="button" class="galaxy-debris-badge" data-galaxy-harvest="1" data-testid="galaxy-debris-1"[^>]*>debris 500\/200 · moon chance 0%<\/button>/,
    );
    assert.doesNotMatch(html, /<span class="galaxy-debris-badge"/);
    assert.doesNotMatch(html, /data-galaxy-harvest="2"/);
    assert.doesNotMatch(html, /data-galaxy-harvest="3"/);
    const busy = pageHtml("galaxy", view, true, null);
    assert.match(busy, /data-galaxy-harvest="1"[^>]*disabled/);
    assert.doesNotMatch(html, /500M/);
    assert.match(html, /1\.2K pts/);
    assert.match(html, /class="[^"]*galaxy-slot-occupied[^"]*galaxy-slot-marked[^"]*"[^>]*data-testid="galaxy-slot-2"/);
    assert.match(html, /data-testid="galaxy-marker-2"/);
    assert.match(html, /data-testid="galaxy-spy-2"/);
    assert.match(html, /data-testid="galaxy-attack-2"/);
    assert.match(html, /data-testid="galaxy-preset-raid-2"/);
    assert.match(html, /class="[^"]*galaxy-slot-empty[^"]*"[^>]*data-testid="galaxy-slot-3"/);
    assert.match(html, /data-testid="galaxy-colonize-3"/);
    assert.match(html, /3\.4K pts/);

    // Spec B7-17: No Mark button in any slot row
    assert.doesNotMatch(html, /data-testid="galaxy-mark-\d+"/);
    // Spec B7-17: Visible label Joint Strike (not Propose Joint Strike)
    assert.match(html, />Joint Strike<\/button>/);
    assert.doesNotMatch(html, />Propose Joint Strike<\/button>/);
    // Spec B7-17: Drop coordinate text from slot rows
    assert.doesNotMatch(html, /class="galaxy-slot-coords"/);
    // Spec B7-17: Slot number element precedes planet disc, label without "N. "
    assert.match(html, /<span class="galaxy-slot-num" data-testid="galaxy-slot-num-1">1<\/span>/);
    assert.match(html, /<span class="galaxy-slot-num" data-testid="galaxy-slot-num-2">2<\/span>/);
    assert.match(html, /<span class="galaxy-slot-label"><button type="button" class="commander-name" data-open-commander="p1" data-testid="galaxy-commander-1" aria-label="Commander dossier for Alpha">Alpha<\/button> \[ACE\] \(you\)/);
    assert.match(html, /<span class="galaxy-slot-label"><button type="button" class="commander-name" data-open-commander="p2" data-testid="galaxy-commander-2" aria-label="Commander dossier for Rival">Rival<\/button> \[FOE\]/);
    assert.match(html, /<span class="galaxy-slot-label">Empty<\/span>/);

    // Spec B7-13: foreign moon has Destroy moon preset icon
    assert.match(html, /data-testid="galaxy-preset-moonDestruction-4"/);
    // Own planet has moon but no Destroy moon or fleet icons
    assert.doesNotMatch(html, /data-testid="galaxy-preset-moonDestruction-1"/);
    assert.doesNotMatch(html, /data-testid="galaxy-spy-1"/);
    assert.doesNotMatch(html, /data-testid="galaxy-attack-1"/);
  });

  it("renders pirate base, alien base, asteroids, mini planets, and deep space cards with testids", () => {
    const view = {
      galaxy: {
        galaxy: 1,
        system: 5,
        slots: [],
        minis: [
          {
            planetId: "mini-1",
            name: "Outpost Alpha",
            coords: { galaxy: 1, system: 5, slot: 17 },
            artId: "mini-art",
            artThumbUrl: "/mini.webp",
            playerName: "Scout",
            isOwn: false,
            debris: { metal: 100, crystal: 50 },
          },
          {
            planetId: "mini-own",
            name: "Own Mini",
            coords: { galaxy: 1, system: 5, slot: 18 },
            artId: "mini-art-2",
            artThumbUrl: "/mini2.webp",
            playerName: "Alpha",
            isOwn: true,
            debris: null,
          },
          {
            planetId: "mini-unclaimed",
            name: "Unclaimed Mini",
            coords: { galaxy: 1, system: 5, slot: 19 },
            artId: "mini-art-3",
            artThumbUrl: "/mini3.webp",
            playerName: null,
            isOwn: false,
            debris: null,
          },
        ],
        asteroids: [
          { id: "ast-1", richness: 3, metal: 5000, crystal: 2000, deuterium: 1000 },
        ],
        pirateBase: {
          id: "pirate-test",
          name: "Black Skull Den",
          tier: 2,
          threatHint: "Medium",
          coords: { galaxy: 1, system: 5, slot: 20 },
        },
        alienBase: {
          id: "alien-test",
          name: "Xeno Hive",
          tier: 3,
          threatHint: "High",
          active: true,
          coords: { galaxy: 1, system: 5, slot: 21 },
        },
        deepSpace: {
          coords: { galaxy: 1, system: 5, slot: 16 },
        },
      },
    } as unknown as PlayerView;

    const html = pageHtml("galaxy", view, false, null);

    assert.match(html, /data-testid="galaxy-deep-space"/);
    assert.match(html, /data-testid="galaxy-minis"/);
    assert.match(html, /data-testid="galaxy-mini-mini-1"/);
    assert.match(html, /data-testid="galaxy-asteroids"/);
    assert.match(html, /data-testid="asteroid-ast-1"/);
    assert.match(html, /5k\/2k\/1k/);
    assert.match(html, /data-testid="galaxy-pirate"/);
    assert.match(html, /data-testid="galaxy-alien"/);

    // Spec B7-17: Mini planet row number precedes disc, no coords
    assert.match(html, /<span class="galaxy-slot-num" data-testid="galaxy-mini-slot-num-17">17<\/span>/);
    assert.match(html, /<span class="galaxy-slot-label">Mini Scout · debris 100\/50<\/span>/);
    assert.doesNotMatch(html, /data-galaxy-harvest/);

    // Spec B7-13: Mini planet preset icons
    // Foreign mini (Scout): spy, attack, claim, destroy
    assert.match(html, /data-testid="galaxy-mini-spy-mini-1"/);
    assert.match(html, /data-testid="galaxy-mini-preset-raid-mini-1"/);
    assert.match(html, /data-testid="galaxy-mini-preset-miniPlanetCapture-mini-1"/);
    assert.match(html, /data-testid="galaxy-mini-preset-miniPlanetDestruction-mini-1"/);

    // Unclaimed mini: claim and destroy, but no spy or attack
    assert.match(html, /data-testid="galaxy-mini-preset-miniPlanetCapture-mini-unclaimed"/);
    assert.match(html, /data-testid="galaxy-mini-preset-miniPlanetDestruction-mini-unclaimed"/);
    assert.doesNotMatch(html, /data-testid="galaxy-mini-spy-mini-unclaimed"/);
    assert.doesNotMatch(html, /data-testid="galaxy-mini-preset-raid-mini-unclaimed"/);

    // Own mini: no action icons
    assert.doesNotMatch(html, /data-testid="galaxy-mini-preset-miniPlanetCapture-mini-own"/);
    assert.doesNotMatch(html, /data-testid="galaxy-mini-preset-miniPlanetDestruction-mini-own"/);
  });
  it("B7-31: shows the escaped alliance tag next to player names in Galaxy rows and omits it for players without one", () => {
    const base = {
      planetId: null,
      playerId: null,
      playerName: null,
      allianceTag: null,
      empirePoints: 0,
      isOwn: false,
      hasMoon: false,
      moonId: null,
      debris: null,
      artThumbUrl: "/thumb.webp",
      allianceMarker: null,
    };
    const slots = Array.from({ length: 15 }, (_, i) => ({
      ...base,
      coords: { galaxy: 3, system: 7, slot: i + 1 },
      artId: `normal-${i + 1}`,
    }));
    slots[0] = { ...slots[0], planetId: "pl-a", playerId: "pa", playerName: "Tagged", allianceTag: "<X&>", empirePoints: 100 };
    slots[1] = { ...slots[1], planetId: "pl-b", playerId: "pb", playerName: "Loner", allianceTag: null, empirePoints: 100 };
    const view = {
      galaxy: { galaxy: 3, system: 7, slots, minis: [], asteroids: [] },
    } as unknown as PlayerView;

    const html = pageHtml("galaxy", view, false, null);

    assert.match(html, /<span class="galaxy-slot-label"><button type="button" class="commander-name" data-open-commander="pa" data-testid="galaxy-commander-1" aria-label="Commander dossier for Tagged">Tagged<\/button> \[&lt;X&amp;&gt;\]/);
    assert.doesNotMatch(html, /\[<X&>\]/);
    assert.match(html, /<span class="galaxy-slot-label"><button type="button" class="commander-name" data-open-commander="pb" data-testid="galaxy-commander-2" aria-label="Commander dossier for Loner">Loner<\/button>(?! \[)/);
  });

  it("shows a small NAP or WAR tag beside allied commanders", () => {
    const base = {
      planetId: null as string | null,
      playerId: null as string | null,
      playerName: null as string | null,
      allianceTag: null as string | null,
      diplomacy: undefined as "nap" | "war" | undefined,
      empirePoints: 0,
      isOwn: false,
      hasMoon: false,
      moonId: null,
      debris: null,
      artThumbUrl: "/thumb.webp",
      allianceMarker: null,
    };
    const slots = Array.from({ length: 15 }, (_, i) => ({
      ...base,
      coords: { galaxy: 3, system: 7, slot: i + 1 },
      artId: `normal-${i + 1}`,
    }));
    slots[0] = {
      ...slots[0],
      planetId: "pl-a",
      playerId: "pa",
      playerName: "Pact",
      allianceTag: "NAP",
      diplomacy: "nap",
      empirePoints: 100,
    };
    slots[1] = {
      ...slots[1],
      planetId: "pl-b",
      playerId: "pb",
      playerName: "Enemy",
      allianceTag: "WAR",
      diplomacy: "war",
      empirePoints: 100,
    };
    const view = {
      galaxy: {
        galaxy: 3,
        system: 7,
        slots,
        minis: [
          {
            planetId: "mini-1",
            name: "Mini",
            coords: { galaxy: 3, system: 7, slot: 40 },
            isOwn: false,
            playerName: "Pact Mini",
            diplomacy: "nap",
            debris: null,
            artId: "mini",
            artThumbUrl: "/thumb.webp",
          },
        ],
        asteroids: [],
      },
    } as unknown as PlayerView;
    const html = pageHtml("galaxy", view, false, null);
    assert.match(html, /data-testid="galaxy-diplomacy-1"[^>]*>NAP</);
    assert.match(html, /data-diplomacy="nap"/);
    assert.match(html, /data-testid="galaxy-diplomacy-2"[^>]*>WAR</);
    assert.match(html, /data-testid="galaxy-diplomacy-mini-mini-1"[^>]*>NAP</);
    assert.doesNotMatch(html, /data-testid="galaxy-diplomacy-3"/);
  });

  it("puts a harvest button only on slots that hold metal or crystal debris", () => {
    const slots = [1, 2, 3].map((slot) => ({
      coords: { galaxy: 2, system: 3, slot },
      planetId: null,
      playerId: null,
      playerName: null,
      allianceTag: null,
      empirePoints: 0,
      isOwn: false,
      hasMoon: false,
      moonId: null,
      debris:
        slot === 1
          ? { metal: 0, crystal: 40 }
          : slot === 2
            ? { metal: 15, crystal: 0 }
            : { metal: 0, crystal: 0 },
      artId: "normal-1",
      artThumbUrl: "/thumb.webp",
      allianceMarker: null,
    }));
    const view = {
      galaxy: { galaxy: 2, system: 3, slots, minis: [], asteroids: [] },
    } as unknown as PlayerView;
    const html = pageHtml("galaxy", view, false, null);
    assert.match(html, /data-galaxy-harvest="1"[^>]*>debris 0\/40 · moon chance 0%<\/button>/);
    assert.match(html, /data-galaxy-harvest="2"[^>]*>debris 15\/0 · moon chance 0%<\/button>/);
    assert.doesNotMatch(html, /data-galaxy-harvest="3"/);
    assert.doesNotMatch(html, /data-testid="galaxy-debris-3"/);
  });

  it("banners an active seasonal boss with a one-click raid prefill", () => {
    const view = {
      galaxy: { galaxy: 1, system: 1, slots: [], minis: [], asteroids: [] },
      player: { id: "p1" },
      now: 1_700_000_000_000,
      pirateBoss: {
        id: "boss-9",
        coords: { galaxy: 4, system: 12, slot: 6 },
        shipsLeft: 25,
        hpPct: 64,
        activeUntil: 1_700_086_400_000,
        projectedSpawnAt: 1_700_000_000_000 + 8 * 86_400_000,
        flavorTitle: "November Veil Hunt",
        myDamage: 10,
        myRank: 3,
        totalDamage: 100,
        myTier: "participant",
        top: [],
      },
    } as unknown as PlayerView;
    const html = pageHtml("galaxy", view, false, null);
    assert.match(html, /data-testid="galaxy-boss-banner"/);
    assert.match(html, /data-testid="galaxy-raid-boss"/);
    assert.match(html, /data-galaxy-attack-pirates="4:12:6"/);
    assert.match(html, /data-galaxy-pirate-base="boss-9"/);
    assert.match(html, /64% hull/);
    assert.match(html, />Raid boss</);
    assert.match(html, /November Veil Hunt/);
    assert.match(html, /window ends in 1d 0h/);
    assert.match(html, /next spawn 8d 0h/);

    view.pirateBoss = {
      ...view.pirateBoss!,
      activeUntil: undefined,
      nextSpawnAt: 1_700_086_400_000,
      hpPct: 0,
    };
    const cooling = pageHtml("galaxy", view, false, null);
    assert.doesNotMatch(cooling, /galaxy-boss-banner/);
  });

  it("shows i and I beside inactive names, with a legend and tooltip", () => {
    const slot = (n: number, extra: Record<string, unknown>) => ({
      coords: { galaxy: 1, system: 4, slot: n },
      planetId: null,
      playerId: null,
      playerName: null,
      allianceTag: null,
      isOwn: false,
      hasMoon: false,
      moonId: null,
      debris: null,
      artId: `art-${n}`,
      artThumbUrl: "/thumb.webp",
      ...extra,
    });
    const view = {
      galaxy: {
        galaxy: 1,
        system: 4,
        slots: [
          slot(1, {
            planetId: "quiet",
            playerId: "quiet",
            playerName: "Quiet",
            allianceTag: "OLD",
            inactivity: "i",
          }),
          slot(2, {
            planetId: "gone",
            playerId: "gone",
            playerName: "Gone",
            inactivity: "I",
          }),
          slot(3, {
            planetId: "here",
            playerId: "here",
            playerName: "Here",
            isOwn: true,
          }),
        ],
        minis: [
          {
            planetId: "mini-quiet",
            name: "Drift",
            coords: { galaxy: 1, system: 4, slot: 20 },
            artId: "mini",
            artThumbUrl: "/mini.webp",
            playerName: "Quiet",
            isOwn: false,
            inactivity: "I",
            debris: null,
          },
        ],
        asteroids: [],
      },
    } as unknown as PlayerView;

    const html = pageHtml("galaxy", view, false, null);
    assert.match(html, /data-testid="galaxy-inactive-legend"/);
    assert.match(html, /inactive 7\+ days/);
    assert.match(html, /inactive 28\+ days/);
    assert.match(
      html,
      /data-testid="galaxy-inactive-1"[^>]*title="Inactive for 7 days or more"[^>]*>i<\/abbr>/,
    );
    assert.match(
      html,
      /data-testid="galaxy-inactive-2"[^>]*title="Inactive for 28 days or more"[^>]*>I<\/abbr>/,
    );
    assert.match(html, /<span class="galaxy-slot-label"><button type="button" class="commander-name"[^>]*>Quiet<\/button><abbr class="galaxy-inactive"[^>]*>i<\/abbr> \[OLD\]/);
    assert.match(html, /<span class="galaxy-slot-label"><button type="button" class="commander-name"[^>]*>Gone<\/button><abbr class="galaxy-inactive"[^>]*>I<\/abbr>/);
    assert.match(html, /<span class="galaxy-slot-label"><button type="button" class="commander-name"[^>]*>Here<\/button> \(you\)/);
    assert.doesNotMatch(html, /data-testid="galaxy-inactive-3"/);
    assert.match(
      html,
      /data-testid="galaxy-mini-inactive-mini-quiet"[^>]*title="Inactive for 28 days or more"/,
    );
  });

  it("shows moon chance on debris badges at 0%, mid, and the 20% cap", () => {
    const slot = (
      n: number,
      debris: { metal: number; crystal: number } | null,
    ) => ({
      coords: { galaxy: 1, system: 5, slot: n },
      planetId: null,
      playerId: null,
      playerName: null,
      allianceTag: null,
      empirePoints: 0,
      isOwn: false,
      hasMoon: false,
      moonId: null,
      debris,
      artId: "normal",
      artThumbUrl: "/thumb.webp",
      allianceMarker: null,
    });
    const view = {
      galaxy: {
        galaxy: 1,
        system: 5,
        slots: [
          slot(1, { metal: 249_999, crystal: 0 }),
          slot(2, { metal: 750_000, crystal: 250_000 }),
          slot(3, { metal: 5_000_000, crystal: 4_000_000 }),
          slot(4, null),
        ],
        minis: [],
        asteroids: [],
      },
    } as unknown as PlayerView;

    const html = galaxyPanel(view, false);
    const badge = (n: number) =>
      html.match(
        new RegExp(`data-testid="galaxy-debris-${n}"[^>]*>([^<]*)</button>`),
      )?.[1] ?? "";

    assert.match(badge(1), /debris 249\.9k\/0/);
    assert.match(badge(1), /moon chance 0%/);
    assert.match(badge(2), /debris 750k\/250k/);
    assert.match(badge(2), /moon chance 4%/);
    assert.match(badge(3), /debris 5M\/4M/);
    assert.match(badge(3), /moon chance 20%/);
    assert.doesNotMatch(badge(3), /moon chance 3[0-9]%/);
    assert.equal(badge(4), "");
    assert.doesNotMatch(html, /data-testid="galaxy-debris-4"/);
  });
});

describe("system scanner range overlay", () => {
  function galaxyView(opts: {
    system: number;
    scannerMoons?: PlayerView["scannerMoons"];
  }): PlayerView {
    return {
      galaxy: {
        galaxy: 1,
        system: opts.system,
        slots: [],
        minis: [],
        asteroids: [],
      },
      scannerMoons: opts.scannerMoons,
    } as unknown as PlayerView;
  }

  it("hides the overlay when every scanner is level 0", () => {
    const html = pageHtml(
      "galaxy",
      galaxyView({
        system: 10,
        scannerMoons: [
          {
            planetId: "m0",
            coords: { galaxy: 1, system: 10, slot: 1 },
            sensorArray: 0,
            range: 0,
          },
        ],
      }),
      false,
      null,
    );
    assert.doesNotMatch(html, /data-testid="galaxy-scanner-range"/);
    assert.doesNotMatch(html, /data-testid="galaxy-scanner-mark"/);
    assert.doesNotMatch(html, /is-scanner-range/);
  });

  it("grows the marked span when sensorArray is upgraded", () => {
    const moon = {
      planetId: "m1",
      coords: { galaxy: 1, system: 10, slot: 1 },
      sensorArray: 2,
      range: 2,
    };
    const before = pageHtml(
      "galaxy",
      galaxyView({ system: 12, scannerMoons: [moon] }),
      false,
      null,
    );
    assert.match(before, /data-testid="galaxy-scanner-range">Scanner: systems 8–12</);
    assert.match(before, /data-testid="galaxy-scanner-mark"/);
    assert.match(before, /data-scanner-in-range="1"/);

    const outside = pageHtml(
      "galaxy",
      galaxyView({ system: 13, scannerMoons: [moon] }),
      false,
      null,
    );
    assert.match(outside, /Scanner: systems 8–12/);
    assert.doesNotMatch(outside, /data-testid="galaxy-scanner-mark"/);
    assert.doesNotMatch(outside, /data-scanner-in-range/);

    const upgraded = pageHtml(
      "galaxy",
      galaxyView({
        system: 13,
        scannerMoons: [{ ...moon, sensorArray: 4, range: 4 }],
      }),
      false,
      null,
    );
    assert.match(upgraded, /Scanner: systems 6–14/);
    assert.match(upgraded, /data-testid="galaxy-scanner-mark"/);
  });

  it("unions a second scanner moon and leaves the gap unmarked", () => {
    const html = pageHtml(
      "galaxy",
      galaxyView({
        system: 15,
        scannerMoons: [
          {
            planetId: "m1",
            coords: { galaxy: 1, system: 10, slot: 1 },
            sensorArray: 1,
            range: 1,
          },
          {
            planetId: "m2",
            coords: { galaxy: 1, system: 20, slot: 1 },
            sensorArray: 1,
            range: 1,
          },
          {
            planetId: "other-galaxy",
            coords: { galaxy: 2, system: 15, slot: 1 },
            sensorArray: 5,
            range: 5,
          },
        ],
      }),
      false,
      null,
    );
    assert.match(html, /Scanner: systems 9–11, 19–21/);
    assert.doesNotMatch(html, /data-testid="galaxy-scanner-mark"/);

    const insideSecond = pageHtml(
      "galaxy",
      galaxyView({
        system: 19,
        scannerMoons: [
          {
            planetId: "m1",
            coords: { galaxy: 1, system: 10, slot: 1 },
            sensorArray: 1,
            range: 1,
          },
          {
            planetId: "m2",
            coords: { galaxy: 1, system: 20, slot: 1 },
            sensorArray: 1,
            range: 1,
          },
        ],
      }),
      false,
      null,
    );
    assert.match(insideSecond, /data-testid="galaxy-scanner-mark"/);
  });

  it("follows the active moon's upgraded level instead of the first built range", () => {
    const previousPage = session.activePage;
    const previousView = session.view;
    const previousMoons = session.scannerMoons;
    session.activePage = "galaxy";
    session.scannerMoons = [
      {
        planetId: "m1",
        coords: { galaxy: 1, system: 10, slot: 1 },
        sensorArray: 1,
        range: 1,
      },
      {
        planetId: "m2",
        coords: { galaxy: 1, system: 40, slot: 1 },
        sensorArray: 2,
        range: 2,
      },
    ];
    session.view = {
      planet: {
        id: "m1",
        kind: "moon",
        coords: { galaxy: 1, system: 10, slot: 1 },
        buildings: { sensorArray: 4 },
      },
      galaxy: { galaxy: 1, system: 14, slots: [], minis: [], asteroids: [] },
    } as unknown as PlayerView;
    try {
      syncScannerOverlayFromPlanet();
      const moons = session.view?.scannerMoons ?? [];
      assert.equal(moons.find((moon) => moon.planetId === "m1")?.sensorArray, 4);
      assert.equal(moons.find((moon) => moon.planetId === "m1")?.range, 4);
      assert.equal(moons.find((moon) => moon.planetId === "m2")?.range, 2);
      const html = pageHtml("galaxy", session.view!, false, null);
      assert.match(html, /Scanner: systems 6–14, 38–42/);
      assert.match(html, /data-testid="galaxy-scanner-mark"/);
    } finally {
      session.activePage = previousPage;
      session.view = previousView;
      session.scannerMoons = previousMoons;
    }
  });

  it("shows a galaxy event banner here, an elsewhere indicator, or neither", () => {
    const galaxy = { galaxy: 4, system: 2, slots: [], minis: [], asteroids: [] };
    const now = 1_700_000_000_000;
    const quiet = { galaxy, now, player: { id: "p1" } } as unknown as PlayerView;
    const quietHtml = pageHtml("galaxy", quiet, false, null);
    assert.match(quietHtml, /data-testid="galaxy-panel"/);
    assert.doesNotMatch(quietHtml, /data-testid="galaxy-event-banner"/);
    assert.doesNotMatch(quietHtml, /data-testid="galaxy-event-elsewhere"/);

    const here = {
      galaxy,
      now,
      player: { id: "p1" },
      pirateBoss: {
        id: "boss-9",
        coords: { galaxy: 4, system: 12, slot: 6 },
        shipsLeft: 10,
        hpPct: 40,
        activeUntil: now + 86_400_000,
        myDamage: 1,
        myRank: 2,
        totalDamage: 10,
        myTier: "participant",
        top: [],
      },
      galaxyEvent: {
        type: "meteor_shower",
        galaxy: 4,
        startsAt: now - 1_000,
        endsAt: now + 2 * 3_600_000 + 15 * 60_000,
        label: "Meteor shower",
      },
    } as unknown as PlayerView;
    const hereHtml = pageHtml("galaxy", here, false, null);
    assert.match(hereHtml, /data-testid="galaxy-boss-banner"/);
    assert.match(hereHtml, /data-testid="galaxy-event-banner"/);
    assert.doesNotMatch(hereHtml, /data-testid="galaxy-event-elsewhere"/);
    assert.match(hereHtml, /Meteor shower in galaxy 4/);
    assert.match(hereHtml, /Debris from fights in this galaxy is 50% higher/);
    assert.match(hereHtml, /2h 15m left/);

    const away = {
      galaxy,
      now,
      player: { id: "p1" },
      galaxyEvent: {
        type: "solar_flare",
        galaxy: 7,
        startsAt: now - 1_000,
        endsAt: now + 3_600_000,
        label: "Solar flare",
      },
    } as unknown as PlayerView;
    const awayHtml = pageHtml("galaxy", away, false, null);
    assert.match(awayHtml, /data-testid="galaxy-event-elsewhere"/);
    assert.match(awayHtml, /Solar flare is in galaxy 7/);
    assert.doesNotMatch(awayHtml, /data-testid="galaxy-event-banner"/);
    assert.doesNotMatch(awayHtml, /20% weaker/);
  });
});
