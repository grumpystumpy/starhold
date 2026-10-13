import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  type BuildingId,
  type Coordinates,
  type DefenseId,
  type FleetShips,
  type MissionType,
  type ResearchId,
  type Resources,
  type ShipId,
  ensureUniverseShape,
  joinUniverse,
  launchFleet,
  playerView,
  queueBuildingUpgrade,
  queueDefenseBuild,
  queueResearch,
  queueShipBuild,
  setActivePlanet,
} from "@starhold/game";
import { storageMode, withUniverse } from "./store.js";

function corsOrigins(): string[] | string {
  const fromEnv = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaults = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ];
  const vercel = process.env.VERCEL_URL
    ? [`https://${process.env.VERCEL_URL}`]
    : [];
  const all = [...new Set([...defaults, ...fromEnv, ...vercel])];
  // Same-origin browser calls don't need CORS; keep explicit list for local Vite.
  return all;
}

/** Shared Hono app — used by local Node server and Vercel serverless. */
export function createApp(): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: corsOrigins(),
    }),
  );

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

  app.get("/api/state/:playerId", async (c) => {
    try {
      const galaxy = Number(c.req.query("galaxy") || 0) || undefined;
      const system = Number(c.req.query("system") || 0) || undefined;
      return await withUniverse((universe) =>
        c.json(
          playerView(
            universe,
            c.req.param("playerId"),
            Date.now(),
            galaxy,
            system,
          ),
        ),
      );
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "State failed." },
        404,
      );
    }
  });

  app.post("/api/upgrade", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      buildingId?: BuildingId;
      planetId?: string;
    };
    if (!body.playerId || !body.buildingId) {
      return c.json({ error: "playerId and buildingId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = queueBuildingUpgrade(
        universe,
        body.playerId!,
        body.buildingId!,
        Date.now(),
        body.planetId,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/build-ship", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      shipId?: ShipId;
      count?: number;
      planetId?: string;
    };
    if (!body.playerId || !body.shipId) {
      return c.json({ error: "playerId and shipId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = queueShipBuild(
        universe,
        body.playerId!,
        body.shipId!,
        body.count ?? 1,
        Date.now(),
        body.planetId,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/build-defense", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      defenseId?: DefenseId;
      count?: number;
      planetId?: string;
    };
    if (!body.playerId || !body.defenseId) {
      return c.json({ error: "playerId and defenseId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = queueDefenseBuild(
        universe,
        body.playerId!,
        body.defenseId!,
        body.count ?? 1,
        Date.now(),
        body.planetId,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/research", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      researchId?: ResearchId;
    };
    if (!body.playerId || !body.researchId) {
      return c.json({ error: "playerId and researchId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = queueResearch(universe, body.playerId!, body.researchId!);
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/select-planet", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      planetId?: string;
    };
    if (!body.playerId || !body.planetId) {
      return c.json({ error: "playerId and planetId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = setActivePlanet(
        universe,
        body.playerId!,
        body.planetId!,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/launch-fleet", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      targetPlanetId?: string;
      targetCoords?: Coordinates;
      mission?: MissionType;
      ships?: Partial<FleetShips>;
      cargo?: Partial<Resources>;
      originPlanetId?: string;
    };
    if (!body.playerId || !body.mission) {
      return c.json({ error: "playerId and mission required." }, 400);
    }
    return withUniverse((universe) => {
      const result = launchFleet(universe, {
        playerId: body.playerId!,
        mission: body.mission!,
        ships: body.ships ?? {},
        targetPlanetId: body.targetPlanetId,
        targetCoords: body.targetCoords,
        cargo: body.cargo,
        originPlanetId: body.originPlanetId,
      });
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  return app;
}

export const app = createApp();
