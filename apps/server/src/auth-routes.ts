import { type Context, type Hono } from "hono";
import {
  claimPlayerToAccount,
  ensureUniverseShape,
  joinUniverse,
  playerForAccount,
  playerView,
} from "@starhold/game";
import {
  authenticateEmailPassword,
  checkAuthRateLimit,
  clientIp,
  createAccountWithPassword,
  createSession,
  deleteSession,
  getAccountById,
  getSession,
  isScryptAttempt,
  normalizeEmail,
  requireSessionSecret,
  sessionSecretConfigured,
  setAccountPlayerId,
} from "./accounts.js";
import {
  clearSessionCookie,
  readSessionId,
  setSessionCookie,
} from "./cookies.js";
import { withUniverse } from "./store.js";

async function sessionAccount(c: Context) {
  const sessionId = readSessionId(c);
  if (!sessionId) return null;
  const session = await getSession(sessionId);
  if (!session) return null;
  const account = await getAccountById(session.accountId);
  if (!account) return null;
  return { session, account };
}

async function maybeClaimGuest(
  accountId: string,
  claimPlayerId: string | undefined,
): Promise<{ status: string; view: ReturnType<typeof playerView> | null }> {
  if (!claimPlayerId) return { status: "none", view: null };
  let claimStatus = "none";
  let view: ReturnType<typeof playerView> | null = null;
  try {
    await withUniverse((universe) => {
      ensureUniverseShape(universe);
      const result = claimPlayerToAccount(universe, claimPlayerId, accountId);
      if (result.ok) {
        claimStatus = "claimed";
        view = playerView(universe, claimPlayerId);
      } else if (result.code === "already_claimed") {
        claimStatus = "already_claimed";
      } else if (result.code === "conflict") {
        claimStatus = "account_has_player";
      } else {
        claimStatus = "claim_failed";
      }
    });
    if (claimStatus === "claimed") {
      await setAccountPlayerId(accountId, claimPlayerId);
    }
  } catch (err) {
    console.error("[starhold-auth] claim during signup", err);
    claimStatus = "claim_failed";
    view = null;
  }
  return { status: claimStatus, view };
}

function publicAccount(account: {
  id: string;
  email: string;
  playerId: string | null;
}) {
  return {
    id: account.id,
    email: account.email,
    playerId: account.playerId,
  };
}

/** Mount email+password + session routes on the shared Hono app. */
export function mountAuthRoutes(app: Hono): void {
  app.post("/api/auth/signup", async (c) => {
    const secretErr = requireSessionSecret();
    if (secretErr) return c.json({ error: secretErr }, 503);

    const body = (await c.req.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      claimPlayerId?: string;
    };
    const email = normalizeEmail(body.email ?? "");
    const password = body.password ?? "";
    const claimPlayerId = body.claimPlayerId?.trim() || undefined;

    const rate = await checkAuthRateLimit(
      "signup",
      email,
      clientIp(c.req.raw.headers),
    );
    if (rate.limited) {
      return c.json(
        {
          error: `Too many signup attempts. Try again in ${rate.retryAfterSec}s.`,
        },
        429,
      );
    }

    const created = await createAccountWithPassword(email, password);
    if (!created.ok) {
      const status = created.error.includes("already exists") ? 409 : 400;
      return c.json({ error: created.error }, status);
    }

    const account = created.account;
    let view: ReturnType<typeof playerView> | null = null;
    if (claimPlayerId) {
      const accountFresh = await getAccountById(account.id);
      if (accountFresh?.playerId && accountFresh.playerId !== claimPlayerId) {
        /* skip claim */
      } else {
        const claimed = await maybeClaimGuest(account.id, claimPlayerId);
        view = claimed.view;
        const refreshed = await getAccountById(account.id);
        if (refreshed) account.playerId = refreshed.playerId;
      }
    }

    const session = await createSession(account.id);
    setSessionCookie(c, session.id);
    return c.json({
      ok: true,
      account: publicAccount(account),
      view,
      auth: { sessionSecretConfigured: sessionSecretConfigured() },
    });
  });

  app.post("/api/auth/login", async (c) => {
    const secretErr = requireSessionSecret();
    if (secretErr) return c.json({ error: secretErr }, 503);

    const body = (await c.req.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      attemptId?: string;
    };
    const email = normalizeEmail(body.email ?? "");
    const password = body.password ?? "";
    const continuing =
      typeof body.attemptId === "string" &&
      body.attemptId.length > 0 &&
      (await isScryptAttempt(body.attemptId));
    if (!continuing) {
      const rate = await checkAuthRateLimit(
        "login",
        email,
        clientIp(c.req.raw.headers),
      );
      if (rate.limited) {
        return c.json(
          {
            error: `Too many login attempts. Try again in ${rate.retryAfterSec}s.`,
          },
          429,
        );
      }
    }

    const auth = await authenticateEmailPassword(
      email,
      password,
      Date.now(),
      body.attemptId,
    );
    if (!auth.ok) {
      if ("pending" in auth && auth.pending) {
        return c.json({ pending: true, attemptId: auth.attemptId }, 202);
      }
      return c.json({ error: auth.error }, auth.status);
    }

    const session = await createSession(auth.account.id);
    setSessionCookie(c, session.id);

    // One universe read: link a stale account index and build the view together.
    let view: ReturnType<typeof playerView> | null = null;
    let linkedPlayerId: string | null = null;
    try {
      await withUniverse((universe) => {
        ensureUniverseShape(universe);
        if (!auth.account.playerId) {
          const linked = playerForAccount(universe, auth.account.id);
          if (linked) {
            auth.account.playerId = linked.id;
            linkedPlayerId = linked.id;
          }
        }
        if (
          auth.account.playerId &&
          universe.players[auth.account.playerId]
        ) {
          view = playerView(universe, auth.account.playerId);
        }
      });
    } catch {
      /* ignore — client can refresh */
    }
    if (linkedPlayerId) {
      await setAccountPlayerId(auth.account.id, linkedPlayerId);
    }

    return c.json({
      ok: true,
      account: publicAccount(auth.account),
      view,
      auth: { sessionSecretConfigured: sessionSecretConfigured() },
    });
  });

  app.get("/api/auth/me", async (c) => {
    const ctx = await sessionAccount(c);
    if (!ctx) {
      return c.json({ account: null, view: null }, 200);
    }
    const { account } = ctx;
    let view = null;
    let playerId = account.playerId;
    try {
      await withUniverse((universe) => {
        ensureUniverseShape(universe);
        if (!playerId) {
          const linked = playerForAccount(universe, account.id);
          if (linked) playerId = linked.id;
        }
        if (playerId && universe.players[playerId]) {
          view = playerView(universe, playerId);
        }
      });
    } catch (err) {
      return c.json(
        {
          error: err instanceof Error ? err.message : "State failed.",
          account: publicAccount(account),
          view: null,
        },
        503,
      );
    }
    if (playerId && playerId !== account.playerId) {
      await setAccountPlayerId(account.id, playerId);
    }
    return c.json({
      account: {
        id: account.id,
        email: account.email,
        playerId: playerId ?? null,
      },
      view,
      auth: {
        sessionSecretConfigured: sessionSecretConfigured(),
      },
    });
  });

  app.post("/api/auth/claim", async (c) => {
    const ctx = await sessionAccount(c);
    if (!ctx) {
      return c.json({ error: "Sign in required." }, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      playerId?: string;
    };
    const playerId = body.playerId?.trim();
    if (!playerId) {
      return c.json({ error: "playerId required." }, 400);
    }
    if (ctx.account.playerId && ctx.account.playerId !== playerId) {
      return c.json(
        {
          error: "This account already owns another commander.",
          playerId: ctx.account.playerId,
        },
        409,
      );
    }
    try {
      return await withUniverse(async (universe) => {
        const result = claimPlayerToAccount(
          universe,
          playerId,
          ctx.account.id,
        );
        if (!result.ok) {
          const status =
            result.code === "already_claimed" || result.code === "conflict"
              ? 409
              : 400;
          return c.json({ error: result.error }, status);
        }
        await setAccountPlayerId(ctx.account.id, playerId);
        return c.json({
          ok: true,
          account: {
            id: ctx.account.id,
            email: ctx.account.email,
            playerId,
          },
          view: playerView(universe, playerId),
        });
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Claim failed." },
        500,
      );
    }
  });

  app.post("/api/auth/logout", async (c) => {
    const sessionId = readSessionId(c);
    if (sessionId) await deleteSession(sessionId);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  /**
   * Authenticated join: create a new commander linked to the session account
   * when the account has no player yet. Anonymous join stays on POST /api/join.
   */
  app.post("/api/auth/join", async (c) => {
    const ctx = await sessionAccount(c);
    if (!ctx) {
      return c.json({ error: "Sign in required." }, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    try {
      return await withUniverse(async (universe) => {
        ensureUniverseShape(universe);
        if (ctx.account.playerId) {
          const existing = universe.players[ctx.account.playerId];
          if (existing) {
            return c.json(playerView(universe, existing.id));
          }
        }
        const linked = playerForAccount(universe, ctx.account.id);
        if (linked) {
          await setAccountPlayerId(ctx.account.id, linked.id);
          return c.json(playerView(universe, linked.id));
        }
        const trimmed = (body.name ?? "").trim().slice(0, 24);
        if (!trimmed) {
          return c.json({ error: "Commander name is required." }, 400);
        }
        const nameTaken = Object.values(universe.players).find(
          (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (nameTaken) {
          return c.json(
            {
              error:
                "That commander name is already taken — choose another or claim your guest save.",
            },
            409,
          );
        }
        const { player } = joinUniverse(universe, trimmed);
        player.accountId = ctx.account.id;
        await setAccountPlayerId(ctx.account.id, player.id);
        return c.json(playerView(universe, player.id));
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Join failed." },
        400,
      );
    }
  });
}
