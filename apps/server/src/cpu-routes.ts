import type { Hono } from "hono";
import {
  advanceUniverse,
  emptyDefenses,
  emptyFleetShips,
  resolveCombat,
} from "@starhold/game";
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
        rounds: result.rounds,
        outcome: result.outcome,
      });
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
