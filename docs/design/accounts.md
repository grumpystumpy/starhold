# Accounts & real multiplayer sessions

**Lane:** engine / persistence (b)  
**Status:** v1 implementation (email + password)  
**Live:** https://starhold-two.vercel.app  
**Repo doc:** mirrored from starhold `docs/design/accounts.md`

## Goal

Friends share **one** Upstash-backed universe. Closing a tab must not wipe progress. Anonymous `playerId` (localStorage) can be **claimed** by a logged-in email account.

## Auth (v1)

**Email + password** (no magic links, no outbound email / Resend).

1. `POST /api/auth/signup` `{ email, password, claimPlayerId? }` → create account (scrypt hash), set **HttpOnly** session cookie, optional claim.
2. `POST /api/auth/login` `{ email, password }` → verify password, set session cookie, return `{ account, view? }`.
3. `GET /api/auth/me` → `{ account, view? }` from cookie.
4. `POST /api/auth/claim` `{ playerId }` → bind anonymous player to account (once).
5. `POST /api/auth/logout` → revoke session + clear cookie.
6. `POST /api/auth/join` `{ name }` → create commander linked to session when account has no player.

Passwords: Node `crypto.scrypt` (N=16384, r=8, p=1) with per-password salt + `SESSION_SECRET` pepper. Rate limits (KV or memory): 10 signup/login attempts per email+IP per 15 minutes.

### Workers imported accounts

Vercel hashes cannot be checked on Workers (the pepper is unrecoverable). Import sets `needsPasswordReset` and drops the hash. The player sets a new PBKDF2 password:

1. `POST /api/auth/claim-code` `{ email }` → same response whether or not the email exists. When `CLAIM_MAIL_URL` is set, a matching reset account is emailed an 8-character code (30 minutes, single use). When it is unset, no code is minted; Micah hands out `claim-codes.txt` from the import script.
2. `POST /api/auth/claim-password` `{ email, code, password }` → verify the hashed code, store PBKDF2, clear the flag, set the session cookie.

Codes live at `starhold:claim-code:{accountId}` as `{ accountId, codeHash, expiresAt }`. Rate limit: 10 claim attempts per email+IP per 15 minutes. Workers `SESSION_SECRET` is a new value. Vercel sessions are not imported.

## Session cookie

| Property | Value |
|----------|--------|
| Name | `starhold_session` |
| Flags | `HttpOnly`, `SameSite=Lax`, `Secure` when HTTPS, `Path=/` |
| Lifetime | 30 days |
| Storage | Opaque id → KV `starhold:session:{id}` |

Closing the tab keeps the cookie; progress resumes via `/api/auth/me` (not localStorage alone).

## KV keys

| Key | Value |
|-----|--------|
| `starhold:account:{id}` | `{ id, email, passwordHash, playerId, createdAt, lastLoginAt }` |
| `starhold:email:{email}` | account id |
| `starhold:session:{id}` | `{ id, accountId, createdAt, expiresAt }` |
| `starhold:ratelimit:auth:{bucket}` | `{ count, expiresAt }` |

Universe players stay in `STARHOLD_UNIVERSE_KEY`. `PlayerState.accountId` links a commander to an account after claim / authenticated join.

## Claim flow

1. Guest joins → `playerId` in localStorage.
2. Sign up may send `claimPlayerId`, or use **Claim guest save** after sign-in.
3. If player has no `accountId` and account has no other player → bind both ways.

## Env (Micah)

| Name | Required | Notes |
|------|----------|--------|
| `KV_REST_API_*` | yes (prod) | Already on project |
| `SESSION_SECRET` | **required on Vercel** | ≥32 random chars (`openssl rand -base64 32`). Signup/login return 503 without it in production. |
| `APP_URL` | optional | `https://starhold-two.vercel.app` |

**Remove** any `RESEND_API_KEY` / `RESEND_FROM` — unused.

Full Micah steps: starhold `docs/vercel-deploy.md`.
