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
  type Resources,
  type ShipId,
  abandonOccupation,
  activateOfficer,
  deletePlayerMessages,
  isMessageCategory,
  advanceUniverse,
  batchScanSystem,
  cancelQueueItem,
  changePlayerClass,
  choosePlayerClass,
  claimDailyLogin,
  claimPlayerGoal,
  classCatalog,
  createAlliance,
  deleteFleetPreset,
  discoverMiniPlanet,
  disbandAlliance,
  empirePoints,
  emptyDefenses,
  emptyFleetShips,
  ensureUniverseShape,
  graduateNewbieProtection,
  inviteToAlliance,
  isAllianceJoinMode,
  isAllianceRole,
  isPlayerClassId,
  joinAlliance,
  joinUniverse,
  kickFromAlliance,
  launchFleet,
  launchMaxExpeditions,
  leaveAlliance,
  markEventsRead,
  playerView,
  pushEventLog,
  queueBuildingUpgrade,
  queueDefenseBuild,
  queueResearch,
  queueShipBuild,
  reorderQueue,
  claimSeasonReward,
  grantSeasonPoints,
  isSeasonBoard,
  raiseOfficer,
  renamePlanet,
  relocateMovingFortress,
  resolveMiniPlanetChoice,
  rollSeasons,
  saveFleetPreset,
  setActivePlanet,
  setAllianceJoinMode,
  setAllianceRole,
  setSeasonSkin,
  setSeasonTitle,
  startOccupation,
  swarmProduce,
  unlockSkill,
  type AllianceJoinMode,
  type AllianceRole,
} from "@starhold/game";
import { sessionSecretConfigured } from "./accounts.js";
import { mountAllianceIntelRoutes } from "./alliance-intel-routes.js";
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
      res.headers.set(
        "Access-Control-Allow-Methods",
        "GET,POST,DELETE,OPTIONS",
      );
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

  /** Round 2 aliases — same handlers as upgrade / build-ship / build-defense / research. */
  app.post("/api/queue/building", async (c) => {
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

  app.post("/api/queue/ship", async (c) => {
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

  app.post("/api/queue/defense", async (c) => {
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

  app.post("/api/queue/research", async (c) => {
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

  app.post("/api/queue/cancel", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      planetId?: string;
      kind?: QueueKind;
      itemId?: string;
    };
    if (!body.playerId || !body.kind || !body.itemId) {
      return c.json({ error: "playerId, kind, and itemId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = cancelQueueItem(universe, body.playerId!, {
        kind: body.kind!,
        itemId: body.itemId!,
        planetId: body.planetId,
      });
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/queue/reorder", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      planetId?: string;
      kind?: QueueKind;
      orderedIds?: string[];
    };
    if (!body.playerId || !body.kind || !Array.isArray(body.orderedIds)) {
      return c.json(
        { error: "playerId, kind, and orderedIds required." },
        400,
      );
    }
    return withUniverse((universe) => {
      const result = reorderQueue(universe, body.playerId!, {
        kind: body.kind!,
        orderedIds: body.orderedIds!,
        planetId: body.planetId,
      });
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

  app.post("/api/rename-planet", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      planetId?: string;
      name?: string;
    };
    if (!body.playerId || !body.planetId || typeof body.name !== "string") {
      return c.json(
        { error: "playerId, planetId, and name required." },
        400,
      );
    }
    return withUniverse((universe) => {
      const result = renamePlanet(
        universe,
        body.playerId!,
        body.planetId!,
        body.name!,
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
      asteroidId?: string;
      pirateBaseId?: string;
      alienBaseId?: string;
      mission?: MissionType;
      ships?: Partial<FleetShips>;
      cargo?: Partial<Resources>;
      originPlanetId?: string;
      openAcs?: boolean;
      acsGroupId?: string;
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
        asteroidId: body.asteroidId,
        pirateBaseId: body.pirateBaseId,
        alienBaseId: body.alienBaseId,
        cargo: body.cargo,
        originPlanetId: body.originPlanetId,
        openAcs: body.openAcs,
        acsGroupId: body.acsGroupId,
      });
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/fleet-preset", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      id?: string;
      name?: string;
      ships?: Partial<FleetShips>;
      delete?: boolean;
    };
    if (!body.playerId) {
      return c.json({ error: "playerId required." }, 400);
    }
    return withUniverse((universe) => {
      ensureUniverseShape(universe);
      if (body.delete) {
        if (!body.id) {
          return c.json({ error: "id required to delete preset." }, 400);
        }
        const result = deleteFleetPreset(universe, body.playerId!, body.id);
        if (!result.ok) return c.json({ error: result.error }, 400);
        return c.json(playerView(universe, body.playerId!));
      }
      if (!body.name || !body.ships) {
        return c.json({ error: "name and ships required." }, 400);
      }
      const result = saveFleetPreset(universe, body.playerId!, {
        id: body.id,
        name: body.name,
        ships: body.ships,
      });
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/launch-max-expeditions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      originPlanetId?: string;
      galaxy?: number;
      system?: number;
      ships?: Partial<FleetShips>;
      presetId?: string;
    };
    if (!body.playerId) {
      return c.json({ error: "playerId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = launchMaxExpeditions(universe, {
        playerId: body.playerId!,
        originPlanetId: body.originPlanetId,
        galaxy: body.galaxy,
        system: body.system,
        ships: body.ships,
        presetId: body.presetId,
      });
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/scan-system", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      galaxy?: number;
      system?: number;
      probesPerTarget?: number;
      originPlanetId?: string;
    };
    if (!body.playerId || body.galaxy == null || body.system == null) {
      return c.json(
        { error: "playerId, galaxy, and system required." },
        400,
      );
    }
    return withUniverse((universe) => {
      const result = batchScanSystem(universe, {
        playerId: body.playerId!,
        galaxy: body.galaxy!,
        system: body.system!,
        probesPerTarget: body.probesPerTarget,
        originPlanetId: body.originPlanetId,
      });
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  // Single-segment paths (Vercel catch-all); contract names map here.
  app.post("/api/claim-goal", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      goalId?: string;
    };
    if (!body.playerId || !body.goalId) {
      return c.json({ error: "playerId and goalId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = claimPlayerGoal(
        universe,
        body.playerId!,
        body.goalId!,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/claim-daily", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
    };
    if (!body.playerId) {
      return c.json({ error: "playerId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = claimDailyLogin(universe, body.playerId!);
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/activate-officer", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      officerId?: OfficerId;
    };
    if (!body.playerId || !body.officerId) {
      return c.json({ error: "playerId and officerId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = activateOfficer(
        universe,
        body.playerId!,
        body.officerId!,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/raise-officer", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      officerId?: OfficerId;
    };
    if (!body.playerId || !body.officerId) {
      return c.json({ error: "playerId and officerId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = raiseOfficer(
        universe,
        body.playerId!,
        body.officerId!,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/delete-messages", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      category?: string;
    };
    if (!body.playerId || !body.category || !isMessageCategory(body.category)) {
      return c.json({ error: "playerId and category required." }, 400);
    }
    return withUniverse((universe) => {
      const result = deletePlayerMessages(
        universe,
        body.playerId!,
        body.category as "all" | "combat" | "spy" | "alerts",
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/unlock-skill", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      skillId?: string;
    };
    if (!body.playerId || !body.skillId) {
      return c.json({ error: "playerId and skillId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = unlockSkill(universe, body.playerId!, body.skillId!);
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  // Alliances foundation (backlog #7).
  app.get("/api/alliance", async (c) => {
    const playerId = c.req.query("playerId");
    if (!playerId) return c.json({ error: "playerId required." }, 400);
    return withUniverse((universe) => {
      return c.json(playerView(universe, playerId));
    });
  });

  app.get("/api/alliance/list", async (c) => {
    const playerId = c.req.query("playerId");
    if (!playerId) return c.json({ error: "playerId required." }, 400);
    return withUniverse((universe) => {
      const view = playerView(universe, playerId);
      return c.json({ alliances: view.allianceDirectory });
    });
  });

  app.post("/api/alliance/create", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      name?: string;
      tag?: string;
      joinMode?: string;
    };
    if (!body.playerId || !body.name || !body.tag) {
      return c.json({ error: "playerId, name, and tag required." }, 400);
    }
    const joinMode = body.joinMode ?? "open";
    if (!isAllianceJoinMode(joinMode)) {
      return c.json({ error: "joinMode must be open or invite." }, 400);
    }
    return withUniverse((universe) => {
      const result = createAlliance(
        universe,
        body.playerId!,
        body.name!,
        body.tag!,
        joinMode as AllianceJoinMode,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/alliance/join", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      allianceId?: string;
      tag?: string;
    };
    if (!body.playerId || (!body.allianceId && !body.tag)) {
      return c.json(
        { error: "playerId and allianceId or tag required." },
        400,
      );
    }
    return withUniverse((universe) => {
      const result = joinAlliance(universe, body.playerId!, {
        allianceId: body.allianceId,
        tag: body.tag,
      });
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/alliance/leave", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
    };
    if (!body.playerId) return c.json({ error: "playerId required." }, 400);
    return withUniverse((universe) => {
      const result = leaveAlliance(universe, body.playerId!);
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/alliance/invite", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      targetPlayerId?: string;
    };
    if (!body.playerId || !body.targetPlayerId) {
      return c.json({ error: "playerId and targetPlayerId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = inviteToAlliance(
        universe,
        body.playerId!,
        body.targetPlayerId!,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/alliance/kick", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      targetPlayerId?: string;
    };
    if (!body.playerId || !body.targetPlayerId) {
      return c.json({ error: "playerId and targetPlayerId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = kickFromAlliance(
        universe,
        body.playerId!,
        body.targetPlayerId!,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/alliance/set-role", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      targetPlayerId?: string;
      role?: string;
    };
    if (!body.playerId || !body.targetPlayerId || !body.role) {
      return c.json(
        { error: "playerId, targetPlayerId, and role required." },
        400,
      );
    }
    if (!isAllianceRole(body.role)) {
      return c.json({ error: "Unknown role." }, 400);
    }
    return withUniverse((universe) => {
      const result = setAllianceRole(
        universe,
        body.playerId!,
        body.targetPlayerId!,
        body.role as AllianceRole,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/alliance/set-join-mode", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      joinMode?: string;
    };
    if (!body.playerId || !body.joinMode) {
      return c.json({ error: "playerId and joinMode required." }, 400);
    }
    if (!isAllianceJoinMode(body.joinMode)) {
      return c.json({ error: "joinMode must be open or invite." }, 400);
    }
    return withUniverse((universe) => {
      const result = setAllianceJoinMode(
        universe,
        body.playerId!,
        body.joinMode as AllianceJoinMode,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  mountAllianceIntelRoutes(app);

  app.post("/api/alliance/disband", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
    };
    if (!body.playerId) return c.json({ error: "playerId required." }, 400);
    return withUniverse((universe) => {
      const result = disbandAlliance(universe, body.playerId!);
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  // Round 3 player class.
  app.get("/api/class/catalog", async (c) => {
    return c.json({ classes: classCatalog() });
  });

  app.post("/api/class/choose", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      classId?: string;
    };
    if (!body.playerId || !body.classId) {
      return c.json({ error: "playerId and classId required." }, 400);
    }
    if (!isPlayerClassId(body.classId)) {
      return c.json({ error: "Unknown class." }, 400);
    }
    return withUniverse((universe) => {
      const result = choosePlayerClass(
        universe,
        body.playerId!,
        body.classId as PlayerClassId,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/class/change", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      classId?: string;
    };
    if (!body.playerId || !body.classId) {
      return c.json({ error: "playerId and classId required." }, 400);
    }
    if (!isPlayerClassId(body.classId)) {
      return c.json({ error: "Unknown class." }, 400);
    }
    return withUniverse((universe) => {
      const result = changePlayerClass(
        universe,
        body.playerId!,
        body.classId as PlayerClassId,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  // Round 2 fleet hooks (single-segment paths for Vercel catch-all).
  app.post("/api/occupy", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      fleetId?: string;
    };
    if (!body.playerId || !body.fleetId) {
      return c.json({ error: "playerId and fleetId required." }, 400);
    }
    return withUniverse((universe) => {
      advanceUniverse(universe);
      const result = startOccupation(
        universe,
        body.playerId!,
        body.fleetId!,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/abandon-occupation", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      planetId?: string;
    };
    if (!body.playerId || !body.planetId) {
      return c.json({ error: "playerId and planetId required." }, 400);
    }
    return withUniverse((universe) => {
      advanceUniverse(universe);
      const result = abandonOccupation(
        universe,
        body.playerId!,
        body.planetId!,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/swarm-produce", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      fleetId?: string;
      count?: number;
    };
    if (!body.playerId || !body.fleetId) {
      return c.json({ error: "playerId and fleetId required." }, 400);
    }
    return withUniverse((universe) => {
      advanceUniverse(universe);
      const now = Date.now();
      const result = swarmProduce(
        universe,
        body.playerId!,
        body.fleetId!,
        body.count ?? 1,
        now,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/events/read", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      ids?: unknown;
    };
    const playerId = body.playerId?.trim();
    if (!playerId) {
      return c.json({ error: "playerId required." }, 400);
    }
    if (body.ids != null && !Array.isArray(body.ids)) {
      return c.json({ error: "ids must be an array of event ids." }, 400);
    }
    const ids =
      body.ids == null
        ? undefined
        : body.ids.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          );
    return withUniverse((universe) => {
      const now = Date.now();
      advanceUniverse(universe, now);
      const result = markEventsRead(universe, playerId, ids, now);
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, playerId, now));
    });
  });

  app.post("/api/season/claim", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      board?: string;
      seasonId?: string;
    };
    if (!body.playerId || !body.board) {
      return c.json({ error: "playerId and board required." }, 400);
    }
    if (!isSeasonBoard(body.board)) {
      return c.json({ error: "Unknown board." }, 400);
    }
    return withUniverse((universe) => {
      const result = claimSeasonReward(
        universe,
        body.playerId!,
        body.board,
        Date.now(),
        body.seasonId,
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/cosmetics/title", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      title?: string | null;
    };
    if (!body.playerId || body.title === undefined) {
      return c.json({ error: "playerId and title required." }, 400);
    }
    return withUniverse((universe) => {
      const result = setSeasonTitle(
        universe,
        body.playerId!,
        body.title ?? null,
        Date.now(),
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/cosmetics/planet-skin", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      skinId?: string | null;
    };
    if (!body.playerId || body.skinId === undefined) {
      return c.json({ error: "playerId and skinId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = setSeasonSkin(
        universe,
        body.playerId!,
        body.skinId ?? null,
        Date.now(),
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/season/hook", async (c) => {
    if (process.env.STARHOLD_E2E !== "1") {
      return c.json({ error: "Not found" }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      combat?: number;
      economy?: number;
      pirateKills?: number;
      rollAt?: number;
    };
    if (!body.playerId) return c.json({ error: "playerId required." }, 400);
    return withUniverse((universe) => {
      const now = Date.now();
      const granted = grantSeasonPoints(
        universe,
        body.playerId!,
        {
          combat: body.combat,
          economy: body.economy,
          pirateKills: body.pirateKills,
        },
        now,
      );
      if (!granted.ok) return c.json({ error: granted.error }, 400);
      if (typeof body.rollAt === "number" && Number.isFinite(body.rollAt)) {
        rollSeasons(universe, body.rollAt);
      }
      return c.json(playerView(universe, body.playerId!, now));
    });
  });

  app.post("/api/mini-resolve", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      fleetId?: string;
      choice?: MiniPlanetResolveChoice;
    };
    if (!body.playerId || !body.fleetId) {
      return c.json({ error: "playerId and fleetId required." }, 400);
    }
    return withUniverse((universe) => {
      advanceUniverse(universe);
      const result = resolveMiniPlanetChoice(
        universe,
        body.playerId!,
        body.fleetId!,
        body.choice ?? "capture",
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  app.post("/api/mini-relocate", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
      planetId?: string;
      galaxy?: number;
      system?: number;
    };
    if (
      !body.playerId ||
      !body.planetId ||
      body.galaxy == null ||
      body.system == null
    ) {
      return c.json(
        { error: "playerId, planetId, galaxy, and system required." },
        400,
      );
    }
    return withUniverse((universe) => {
      advanceUniverse(universe);
      const result = relocateMovingFortress(
        universe,
        body.playerId!,
        body.planetId!,
        Number(body.galaxy),
        Number(body.system),
        Date.now(),
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId!));
    });
  });

  /**
   * Local quality-gate only (`STARHOLD_E2E=1`). Reveals the first mini planet
   * to the player so Playwright can exercise discovery UI without flaky rolls.
   */
  app.post("/api/e2e/discover-mini", async (c) => {
    if (process.env.STARHOLD_E2E !== "1") {
      return c.json({ error: "Not found." }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
    };
    if (!body.playerId) {
      return c.json({ error: "playerId required." }, 400);
    }
    return withUniverse((universe) => {
      advanceUniverse(universe);
      const ids = universe.miniPlanetIds ?? [];
      const targetId = ids.find((id) => universe.planets[id]?.flags?.mini);
      if (!targetId) {
        return c.json({ error: "No mini planets seeded." }, 500);
      }
      const planet = discoverMiniPlanet(universe, body.playerId!, targetId);
      if (!planet) {
        return c.json({ error: "Discover failed." }, 400);
      }
      return c.json(playerView(universe, body.playerId!));
    });
  });

  /** Local quality-gate seed hook — disabled unless STARHOLD_E2E=1. */
  if (process.env.STARHOLD_E2E === "1") {
    app.post("/api/e2e/grant", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as {
        playerId?: string;
        ships?: Partial<FleetShips>;
        resources?: Partial<Resources>;
        buildings?: Partial<Record<BuildingId, number>>;
        starshards?: number;
        colonySlot?: number;
        inbox?: boolean;
      };
      if (!body.playerId) {
        return c.json({ error: "playerId required." }, 400);
      }
      return withUniverse((universe) => {
        ensureUniverseShape(universe);
        const player = universe.players[body.playerId!];
        if (!player) return c.json({ error: "Player not found." }, 404);
        const planet =
          universe.planets[player.activePlanetId] ??
          universe.planets[player.homePlanetId];
        if (!planet) return c.json({ error: "Planet not found." }, 404);
        if (body.ships) {
          for (const [id, n] of Object.entries(body.ships)) {
            if (typeof n === "number" && n >= 0) {
              planet.ships[id as ShipId] = Math.floor(n);
            }
          }
        }
        if (body.resources) {
          for (const key of ["metal", "crystal", "deuterium"] as const) {
            const n = body.resources[key];
            if (typeof n === "number" && n >= 0) {
              planet.resources[key] = Math.floor(n);
            }
          }
        }
        if (body.buildings) {
          for (const [id, n] of Object.entries(body.buildings)) {
            if (typeof n === "number" && n >= 0) {
              planet.buildings[id as BuildingId] = Math.floor(n);
            }
          }
        }
        if (typeof body.starshards === "number" && body.starshards >= 0) {
          player.starshards = Math.floor(body.starshards);
        }
        if (typeof body.colonySlot === "number") {
          const slot = Math.floor(body.colonySlot);
          const coords = { ...planet.coords, slot };
          const taken = Object.values(universe.planets).some(
            (p) =>
              p.kind !== "moon" &&
              p.coords.galaxy === coords.galaxy &&
              p.coords.system === coords.system &&
              p.coords.slot === coords.slot,
          );
          if (!taken && slot >= 1 && slot <= 15 && slot !== planet.coords.slot) {
            const id = `e2e_col_${player.id}_${slot}`;
            const colony = structuredClone(planet);
            colony.id = id;
            colony.name = "Far Holding";
            colony.coords = coords;
            colony.kind = "planet";
            colony.parentPlanetId = null;
            colony.moonId = null;
            colony.buildQueue = [];
            colony.shipQueue = [];
            colony.defenseQueue = [];
            colony.resources = { metal: 0, crystal: 0, deuterium: 0 };
            universe.planets[id] = colony;
            if (!player.planetIds.includes(id)) player.planetIds.push(id);
          }
        }
        if (body.inbox) {
          const now = Date.now();
          pushEventLog(player, {
            kind: "fleetReturn",
            title: "Fleet returned to Home",
            body: "A hauler is home.",
            createdAt: now,
          });
          const ships = emptyFleetShips();
          const defenses = emptyDefenses();
          const combatId = `e2e_combat_${player.id}`;
          universe.reports[combatId] = {
            id: combatId,
            at: now,
            missionId: "e2e",
            attackerPlayerId: player.id,
            defenderPlayerId: player.id,
            attackerName: player.name,
            defenderName: player.name,
            targetCoords: planet.coords,
            attackerBefore: ships,
            attackerAfter: ships,
            defenderBefore: ships,
            defenderAfter: ships,
            defensesBefore: defenses,
            defensesAfter: defenses,
            loot: { metal: 0, crystal: 0, deuterium: 0 },
            debrisCreated: { metal: 0, crystal: 0, deuterium: 0 },
            outcome: "draw",
            rounds: 1,
            summary: "Drill report",
          };
          const spyId = `e2e_spy_${player.id}`;
          universe.spyReports[spyId] = {
            id: spyId,
            at: now - 1,
            missionId: "e2e",
            spyPlayerId: player.id,
            targetPlayerId: player.id,
            targetName: player.name,
            targetCoords: planet.coords,
            detail: 1,
            resources: { metal: 1, crystal: 0, deuterium: 0 },
            buildings: null,
            ships: null,
            defenses: null,
            research: null,
            summary: "Practice scan",
          };
          if (!universe.expeditionReports) universe.expeditionReports = {};
          const expId = `e2e_exp_${player.id}`;
          universe.expeditionReports[expId] = {
            id: expId,
            at: now - 2,
            missionId: "e2e",
            playerId: player.id,
            targetCoords: planet.coords,
            kind: "nothing",
            cargoGained: { metal: 0, crystal: 0, deuterium: 0 },
            shipsDelta: {},
            summary: "Empty expedition",
          };
        }
        return c.json(playerView(universe, body.playerId!));
      });
    });
  }

  /**
   * CI / local Playwright only. Raises storage so empire points clear
   * newbie protection without combat ships. Never enabled in production.
   */
  if (process.env.ALLOW_E2E_HOOKS === "1") {
    app.post("/api/e2e/graduate-newbie", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as {
        playerId?: string;
      };
      if (!body.playerId) {
        return c.json({ error: "playerId required." }, 400);
      }
      return withUniverse((universe) => {
        const player = universe.players[body.playerId!];
        if (!player) return c.json({ error: "Unknown player." }, 404);
        graduateNewbieProtection(universe, player);
        return c.json({
          ok: true,
          points: empirePoints(universe, player),
        });
      });
    });
  }

  return app;
}

export const app = createApp();
