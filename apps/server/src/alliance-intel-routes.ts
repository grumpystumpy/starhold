import type { Context, Hono } from "hono";
import {
  deleteAllianceIntel,
  deleteAllianceMarker,
  isStrikeMission,
  listAllianceChat,
  listAllianceIntel,
  listAllianceMarkers,
  parseAllianceCoords,
  playerView,
  postAllianceChat,
  proposeAllianceStrike,
  shareAllianceIntel,
  upsertAllianceMarker,
  type StrikeMission,
} from "@starhold/game";
import { getAccountById, getSession } from "./accounts.js";
import { readSessionId } from "./cookies.js";
import { withUniverse } from "./store.js";

function isResponse(value: string | Response): value is Response {
  return typeof value !== "string";
}

async function sessionPlayerId(c: Context): Promise<string | Response> {
  const sessionId = readSessionId(c);
  if (!sessionId) return c.json({ error: "Sign in required." }, 401);
  const session = await getSession(sessionId);
  if (!session) return c.json({ error: "Sign in required." }, 401);
  const account = await getAccountById(session.accountId);
  if (!account?.playerId) {
    return c.json({ error: "Sign in required." }, 401);
  }
  return account.playerId;
}

function denied(error: string): boolean {
  return error === "Not in an alliance.";
}

export function mountAllianceIntelRoutes(app: Hono): void {
  app.get("/api/alliance/chat", async (c) => {
    const playerId = await sessionPlayerId(c);
    if (isResponse(playerId)) return playerId;
    return withUniverse((universe) => {
      const result = listAllianceChat(universe, playerId);
      if (!result.ok) {
        return c.json({ error: result.error }, denied(result.error) ? 403 : 400);
      }
      return c.json({ messages: result.messages });
    }, { playerIds: [playerId] });
  });

  app.post("/api/alliance/chat", async (c) => {
    const playerId = await sessionPlayerId(c);
    if (isResponse(playerId)) return playerId;
    const body = (await c.req.json().catch(() => ({}))) as { body?: string };
    if (typeof body.body !== "string") {
      return c.json({ error: "body required." }, 400);
    }
    return withUniverse((universe) => {
      const result = postAllianceChat(universe, playerId, body.body ?? "");
      if (!result.ok) {
        return c.json({ error: result.error }, denied(result.error) ? 403 : 400);
      }
      return c.json(playerView(universe, playerId));
    }, { playerIds: [playerId] });
  });

  app.get("/api/alliance/intel", async (c) => {
    const playerId = await sessionPlayerId(c);
    if (isResponse(playerId)) return playerId;
    return withUniverse((universe) => {
      const result = listAllianceIntel(universe, playerId);
      if (!result.ok) {
        return c.json({ error: result.error }, denied(result.error) ? 403 : 400);
      }
      return c.json({ intel: result.intel });
    }, { playerIds: [playerId] });
  });

  app.post("/api/alliance/intel/share", async (c) => {
    const playerId = await sessionPlayerId(c);
    if (isResponse(playerId)) return playerId;
    const body = (await c.req.json().catch(() => ({}))) as {
      spyReportId?: string;
    };
    if (!body.spyReportId) {
      return c.json({ error: "spyReportId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = shareAllianceIntel(universe, playerId, body.spyReportId!);
      if (!result.ok) {
        return c.json({ error: result.error }, denied(result.error) ? 403 : 400);
      }
      return c.json(playerView(universe, playerId));
    }, { playerIds: [playerId] });
  });

  app.delete("/api/alliance/intel/:id", async (c) => {
    const playerId = await sessionPlayerId(c);
    if (isResponse(playerId)) return playerId;
    const intelId = c.req.param("id");
    return withUniverse((universe) => {
      const result = deleteAllianceIntel(universe, playerId, intelId);
      if (!result.ok) {
        return c.json({ error: result.error }, denied(result.error) ? 403 : 400);
      }
      return c.json(playerView(universe, playerId));
    }, { playerIds: [playerId] });
  });

  app.get("/api/alliance/markers", async (c) => {
    const playerId = await sessionPlayerId(c);
    if (isResponse(playerId)) return playerId;
    return withUniverse((universe) => {
      const result = listAllianceMarkers(universe, playerId);
      if (!result.ok) {
        return c.json({ error: result.error }, denied(result.error) ? 403 : 400);
      }
      return c.json({ markers: result.markers });
    }, { playerIds: [playerId] });
  });

  app.post("/api/alliance/markers", async (c) => {
    const playerId = await sessionPlayerId(c);
    if (isResponse(playerId)) return playerId;
    const body = (await c.req.json().catch(() => ({}))) as {
      coords?: { galaxy?: number; system?: number; slot?: number };
      note?: string;
    };
    const coords = parseAllianceCoords(body.coords ?? {});
    if (!coords) return c.json({ error: "Coordinates are out of range." }, 400);
    return withUniverse((universe) => {
      const result = upsertAllianceMarker(
        universe,
        playerId,
        coords,
        body.note ?? "",
      );
      if (!result.ok) {
        return c.json({ error: result.error }, denied(result.error) ? 403 : 400);
      }
      return c.json(playerView(universe, playerId));
    }, { playerIds: [playerId] });
  });

  app.delete("/api/alliance/markers/:id", async (c) => {
    const playerId = await sessionPlayerId(c);
    if (isResponse(playerId)) return playerId;
    const markerId = c.req.param("id");
    return withUniverse((universe) => {
      const result = deleteAllianceMarker(universe, playerId, markerId);
      if (!result.ok) {
        return c.json({ error: result.error }, denied(result.error) ? 403 : 400);
      }
      return c.json(playerView(universe, playerId));
    }, { playerIds: [playerId] });
  });

  app.post("/api/alliance/plan-strike", async (c) => {
    const playerId = await sessionPlayerId(c);
    if (isResponse(playerId)) return playerId;
    const body = (await c.req.json().catch(() => ({}))) as {
      coords?: { galaxy?: number; system?: number; slot?: number };
      note?: string;
      mission?: string;
    };
    const coords = parseAllianceCoords(body.coords ?? {});
    if (!coords) return c.json({ error: "Coordinates are out of range." }, 400);
    if (body.mission && !isStrikeMission(body.mission)) {
      return c.json({ error: "Mission must be raid or pirateRaid." }, 400);
    }
    const mission: StrikeMission =
      body.mission && isStrikeMission(body.mission) ? body.mission : "raid";
    return withUniverse((universe) => {
      const result = proposeAllianceStrike(
        universe,
        playerId,
        coords,
        body.note,
        mission,
      );
      if (!result.ok) {
        return c.json({ error: result.error }, denied(result.error) ? 403 : 400);
      }
      return c.json({
        planId: result.planId,
        acsPrefill: result.acsPrefill,
        view: playerView(universe, playerId),
      });
    }, { playerIds: [playerId] });
  });
}
