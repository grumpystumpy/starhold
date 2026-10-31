import "../test-dom";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readDefenseCount, readShipCount, root } from "../session";
import {
  DEFENSES,
  DEFENSE_ORDER,
  SHIPS,
  SHIP_ORDER,
  shipClassAllowed,
  type CombatReport,
  type DefenseId,
  type PlayerView,
  type ShipId,
} from "@starhold/game";
import { defenseRow, shipRow } from "./render-chrome-rows";
import { reportsHtml } from "./render-fleets-panels";
import {
  WEAKEST_FIRST_DEFENSES,
  WEAKEST_FIRST_SHIPS,
  defensesPage,
  pageHtml,
  shipyardPage,
} from "./render-pages";

describe("build count inputs", () => {
  it("allows up to 999999 ships and defenses, flooring and clamping counts", () => {
    let value = "999999";
    root.querySelector = (() => ({ value })) as typeof root.querySelector;
    assert.equal(readShipCount("scout"), 999_999);
    assert.equal(readDefenseCount("needleTurret"), 999_999);

    value = "1000001";
    assert.equal(readShipCount("scout"), 999_999);
    assert.equal(readDefenseCount("needleTurret"), 999_999);

    value = "12.9";
    assert.equal(readShipCount("scout"), 12);
    assert.equal(readDefenseCount("needleTurret"), 12);
  });
});

function dummyPlanet(): PlayerView["planet"] {
  return {
    id: "pl-1",
    kind: "planet",
    fieldsCap: 200,
    buildings: { shipyard: 10 },
    resources: { metal: 1_000_000, crystal: 1_000_000, deuterium: 1_000_000 },
    buildQueue: [],
    coords: { galaxy: 1, system: 1, slot: 4 },
    ships: {},
    defenses: {},
  } as unknown as PlayerView["planet"];
}

function dummyView(planet: PlayerView["planet"], classId: string | null = null): PlayerView {
  return {
    now: 1_700_000_000_000,
    player: {
      id: "p1",
      name: "Commander",
      research: {},
      researchQueue: [],
      officers: [],
      skillsUnlocked: [],
      playerClass: classId ? { classId } : undefined,
    },
    planet,
    ownedPlanets: [],
    universe: { speed: 1 },
  } as unknown as PlayerView;
}

function combatStrength(def: { attack: number; shield: number; hull: number }): number {
  return def.attack + def.shield + def.hull;
}

describe("Shipyard and Defenses owned count and weakest-first ordering", () => {
  it("shows Shield, Armor, and Hull in order with catalog values", () => {
    const shipHtml = shipRow("scout", dummyPlanet(), false);
    const shipStats = `Shield ${SHIPS.scout.shield} · Armor ${SHIPS.scout.armor} · Hull ${SHIPS.scout.hull}`;
    assert.ok(shipHtml.indexOf(shipStats) >= 0);

    const defenseHtml = defenseRow("needleTurret", dummyPlanet(), false);
    const defenseStats = `Shield ${DEFENSES.needleTurret.shield} · Armor ${DEFENSES.needleTurret.armor} · Hull ${DEFENSES.needleTurret.hull}`;
    assert.ok(defenseHtml.indexOf(defenseStats) >= 0);
  });

  it("renders a legacy combat report without armor data", () => {
    const oldReport = {
      id: "legacy-report",
      at: 1_700_000_000_000,
      missionId: "legacy-mission",
      attackerPlayerId: "p1",
      defenderPlayerId: "p2",
      attackerName: "Alpha",
      defenderName: "Beta",
      targetCoords: { galaxy: 1, system: 1, slot: 4 },
      attackerBefore: {},
      attackerAfter: {},
      defenderBefore: {},
      defenderAfter: {},
      defensesBefore: {},
      defensesAfter: {},
      loot: { metal: 0, crystal: 0, deuterium: 0 },
      debrisCreated: { metal: 0, crystal: 0 },
      outcome: "attacker_win",
      rounds: 1,
      summary: "Legacy report",
    } as unknown as CombatReport;
    const html = reportsHtml([oldReport], "p1");

    assert.match(html, /Legacy report/);
    assert.doesNotMatch(html, /Armor/);
  });

  describe("shipRow owned count", () => {
    it("displays 'Owned 0' when planet has no ships of that hull", () => {
      const pl = dummyPlanet();
      const html = shipRow("scout", pl, false);
      assert.match(html, /Owned 0/);
      assert.match(html, /data-testid="ship-scout"/);
      assert.match(html, /data-testid="ship-count-scout"/);
      assert.match(html, /max="999999"[^>]*data-ship-count="scout"/);
      assert.match(html, /data-testid="build-scout"/);
    });

    it("displays formatted owned count when ships exist", () => {
      const pl = dummyPlanet();
      pl.ships = {
        scout: 42,
        hauler: 1500,
      } as Record<ShipId, number>;

      const scoutHtml = shipRow("scout", pl, false);
      assert.match(scoutHtml, /Owned 42/);

      const haulerHtml = shipRow("hauler", pl, false);
      assert.match(haulerHtml, /Owned 1\.5k/);
    });

    it("handles missing ships map gracefully", () => {
      const pl = dummyPlanet();
      delete (pl as Partial<PlayerView["planet"]>).ships;
      const html = shipRow("scout", pl, false);
      assert.match(html, /Owned 0/);
    });
  });

  describe("defenseRow owned count", () => {
    it("displays 'Owned 0' when planet has no defenses of that kind", () => {
      const pl = dummyPlanet();
      const html = defenseRow("needleTurret", pl, false);
      assert.match(html, /Owned 0/);
      assert.doesNotMatch(html, />×0</);
      assert.match(html, /data-testid="defense-needleTurret"/);
      assert.match(html, /data-testid="defense-count-needleTurret"/);
      assert.match(html, /max="999999"[^>]*data-defense-count="needleTurret"/);
      assert.match(html, /data-testid="build-defense-needleTurret"/);
    });

    it("displays formatted owned count when defenses exist", () => {
      const pl = dummyPlanet();
      pl.defenses = {
        needleTurret: 15,
        laserBattery: 2500,
      } as Partial<Record<DefenseId, number>>;

      const needleHtml = defenseRow("needleTurret", pl, false);
      assert.match(needleHtml, /Owned 15/);
      assert.doesNotMatch(needleHtml, />×15</);

      const laserHtml = defenseRow("laserBattery", pl, false);
      assert.match(laserHtml, /Owned 2\.5k/);
      assert.doesNotMatch(laserHtml, />×2\.5k</);
    });

    it("needleTurret displays 'Rocket Launcher' and an old save with needleTurret count N still has N", () => {
      const pl = dummyPlanet();
      const countN = 42;
      pl.defenses = {
        needleTurret: countN,
      } as Partial<Record<DefenseId, number>>;

      const html = defenseRow("needleTurret", pl, false);
      assert.match(html, /Missile Battery/);
      assert.match(html, /Owned 42/);
      assert.equal(pl.defenses.needleTurret, countN);
      assert.equal(DEFENSES.needleTurret.name, "Missile Battery");
    });

    it("handles missing defenses map gracefully", () => {
      const pl = dummyPlanet();
      delete (pl as Partial<PlayerView["planet"]>).defenses;
      const html = defenseRow("needleTurret", pl, false);
      assert.match(html, /Owned 0/);
    });
  });

  describe("weakest-first sorting", () => {
    it("sorts ships by combat strength (attack + shield + hull) with stable tie-breaking", () => {
      // Check each pair is monotonically increasing in strength
      for (let i = 0; i < WEAKEST_FIRST_SHIPS.length - 1; i++) {
        const a = WEAKEST_FIRST_SHIPS[i];
        const b = WEAKEST_FIRST_SHIPS[i + 1];
        const strA = combatStrength(SHIPS[a]);
        const strB = combatStrength(SHIPS[b]);
        assert.ok(
          strA <= strB,
          `Ship ${a} (${strA}) should not be stronger than ship ${b} (${strB})`,
        );
      }

      // First should be Whisper Probe (5) and last World Eater (3,100,000)
      assert.equal(WEAKEST_FIRST_SHIPS[0], "probe");
      assert.equal(
        WEAKEST_FIRST_SHIPS[WEAKEST_FIRST_SHIPS.length - 1],
        "worldEater",
      );
    });

    it("tie-breaks equal combat strength units by total cost (cheapest to most expensive)", () => {
      for (let i = 0; i < WEAKEST_FIRST_SHIPS.length - 1; i++) {
        const idA = WEAKEST_FIRST_SHIPS[i];
        const idB = WEAKEST_FIRST_SHIPS[i + 1];
        const a = SHIPS[idA];
        const b = SHIPS[idB];
        const strA = combatStrength(a);
        const strB = combatStrength(b);
        if (strA === strB) {
          const costA = (a.cost?.metal ?? 0) + (a.cost?.crystal ?? 0) + (a.cost?.deuterium ?? 0);
          const costB = (b.cost?.metal ?? 0) + (b.cost?.crystal ?? 0) + (b.cost?.deuterium ?? 0);
          assert.ok(
            costA <= costB,
            `Ship ${idA} cost (${costA}) should come before or equal to ${idB} (${costB}) when combat strength is equal`,
          );
        }
      }
    });

    it("sorts defenses by combat strength (attack + shield + hull) with stable tie-breaking", () => {
      for (let i = 0; i < WEAKEST_FIRST_DEFENSES.length - 1; i++) {
        const a = WEAKEST_FIRST_DEFENSES[i];
        const b = WEAKEST_FIRST_DEFENSES[i + 1];
        const strA = combatStrength(DEFENSES[a]);
        const strB = combatStrength(DEFENSES[b]);
        assert.ok(
          strA <= strB,
          `Defense ${a} (${strA}) should not be stronger than defense ${b} (${strB})`,
        );
        if (strA === strB) {
          const idxA = DEFENSE_ORDER.indexOf(a);
          const idxB = DEFENSE_ORDER.indexOf(b);
          assert.ok(
            idxA < idxB,
            `Tied defenses ${a} and ${b} should preserve DEFENSE_ORDER (${idxA} < ${idxB})`,
          );
        }
      }

      // First should be needleTurret (39) and last crownAegis (7001)
      assert.equal(WEAKEST_FIRST_DEFENSES[0], "needleTurret");
      assert.equal(
        WEAKEST_FIRST_DEFENSES[WEAKEST_FIRST_DEFENSES.length - 1],
        "crownAegis",
      );
    });

    it("renders shipyard build list in weakest-first order in HTML", () => {
      const pl = dummyPlanet();
      const view = dummyView(pl, null);
      const html = shipyardPage(view, false);

      // Extract all <article ... data-testid="ship-<id>" occurrences in order
      const matches = [
        ...html.matchAll(/<article[^>]*data-testid="ship-([a-zA-Z0-9_-]+)"/g),
      ].map((m) => m[1] as ShipId);

      const expected = WEAKEST_FIRST_SHIPS.filter((id) =>
        shipClassAllowed(id, null),
      );
      assert.deepEqual(matches, expected);
    });

    it("renders defenses build list in weakest-first order in HTML", () => {
      const pl = dummyPlanet();
      const view = dummyView(pl, null);
      const html = defensesPage(view, false);

      const matches = [
        ...html.matchAll(/<article[^>]*data-testid="defense-([a-zA-Z0-9_-]+)"/g),
      ].map((m) => m[1] as DefenseId);

      assert.deepEqual(matches, WEAKEST_FIRST_DEFENSES);
    });

    it("preserves weakest-first order when class-exclusive ships are unlocked", () => {
      const pl = dummyPlanet();
      const fleeterView = dummyView(pl, "fleeter");
      const html = shipyardPage(fleeterView, false);

      const matches = [
        ...html.matchAll(/<article[^>]*data-testid="ship-([a-zA-Z0-9_-]+)"/g),
      ].map((m) => m[1] as ShipId);

      const expected = WEAKEST_FIRST_SHIPS.filter((id) =>
        shipClassAllowed(id, "fleeter"),
      );
      assert.deepEqual(matches, expected);
      assert.ok(matches.includes("rakeCorsair"));
    });

    it("renders Hangar roster in weakest-first order in HTML", () => {
      const pl = dummyPlanet();
      pl.ships = { scout: 5, probe: 10, hauler: 2, cruiser: 1 };
      const view = dummyView(pl, null);
      const html = shipyardPage(view, false);

      const indices = WEAKEST_FIRST_SHIPS.map((id) =>
        html.indexOf(`data-testid="hangar-${id}"`),
      ).filter((idx) => idx !== -1);
      assert.ok(indices.length > 1, "Should find multiple hangar rows in HTML");
      for (let i = 0; i < indices.length - 1; i++) {
        assert.ok(
          indices[i] < indices[i + 1],
          `Hangar row at index ${i} should appear before index ${i + 1} in HTML`,
        );
      }
    });

    it("renders Fleet tab ship picker in weakest-first order in HTML", () => {
      const pl = dummyPlanet();
      pl.ships = { scout: 5, probe: 10, hauler: 2, cruiser: 1 };
      const view = dummyView(pl, null);
      view.fleets = [];
      view.roster = [];
      view.ownedPlanets = [];
      view.galaxy = { slots: [], system: 1, galaxy: 1 } as unknown as PlayerView["galaxy"];
      const html = pageHtml("fleet", view, false, null);

      const indices = WEAKEST_FIRST_SHIPS.map((id) =>
        html.indexOf(`data-testid="fleet-count-${id}"`),
      ).filter((idx) => idx !== -1);
      assert.ok(indices.length > 1, "Should find multiple fleet ship inputs in HTML");
      for (let i = 0; i < indices.length - 1; i++) {
        assert.ok(
          indices[i] < indices[i + 1],
          `Fleet ship count at index ${i} should appear before index ${i + 1} in HTML`,
        );
      }
    });
  });
});
