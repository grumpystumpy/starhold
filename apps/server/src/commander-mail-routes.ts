import type { Context, Hono } from "hono";
import { getAccountById, getSession } from "./accounts.js";
import {
  deleteCommanderMail,
  listCommanderMail,
  sendCommanderMail,
} from "./commander-mail.js";
import { readSessionId } from "./cookies.js";

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

type MailPost =
  | { kind: "delete"; deleteId: string }
  | { kind: "send"; to: string; body: string }
  | { kind: "bad"; error: string };

function parseMailPost(raw: unknown): MailPost {
  const body =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (typeof body.deleteId === "string") {
    const deleteId = body.deleteId.trim();
    if (!deleteId || deleteId.length > 80) {
      return { kind: "bad", error: "deleteId required." };
    }
    return { kind: "delete", deleteId };
  }
  if (typeof body.to !== "string") return { kind: "bad", error: "to required." };
  if (typeof body.body !== "string") return { kind: "bad", error: "body required." };
  return { kind: "send", to: body.to, body: body.body };
}

export function mountCommanderMailRoutes(app: Hono): void {
  app.get("/api/mail", async (c) => {
    const playerId = await sessionPlayerId(c);
    if (isResponse(playerId)) return playerId;
    const sinceRaw = c.req.query("since");
    const sinceNum = sinceRaw == null || sinceRaw === "" ? undefined : Number(sinceRaw);
    const since = sinceNum != null && Number.isFinite(sinceNum) ? sinceNum : undefined;
    const messages = await listCommanderMail(playerId, since);
    return c.json({ messages });
  });

  app.post("/api/mail", async (c) => {
    const playerId = await sessionPlayerId(c);
    if (isResponse(playerId)) return playerId;
    const parsed = parseMailPost(await c.req.json().catch(() => ({})));
    switch (parsed.kind) {
      case "bad":
        return c.json({ error: parsed.error }, 400);
      case "delete": {
        const removed = await deleteCommanderMail(playerId, parsed.deleteId);
        if (!removed) return c.json({ error: "Message not found." }, 404);
        return c.json({ ok: true });
      }
      case "send": {
        const result = await sendCommanderMail(playerId, parsed.to, parsed.body);
        if (!result.ok) return c.json({ error: result.error }, 400);
        return c.json({ message: result.message });
      }
      default: {
        const exhaustive: never = parsed;
        return exhaustive;
      }
    }
  });
}
