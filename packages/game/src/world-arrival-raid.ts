import { mintCombatShareCode } from "./combat-share.js";
import {
  classBonuses,
  allianceBonusesForPlayer,
  computeRaidLoot,
  debrisFromDestroyed,
  debrisFromDestroyedDefenses,
  defenseRebuildRate,
  destroyedShipResources,
  effectiveCombatResearch,
  emptyDefenses,
  grantPlayerXp,
  rebuildDefenses,
  resolveCombat,
  resourcesCostTotal,
  spoilSkimmerDebris,
  xpForCombatLose,
  xpForCombatWin,
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
import { clearOccupationIfRecaptured } from "./world-occupation.js";
import {
  canDestroyMiniPlanet,
  canDirectCaptureMini,
} from "./formulas-round2.js";
import {
  MINI_FORTRESS_ARMOR_MULT,
  MINI_FORTRESS_ATTACK_MULT,
  MINI_FORTRESS_SHIELD_MULT,
  RAID_LOOT_SHARE,
  RAID_LOOT_SHARE_FLEETER,
  RAID_LOOT_SHARE_OTHER,
} from "./catalog.js";
import {
  isMiniPlanet,
  isMovingFortress,
  vacateMiniPlanet,
} from "./world-mini.js";
import { maybeDestroyMoonWithTitans } from "./world-round2.js";
import { pushEventLog } from "./world-event-log.js";
import { awardSeasonPvpWin, isSeasonPvpMission } from "./world-seasons.js";
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
  const atkCls = classBonuses(owner?.playerClass?.classId);
  const defCls = classBonuses(defenderOwner?.playerClass?.classId);
  const atkAlly = allianceBonusesForPlayer(universe, fleet.ownerPlayerId);
  const defAlly = allianceBonusesForPlayer(universe, target.ownerPlayerId);
  const defensePower =
    playerBoosts(defenderOwner, now).defensePower * defCls.defensePower;
  const fortressField = isMovingFortress(target)
    ? {
        shieldMult: MINI_FORTRESS_SHIELD_MULT,
        attackMult: MINI_FORTRESS_ATTACK_MULT,
        armorMult: MINI_FORTRESS_ARMOR_MULT,
      }
    : undefined;
  const combat = resolveCombat(
    fleet.ships,
    defenderBefore,
    defensesBefore,
    effectiveCombatResearch(owner),
    effectiveCombatResearch(defenderOwner),
    {
      defensePower,
      attackMult: atkCls.attack,
      defenseSlot: target.coords.slot,
      battlefield: fortressField,
      seed: `${fleet.id}:${fleet.arrivesAt}`,
      attackerShieldMult: atkAlly.shipShield,
      defenderShieldMult: defAlly.shipShield,
      attackerWeaponMult: atkAlly.shipWeapon,
      defenderWeaponMult: defAlly.shipWeapon,
      defenderDefenseStatMult: defAlly.defenseStat,
    },
  );
  target.ships = combat.defenderAfter;
  const rebuilt = rebuildDefenses(
    defensesBefore,
    combat.defensesAfter,
    defenseRebuildRate(defenderOwner?.playerClass?.classId),
  );
  target.defenses = rebuilt.defensesAfter;

  const debrisAtk = debrisFromDestroyed(
    destroyedShipResources(fleet.ships, combat.attackerAfter),
  );
  const debrisDef = debrisFromDestroyed(
    destroyedShipResources(defenderBefore, combat.defenderAfter),
  );
  const debrisGuns = debrisFromDestroyedDefenses(rebuilt.defensesPermanentlyLost);
  let debrisCreated: Resources = {
    metal: debrisAtk.metal + debrisDef.metal + debrisGuns.metal,
    crystal: debrisAtk.crystal + debrisDef.crystal + debrisGuns.crystal,
    deuterium: 0,
  };
  const atkClassId = owner?.playerClass?.classId ?? null;
  const defClassId = defenderOwner?.playerClass?.classId ?? null;
  if (atkClassId && defClassId && atkClassId !== defClassId) {
    const debrisMult = Math.max(
      atkCls.debrisVsOtherClass,
      defCls.debrisVsOtherClass,
    );
    if (debrisMult > 1) {
      debrisCreated = {
        metal: Math.floor(debrisCreated.metal * debrisMult),
        crystal: Math.floor(debrisCreated.crystal * debrisMult),
        deuterium: 0,
      };
    }
  }

  let loot = emptyCargo();
  if (combat.outcome === "attacker_win") {
    const lootShare =
      owner?.playerClass?.classId === "fleeter"
        ? RAID_LOOT_SHARE_FLEETER
        : RAID_LOOT_SHARE_OTHER;
    const lootScale = lootShare / RAID_LOOT_SHARE;
    const lootResources =
      lootScale === 1
        ? target.resources
        : {
            metal: Math.floor(Math.floor(target.resources.metal) * lootScale),
            crystal: Math.floor(
              Math.floor(target.resources.crystal) * lootScale,
            ),
            deuterium: Math.floor(
              Math.floor(target.resources.deuterium) * lootScale,
            ),
          };
    loot = computeRaidLoot(lootResources, combat.attackerAfter);
    if (atkAlly.loot !== 1) {
      loot = {
        metal: Math.floor(loot.metal * atkAlly.loot),
        crystal: Math.floor(loot.crystal * atkAlly.loot),
        deuterium: Math.floor(loot.deuterium * atkAlly.loot),
      };
    }
    subtractCargo(target, loot);
    const skim = spoilSkimmerDebris(debrisCreated, combat.attackerAfter);
    debrisCreated = skim.remaining;
    loot = {
      metal: loot.metal + skim.skimmed.metal,
      crystal: loot.crystal + skim.skimmed.crystal,
      deuterium: loot.deuterium,
    };
  }
  addDebris(universe, target.coords, debrisCreated);

  // XP: winner gets combat-win formula vs destroyed enemy ships; loser base.
  const atkDestroyed = resourcesCostTotal(
    destroyedShipResources(defenderBefore, combat.defenderAfter),
  );
  const defDestroyed = resourcesCostTotal(
    destroyedShipResources(fleet.ships, combat.attackerAfter),
  );
  let attackerXp = 0;
  let defenderXp = 0;
  if (owner) {
    if (combat.outcome === "attacker_win") {
      attackerXp = xpForCombatWin(atkDestroyed);
      if (
        defenderOwner &&
        defenderOwner.id !== owner.id &&
        isSeasonPvpMission(fleet.mission)
      ) {
        awardSeasonPvpWin(universe, owner, now);
      }
    } else {
      attackerXp = xpForCombatLose();
    }
    grantPlayerXp(owner, attackerXp);
    universe.players[owner.id] = owner;
  }
  if (defenderOwner && defenderOwner.id !== owner?.id) {
    if (combat.outcome === "defender_win") {
      defenderXp = xpForCombatWin(defDestroyed);
    } else {
      defenderXp = xpForCombatLose();
    }
    grantPlayerXp(defenderOwner, defenderXp);
    universe.players[defenderOwner.id] = defenderOwner;
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
    if (kill.chancePct > 0) moonKillChancePct = kill.chancePct;
    if (kill.destroyed) {
      moonDestroyed = true;
      summary = `${combat.summary} Void Titans shattered the moon (${kill.chancePct}% chance).`;
    }
  } else {
    const moon = tryFormMoon(universe, target, debrisCreated, `${fleet.id}:${fleet.arrivesAt}`, now);
    moonFormed = Boolean(moon);
    if (moon) {
      summary = `${combat.summary} A moon coalesced from the debris field.`;
    }
  }

  if (combat.outcome === "attacker_win") {
    // Owner recapture: attacking own occupied world clears occupation.
    clearOccupationIfRecaptured(universe, target.id, fleet.ownerPlayerId);
  } else if (combat.outcome === "defender_win") {
    clearOccupationIfRecaptured(universe, target.id, target.ownerPlayerId);
  }

  let miniResolveAvailable = false;
  let miniPlanetId: string | undefined;
  if (
    combat.outcome === "attacker_win" &&
    isMiniPlanet(target) &&
    Boolean(target.ownerPlayerId) &&
    target.ownerPlayerId !== fleet.ownerPlayerId
  ) {
    miniPlanetId = target.id;
    if (canDirectCaptureMini(combat.attackerAfter)) {
      miniResolveAvailable = true;
      summary = canDestroyMiniPlanet(combat.attackerAfter)
        ? `${summary} Mini contested — capture directly or destroy with World Eater.`
        : `${summary} Mini contested — capital ships can capture on resolve.`;
    } else {
      vacateMiniPlanet(universe, target);
      summary = `${summary} Owner cleared — mini unoccupied. Reclaim with a Colonizer (this fleet cannot capture).`;
    }
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
    defensesAfter: rebuilt.defensesAfter,
    defensesDestroyed: rebuilt.defensesDestroyed,
    defensesRebuilt: rebuilt.defensesRebuilt,
    defensesPermanentlyLost: rebuilt.defensesPermanentlyLost,
    loot,
    debrisCreated,
    outcome: combat.outcome,
    rounds: combat.rounds,
    summary,
    moonFormed,
    moonDestroyed: moonDestroyed || undefined,
    moonKillChancePct,
    miniResolveAvailable: miniResolveAvailable || undefined,
    miniPlanetId,
    roundLog: combat.roundLog.length ? combat.roundLog : undefined,
    xpAwarded: { attacker: attackerXp, defender: defenderXp },
    shareCode: mintCombatShareCode(universe),
  };
  universe.reports[reportId] = report;

  if (defenderOwner && defenderOwner.id !== fleet.ownerPlayerId) {
    pushEventLog(defenderOwner, {
      kind: "raidAlert",
      createdAt: fleet.arrivesAt,
      title: `Hostile raid resolved at ${target.name}`,
      body: summary,
      href: `#msg-combat-${reportId}`,
      meta: {
        reportId,
        outcome: combat.outcome,
        planetId: target.id,
        galaxy: target.coords.galaxy,
        system: target.coords.system,
        slot: target.coords.slot,
      },
    });
    universe.players[defenderOwner.id] = defenderOwner;
  }

  fleet.ships = combat.attackerAfter;
  fleet.cargo = loot;
  fleet.reportId = reportId;
}
