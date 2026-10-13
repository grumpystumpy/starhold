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
import {
  clearOccupationIfRecaptured,
} from "./world-occupation.js";
import { maybeDestroyMoonWithTitans } from "./world-round2.js";
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
  let summary = combat.summary;
  let moonFormed = false;
  let moonDestroyed = false;
  let moonKillChancePct: number | undefined;

  if (target.kind === "moon" && combat.outcome === "attacker_win") {
    const kill = maybeDestroyMoonWithTitans(
      universe,
      target,
      combat.attackerAfter,
      reportId,
    );
    moonKillChancePct = kill.chancePct;
    if (kill.destroyed) {
      moonDestroyed = true;
      summary = `${combat.summary} Voidforge Titan shattered the moon (${kill.chancePct}% chance).`;
    }
  } else {
    const moon = tryFormMoon(universe, target, debrisCreated, reportId, now);
    moonFormed = Boolean(moon);
    if (moon) {
      summary = `${combat.summary} A moon coalesced from the debris field.`;
    }
  }

  if (combat.outcome === "attacker_win") {
    // Owner recapture: attacking own occupied world clears occupation.
    // Also: owner winning vs occupier's parked garrison is handled when
    // defender is the occupier — clear when planet owner wins the fight.
    clearOccupationIfRecaptured(universe, target.id, fleet.ownerPlayerId);
  } else if (combat.outcome === "defender_win") {
    clearOccupationIfRecaptured(universe, target.id, target.ownerPlayerId);
  }

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
    moonFormed,
    moonDestroyed: moonDestroyed || undefined,
    moonKillChancePct,
  };
  universe.reports[reportId] = report;

  fleet.ships = combat.attackerAfter;
  fleet.cargo = loot;
  fleet.reportId = reportId;
}
