import { type Context, type Hono } from "hono";
import {
  claimPlayerToAccount,
  ensureUniverseShape,
  joinUniverse,
  playerForAccount,
  playerView,
} from "@starhold/game";
import {
  appBaseUrl,
  consumeMagicToken,
  createMagicLink,
  createSession,
  deleteSession,
  getAccountById,
  getSession,
  isValidEmail,
  normalizeEmail,
  setAccountPlayerId,
  upsertAccountForEmail,
} from "./accounts.js";
import {
  clearSessionCookie,
  readSessionId,
  setSessionCookie,
} from "./cookies.js";
import { resendConfigured, sendMagicLinkEmail } from "./email.js";
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

/** Mount email magic-link + session routes on the shared Hono app. */
export function mountAuthRoutes(app: Hono): void {
  app.post("/api/auth/request-link", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      email?: string;
      claimPlayerId?: string;
    };
    const email = normalizeEmail(body.email ?? "");
    if (!isValidEmail(email)) {
      return c.json({ error: "Valid email required." }, 400);
    }
    const claimPlayerId = body.claimPlayerId?.trim() || undefined;
    const { token } = await createMagicLink({ email, claimPlayerId });
    const base = appBaseUrl(c.req.url);
    const magicUrl = `${base}/api/auth/verify?token=${encodeURIComponent(token)}`;

    const send = await sendMagicLinkEmail({ to: email, magicUrl });
    if (!send.emailed) {
      console.info("[starhold-auth] magic link (dev / no Resend):", magicUrl);
    }

    return c.json({
      ok: true,
      emailed: send.emailed,
      /** Present when Resend is unset or send failed — local/CI only convenience. */
      devMagicUrl: send.emailed ? undefined : magicUrl,
      resendConfigured: resendConfigured(),
      error: send.error,
    });
  });

  app.get("/api/auth/verify", async (c) => {
    const token = c.req.query("token")?.trim() ?? "";
    const base = appBaseUrl(c.req.url);
    if (!token) {
      return c.redirect(`${base}/?auth=missing_token`);
    }
    const magic = await consumeMagicToken(token);
    if (!magic) {
      return c.redirect(`${base}/?auth=invalid_or_expired`);
    }

    const account = await upsertAccountForEmail(magic.email);
    let claimStatus = "none";

    if (magic.claimPlayerId) {
      try {
        await withUniverse((universe) => {
          ensureUniverseShape(universe);
          if (account.playerId && account.playerId !== magic.claimPlayerId) {
            claimStatus = "account_has_player";
            return;
          }
          const result = claimPlayerToAccount(
            universe,
            magic.claimPlayerId!,
            account.id,
          );
          if (result.ok) {
            claimStatus = "claimed";
          } else if (result.code === "already_claimed") {
            claimStatus = "already_claimed";
          } else {
            claimStatus = "claim_failed";
          }
        });
        if (claimStatus === "claimed") {
          await setAccountPlayerId(account.id, magic.claimPlayerId);
          account.playerId = magic.claimPlayerId;
        }
      } catch (err) {
        console.error("[starhold-auth] claim during verify", err);
        claimStatus = "claim_failed";
      }
    }

    // Resolve playerId from universe if account index is stale.
    if (!account.playerId) {
      try {
        await withUniverse((universe) => {
          const linked = playerForAccount(universe, account.id);
          if (linked) account.playerId = linked.id;
        });
        if (account.playerId) {
          await setAccountPlayerId(account.id, account.playerId);
        }
      } catch {
        /* ignore */
      }
    }

    const session = await createSession(account.id);
    setSessionCookie(c, session.id);
    const q = new URLSearchParams({ auth: "ok", claim: claimStatus });
    return c.redirect(`${base}/?${q.toString()}`);
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
          account: {
            id: account.id,
            email: account.email,
            playerId: account.playerId,
          },
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
        resendConfigured: resendConfigured(),
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
