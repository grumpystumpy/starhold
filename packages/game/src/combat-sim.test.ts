import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  attackerSimResearch,
  defenderFromSpyReport,
  parseCombatSimPaste,
  runCombatSandbox,
  simulateCombat,
} from "./combat-sim.js";
import { emptyDefenses, emptyFleetShips, emptyResearch, resolveCombat } from "./formulas.js";
import { effectiveCombatResearch } from "./formulas-progress.js";
import { classBonuses } from "./formulas-round3.js";
import { NEWBIE_DEFENSE_MULT } from "./world-protection.js";
import { createUniverse, joinUniverse, migrateOrResetUniverse, type UniverseState } from "./world.js";

describe("combat simulator", () => {
  it("matches resolveCombat for the same fleets, research, mods, and seed", () => {
    const attacker = { cruiser: 4, interceptor: 12, scout: 1 };
    const defender = { cruiser: 6, scout: 2 };
    const defenses = { laserBattery: 8, gaussRail: 2 };
    const attackerResearch = emptyResearch();
    attackerResearch.weaponsTech = 4;
    attackerResearch.armourTech = 2;
    const defenderResearch = emptyResearch();
    defenderResearch.shieldingTech = 3;
    defenderResearch.weaponsTech = 1;
    const mods = {
      seed: "b7-90-equal",
      attackMult: 1.08,
      defensePower: 1.15,
      defenderUnitStatMult: NEWBIE_DEFENSE_MULT,
      defenseSlot: 6,
    };
    const direct = resolveCombat(
      { ...emptyFleetShips(), ...attacker },
      { ...emptyFleetShips(), ...defender },
      { ...emptyDefenses(), ...defenses },
      { ...attackerResearch },
      { ...defenderResearch },
      { ...mods },
    );
    const sim = simulateCombat({
      attacker,
      defender,
      defenses,
      attackerResearch,
      defenderResearch,
      mods,
    });
    assert.deepEqual(sim, direct);
    assert.equal(sim.rounds > 0, true);
    assert.deepEqual(attacker, { cruiser: 4, interceptor: 12, scout: 1 });
    assert.deepEqual(defenses, { laserBattery: 8, gaussRail: 2 });
    assert.equal(attackerResearch.weaponsTech, 4);
  });

  it("applies class attack and level research without writing the player", () => {
    const universe = createUniverse("Sim research", 1);
    const joined = joinUniverse(universe, "Sim", 1_700_000_000_000);
    const player = universe.players[joined.player.id]!;
    player.level = 11;
    player.research.weaponsTech = 2;
    player.playerClass!.classId = "fleeter";
    const before = structuredClone(player);
    const derived = attackerSimResearch(player);
    assert.deepEqual(derived, effectiveCombatResearch(structuredClone(player)));
    assert.deepEqual(player, before);
    const sandbox = runCombatSandbox({
      attacker: { cruiser: 5 },
      defender: { interceptor: 8 },
      defenses: { laserBattery: 4 },
      attackerResearch: player.research,
      attackerLevel: player.level,
      attackerClassId: player.playerClass.classId,
      defenderResearch: { shieldingTech: 1 },
      seed: "class-seed",
    });
    const direct = resolveCombat(
      { ...emptyFleetShips(), cruiser: 5 },
      { ...emptyFleetShips(), interceptor: 8 },
      { ...emptyDefenses(), laserBattery: 4 },
      derived,
      { ...emptyResearch(), shieldingTech: 1 },
      { seed: "class-seed", attackMult: classBonuses("fleeter").attack },
    );
    assert.deepEqual(sandbox, direct);
    assert.equal(player.research.weaponsTech, 2);
  });

  it("fills the defender from a spy report and from pasted report lines", () => {
    const fromReport = defenderFromSpyReport({
      ships: { cruiser: 4, scout: 2 },
      defenses: { laserBattery: 9 },
      research: { weaponsTech: 3 },
    });
    assert.equal(fromReport.ships?.cruiser, 4);
    assert.equal(fromReport.ships?.scout, 2);
    assert.equal(fromReport.ships?.interceptor, 0);
    assert.equal(fromReport.defenses?.laserBattery, 9);
    assert.equal(fromReport.research?.weaponsTech, 3);
    assert.equal(fromReport.research?.armourTech, 0);

    const pasted = parseCombatSimPaste(
      [
        "Metal 10 · Crystal 4 · Deut 1",
        "Ships: 4× Recon Drone, 2× Strike Fighter",
        "Defenses: 6× Light Laser Turret",
        "Research: Ordnance Doctrine L3",
      ].join("\n"),
    );
    assert.equal(pasted.ok, true);
    if (!pasted.ok) return;
    assert.equal(pasted.ships.scout, 4);
    assert.equal(pasted.ships.interceptor, 2);
    assert.equal(pasted.defenses.laserBattery, 6);
    assert.equal(pasted.research?.weaponsTech, 3);

    const ids = parseCombatSimPaste("cruiser=5\ngaussRail=2\nweaponsTech=1");
    assert.equal(ids.ok, true);
    if (!ids.ok) return;
    assert.equal(ids.ships.cruiser, 5);
    assert.equal(ids.defenses.gaussRail, 2);
    assert.equal(ids.research?.weaponsTech, 1);

    const junk = parseCombatSimPaste("Ships: 1× Not A Hull");
    assert.equal(junk.ok, false);
  });

  it("leaves a main-branch in-flight save unchanged", () => {
    const path = fileURLToPath(new URL("./fixtures/in-flight-fleet-save.json", import.meta.url));
    const raw = JSON.parse(readFileSync(path, "utf8")) as UniverseState;
    const loaded = migrateOrResetUniverse(structuredClone(raw));
    assert.equal(loaded.didReset, false);
    const universe = loaded.universe;
    const fleetId = Object.keys(universe.fleets)[0];
    assert.ok(fleetId);
    const fleet = universe.fleets[fleetId!]!;
    const owner = universe.players[fleet.ownerPlayerId]!;
    const home = universe.planets[owner.homePlanetId]!;
    const snapshot = JSON.stringify(universe);
    runCombatSandbox({
      attacker: home.ships,
      defender: { cruiser: 3, interceptor: 4 },
      defenses: home.defenses,
      attackerResearch: owner.research,
      attackerLevel: owner.level,
      attackerClassId: owner.playerClass?.classId ?? null,
      defenderResearch: { weaponsTech: 2 },
      seed: "main-save",
    });
    assert.equal(JSON.stringify(universe), snapshot);
    assert.equal(universe.fleets[fleetId!]!.mission, "deploy");
    assert.equal(universe.fleets[fleetId!]!.ships.scout, 1);
    assert.equal(universe.fleets[fleetId!]!.ownerPlayerId, fleet.ownerPlayerId);
    assert.equal(home.ships.scout, 0);
  });
});
