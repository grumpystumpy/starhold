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
import { playerBoosts } from "./world-boosts.js";
import { emptyCargo } from "./world-bootstrap.js";
import { tryFormMoon } from "./world-moons.js";
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
  const defensePower = playerBoosts(defenderOwner, now).defensePower;
  const combat = resolveCombat(
    fleet.ships,
    defenderBefore,
    defensesBefore,
    owner?.research,
    defenderOwner?.research,
    { defensePower },
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
  const moon = tryFormMoon(universe, target, debrisCreated, reportId, now);
  const summary = moon
    ? `${combat.summary} A moon coalesced from the debris field.`
    : combat.summary;
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
    summary,
    moonFormed: Boolean(moon),
  };
  universe.reports[reportId] = report;

  fleet.ships = combat.attackerAfter;
  fleet.cargo = loot;
  fleet.reportId = reportId;
}
