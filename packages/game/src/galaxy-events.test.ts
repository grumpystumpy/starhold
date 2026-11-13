import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  GALAXY_EVENT_DURATION_MS,
  GALAXY_EVENT_METEOR_DEBRIS_MULT,
  GALAXY_EVENT_SOLAR_FLARE_SHIELD_MULT,
  GALAXY_EVENTS_PER_WEEK,
} from "./data/tuning.js";
import {
  debrisFromDestroyed,
  emptyDefenses,
  normalizeFleetShips,
  resolveCombat,
} from "./formulas.js";
import type { Coordinates, UniverseState } from "./types.js";
import { migrateOrResetUniverse } from "./world-migrate.js";
import {
  galaxyEventDebrisMult,
  galaxyEventShieldMods,
  galaxyEventShieldMult,
  scheduledGalaxyEvent,
  tickGalaxyEvents,
} from "./world-galaxy-events.js";
import { resolveRaidArrival } from "./world-arrival-raid.js";
import { createUniverse, joinUniverse, launchFleet } from "./world.js";
import { graduateNewbieProtection } from "./test-graduate.js";

const WEEK_MS = 7 * GALAXY_EVENT_DURATION_MS;
const SLOT_MS = Math.floor(WEEK_MS / GALAXY_EVENTS_PER_WEEK);

function bare(seed: string): UniverseState {
  return {
    id: `uni_${seed}`,
    name: "Events",
    speed: 1,
    fleetSpeed: 1,
    createdAt: 0,
    seed,
    players: {},
    planets: {},
    fleets: {},
    reports: {},
    spyReports: {},
    expeditionReports: {},
    debris: {},
  };
}

function weekStart(week: number): number {
  return week * WEEK_MS;
}

describe("galaxy events", () => {
  it("picks the same event for the same seed and frozen now", () => {
    const now = weekStart(4) + 1_000;
    const left = bare("alpha-seed");
    const right = bare("alpha-seed");
    tickGalaxyEvents(left, now);
    tickGalaxyEvents(right, now);
    assert.deepEqual(left.galaxyEvent, right.galaxyEvent);
    assert.ok(left.galaxyEvent);
    assert.equal(left.galaxyEvent.startsAt, weekStart(4));
    assert.equal(
      left.galaxyEvent.endsAt,
      weekStart(4) + GALAXY_EVENT_DURATION_MS,
    );
    assert.ok(left.galaxyEvent.galaxy >= 1 && left.galaxyEvent.galaxy <= 10);

    let differed = false;
    for (const seed of ["beta-seed", "gamma-seed", "delta-seed", "epsilon"]) {
      const other = bare(seed);
      tickGalaxyEvents(other, now);
      if (
        other.galaxyEvent?.galaxy !== left.galaxyEvent.galaxy ||
        other.galaxyEvent?.type !== left.galaxyEvent.type
      ) {
        differed = true;
        break;
      }
    }
    assert.equal(differed, true);

    let weekDiffered = false;
    for (let week = 5; week < 13; week++) {
      const later = bare("alpha-seed");
      tickGalaxyEvents(later, weekStart(week) + 1_000);
      if (
        later.galaxyEvent?.galaxy !== left.galaxyEvent.galaxy ||
        later.galaxyEvent?.type !== left.galaxyEvent.type
      ) {
        weekDiffered = true;
        break;
      }
    }
    assert.equal(weekDiffered, true);
  });

  it("loads a save with no galaxyEvent field and ticks it", () => {
    const path = fileURLToPath(
      new URL(
        "../../../apps/server/src/fixtures/pre-row-save.json",
        import.meta.url,
      ),
    );
    const raw = JSON.parse(readFileSync(path, "utf8")) as UniverseState;
    assert.equal(raw.galaxyEvent, undefined);
    const loaded = migrateOrResetUniverse(structuredClone(raw));
    assert.equal(loaded.didReset, false);
    assert.equal(loaded.universe.galaxyEvent, undefined);
    const planet = loaded.universe.planets.plnt_fixture_row!;
    assert.equal(planet.resources.metal, 123456);
    tickGalaxyEvents(loaded.universe, weekStart(2) + 1_000);
    assert.ok(loaded.universe.galaxyEvent);
    assert.equal(planet.resources.metal, 123456);
    assert.equal(loaded.universe.fleets.flt_fixture_outbound?.ships.scout, 4);
  });

  it("expires after 24h and starts the next event without overlap", () => {
    const start = weekStart(6);
    const universe = bare("overlap-seed");
    tickGalaxyEvents(universe, start + 5_000);
    const first = universe.galaxyEvent;
    assert.ok(first);
    tickGalaxyEvents(universe, start + 6_000);
    assert.deepEqual(universe.galaxyEvent, first);

    tickGalaxyEvents(universe, first.endsAt);
    assert.equal(universe.galaxyEvent, undefined);
    assert.equal(scheduledGalaxyEvent(universe, first.endsAt), null);

    tickGalaxyEvents(universe, start + SLOT_MS);
    const next = universe.galaxyEvent;
    assert.ok(next);
    assert.ok(next.startsAt >= first.endsAt);
    assert.notEqual(next.startsAt, first.startsAt);
    assert.ok(next.endsAt <= next.startsAt + GALAXY_EVENT_DURATION_MS);
    assert.ok(first.endsAt <= next.startsAt);
  });

  it("boosts meteor debris only in that galaxy and only during the window", () => {
    const base = debrisFromDestroyed({ metal: 4_000, crystal: 2_000, deuterium: 0 });
    const scaled = debrisFromDestroyed(
      { metal: 4_000, crystal: 2_000, deuterium: 0 },
      GALAXY_EVENT_METEOR_DEBRIS_MULT,
    );
    assert.equal(scaled.metal, Math.floor(base.metal * GALAXY_EVENT_METEOR_DEBRIS_MULT));
    assert.equal(
      scaled.crystal,
      Math.floor(base.crystal * GALAXY_EVENT_METEOR_DEBRIS_MULT),
    );

    const universe = createUniverse("Meteor", 1, 1, { lazySeed: true });
    const atk = joinUniverse(universe, "MeteorAtk", 1_000);
    const def = joinUniverse(universe, "MeteorDef", 1_001);
    graduateNewbieProtection(universe, universe.players[def.player.id]!);
    universe.planets[atk.planet.id]!.ships.interceptor = 4;
    universe.planets[atk.planet.id]!.resources.deuterium = 50_000;
    universe.planets[def.planet.id]!.ships.interceptor = 3;
    const launch = launchFleet(
      universe,
      atk.player.id,
      def.planet.id,
      "raid",
      { interceptor: 3 },
      1_100,
    );
    assert.equal(launch.ok, true);
    if (!launch.ok) return;

    const now = launch.fleet.arrivesAt;
    const galaxy = def.planet.coords.galaxy;
    const otherGalaxy = galaxy === 1 ? 2 : 1;
    const plain = structuredClone(universe);
    const here = structuredClone(universe);
    const away = structuredClone(universe);
    const expired = structuredClone(universe);
    here.galaxyEvent = {
      type: "meteor_shower",
      galaxy,
      startsAt: now - 1_000,
      endsAt: now + GALAXY_EVENT_DURATION_MS,
    };
    away.galaxyEvent = {
      type: "meteor_shower",
      galaxy: otherGalaxy,
      startsAt: now - 1_000,
      endsAt: now + GALAXY_EVENT_DURATION_MS,
    };
    expired.galaxyEvent = {
      type: "meteor_shower",
      galaxy,
      startsAt: now - 10_000,
      endsAt: now - 1,
    };

    const fight = (row: UniverseState) => {
      resolveRaidArrival(
        row,
        row.fleets[launch.fleet.id]!,
        row.planets[def.planet.id]!,
        now,
      );
      const report = Object.values(row.reports)[0];
      assert.ok(report?.roundLog && report.roundLog.length >= 1);
      return report!;
    };

    const plainReport = fight(plain);
    const hereReport = fight(here);
    const awayReport = fight(away);
    const expiredReport = fight(expired);

    assert.deepEqual(awayReport.debrisCreated, plainReport.debrisCreated);
    assert.deepEqual(
      awayReport.roundLog?.map((round) => round.debrisThisRound),
      plainReport.roundLog?.map((round) => round.debrisThisRound),
    );
    assert.deepEqual(expiredReport.debrisCreated, plainReport.debrisCreated);
    assert.ok(hereReport.debrisCreated.metal > plainReport.debrisCreated.metal);
    for (let i = 0; i < (plainReport.roundLog?.length ?? 0); i++) {
      const before = plainReport.roundLog![i]!.debrisThisRound;
      const after = hereReport.roundLog![i]!.debrisThisRound;
      assert.equal(
        after.metal,
        Math.floor(before.metal * GALAXY_EVENT_METEOR_DEBRIS_MULT),
      );
      assert.equal(
        after.crystal,
        Math.floor(before.crystal * GALAXY_EVENT_METEOR_DEBRIS_MULT),
      );
    }
    const coords: Coordinates = { ...def.planet.coords };
    assert.equal(galaxyEventDebrisMult(here, coords, now), GALAXY_EVENT_METEOR_DEBRIS_MULT);
    assert.equal(galaxyEventDebrisMult(away, coords, now), 1);
    assert.equal(galaxyEventDebrisMult(expired, coords, now), 1);
  });

  it("cuts both shield mods by 0.8 only in-window and in-galaxy", () => {
    const universe = bare("flare-seed");
    const coords: Coordinates = { galaxy: 3, system: 2, slot: 4 };
    const elsewhere: Coordinates = { galaxy: 4, system: 2, slot: 4 };
    const now = 50_000;
    universe.galaxyEvent = {
      type: "solar_flare",
      galaxy: 3,
      startsAt: 0,
      endsAt: 80_000,
    };
    assert.equal(
      galaxyEventShieldMult(universe, coords, now),
      GALAXY_EVENT_SOLAR_FLARE_SHIELD_MULT,
    );
    assert.equal(galaxyEventShieldMult(universe, elsewhere, now), 1);
    assert.equal(galaxyEventShieldMult(universe, coords, 80_000), 1);
    const folded = galaxyEventShieldMods(universe, coords, now, 2, 4);
    assert.equal(folded.attackerShieldMult, 2 * GALAXY_EVENT_SOLAR_FLARE_SHIELD_MULT);
    assert.equal(folded.defenderShieldMult, 4 * GALAXY_EVENT_SOLAR_FLARE_SHIELD_MULT);
    assert.equal(galaxyEventDebrisMult(universe, coords, now), 1);

    const atk = normalizeFleetShips({ cruiser: 1 });
    const def = normalizeFleetShips({ cruiser: 1 });
    const seed = "galaxy-flare-unchanged";
    const plain = resolveCombat(atk, def, emptyDefenses(), undefined, undefined, {
      seed,
    });
    const explicit = resolveCombat(atk, def, emptyDefenses(), undefined, undefined, {
      seed,
      attackerShieldMult: 1,
      defenderShieldMult: 1,
      debrisMult: 1,
    });
    assert.deepEqual(explicit, plain);
    const flared = resolveCombat(atk, def, emptyDefenses(), undefined, undefined, {
      seed,
      attackerShieldMult: folded.attackerShieldMult / 2,
      defenderShieldMult: GALAXY_EVENT_SOLAR_FLARE_SHIELD_MULT,
    });
    assert.notDeepEqual(
      flared.roundLog[0]?.shieldsAbsorbed,
      plain.roundLog[0]?.shieldsAbsorbed,
    );
  });
});
