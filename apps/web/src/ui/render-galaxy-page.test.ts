import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
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
    assert.doesNotMatch(html, /500M/);
    assert.match(html, /1\.2k pts/);
    assert.match(html, /class="[^"]*galaxy-slot-occupied[^"]*galaxy-slot-marked[^"]*"[^>]*data-testid="galaxy-slot-2"/);
    assert.match(html, /data-testid="galaxy-marker-2"/);
    assert.match(html, /data-testid="galaxy-spy-2"/);
    assert.match(html, /data-testid="galaxy-attack-2"/);
    assert.match(html, /data-testid="galaxy-preset-raid-2"/);
    assert.match(html, /class="[^"]*galaxy-slot-empty[^"]*"[^>]*data-testid="galaxy-slot-3"/);
    assert.match(html, /data-testid="galaxy-colonize-3"/);
    assert.match(html, /3\.4k pts/);

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
    assert.match(html, /<span class="galaxy-slot-label">Alpha \[ACE\] \(you\)/);
    assert.match(html, /<span class="galaxy-slot-label">Rival \[FOE\]/);
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
          name: "Black Skull Den",
          tier: 2,
          threatHint: "Medium",
          coords: { galaxy: 1, system: 5, slot: 20 },
        },
        alienBase: {
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
});
