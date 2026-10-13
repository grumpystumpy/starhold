# Accounts & real multiplayer sessions

**Lane:** engine / persistence (b)  
**Status:** v1 implementation  
**Live:** https://starhold-two.vercel.app  
**Related:** [vision.md](../vision.md), [vercel-deploy.md](../vercel-deploy.md)

## Goal

Friends share **one** Upstash-backed universe. Closing a tab must not wipe progress. Anonymous `playerId` (localStorage) can be **claimed** by a logged-in email account.

## Auth (v1)

**Magic link** via [Resend](https://resend.com) free tier (no paid plan / no credit card assumed).

1. `POST /api/auth/request-link` `{ email, claimPlayerId? }` → email with one-time link (15 min).
2. `GET /api/auth/verify?token=…` → create/load account, set **HttpOnly** session cookie, optional claim, redirect to app.
3. `GET /api/auth/me` → `{ account, view? }` from cookie.
4. `POST /api/auth/claim` `{ playerId }` → bind anonymous player to account (once).
5. `POST /api/auth/logout` → revoke session + clear cookie.

Local / CI without `RESEND_API_KEY`: response includes `devMagicUrl` (also logged). No email send.

## Session cookie

| Property | Value |
|----------|--------|
| Name | `starhold_session` |
| Flags | `HttpOnly`, `SameSite=Lax`, `Secure` when HTTPS, `Path=/` |
| Lifetime | 30 days |
| Storage | Opaque id → KV `starhold:session:{id}` |

Closing the tab keeps the cookie; progress resumes via `/api/auth/me` (not localStorage alone).

## KV keys (alongside universe blob)

| Key | Value |
|-----|--------|
| `starhold:account:{accountId}` | `{ id, email, playerId, createdAt, lastLoginAt }` |
| `starhold:email:{normalizedEmail}` | `accountId` |
| `starhold:session:{sessionId}` | `{ id, accountId, createdAt, expiresAt }` |
| `starhold:magic:{sha256(token)}` | `{ email, expiresAt, claimPlayerId? }` |

Universe players stay in `STARHOLD_UNIVERSE_KEY`. `PlayerState.accountId` links a commander to an account after claim / authenticated join.

## Anonymous → claim

1. Guest joins as today (`POST /api/join` + `localStorage starhold.playerId`).
2. Guest requests magic link with optional `claimPlayerId`.
3. After verify (or later `POST /api/auth/claim`): if player has no `accountId` and account has no other player → bind both ways.

If the account already owns a different player → **409** (keep both; user continues as the account’s player).

## Shared universe

Unchanged: one document, galaxy roster, raids, highscores. Alliance tags remain the existing stub (`null` until an alliances thread). Authenticated and anonymous commanders coexist in the same map.

## Env (Micah / Vercel)

| Name | Required | Notes |
|------|----------|--------|
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | yes (prod) | Already on project |
| `RESEND_API_KEY` | for real email | Free Resend → API key |
| `RESEND_FROM` | optional | Default `Starhold <onboarding@resend.dev>` (Resend test sender) |
| `SESSION_SECRET` | recommended | ≥32 random chars (HMAC pepper for token hashes) |
| `APP_URL` | recommended | `https://starhold-two.vercel.app` (magic-link base) |

See [vercel-deploy.md](../vercel-deploy.md) for exact Micah steps.

## Non-goals (v1)

- Passwords / OAuth
- Multi-universe / server picker
- Full alliance CRUD
- Forcing login (anonymous join remains for smoke / playtests)
