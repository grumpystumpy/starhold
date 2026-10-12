import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
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
  joinUniverse,
  launchFleet,
  playerView,
  queueBuildingUpgrade,
  queueDefenseBuild,
  queueResearch,
  queueShipBuild,
  setActivePlanet,
} from "@starhold/game";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { universe } from "./store.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  }),
);

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    universe: universe.name,
    players: Object.keys(universe.players).length,
    speed: universe.speed,
    fleetSpeed: universe.fleetSpeed,
    fleets: Object.keys(universe.fleets ?? {}).length,
    debris: Object.keys(universe.debris ?? {}).length,
  }),
);

app.get("/api/universe", (c) => {
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

app.post("/api/join", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  try {
    const { player } = joinUniverse(universe, body.name ?? "");
    const view = playerView(universe, player.id);
    return c.json(view);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Join failed." },
      400,
    );
  }
});

app.get("/api/state/:playerId", (c) => {
  try {
    const galaxy = Number(c.req.query("galaxy") || 0) || undefined;
    const system = Number(c.req.query("system") || 0) || undefined;
    return c.json(
      playerView(universe, c.req.param("playerId"), Date.now(), galaxy, system),
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
  const result = queueBuildingUpgrade(
    universe,
    body.playerId,
    body.buildingId,
    Date.now(),
    body.planetId,
  );
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(playerView(universe, body.playerId));
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
  const result = queueShipBuild(
    universe,
    body.playerId,
    body.shipId,
    body.count ?? 1,
    Date.now(),
    body.planetId,
  );
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(playerView(universe, body.playerId));
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
  const result = queueDefenseBuild(
    universe,
    body.playerId,
    body.defenseId,
    body.count ?? 1,
    Date.now(),
    body.planetId,
  );
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(playerView(universe, body.playerId));
});

app.post("/api/research", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    playerId?: string;
    researchId?: ResearchId;
  };
  if (!body.playerId || !body.researchId) {
    return c.json({ error: "playerId and researchId required." }, 400);
  }
  const result = queueResearch(universe, body.playerId, body.researchId);
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(playerView(universe, body.playerId));
});

app.post("/api/select-planet", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    playerId?: string;
    planetId?: string;
  };
  if (!body.playerId || !body.planetId) {
    return c.json({ error: "playerId and planetId required." }, 400);
  }
  const result = setActivePlanet(universe, body.playerId, body.planetId);
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(playerView(universe, body.playerId));
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
  const result = launchFleet(universe, {
    playerId: body.playerId,
    mission: body.mission,
    ships: body.ships ?? {},
    targetPlanetId: body.targetPlanetId,
    targetCoords: body.targetCoords,
    cargo: body.cargo,
    originPlanetId: body.originPlanetId,
  });
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(playerView(universe, body.playerId));
});

// Optional: serve Vite production build from the same port.
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ root: webDist, path: "index.html" }));
}

const port = Number(process.env.PORT ?? 3001);
console.log(`Starhold API listening on http://localhost:${port}`);
console.log(
  `Universe "${universe.name}" @ ${universe.speed}x economy / ${universe.fleetSpeed}x fleet`,
);
serve({ fetch: app.fetch, port });
