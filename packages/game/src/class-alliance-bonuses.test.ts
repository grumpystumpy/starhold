import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PLAYER_CLASS_BONUSES,
  SHIPS,
} from "./catalog.js";
import {
  buildingUpgradeCost,
  classBonuses,
  effectiveFieldsCap,
  empireExpeditionCap,
  maxExpeditions,
  planetPoints,
  shipStockPoints,
} from "./formulas.js";
import type {
  AllianceClassId,
  FleetMission,
  PlanetState,
  PlayerClassId,
  PlayerState,
  UniverseState,
} from "./types.js";
import { installDeterministicInputs } from "./test-determinism.js";
import { graduateNewbieProtection } from "./test-graduate.js";
import { emptyBuildings, emptyCargo, emptyShips } from "./world-bootstrap.js";
import {
  expeditionBlackHoleRoll,
  expeditionKindForShift,
  expeditionRoll,
  resolveExpeditionArrival,
} from "./world-expedition.js";
import {
  advanceUniverse,
  choosePlayerClass,
  changePlayerClass,
  createAlliance,
  createUniverse,
  joinAlliance,
  joinUniverse,
  launchFleet,
  leaveAlliance,
  migrateOrResetUniverse,
  playerView,
  queueBuildingUpgrade,
  queueShipBuild,
  setActivePlanet,
  setAllianceClass,
  setAllianceRole,
} from "./world.js";

const RAID_REPORT_SEED = 0x52414944;

function near(actual: number, expected: number, rel = 0.02): void {
  const denom = Math.max(1, Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) / denom <= rel,
    `expected ${actual} ≈ ${expected}`,
  );
}

function addColony(
  universe: UniverseState,
  player: PlayerState,
  fieldsCap: number,
): PlanetState {
  const home = universe.planets[player.homePlanetId]!;
  const id = `plnt_col_${player.id}`;
  const slot = home.coords.slot === 15 ? 1 : home.coords.slot + 1;
  const colony: PlanetState = {
    ...structuredClone(home),
    id,
    name: "Colony",
    ownerPlayerId: player.id,
    coords: { galaxy: home.coords.galaxy, system: home.coords.system, slot },
    kind: "planet",
    parentPlanetId: null,
    moonId: null,
    fieldsCap,
    resources: { metal: 80_000, crystal: 80_000, deuterium: 80_000 },
    lastTickAt: home.lastTickAt,
    buildings: emptyBuildings(),
    ships: emptyShips(),
    defenses: { ...home.defenses },
    buildQueue: [],
    shipQueue: [],
    defenseQueue: [],
  };
  universe.planets[id] = colony;
  player.planetIds.push(id);
  universe.players[player.id] = player;
  return colony;
}

function setClass(
  player: PlayerState,
  classId: PlayerClassId | null,
): void {
  player.playerClass = {
    classId,
    chosenAt: classId ? 1 : null,
    changeCount: 0,
    lastChangeAt: null,
  };
}

function foundAlliance(
  universe: UniverseState,
  founderId: string,
  classId: AllianceClassId | null,
  now: number,
): void {
  const created = createAlliance(universe, founderId, "Class Pact", "CLS", "open", now);
  assert.equal(created.ok, true, created.ok ? "" : created.error);
  if (classId) {
    const set = setAllianceClass(universe, founderId, classId, now + 1);
    assert.equal(set.ok, true, set.ok ? "" : set.error);
  }
}

function oneWaySeconds(opts: {
  classId?: PlayerClassId | null;
  alliance?: AllianceClassId | null;
  own: boolean;
  ships: "scout" | "recycler" | "mixed";
}): number {
  const universe = createUniverse(`spd-${opts.ships}-${opts.own}`, 1);
  const now = 3_000_000;
  const a = joinUniverse(universe, "Pilot", now);
  const b = joinUniverse(universe, "Other", now + 1);
  const origin = universe.planets[a.planet.id]!;
  const target = opts.own
    ? addColony(universe, a.player, 160)
    : universe.planets[b.planet.id]!;
  origin.coords = { galaxy: 2, system: 4, slot: 2 };
  target.coords = { galaxy: 2, system: 4, slot: 4 };
  origin.resources.deuterium = 50_000;
  origin.ships.scout = 0;
  origin.ships.recycler = 0;
  origin.ships.colonyShip = 0;
  if (opts.ships === "scout") origin.ships.scout = 1;
  if (opts.ships === "recycler") origin.ships.recycler = 1;
  if (opts.ships === "mixed") {
    origin.ships.recycler = 1;
    origin.ships.colonyShip = 1;
  }
  if (opts.classId) setClass(a.player, opts.classId);
  if (opts.alliance) foundAlliance(universe, a.player.id, opts.alliance, now + 2);
  const launch = launchFleet(
    universe,
    a.player.id,
    target.id,
    "deploy",
    opts.ships === "scout"
      ? { scout: 1 }
      : opts.ships === "recycler"
        ? { recycler: 1 }
        : { recycler: 1, colonyShip: 1 },
    now + 10,
  );
  assert.equal(launch.ok, true, launch.ok ? "" : launch.error);
  if (!launch.ok) return 0;
  return (launch.fleet.arrivesAt - launch.fleet.departedAt) / 1000;
}

function raidReport(opts: {
  atkClass: PlayerClassId | null;
  defClass: PlayerClassId | null;
  atkAlliance?: AllianceClassId | null;
  defAlliance?: AllianceClassId | null;
  atkShips: Record<string, number>;
  defShips?: Record<string, number>;
  defDefenses?: Record<string, number>;
  resources?: { metal: number; crystal: number; deuterium: number };
}) {
  const restoreInputs = installDeterministicInputs(RAID_REPORT_SEED, 4_000_000);
  try {
    const universe = createUniverse("raid-class", 1);
    const now = 4_000_000;
    const a = joinUniverse(universe, "Atk", now);
    const b = joinUniverse(universe, "Def", now + 1);
    graduateNewbieProtection(universe, b.player);
    setClass(a.player, opts.atkClass);
    setClass(b.player, opts.defClass);
    if (opts.atkAlliance) {
      foundAlliance(universe, a.player.id, opts.atkAlliance, now + 2);
    }
    if (opts.defAlliance) {
      foundAlliance(universe, b.player.id, opts.defAlliance, now + 3);
    }
    const origin = universe.planets[a.planet.id]!;
    const target = universe.planets[b.planet.id]!;
    origin.resources.deuterium = 50_000;
    for (const [id, n] of Object.entries(opts.atkShips)) {
      origin.ships[id as "scout"] = n;
    }
    for (const [id, n] of Object.entries(opts.defShips ?? {})) {
      target.ships[id as "scout"] = n;
    }
    for (const [id, n] of Object.entries(opts.defDefenses ?? {})) {
      target.defenses[id as "laserBattery"] = n;
    }
    if (opts.resources) {
      const live = universe.planets[b.planet.id]!;
      live.resources = { ...opts.resources };
      live.lastTickAt = now + 20;
    }
    const launch = (() => {
      const restoreLaunchInputs = installDeterministicInputs(
        RAID_REPORT_SEED,
        4_000_000,
      );
      try {
        return launchFleet(
          universe,
          a.player.id,
          b.planet.id,
          "raid",
          opts.atkShips,
          now + 20,
        );
      } finally {
        restoreLaunchInputs();
      }
    })();
    assert.equal(launch.ok, true, launch.ok ? "" : launch.error);
    if (!launch.ok) throw new Error("launch failed");
    const liveTarget = universe.planets[b.planet.id]!;
    if (opts.resources) liveTarget.resources = { ...opts.resources };
    liveTarget.lastTickAt = launch.fleet.arrivesAt;
    advanceUniverse(universe, launch.fleet.arrivesAt);
    const fleet = universe.fleets[launch.fleet.id];
    const report =
      (fleet?.reportId ? universe.reports[fleet.reportId] : undefined) ??
      Object.values(universe.reports).find((r) => r.missionId === launch.fleet.id);
    assert.ok(report);
    return { report, fleet, universe, attacker: a.player, defender: b.player };
  } finally {
    restoreInputs();
  }
}

describe("player class explorer and expansionist", () => {
  it("keeps the existing class table and gives Explorer +2 expedition slots", () => {
    assert.equal(PLAYER_CLASS_BONUSES.miner.mineOutput, 1.12);
    assert.equal(PLAYER_CLASS_BONUSES.miner.energyOutput, 1.1);
    assert.equal(PLAYER_CLASS_BONUSES.miner.defensePower, 1.1);
    assert.equal(PLAYER_CLASS_BONUSES.miner.defenseBuildTime, 0.9);
    assert.equal(PLAYER_CLASS_BONUSES.explorer.expeditionYield, 1.2);
    assert.equal(PLAYER_CLASS_BONUSES.explorer.researchTime, 0.9);
    assert.equal(PLAYER_CLASS_BONUSES.explorer.probeSpeed, 1.25);
    assert.equal(PLAYER_CLASS_BONUSES.explorer.expeditionSlots, 2);
    assert.equal(PLAYER_CLASS_BONUSES.fleeter.attack, 1.08);
    assert.equal(PLAYER_CLASS_BONUSES.fleeter.fleetSpeed, 1.1);
    assert.equal(PLAYER_CLASS_BONUSES.fleeter.shipBuildTime, 0.9);
    assert.equal(PLAYER_CLASS_BONUSES.fleeter.fleetSlots, 2);
    assert.equal(PLAYER_CLASS_BONUSES.expansionist.colonySlots, 2);
    assert.equal(PLAYER_CLASS_BONUSES.expansionist.colonyShipSpeed, 1.15);
    assert.equal(PLAYER_CLASS_BONUSES.expansionist.buildingBuildTime, 0.95);
    assert.equal(PLAYER_CLASS_BONUSES.expansionist.jumpGateCooldown, 0.85);
    assert.equal(classBonuses(null).expeditionSlots, 0);
    assert.equal(classBonuses(null).colonyFields, 0);

    const universe = createUniverse("Explorer slots", 1);
    const joined = joinUniverse(universe, "Surveyor", 5_000_000);
    const player = universe.players[joined.player.id]!;
    const plain = empireExpeditionCap(player, maxExpeditions);
    assert.equal(choosePlayerClass(universe, player.id, "explorer", 5_000_010).ok, true);
    const cap = empireExpeditionCap(player, maxExpeditions);
    assert.equal(cap, plain + 2);
    assert.equal(
      playerView(universe, player.id, 5_000_010).expeditionSlotCap,
      plain + 2,
    );
  });

  it("multiplies debris by 1.10 only when an Explorer fights a different class", () => {
    const ships = { interceptor: 6 };
    const garrison = { interceptor: 3 };
    const cross = raidReport({
      atkClass: "explorer",
      defClass: "miner",
      atkShips: ships,
      defShips: garrison,
    }).report.debrisCreated;
    const same = raidReport({
      atkClass: "explorer",
      defClass: "explorer",
      atkShips: ships,
      defShips: garrison,
    }).report.debrisCreated;
    const neither = raidReport({
      atkClass: "miner",
      defClass: "fleeter",
      atkShips: ships,
      defShips: garrison,
    }).report.debrisCreated;
    const npc = raidReport({
      atkClass: "explorer",
      defClass: null,
      atkShips: ships,
      defShips: garrison,
    }).report.debrisCreated;
    assert.ok(same.metal > 0, "fight should destroy hulls");
    assert.deepEqual(same, neither);
    assert.deepEqual(npc, neither);
    assert.equal(cross.metal, Math.floor(same.metal * 1.1));
    assert.equal(cross.crystal, Math.floor(same.crystal * 1.1));
    assert.ok(cross.metal > same.metal);
  });

  it("adds 50 colony fields at read time and reverts them on class change", () => {
    const universe = createUniverse("Fields", 1);
    const now = 6_000_000;
    const joined = joinUniverse(universe, "Settler", now);
    const player = universe.players[joined.player.id]!;
    const home = universe.planets[player.homePlanetId]!;
    const storedHome = home.fieldsCap;
    const colony = addColony(universe, player, 10);
    colony.buildings.metalMine = 30;
    assert.equal(choosePlayerClass(universe, player.id, "expansionist", now).ok, true);
    assert.equal(home.fieldsCap, storedHome);
    assert.equal(colony.fieldsCap, 10);
    assert.equal(
      effectiveFieldsCap(home, {
        homePlanetId: player.homePlanetId,
        colonyFields: 50,
      }),
      storedHome,
    );
    assert.equal(
      effectiveFieldsCap(colony, {
        homePlanetId: player.homePlanetId,
        colonyFields: classBonuses("expansionist").colonyFields,
      }),
      60,
    );
    setActivePlanet(universe, player.id, colony.id, now);
    const view = playerView(universe, player.id, now);
    assert.equal(view.economy.fields.cap, 60);
    assert.equal(universe.planets[colony.id]!.fieldsCap, 10);
    assert.equal(universe.planets[colony.id]!.buildings.metalMine, 30);

    player.starshards = 500;
    assert.equal(
      changePlayerClass(universe, player.id, "miner", now + 5).ok,
      true,
    );
    assert.equal(universe.planets[colony.id]!.buildings.metalMine, 30);
    assert.equal(universe.planets[colony.id]!.fieldsCap, 10);
    const after = playerView(universe, player.id, now + 5);
    assert.equal(after.economy.fields.cap, 10);
    assert.equal(after.planet.buildings.metalMine, 30);
  });

  it("speeds Expansionist fleets 20% between own worlds only", () => {
    const plain = oneWaySeconds({ own: true, ships: "scout" });
    const own = oneWaySeconds({
      classId: "expansionist",
      own: true,
      ships: "scout",
    });
    const away = oneWaySeconds({
      classId: "expansionist",
      own: false,
      ships: "scout",
    });
    const awayPlain = oneWaySeconds({ own: false, ships: "scout" });
    near(plain / own, 1.2);
    assert.equal(away, awayPlain);
    assert.ok(own < plain);
  });
});

describe("alliance classes", () => {
  it("applies each alliance-class bonus after the player-class bonus", () => {
    const base = oneWaySeconds({ own: false, ships: "scout" });
    const destroyerSpeed = oneWaySeconds({
      alliance: "destroyer",
      own: false,
      ships: "scout",
    });
    near(base / destroyerSpeed, 1.05);

    const fleeter = oneWaySeconds({
      classId: "fleeter",
      own: false,
      ships: "scout",
    });
    const fleeterDestroyer = oneWaySeconds({
      classId: "fleeter",
      alliance: "destroyer",
      own: false,
      ships: "scout",
    });
    near(base / fleeter, 1.1);
    near(base / fleeterDestroyer, 1.1 * 1.05);

    const builderOwn = oneWaySeconds({
      alliance: "builder",
      own: true,
      ships: "scout",
    });
    const builderAway = oneWaySeconds({
      alliance: "builder",
      own: false,
      ships: "scout",
    });
    const ownPlain = oneWaySeconds({ own: true, ships: "scout" });
    near(ownPlain / builderOwn, 1.45);
    assert.equal(builderAway, base);

    const stacked = oneWaySeconds({
      classId: "expansionist",
      alliance: "builder",
      own: true,
      ships: "scout",
    });
    near(ownPlain / stacked, 1.2 * 1.45);

    const recycler = oneWaySeconds({
      alliance: "explorer",
      own: false,
      ships: "recycler",
    });
    const recyclerPlain = oneWaySeconds({ own: false, ships: "recycler" });
    near(recyclerPlain / recycler, 1.1);
    const mixed = oneWaySeconds({
      alliance: "explorer",
      own: false,
      ships: "mixed",
    });
    const mixedPlain = oneWaySeconds({ own: false, ships: "mixed" });
    assert.equal(mixed, mixedPlain);

    const loot = raidReport({
      atkClass: "fleeter",
      defClass: "miner",
      atkAlliance: "destroyer",
      atkShips: { hauler: 1 },
      resources: { metal: 1000, crystal: 400, deuterium: 200 },
    }).report.loot;
    assert.deepEqual(loot, {
      metal: Math.floor(750 * 1.1),
      crystal: Math.floor(300 * 1.1),
      deuterium: Math.floor(150 * 1.1),
    });

    const plainWeapons = raidReport({
      atkClass: "miner",
      defClass: "miner",
      atkShips: { scout: 12 },
      defShips: { interceptor: 1 },
    });
    const builderWeapons = raidReport({
      atkClass: "miner",
      defClass: "miner",
      atkAlliance: "builder",
      atkShips: { scout: 12 },
      defShips: { interceptor: 1 },
    });
    assert.ok(plainWeapons.report.attackerAfter.scout < 12);
    assert.ok(
      builderWeapons.report.attackerAfter.scout <
        plainWeapons.report.attackerAfter.scout,
    );

    const bareShield = raidReport({
      atkClass: null,
      defClass: null,
      atkShips: { scout: 2 },
      defDefenses: { laserBattery: 1 },
    });
    const destroyerShield = raidReport({
      atkClass: null,
      defClass: null,
      atkAlliance: "destroyer",
      atkShips: { scout: 2 },
      defDefenses: { laserBattery: 1 },
    });
    assert.equal(bareShield.report.attackerAfter.scout ?? 0, 0);
    assert.equal(destroyerShield.report.attackerAfter.scout, 1);

    const bareDefense = raidReport({
      atkClass: null,
      defClass: null,
      atkShips: { scout: 2 },
      defDefenses: { laserBattery: 1 },
    });
    const builderDefense = raidReport({
      atkClass: null,
      defClass: null,
      defAlliance: "builder",
      atkShips: { scout: 2 },
      defDefenses: { laserBattery: 1 },
    });
    assert.equal(bareDefense.report.defensesAfter.laserBattery ?? 0, 0);
    assert.equal(builderDefense.report.defensesAfter.laserBattery, 1);

    const plainShield = raidReport({
      atkClass: null,
      defClass: null,
      atkShips: { scout: 15 },
      defDefenses: { laserBattery: 9 },
    });
    const builderShield = raidReport({
      atkClass: null,
      defClass: null,
      atkAlliance: "builder",
      atkShips: { scout: 15 },
      defDefenses: { laserBattery: 9 },
    });
    assert.ok(builderShield.report.rounds < plainShield.report.rounds);

    const universe = createUniverse("mines", 1);
    const now = 7_000_000;
    const joined = joinUniverse(universe, "Digger", now);
    const planet = universe.planets[joined.planet.id]!;
    planet.buildings.metalMine = 8;
    planet.buildings.solarPlant = 12;
    planet.coords.slot = 8;
    const before = playerView(universe, joined.player.id, now).economy
      .productionPerHour.metal;
    foundAlliance(universe, joined.player.id, "builder", now + 1);
    const after = playerView(universe, joined.player.id, now + 1).economy
      .productionPerHour.metal;
    const baseIncome = 500;
    near((after - baseIncome) / (before - baseIncome), 1.05, 0.001);

    const fields = createUniverse("ally fields", 1);
    const owner = joinUniverse(fields, "Member", now);
    const colony = addColony(fields, owner.player, 200);
    setActivePlanet(fields, owner.player.id, colony.id, now);
    const stored = colony.fieldsCap;
    const capBefore = playerView(fields, owner.player.id, now).economy.fields.cap;
    foundAlliance(fields, owner.player.id, "explorer", now + 2);
    const capAfter = playerView(fields, owner.player.id, now + 2).economy.fields.cap;
    assert.equal(colony.fieldsCap, stored);
    assert.equal(capAfter, Math.floor(capBefore * 1.05));

    const at = 8_000_000;
    let resourceRoll: { id: string; at: number } | null = null;
    let pirateRoll: { id: string; at: number } | null = null;
    for (let i = 0; i < 5000; i++) {
      const id = `flt_bonus_${i}`;
      const roll = expeditionRoll(id, at);
      if (expeditionBlackHoleRoll(id, at)) continue;
      if (!resourceRoll && roll < 40) resourceRoll = { id, at };
      if (!pirateRoll && roll === 78) pirateRoll = { id, at };
      if (resourceRoll && pirateRoll) break;
    }
    assert.ok(resourceRoll && pirateRoll);
    const runExpedition = (
      rollFleet: { id: string; at: number },
      withClass: boolean,
    ) => {
      const uni = createUniverse(`xpd-${rollFleet.id}`, 1);
      const who = joinUniverse(uni, "Explorer", at - 10);
      if (withClass) foundAlliance(uni, who.player.id, "explorer", at - 5);
      const fleet: FleetMission = {
        id: rollFleet.id,
        ownerPlayerId: who.player.id,
        originPlanetId: who.planet.id,
        targetPlanetId: null,
        targetPlayerId: null,
        targetCoords: { galaxy: 1, system: 1, slot: 16 },
        mission: "expedition",
        ships: emptyShips(),
        cargo: emptyCargo(),
        departedAt: rollFleet.at - 1000,
        arrivesAt: rollFleet.at,
        phase: "outbound",
        reportId: null,
      };
      fleet.ships.scout = 1;
      uni.fleets[fleet.id] = fleet;
      resolveExpeditionArrival(uni, fleet, rollFleet.at);
      return Object.values(uni.expeditionReports ?? {})[0]!;
    };
    const plainFind = runExpedition(resourceRoll!, false);
    const boostedFind = runExpedition(resourceRoll!, true);
    assert.equal(plainFind.kind, "resources");
    assert.equal(boostedFind.kind, "resources");
    assert.equal(
      boostedFind.cargoGained.metal,
      Math.floor(plainFind.cargoGained.metal * 1.05),
    );
    assert.ok(boostedFind.cargoGained.metal > plainFind.cargoGained.metal);
    const plainBad = runExpedition(pirateRoll!, false);
    const shifted = runExpedition(pirateRoll!, true);
    assert.equal(plainBad.kind, "pirates");
    assert.notEqual(shifted.kind, "pirates");
    assert.equal(expeditionKindForShift(78, 5), shifted.kind);

    const yard = createUniverse("yards", 1);
    const builder = joinUniverse(yard, "Builder", 9_000_000);
    builder.planet.buildings.shipyard = 1;
    builder.planet.resources = { metal: 50_000, crystal: 50_000, deuterium: 5_000 };
    builder.planet.lastTickAt = 9_000_000;
    const catalogShip = SHIPS.scout.cost;
    const pointsBeforeShip = shipStockPoints(builder.planet.ships);
    foundAlliance(yard, builder.player.id, "destroyer", 9_000_001);
    const queuedShip = queueShipBuild(
      yard,
      builder.player.id,
      "scout",
      1,
      9_000_100,
    );
    assert.equal(queuedShip.ok, true, queuedShip.ok ? "" : queuedShip.error);
    const shipItem = yard.planets[builder.planet.id]!.shipQueue[0]!;
    assert.equal(shipItem.paidCost.metal, Math.floor(catalogShip.metal * 0.95));
    assert.equal(shipItem.paidCost.crystal, Math.floor(catalogShip.crystal * 0.95));
    const unclassed = createUniverse("yards-plain", 1);
    const plainYard = joinUniverse(unclassed, "Plain", 9_000_000);
    plainYard.planet.buildings.shipyard = 1;
    plainYard.planet.resources = { metal: 50_000, crystal: 50_000, deuterium: 5_000 };
    plainYard.planet.lastTickAt = 9_000_000;
    assert.equal(
      queueShipBuild(unclassed, plainYard.player.id, "scout", 1, 9_000_100).ok,
      true,
    );
    const plainSeconds = unclassed.planets[plainYard.planet.id]!.shipQueue[0]!.workSeconds;
    near(shipItem.workSeconds / plainSeconds, 0.95, 0.001);
    advanceUniverse(yard, shipItem.completesAt! + 1);
    const scoutPoints =
      (catalogShip.metal + catalogShip.crystal + catalogShip.deuterium) / 1000;
    assert.equal(
      shipStockPoints(yard.planets[builder.planet.id]!.ships) - pointsBeforeShip,
      scoutPoints,
    );

    const site = createUniverse("build-disc", 1);
    const mason = joinUniverse(site, "Mason", 9_100_000);
    mason.planet.resources = { metal: 50_000, crystal: 50_000, deuterium: 5_000 };
    mason.planet.lastTickAt = 9_100_000;
    const level = mason.planet.buildings.metalMine ?? 0;
    const catalogBuild = buildingUpgradeCost("metalMine", level);
    const pointsBefore = planetPoints(mason.planet);
    foundAlliance(site, mason.player.id, "builder", 9_100_001);
    assert.equal(
      queueBuildingUpgrade(site, mason.player.id, "metalMine", 9_100_100).ok,
      true,
    );
    const buildItem = site.planets[mason.planet.id]!.buildQueue[0]!;
    assert.equal(buildItem.paidCost.metal, Math.floor(catalogBuild.metal * 0.9));
    assert.equal(buildItem.paidCost.crystal, Math.floor(catalogBuild.crystal * 0.9));
    const plainSite = createUniverse("build-plain", 1);
    const plainMason = joinUniverse(plainSite, "PlainMason", 9_100_000);
    plainMason.planet.resources = { metal: 50_000, crystal: 50_000, deuterium: 5_000 };
    plainMason.planet.lastTickAt = 9_100_000;
    assert.equal(
      queueBuildingUpgrade(plainSite, plainMason.player.id, "metalMine", 9_100_100).ok,
      true,
    );
    near(
      buildItem.workSeconds /
        plainSite.planets[plainMason.planet.id]!.buildQueue[0]!.workSeconds,
      0.9,
      0.001,
    );
    advanceUniverse(site, buildItem.completesAt + 1);
    const gained =
      (catalogBuild.metal + catalogBuild.crystal + catalogBuild.deuterium) / 1000;
    const pointDelta = planetPoints(site.planets[mason.planet.id]!) - pointsBefore;
    near(pointDelta, gained, 1e-9);
    const paid =
      (Math.floor(catalogBuild.metal * 0.9) +
        Math.floor(catalogBuild.crystal * 0.9) +
        Math.floor(catalogBuild.deuterium * 0.9)) /
      1000;
    assert.ok(Math.abs(pointDelta - paid) > 0.001);
  });

  it("rejects non-leaders and toggles the bonus on leave and join", () => {
    const universe = createUniverse("membership", 1);
    const now = 10_000_000;
    const founder = joinUniverse(universe, "Leader", now);
    const officer = joinUniverse(universe, "Officer", now + 1);
    const member = joinUniverse(universe, "Member", now + 2);
    assert.equal(
      createAlliance(universe, founder.player.id, "Toggle", "TOG", "open", now).ok,
      true,
    );
    assert.equal(joinAlliance(universe, officer.player.id, { tag: "TOG" }, now + 3).ok, true);
    assert.equal(joinAlliance(universe, member.player.id, { tag: "TOG" }, now + 4).ok, true);
    assert.equal(
      setAllianceRole(universe, founder.player.id, officer.player.id, "officer", now + 5).ok,
      true,
    );
    const officerSet = setAllianceClass(universe, officer.player.id, "destroyer", now + 6);
    const memberSet = setAllianceClass(universe, member.player.id, "builder", now + 7);
    assert.equal(officerSet.ok, false);
    assert.equal(memberSet.ok, false);
    if (!officerSet.ok) {
      assert.equal(officerSet.error, "Only the alliance leader can set the class.");
    }
    if (!memberSet.ok) {
      assert.equal(memberSet.error, "Only the alliance leader can set the class.");
    }
    assert.equal(
      setAllianceClass(universe, founder.player.id, "explorer", now + 8).ok,
      true,
    );

    const colony = addColony(universe, member.player, 180);
    setActivePlanet(universe, member.player.id, colony.id, now + 9);
    const joinedCap = playerView(universe, member.player.id, now + 9).economy.fields.cap;
    assert.equal(leaveAlliance(universe, member.player.id, now + 10).ok, true);
    const leftCap = playerView(universe, member.player.id, now + 10).economy.fields.cap;
    assert.ok(leftCap < joinedCap);
    assert.equal(colony.fieldsCap, 180);
    assert.equal(joinAlliance(universe, member.player.id, { tag: "TOG" }, now + 11).ok, true);
    setActivePlanet(universe, member.player.id, colony.id, now + 12);
    const rejoined = playerView(universe, member.player.id, now + 12).economy.fields.cap;
    assert.equal(rejoined, joinedCap);
    assert.equal(Math.floor(leftCap * 1.05), joinedCap);
  });

  it("loads an old save without rewriting resources, buildings, fleets, or fields", () => {
    const universe = createUniverse("old-class-save", 1);
    const now = 11_000_000;
    const miner = joinUniverse(universe, "OldMiner", now);
    const settler = joinUniverse(universe, "OldSettler", now + 1);
    setClass(miner.player, "miner");
    setClass(settler.player, "expansionist");
    miner.planet.resources = { metal: 111, crystal: 222, deuterium: 333 };
    miner.planet.buildings.solarPlant = 4;
    miner.planet.lastTickAt = now + 2;
    const colony = addColony(universe, settler.player, 144);
    colony.buildings.metalMine = 6;
    colony.resources = { metal: 444, crystal: 555, deuterium: 666 };
    colony.ships.scout = 2;
    const home = universe.planets[settler.planet.id]!;
    home.ships.scout = 2;
    home.resources.deuterium = 20_000;
    home.lastTickAt = now + 4;
    assert.equal(
      createAlliance(universe, miner.player.id, "Unclassed", "OLD", "open", now + 3).ok,
      true,
    );
    const alliance = Object.values(universe.alliances ?? {})[0]!;
    delete alliance.allianceClass;
    const launch = launchFleet(
      universe,
      settler.player.id,
      miner.planet.id,
      "deploy",
      { scout: 1 },
      now + 4,
    );
    assert.equal(launch.ok, true, launch.ok ? "" : launch.error);
    const minerLive = universe.planets[miner.planet.id]!;
    minerLive.resources = { metal: 111, crystal: 222, deuterium: 333 };
    minerLive.buildings.solarPlant = 4;
    minerLive.lastTickAt = now + 4;
    const colonyLive = universe.planets[colony.id]!;
    colonyLive.buildings.metalMine = 6;
    colonyLive.resources = { metal: 444, crystal: 555, deuterium: 666 };
    colonyLive.ships.scout = 2;
    colonyLive.fieldsCap = 144;
    colonyLive.lastTickAt = now + 4;
    const saved = JSON.parse(JSON.stringify(universe)) as UniverseState;
    const loaded = migrateOrResetUniverse(saved);
    assert.equal(loaded.didReset, false);
    const next = loaded.universe;
    assert.equal(next.players[miner.player.id]!.playerClass?.classId, "miner");
    assert.equal(next.players[settler.player.id]!.playerClass?.classId, "expansionist");
    assert.equal(next.alliances?.[alliance.id]?.allianceClass, undefined);
    assert.deepEqual(next.planets[miner.planet.id]!.resources, {
      metal: 111,
      crystal: 222,
      deuterium: 333,
    });
    assert.equal(next.planets[miner.planet.id]!.buildings.solarPlant, 4);
    assert.equal(next.planets[colony.id]!.fieldsCap, 144);
    assert.equal(next.planets[colony.id]!.buildings.metalMine, 6);
    assert.deepEqual(next.planets[colony.id]!.resources, {
      metal: 444,
      crystal: 555,
      deuterium: 666,
    });
    assert.equal(next.planets[colony.id]!.ships.scout, 2);
    assert.equal(Object.keys(next.fleets).length, 1);
    assert.equal(Object.values(next.fleets)[0]!.ships.scout, 1);
    assert.equal(
      effectiveFieldsCap(next.planets[colony.id]!, {
        homePlanetId: settler.player.homePlanetId,
        colonyFields: 50,
      }),
      194,
    );
    assert.equal(next.planets[colony.id]!.fieldsCap, 144);
  });
});
