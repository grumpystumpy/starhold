import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFENSES,
  SHIPS,
  UNIVERSE_SCHEMA_VERSION,
  advancePlanet,
  advanceUniverse,
  cancelQueueItem,
  constructionTimeMultiplier,
  createUniverse,
  joinUniverse,
  migrateOrResetUniverse,
  migrateUniverseV2ToV3,
  naniteFactoryLevel,
  queueBuildingUpgrade,
  queueCapForKind,
  queueResearch,
  queueShipBuild,
  queueDefenseBuild,
  previewResearchUpgrade,
  researchUpgradeSeconds,
  reorderQueue,
  researchQueueCap,
  shipUnitBuildSeconds,
  yardQueueCap,
} from "./index.js";

describe("Round 2 multi-item queues", () => {
  it("accepts build quantities through 999,999 and scales cost and time", () => {
    const universe = createUniverse("Large batches", 8);
    const { player, planet } = joinUniverse(universe, "Batcher", 310_000_000);
    const p = universe.planets[planet.id];
    p.buildings.shipyard = 1;
    p.resources = { metal: 1_000_000_000_000, crystal: 1_000_000_000_000, deuterium: 1_000_000_000_000 };
    p.lastTickAt = 310_000_100;

    const ship = queueShipBuild(universe, player.id, "scout", 999_999, 310_000_100);
    assert.equal(ship.ok, true);
    if (!ship.ok) return;
    const shipItem = ship.planet.shipQueue[0]!;
    assert.equal(shipItem.count, 999_999);
    assert.equal(shipItem.paidCost.metal, SHIPS.scout.cost.metal * 999_999);
    assert.equal(shipItem.workSeconds, shipItem.unitSeconds * 999_999);

    const current = universe.planets[planet.id];
    current.shipQueue = [];
    current.resources = { metal: 1_000_000_000_000, crystal: 1_000_000_000_000, deuterium: 1_000_000_000_000 };
    current.lastTickAt = 310_000_200;
    const defense = queueDefenseBuild(universe, player.id, "laserBattery", 999_999, 310_000_200);
    assert.equal(defense.ok, true);
    if (!defense.ok) return;
    const defenseItem = defense.planet.defenseQueue[0]!;
    assert.equal(defenseItem.count, 999_999);
    assert.equal(defenseItem.paidCost.metal, DEFENSES.laserBattery.cost.metal * 999_999);
    assert.equal(defenseItem.workSeconds, defenseItem.unitSeconds * 999_999);
  });

  it("rejects zero, fractional, and over-limit ship and defense quantities", () => {
    const universe = createUniverse("Invalid batches", 8);
    const { player, planet } = joinUniverse(universe, "Validator", 311_000_000);
    const p = universe.planets[planet.id];
    p.buildings.shipyard = 1;
    for (const qty of [0, 0.5, 1_000_000]) {
      assert.equal(queueShipBuild(universe, player.id, "scout", qty, 311_000_100).ok, false);
      assert.equal(queueDefenseBuild(universe, player.id, "laserBattery", qty, 311_000_100).ok, false);
    }
  });

  it("uses the active planet lab bonus for research preview and queue", () => {
    const universe = createUniverse("Local Lab", 8);
    const { player, planet } = joinUniverse(universe, "Local", 306_500_000);
    const owner = universe.players[player.id]!;
    const active = universe.planets[planet.id]!;
    active.buildings.researchLab = 2;
    active.resources = { metal: 50_000, crystal: 50_000, deuterium: 50_000 };

    const other = structuredClone(active);
    other.id = `${active.id}-colony`;
    other.buildings.researchLab = 10;
    universe.planets[other.id] = other;
    owner.planetIds.push(other.id);

    const preview = previewResearchUpgrade(
      owner,
      active,
      "energyTech",
      10,
      306_500_100,
      2,
    );
    assert.equal(preview.ok, true);
    if (!preview.ok) return;

    const result = queueResearch(universe, owner.id, "energyTech", 306_500_100);
    assert.equal(result.ok, true);
    const queued = universe.players[owner.id]!.researchQueue[0]!;
    assert.deepEqual(queued.paidCost, preview.cost);
    const previewSeconds = Math.max(
      1,
      Math.ceil(
        researchUpgradeSeconds("energyTech", preview.current, 2) /
          universe.speed,
      ),
    );
    assert.equal(queued.workSeconds, previewSeconds);
    assert.equal(previewSeconds, 5);
    assert.deepEqual(queued.paidCost, { metal: 0, crystal: 78, deuterium: 39 });
  });

  it("schema version is 4", () => {
    assert.equal(UNIVERSE_SCHEMA_VERSION, 5);
    const u = createUniverse("Queue Drift", 8);
    assert.equal(u.schemaVersion, UNIVERSE_SCHEMA_VERSION);
  });

  it("base caps are 2/2/2/1 with hard cap 8", () => {
    const universe = createUniverse("Cap Drift", 8);
    const { player } = joinUniverse(universe, "Capper", 300_000_000);
    assert.equal(yardQueueCap(player), 2);
    assert.equal(researchQueueCap(player), 1);
    assert.equal(queueCapForKind(player, "ship"), 2);
    player.research.queueLogistics = 4;
    assert.equal(yardQueueCap(player), 4); // 2 + floor(4/2)
    assert.equal(researchQueueCap(player), 2); // 1 + floor(4/3)
    player.research.queueLogistics = 99;
    assert.equal(yardQueueCap(player), 8);
    assert.equal(researchQueueCap(player), 8);
  });

  it("queues multiple buildings then completes in order", () => {
    const universe = createUniverse("BuildQ Drift", 8);
    const { player, planet } = joinUniverse(universe, "Builder", 301_000_000);
    universe.planets[planet.id].resources = {
      metal: 50_000,
      crystal: 50_000,
      deuterium: 50_000,
    };
    const t0 = 301_000_100;
    const a = queueBuildingUpgrade(universe, player.id, "shipyard", t0);
    const b = queueBuildingUpgrade(universe, player.id, "metalMine", t0 + 1);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(universe.planets[planet.id].buildQueue.length, 2);

    const full = queueBuildingUpgrade(
      universe,
      player.id,
      "crystalMine",
      t0 + 2,
    );
    assert.equal(full.ok, false);
    if (!full.ok) assert.match(full.error, /full/i);

    const firstDone = universe.planets[planet.id].buildQueue[0]!.completesAt;
    advanceUniverse(universe, firstDone);
    assert.equal(universe.planets[planet.id].buildings.shipyard, 1);
    assert.equal(universe.planets[planet.id].buildQueue.length, 1);
    assert.equal(
      universe.planets[planet.id].buildQueue[0]!.buildingId,
      "metalMine",
    );
    assert.ok(universe.planets[planet.id].buildQueue[0]!.startedAt != null);

    advanceUniverse(
      universe,
      universe.planets[planet.id].buildQueue[0]!.completesAt,
    );
    assert.equal(universe.planets[planet.id].buildings.metalMine, 2);
    assert.equal(universe.planets[planet.id].buildQueue.length, 0);
  });

  it("cancel front refunds 50% and starts next; cancel tail refunds 100%", () => {
    const universe = createUniverse("Cancel Drift", 8);
    const { player, planet } = joinUniverse(universe, "Canceller", 302_000_000);
    const p = universe.planets[planet.id];
    p.buildings.metalStorage = 3;
    p.resources = { metal: 50_000, crystal: 50_000, deuterium: 50_000 };
    const t0 = 302_000_100;
    assert.ok(queueBuildingUpgrade(universe, player.id, "shipyard", t0).ok);
    assert.ok(
      queueBuildingUpgrade(universe, player.id, "solarPlant", t0 + 1).ok,
    );
    const frontId = universe.planets[planet.id].buildQueue[0]!.id;
    const tailId = universe.planets[planet.id].buildQueue[1]!.id;
    const tailCost = universe.planets[planet.id].buildQueue[1]!.paidCost.metal;
    // Freeze production so refund asserts stay exact.
    universe.planets[planet.id].lastTickAt = t0 + 100;
    const metalBeforeTailCancel = universe.planets[planet.id].resources.metal;

    const cancelTail = cancelQueueItem(
      universe,
      player.id,
      { kind: "building", itemId: tailId, planetId: planet.id },
      t0 + 100,
    );
    assert.equal(cancelTail.ok, true);
    assert.equal(universe.planets[planet.id].buildQueue.length, 1);
    assert.equal(
      universe.planets[planet.id].resources.metal,
      metalBeforeTailCancel + tailCost,
    );

    assert.ok(
      queueBuildingUpgrade(universe, player.id, "solarPlant", t0 + 100).ok,
    );
    const frontCost =
      universe.planets[planet.id].buildQueue[0]!.paidCost.metal;
    universe.planets[planet.id].lastTickAt = t0 + 200;
    const metalBeforeFront = universe.planets[planet.id].resources.metal;
    const cancelFront = cancelQueueItem(
      universe,
      player.id,
      { kind: "building", itemId: frontId, planetId: planet.id },
      t0 + 200,
    );
    assert.equal(cancelFront.ok, true);
    assert.equal(universe.planets[planet.id].buildQueue.length, 1);
    assert.equal(
      universe.planets[planet.id].buildQueue[0]!.buildingId,
      "solarPlant",
    );
    assert.equal(
      universe.planets[planet.id].resources.metal,
      metalBeforeFront + Math.floor(frontCost * 0.5),
    );
  });

  it("rejects reorder that moves the front item", () => {
    const universe = createUniverse("Reorder Drift", 8);
    const { player, planet } = joinUniverse(universe, "Reorder", 303_000_000);
    universe.planets[planet.id].resources = {
      metal: 50_000,
      crystal: 50_000,
      deuterium: 50_000,
    };
    const t0 = 303_000_100;
    assert.ok(queueBuildingUpgrade(universe, player.id, "shipyard", t0).ok);
    assert.ok(
      queueBuildingUpgrade(universe, player.id, "metalMine", t0 + 1).ok,
    );
    const ids = universe.planets[planet.id].buildQueue.map((q) => q.id);
    const bad = reorderQueue(
      universe,
      player.id,
      { kind: "building", orderedIds: [ids[1]!, ids[0]!], planetId: planet.id },
      t0 + 2,
    );
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.error, /locked|front/i);

    const ok = reorderQueue(
      universe,
      player.id,
      { kind: "building", orderedIds: [ids[0]!, ids[1]!], planetId: planet.id },
      t0 + 3,
    );
    assert.equal(ok.ok, true);
  });

  it("ship queue allows two batches then completes sequentially", () => {
    const universe = createUniverse("ShipQ Drift", 8);
    const { player, planet } = joinUniverse(universe, "Yard", 304_000_000);
    universe.planets[planet.id].resources = {
      metal: 50_000,
      crystal: 50_000,
      deuterium: 50_000,
    };
    universe.planets[planet.id].buildings.shipyard = 1;
    const t0 = 304_000_100;
    assert.ok(queueShipBuild(universe, player.id, "scout", 1, t0).ok);
    assert.ok(queueShipBuild(universe, player.id, "scout", 1, t0 + 1).ok);
    assert.equal(universe.planets[planet.id].shipQueue.length, 2);
    const third = queueShipBuild(universe, player.id, "scout", 1, t0 + 2);
    assert.equal(third.ok, false);

    advanceUniverse(
      universe,
      universe.planets[planet.id].shipQueue[0]!.completesAt,
    );
    assert.equal(universe.planets[planet.id].ships.scout, 1);
    assert.equal(universe.planets[planet.id].shipQueue.length, 1);
    advanceUniverse(
      universe,
      universe.planets[planet.id].shipQueue[0]!.completesAt,
    );
    assert.equal(universe.planets[planet.id].ships.scout, 2);
  });

  it("research queue base length 1; grows with Yard Logistics", () => {
    const universe = createUniverse("ResQ Drift", 8);
    const { player, planet } = joinUniverse(universe, "Labber", 305_000_000);
    universe.planets[planet.id].resources = {
      metal: 50_000,
      crystal: 50_000,
      deuterium: 50_000,
    };
    universe.planets[planet.id].buildings.researchLab = 1;
    const t0 = 305_000_100;
    assert.ok(queueResearch(universe, player.id, "energyTech", t0).ok);
    const second = queueResearch(universe, player.id, "combustionDrive", t0 + 1);
    assert.equal(second.ok, false);

    // Finish first, raise logistics, then allow multi research.
    const afterFirst = universe.players[player.id].researchQueue[0]!.completesAt;
    advanceUniverse(universe, afterFirst);
    const stillLocked = queueResearch(universe, player.id, "shieldingTech", afterFirst + 1);
    assert.equal(stillLocked.ok, false);
    if (!stillLocked.ok) {
      assert.match(stillLocked.error, /Needs Research Lab level 6/);
    }
    universe.players[player.id].research.queueLogistics = 3;
    const aboveLab = queueResearch(universe, player.id, "energyTech", afterFirst + 2);
    assert.equal(aboveLab.ok, true);
    assert.equal(universe.players[player.id].researchQueue[0]!.targetLevel, 2);
    advanceUniverse(
      universe,
      universe.players[player.id].researchQueue[0]!.completesAt,
    );
    assert.equal(researchQueueCap(universe.players[player.id]), 2);
    assert.ok(
      queueResearch(universe, player.id, "combustionDrive", t0 + 50_000).ok,
    );
    assert.ok(
      queueResearch(universe, player.id, "computerTech", t0 + 50_001).ok,
    );
    assert.equal(universe.players[player.id].researchQueue.length, 2);
  });

  it("completes research that was already queued before new gates", () => {
    const universe = createUniverse("Queued Research Migration", 8);
    const { player, planet } = joinUniverse(
      universe,
      "Legacy Researcher",
      305_500_000,
    );
    const owner = universe.players[player.id]!;
    const t0 = 305_500_100;
    owner.researchQueue = [
      {
        id: "legacy-shielding",
        kind: "research",
        researchId: "shieldingTech",
        targetLevel: 1,
        enqueuedAt: t0,
        completesAt: t0 + 1_000,
        workSeconds: 1,
        startedAt: t0,
        paidCost: { metal: 20, crystal: 60, deuterium: 0 },
      },
    ];

    advanceUniverse(universe, t0 + 1_000);

    assert.equal(universe.players[player.id]!.research.shieldingTech, 1);
    assert.equal(universe.players[player.id]!.researchQueue.length, 0);
    assert.equal(universe.planets[planet.id]!.buildings.researchLab, 0);
  });

  it("migrates v2 single queues into v3 arrays without reset", () => {
    const universe = createUniverse("LegacyQ", 8);
    const { player, planet } = joinUniverse(universe, "Legacy", 306_000_000);
    universe.schemaVersion = 2;
    // Simulate pre-v3 single-item shape.
    (universe.planets[planet.id] as { buildQueue: unknown }).buildQueue = {
      kind: "building",
      buildingId: "shipyard",
      targetLevel: 1,
      completesAt: 306_100_000,
    };
    (universe.players[player.id] as { researchQueue: unknown }).researchQueue = {
      kind: "research",
      researchId: "energyTech",
      targetLevel: 1,
      completesAt: 306_200_000,
    };

    const result = migrateOrResetUniverse(universe);
    assert.equal(result.didReset, false);
    assert.equal(result.universe.schemaVersion, UNIVERSE_SCHEMA_VERSION);
    assert.ok(Array.isArray(result.universe.planets[planet.id].buildQueue));
    assert.equal(result.universe.planets[planet.id].buildQueue.length, 1);
    assert.ok(result.universe.planets[planet.id].buildQueue[0]!.id);
    assert.ok(Array.isArray(result.universe.players[player.id].researchQueue));
    assert.equal(result.universe.players[player.id].researchQueue.length, 1);
    assert.equal(
      result.universe.players[player.id].researchQueue[0]!.completesAt,
      306_200_000,
    );
    assert.ok(result.universe.players[player.id].playerClass);

    // Idempotent
    migrateUniverseV2ToV3(result.universe);
    assert.equal(result.universe.schemaVersion, UNIVERSE_SCHEMA_VERSION);
    assert.equal(result.universe.planets[planet.id].buildQueue.length, 1);
  });

  it("batches multiple ships per tick when unitSeconds < 1", () => {
    const universe = createUniverse("Batch Drift", 8);
    const { planet } = joinUniverse(universe, "Batcher", 307_000_000);
    const p = universe.planets[planet.id];
    const t0 = 307_000_000;
    p.lastTickAt = t0;
    p.shipQueue = [
      {
        id: "q_batch",
        kind: "ship",
        shipId: "scout",
        count: 10,
        enqueuedAt: t0,
        workSeconds: 1,
        startedAt: t0,
        completesAt: t0 + 1000,
        unitSeconds: 0.1,
        paidCost: { metal: 2200, crystal: 800, deuterium: 0 },
      },
    ];
    // 0.35s → floor(3.5) = 3 units
    const mid = advancePlanet(p, universe.speed, t0 + 350);
    assert.equal(mid.ships.scout, 3);
    assert.equal(mid.shipQueue.length, 1);
    assert.equal(mid.shipQueue[0]!.count, 7);
    // Remaining 0.7s → all 7
    const done = advancePlanet(mid, universe.speed, t0 + 350 + 700);
    assert.equal(done.ships.scout, 10);
    assert.equal(done.shipQueue.length, 0);
  });

  it("does not floor per-unit ship time at 1s; Nanite hook is ×0.1^level", () => {
    assert.equal(constructionTimeMultiplier(0), 1);
    assert.equal(constructionTimeMultiplier(1), 0.1);
    assert.ok(Math.abs(constructionTimeMultiplier(2) - 0.01) < 1e-12);
    const base = shipUnitBuildSeconds("scout", 1, 0);
    const nanite1 = shipUnitBuildSeconds("scout", 1, 1);
    assert.ok(Math.abs(nanite1 - base * 0.1) < 1e-9);
    const universe = createUniverse("Nanite Hook", 8);
    const { planet } = joinUniverse(universe, "Nano", 308_000_000);
    assert.equal(naniteFactoryLevel(universe.planets[planet.id]), 0);
  });

  it("completes multiple sub-second building queue items in one tick", () => {
    const universe = createUniverse("BldBatch", 8);
    const { planet } = joinUniverse(universe, "BldBatch", 309_000_000);
    const p = universe.planets[planet.id];
    const t0 = 309_000_000;
    p.lastTickAt = t0;
    p.buildings.shipyard = 0;
    p.buildings.metalMine = 1;
    p.buildQueue = [
      {
        id: "b1",
        kind: "building",
        buildingId: "shipyard",
        targetLevel: 1,
        enqueuedAt: t0,
        workSeconds: 0.2,
        startedAt: t0,
        completesAt: t0 + 200,
        paidCost: { metal: 300, crystal: 150, deuterium: 0 },
      },
      {
        id: "b2",
        kind: "building",
        buildingId: "metalMine",
        targetLevel: 2,
        enqueuedAt: t0,
        workSeconds: 0.2,
        startedAt: null,
        completesAt: t0 + 400,
        paidCost: { metal: 90, crystal: 22, deuterium: 0 },
      },
    ];
    const after = advancePlanet(p, universe.speed, t0 + 500);
    assert.equal(after.buildings.shipyard, 1);
    assert.equal(after.buildings.metalMine, 2);
    assert.equal(after.buildQueue.length, 0);
  });
});
