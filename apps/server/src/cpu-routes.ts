import type { Hono } from "hono";
import {
  advanceUniverse,
  emptyDefenses,
  emptyFleetShips,
  createUniverse,
  joinUniverse,
  resolveCombat,
  tickPirates,
} from "@starhold/game";
import { DEFENSE_ORDER, SHIP_ORDER, NPC_RAID_CATCHUP_MAX, PIRATE_RAID_PERIOD_MS, rollNextRaidAt } from "@starhold/game";
import { hashPassword } from "./accounts.js";
import { readCpuMs } from "./request-context.js";
import { withUniverse } from "./store.js";

/**
 * Local measurement only. One case per request so a single invocation
 * stays inside the Workers free-plan CPU limit.
 */
export function mountCpuRoutes(app: Hono): void {
  app.get("/api/profile/:case", async (c) => {
    if (process.env.STARHOLD_CPU_PROFILE !== "1") {
      return c.json({ error: "Not found", path: c.req.path }, 404);
    }
    const name = c.req.param("case");
    if (name === "pbkdf2") {
      const started = performance.now();
      const hash = await hashPassword("measure-me-please");
      return c.json({
        case: name,
        ms: performance.now() - started,
        prefix: hash.slice(0, hash.indexOf("$")),
        cpu: readCpuMs(),
      });
    }
    if (name === "combat") {
      const attacker = emptyFleetShips();
      attacker.cruiser = 20;
      attacker.interceptor = 40;
      const defender = emptyFleetShips();
      defender.interceptor = 30;
      defender.cruiser = 10;
      const started = performance.now();
      const result = resolveCombat(attacker, defender, emptyDefenses());
      return c.json({
        case: name,
        ms: performance.now() - started,
        cpu: readCpuMs(),
        rounds: result.rounds,
        outcome: result.outcome,
      });
    }
    if (["combat-catalog", "combat-heavy"].includes(name)) {
      const attacker = emptyFleetShips();
      const defender = emptyFleetShips();
      const defenses = emptyDefenses();
      if (name === "combat-catalog") {
        for (const id of SHIP_ORDER) { attacker[id] = 10_000; defender[id] = 10_000; }
        for (const id of DEFENSE_ORDER) defenses[id] = 10_000;
      } else if (name === "combat-heavy") {
        attacker.worldEater = 1; attacker.voidforgeTitan = 1; attacker.swarmMothership = 1; attacker.swarmDrone = 2_000;
        for (const id of DEFENSE_ORDER) defenses[id] = 10_000;
      }
      const started = performance.now();
      const result = resolveCombat(attacker, defender, defenses);
      return c.json({ case: name, ms: performance.now() - started, cpu: readCpuMs(), rounds: result.rounds, outcome: result.outcome });
    }
    if (name === "pirate-raids") {
      const now = 1_700_000_000_000;
      const universe = createUniverse("CPU profile", 1, 1);
      const { planet } = joinUniverse(universe, "CPU profile target", now);
      for (const id of SHIP_ORDER) planet.ships[id] = 10_000;
      for (const id of DEFENSE_ORDER) planet.defenses[id] = 10_000;
      const bases = Object.values(universe.pirateBases ?? {}).slice(0, 1);
      const base = bases[0];
      if (base) {
        base.ships = emptyFleetShips();
        for (const id of SHIP_ORDER) base.ships[id] = 10_000;
        // Leave room for the deterministic per-raid schedule jitter so the
        // catch-up cap, rather than elapsed time, ends this run.
        base.nextRaidAt = now - (NPC_RAID_CATCHUP_MAX + 2) * PIRATE_RAID_PERIOD_MS;
        base.lastGrewAt = now;
        base.lastFreeSpawnAt = now;
      }
      const firstRaidAt = base?.nextRaidAt ?? now;
      const started = performance.now();
      tickPirates(universe, now);
      let raids = 0;
      let scheduledAt = firstRaidAt;
      while (base && raids < NPC_RAID_CATCHUP_MAX && scheduledAt < base.nextRaidAt) {
        scheduledAt = rollNextRaidAt(base.id, scheduledAt, PIRATE_RAID_PERIOD_MS);
        raids += 1;
      }
      if (!base || scheduledAt !== base.nextRaidAt) raids = 0;
      return c.json({ case: name, ms: performance.now() - started, cpu: readCpuMs(), raids });
    }
    if (name === "encode") {
      const started = performance.now();
      const summary = await withUniverse((universe) => {
        const t = performance.now();
        const json = JSON.stringify(universe);
        return { bytes: json.length, stringifyMs: performance.now() - t };
      });
      return c.json({
        case: name,
        ms: performance.now() - started,
        cpu: readCpuMs(),
        ...summary,
      });
    }
    if (name === "catchup") {
      const started = performance.now();
      const summary = await withUniverse((universe) => {
        advanceUniverse(universe, Date.now() + 30 * 24 * 60 * 60 * 1000);
        return {
          seedAt: universe.seedCursor?.at ?? null,
          seedDone: Boolean(universe.seedCursor?.done),
          planets: Object.keys(universe.planets).length,
        };
      });
      return c.json({
        case: name,
        ms: performance.now() - started,
        cpu: readCpuMs(),
        ...summary,
      });
    }
    if (name === "tick") {
      const started = performance.now();
      const summary = await withUniverse((universe) => {
        advanceUniverse(universe);
        return {
          seedAt: universe.seedCursor?.at ?? null,
          seedDone: Boolean(universe.seedCursor?.done),
          planets: Object.keys(universe.planets).length,
          pirates: Object.keys(universe.pirateBases ?? {}).length,
          players: Object.keys(universe.players).length,
        };
      });
      return c.json({
        case: name,
        ms: performance.now() - started,
        cpu: readCpuMs(),
        ...summary,
      });
    }
    return c.json({ error: "Unknown profile case." }, 404);
  });
}
