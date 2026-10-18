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
  claimNewPassword,
  clientIp,
  createAccountWithPassword,
  createSession,
  deleteSession,
  getAccountById,
  getSession,
  normalizeEmail,
  preparePasswordClaim,
  requestClaimCode,
  requireSessionSecret,
  sessionSecretConfigured,
  setAccountPlayerId,
  type AccountRecord,
} from "./accounts.js";
import {
  CLAIM_MAIL_MESSAGE,
  CLAIM_NO_MAIL_MESSAGE,
  claimMailConfigured,
} from "./claim-code.js";
import {
  clearSessionCookie,
  readSessionId,
  setSessionCookie,
} from "./cookies.js";
import { withUniverse, withUniverseRead, isUniverseBusy } from "./store.js";
import { reportServerError } from "./request-context.js";

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

/** Session cookie plus the linked commander view, shared by login and claim. */
async function startSession(c: Context, account: AccountRecord) {
  const session = await createSession(account.id);
  setSessionCookie(c, session.id);

  let view: ReturnType<typeof playerView> | null = null;
  let linkedPlayerId: string | null = null;
  try {
    // Login must not wait on the universe lock. A busy writer used to be
    // swallowed, which returned ok:true and view:null and left the client
    // on the sign-in screen.
    await withUniverseRead((universe) => {
      ensureUniverseShape(universe);
      if (!account.playerId) {
        const linked = playerForAccount(universe, account.id);
        if (linked) {
          account.playerId = linked.id;
          linkedPlayerId = linked.id;
        }
      }
      if (account.playerId && universe.players[account.playerId]) {
        view = playerView(universe, account.playerId);
      }
    }, account.playerId
      ? { playerIds: [account.playerId] }
      : { catalog: true });
  } catch (err) {
    console.error("[starhold-auth] session view", err);
    const message = err instanceof Error ? err.message : "Universe busy — retry in a moment.";
    return c.json(
      {
        error: message.startsWith("Universe busy")
          ? message
          : "Universe busy — retry in a moment.",
        code: "busy",
        retry: true,
        account: publicAccount(account),
        view: null,
      },
      503,
    );
  }
  if (linkedPlayerId) {
    await setAccountPlayerId(account.id, linkedPlayerId);
  }

  return c.json({
    ok: true,
    account: publicAccount(account),
    view,
    auth: { sessionSecretConfigured: sessionSecretConfigured() },
  });
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
    };
    const email = normalizeEmail(body.email ?? "");
    const password = body.password ?? "";
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

    const auth = await authenticateEmailPassword(email, password, Date.now());
    if (!auth.ok) {
      return c.json({ error: auth.error }, auth.status);
    }
    return startSession(c, auth.account);
  });

  app.post("/api/auth/claim-code", async (c) => {
    const secretErr = requireSessionSecret();
    if (secretErr) return c.json({ error: secretErr }, 503);

    const body = (await c.req.json().catch(() => ({}))) as { email?: string };
    const email = normalizeEmail(body.email ?? "");
    const rate = await checkAuthRateLimit(
      "claim",
      email || "invalid",
      clientIp(c.req.raw.headers),
    );
    if (rate.limited) {
      return c.json(
        { error: `Too many attempts. Try again in ${rate.retryAfterSec}s.` },
        429,
      );
    }
    if (!claimMailConfigured()) {
      return c.json({ ok: true, message: CLAIM_NO_MAIL_MESSAGE });
    }
    await requestClaimCode(email);
    return c.json({ ok: true, message: CLAIM_MAIL_MESSAGE });
  });

  app.post("/api/auth/claim-password", async (c) => {
    const secretErr = requireSessionSecret();
    if (secretErr) return c.json({ error: secretErr }, 503);

    const body = (await c.req.json().catch(() => ({}))) as {
      email?: string;
      code?: string;
      password?: string;
    };
    const email = normalizeEmail(body.email ?? "");
    const rate = await checkAuthRateLimit(
      "claim",
      email || "invalid",
      clientIp(c.req.raw.headers),
    );
    if (rate.limited) {
      return c.json(
        { error: `Too many attempts. Try again in ${rate.retryAfterSec}s.` },
        429,
      );
    }
    const claimed = await claimNewPassword(
      email,
      body.code ?? "",
      body.password ?? "",
    );
    if (!claimed.ok) {
      return c.json({ error: claimed.error }, claimed.status);
    }
    return startSession(c, claimed.account);
  });

  app.post("/api/e2e/prepare-password-claim", async (c) => {
    if (process.env.STARHOLD_E2E !== "1") {
      return c.json({ error: "Not found" }, 404);
    }
    const body = (await c.req.json().catch(() => ({}))) as { email?: string };
    const prepared = await preparePasswordClaim(body.email ?? "");
    if (!prepared.ok) return c.json({ error: prepared.error }, 404);
    return c.json({ ok: true, code: prepared.code });
  });

  app.get("/api/auth/me", async (c) => {
    const sessionId = readSessionId(c);
    if (!sessionId) {
      return c.json({ account: null, view: null }, 200);
    }
    const session = await getSession(sessionId);
    if (!session) {
      return c.json({ account: null, view: null }, 401);
    }
    const account = await getAccountById(session.accountId);
    if (!account) {
      return c.json({ account: null, view: null }, 401);
    }
    let view = null;
    let playerId = account.playerId;
    try {
      await withUniverseRead((universe) => {
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
      const message = err instanceof Error ? err.message : "State failed.";
      if (isUniverseBusy(err)) {
        return c.json(
          { error: message, account: publicAccount(account), view: null, code: "busy" },
          503,
        );
      }
      console.error("[starhold-api]", err);
      reportServerError(err);
      return c.json(
        { error: message, account: publicAccount(account), view: null },
        500,
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
      }, { catalog: true });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Join failed." },
        400,
      );
    }
  });
}
