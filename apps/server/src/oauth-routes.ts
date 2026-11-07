import type { Context, Hono } from "hono";
import {
  appBaseUrl,
  checkAuthRateLimit,
  clientIp,
  createSession,
  getSession,
  isValidEmail,
  normalizeEmail,
  requireSessionSecret,
} from "./accounts.js";
import { readSessionId, setSessionCookie } from "./cookies.js";
import {
  authorizeUrl,
  beginOAuthState,
  configuredProviders,
  consumeOAuthState,
  fetchOAuthProfile,
  isOAuthProvider,
  mockAllowed,
  oauthRedirectUri,
  providerConfigured,
  resolveOAuthLogin,
  unlinkOAuthProvider,
  type OAuthProfile,
  type OAuthProviderId,
} from "./oauth.js";

function providerNotConfigured(c: Context) {
  return c.json({ error: "provider not configured" }, 404);
}

async function signedInAccountId(c: Context): Promise<string | null> {
  const sessionId = readSessionId(c);
  if (!sessionId) return null;
  const session = await getSession(sessionId);
  return session?.accountId ?? null;
}

async function limited(c: Context, bucket: string): Promise<Response | null> {
  const rate = await checkAuthRateLimit("login", bucket, clientIp(c.req.raw.headers));
  if (!rate.limited) return null;
  return c.json(
    { error: `Too many login attempts. Try again in ${rate.retryAfterSec}s.` },
    429,
  );
}

export function mountOAuthRoutes(app: Hono): void {
  app.get("/api/auth/providers", (c) => {
    return c.json({ providers: configuredProviders(), passwordAuth: true });
  });

  app.get("/api/auth/oauth/:provider/start", async (c) => {
    const provider = c.req.param("provider");
    if (!providerConfigured(provider)) return providerNotConfigured(c);
    const secretErr = requireSessionSecret();
    if (secretErr) return c.json({ error: secretErr }, 503);

    const blocked = await limited(c, `oauth:${provider}`);
    if (blocked) return blocked;

    let email: string | undefined;
    let sub: string | undefined;
    if (provider === "mock") {
      const rawEmail = c.req.query("email")?.trim() ?? "";
      const rawSub = c.req.query("sub")?.trim() ?? "";
      email = rawEmail ? normalizeEmail(rawEmail) : `mock_${Date.now().toString(36)}@starhold.test`;
      sub = rawSub || `mock_${Date.now().toString(36)}`;
      if (!isValidEmail(email)) {
        return c.json({ error: "A verified email is required." }, 400);
      }
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(sub)) {
        return c.json({ error: "OAuth subject is invalid." }, 400);
      }
    }

    const accountId = await signedInAccountId(c);
    const begun = await beginOAuthState({
      provider,
      accountId,
      email,
      sub,
    });
    const base = appBaseUrl(c.req.url);
    if (provider === "mock") {
      const url = new URL(`${base}/api/auth/oauth/mock/authorize`);
      url.searchParams.set("state", begun.state);
      if (email) url.searchParams.set("email", email);
      if (sub) url.searchParams.set("sub", sub);
      return c.redirect(url.toString(), 302);
    }
    return c.redirect(
      authorizeUrl({
        provider,
        redirectUri: oauthRedirectUri(base, provider),
        state: begun.state,
        challenge: begun.challenge,
      }),
      302,
    );
  });

  app.get("/api/auth/oauth/mock/authorize", (c) => {
    if (!mockAllowed()) return providerNotConfigured(c);
    const state = c.req.query("state") ?? "";
    if (!state) return c.json({ error: "OAuth state expired or already used." }, 400);
    const base = appBaseUrl(c.req.url);
    const url = new URL(oauthRedirectUri(base, "mock"));
    url.searchParams.set("code", "mock");
    url.searchParams.set("state", state);
    return c.redirect(url.toString(), 302);
  });

  app.get("/api/auth/oauth/:provider/callback", async (c) => {
    const provider = c.req.param("provider");
    if (!providerConfigured(provider)) return providerNotConfigured(c);
    const secretErr = requireSessionSecret();
    if (secretErr) return c.json({ error: secretErr }, 503);
    const blocked = await limited(c, `oauth:${provider}`);
    if (blocked) return blocked;

    const state = await consumeOAuthState(c.req.query("state") ?? "");
    if (!state || state.provider !== provider) {
      return c.json({ error: "OAuth state expired or already used." }, 400);
    }

    let profile: OAuthProfile;
    try {
      if (provider === "mock") {
        profile = {
          subject: state.sub ?? "",
          email: state.email ?? "",
          emailVerified: true,
        };
      } else {
        const code = c.req.query("code") ?? "";
        if (!code) return c.json({ error: "OAuth code required." }, 400);
        profile = await fetchOAuthProfile(
          provider,
          code,
          state.verifier,
          oauthRedirectUri(appBaseUrl(c.req.url), provider),
        );
      }
    } catch (err) {
      console.error("[starhold-oauth]", err);
      return c.json({ error: "OAuth provider failed." }, 502);
    }

    const resolved = await resolveOAuthLogin({
      provider,
      profile,
      signedInAccountId: state.accountId,
    });
    if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);

    const session = await createSession(resolved.account.id);
    setSessionCookie(c, session.id);
    return c.redirect(`${appBaseUrl(c.req.url)}/`, 302);
  });

  app.post("/api/auth/oauth/:provider/unlink", async (c) => {
    const provider = c.req.param("provider");
    if (!isOAuthProvider(provider)) return providerNotConfigured(c);
    const accountId = await signedInAccountId(c);
    if (!accountId) return c.json({ error: "Sign in required." }, 401);
    const result = await unlinkOAuthProvider(accountId, provider as OAuthProviderId);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true });
  });
}
