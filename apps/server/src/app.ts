import { Hono } from "hono";
import type { Context, Next } from "hono";
import {
  type BuildingId,
  type Coordinates,
  type DefenseId,
  type FleetShips,
  type MiniPlanetResolveChoice,
  type MissionType,
  type OfficerId,
  type PlayerClassId,
  type QueueKind,
  type ResearchId,
  type GoalMetricId,
  type Resources,
  type ShipId,
  abandonOccupation,
  activateOfficer,
  advanceUniverse,
  batchScanSystem,
  cancelQueueItem,
  changePlayerClass,
  choosePlayerClass,
  claimDailyLogin,
  claimGoal,
  classCatalog,
  deleteFleetPreset,
  ensureUniverseShape,
  isPlayerClassId,
  joinUniverse,
  launchFleet,
  launchMaxExpeditions,
  noteGoalProgress,
  playerView,
  queueBuildingUpgrade,
  queueDefenseBuild,
  queueResearch,
  queueShipBuild,
  reorderQueue,
  renamePlanet,
  resolveMiniPlanetChoice,
  saveFleetPreset,
  setActivePlanet,
  startOccupation,
  swarmProduce,
  unlockSkill,
} from "@starhold/game";
import { sessionSecretConfigured } from "./accounts.js";
import { mountAuthRoutes } from "./auth-routes.js";
import { storageMode, withUniverse } from "./store.js";

function allowedOrigins(): Set<string> {
  const fromEnv = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaults = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "https://starhold-two.vercel.app",
  ];
  const vercel = process.env.VERCEL_URL
    ? [`https://${process.env.VERCEL_URL}`]
    : [];
  return new Set([...defaults, ...fromEnv, ...vercel]);
}

/** Lightweight CORS — avoids hono/cors Headers quirks on some Node adapters. */
async function simpleCors(c: Context, next: Next): Promise<Response | void> {
  const origin = c.req.header("Origin");
  const allow =
    origin && (allowedOrigins().has(origin) || process.env.VERCEL === "1");
  if (c.req.method === "OPTIONS") {
    const res = new Response(null, { status: 204 });
    if (origin && allow) {
      res.headers.set("Access-Control-Allow-Origin", origin);
      res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Cookie",
      );
      res.headers.set("Access-Control-Allow-Credentials", "true");
      res.headers.set("Vary", "Origin");
    }
    return res;
  }
  await next();
  if (origin && allow) {
    c.res.headers.set("Access-Control-Allow-Origin", origin);
    c.res.headers.set("Access-Control-Allow-Credentials", "true");
    c.res.headers.set("Vary", "Origin");
  }
}

/** Shared Hono app — used by local Node server and Vercel serverless. */
export function createApp(): Hono {
  const app = new Hono();

  app.use("*", simpleCors);
  mountAuthRoutes(app);

  app.notFound((c) =>
    c.json({ error: "Not found", path: c.req.path }, 404),
  );

  app.onError((err, c) => {
    console.error("[starhold-api]", err);
    return c.json(
      { error: err instanceof Error ? err.message : "Server error" },
      500,
    );
  });

  app.get("/api/health", async (c) => {
    try {
      return await withUniverse((universe) => {
        ensureUniverseShape(universe);
        return c.json({
          ok: true,
          storage: storageMode(),
          universe: universe.name,
          players: Object.keys(universe.players).length,
          speed: universe.speed,
          fleetSpeed: universe.fleetSpeed,
          fleets: Object.keys(universe.fleets ?? {}).length,
          debris: Object.keys(universe.debris ?? {}).length,
          auth: {
            sessionSecretConfigured: sessionSecretConfigured(),
            passwordAuth: true,
          },
        });
      });
    } catch (err) {
      return c.json(
        {
          ok: false,
          storage: storageMode(),
          error: err instanceof Error ? err.message : "Health failed.",
        },
        503,
      );
    }
  });

  app.get("/api/universe", async (c) => {
    return withUniverse((universe) => {
      ensureUniverseShape(universe);
      const now = Date.now();
      return c.json({
        now,
        id: universe.id,
        name: universe.name,
        speed: universe.speed,
        fleetSpeed: universe.fleetSpeed,
        players: Object.values(universe.players).map((p) => {
          const planet = universe.planets[p.homePlanetId];
          return {
            id: p.id,
            name: p.name,
            coords: planet?.coords ?? null,
            planetId: p.homePlanetId,
          };
        }),
      });
    });
  });

  app.post("/api/join", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    try {
      return await withUniverse((universe) => {
        const { player } = joinUniverse(universe, body.name ?? "");
        return c.json(playerView(universe, player.id));
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Join failed." },
        400,
      );
    }
  });

  // Single-segment path: Vercel catch-all only matches one segment under /api.
  // Use ?playerId= (rewrite maps legacy /api/state/:id → this).
  app.get("/api/state", async (c) => {
    const playerId = c.req.query("playerId")?.trim();
    if (!playerId) {
      return c.json({ error: "playerId query required." }, 400);
    }
    try {
      const galaxy = Number(c.req.query("galaxy") || 0) || undefined;
      const system = Number(c.req.query("system") || 0) || undefined;
      return await withUniverse((universe) =>
        c.json(playerView(universe, playerId, Date.now(), galaxy, system)),
      );
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "State failed." },
        404,
      );
    }
  });

  app.post("/api/claim-goal", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      goalId?: string;
    };
    if (!body.playerId || !body.goalId) {
      return c.json({ error: "playerId and goalId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = claimGoal(universe, body.playerId!, body.goalId!);
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  return app;
}

export const app = createApp();
