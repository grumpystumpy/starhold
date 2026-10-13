import {
  computeRaidLoot,
  debrisFromDestroyed,
  destroyedShipResources,
  emptyDefenses,
  resolveCombat,
} from "./formulas.js";
import type {
  CombatReport,
  FleetMission,
  PlanetState,
  Resources,
  UniverseState,
} from "./types.js";
import { emptyCargo } from "./world-bootstrap.js";
import { addDebris, subtractCargo } from "./world-tick.js";

/** Resolve outbound raid at target; mutates fleet cargo/ships/reportId. */
export function resolveRaidArrival(
  universe: UniverseState,
  fleet: FleetMission,
  target: PlanetState,
  now: number,
): void {
  const owner = universe.players[fleet.ownerPlayerId];
  const defenderOwner = universe.players[target.ownerPlayerId];
  const defenderBefore = { ...target.ships };
  const defensesBefore = { ...(target.defenses ?? emptyDefenses()) };
  const combat = resolveCombat(
    fleet.ships,
    defenderBefore,
    defensesBefore,
    owner?.research,
    defenderOwner?.research,
  );
  target.ships = combat.defenderAfter;
  target.defenses = combat.defensesAfter;

  const debrisAtk = debrisFromDestroyed(
    destroyedShipResources(fleet.ships, combat.attackerAfter),
  );
  const debrisDef = debrisFromDestroyed(
    destroyedShipResources(defenderBefore, combat.defenderAfter),
  );
  const debrisCreated: Resources = {
    metal: debrisAtk.metal + debrisDef.metal,
    crystal: debrisAtk.crystal + debrisDef.crystal,
    deuterium: 0,
  };
  addDebris(universe, target.coords, debrisCreated);

  let loot = emptyCargo();
  if (combat.outcome === "attacker_win") {
    loot = computeRaidLoot(target.resources, combat.attackerAfter);
    subtractCargo(target, loot);
  }

  const reportId = `rpt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const report: CombatReport = {
    id: reportId,
    at: now,
    missionId: fleet.id,
    attackerPlayerId: fleet.ownerPlayerId,
    defenderPlayerId: target.ownerPlayerId,
    attackerName: owner?.name ?? "Unknown",
    defenderName: defenderOwner?.name ?? "Unknown",
    targetCoords: { ...target.coords },
    attackerBefore: { ...fleet.ships },
    attackerAfter: combat.attackerAfter,
    defenderBefore,
    defenderAfter: combat.defenderAfter,
    defensesBefore,
    defensesAfter: combat.defensesAfter,
    loot,
    debrisCreated,
    outcome: combat.outcome,
    rounds: combat.rounds,
    summary: combat.summary,
  };
  universe.reports[reportId] = report;

  fleet.ships = combat.attackerAfter;
  fleet.cargo = loot;
  fleet.reportId = reportId;
}
