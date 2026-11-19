import type { Context, Hono } from "hono";
import { getAccountById, getSession } from "./accounts.js";
import {
  deleteCommanderMail,
  listCommanderMail,
  sendCommanderMail,
} from "./commander-mail.js";
import { readSessionId } from "./cookies.js";
import { currentScope } from "./request-context.js";
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
  if (!account?.playerId) return c.json({ error: "Sign in required." }, 401);
  return account.playerId;
}

export function mountCommanderMailRoutes(app: Hono): void {
  app.get("/api/mail", async (c) => {
    const playerId = await sessionPlayerId(c);
    if (isResponse(playerId)) return playerId;
    const sinceRaw = c.req.query("since");
    const sinceNum = sinceRaw == null || sinceRaw === "" ? undefined : Number(sinceRaw);
    const since = sinceNum != null && Number.isFinite(sinceNum) ? sinceNum : undefined;
    const db = currentScope()?.db;
    const result = await listCommanderMail(db, playerId, since);
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ messages: result.messages });
  });

  app.post("/api/mail", async (c) => {
    const playerId = await sessionPlayerId(c);
    if (isResponse(playerId)) return playerId;
    const body = (await c.req.json().catch(() => ({}))) as { to?: string; body?: string };
    if (typeof body.to !== "string" || typeof body.body !== "string") {
      return c.json({ error: "to and body required." }, 400);
    }
    const db = currentScope()?.db;
    return withUniverse(async (universe) => {
      const result = await sendCommanderMail(db, universe, playerId, body.to ?? "", body.body ?? "");
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json({ message: result.message });
    }, { playerIds: [playerId] });
  });

  app.delete("/api/mail/:id", async (c) => {
    const playerId = await sessionPlayerId(c);
    if (isResponse(playerId)) return playerId;
    const db = currentScope()?.db;
    const result = await deleteCommanderMail(db, playerId, c.req.param("id"));
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ ok: true });
  });
}
