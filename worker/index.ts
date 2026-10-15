/**
 * Cloudflare Workers entry. Static files come from the assets binding.
 * Every /api request reuses the Hono app and game rules; only storage,
 * the tick budget, and the password KDF differ from Vercel.
 */
import { bindTickBudget, workersTickBudget } from "@starhold/game";
import { app } from "../apps/server/src/app.js";
import { createD1Store, type D1Like } from "../apps/server/src/d1-store.js";
import { currentScope, runWithScope } from "../apps/server/src/request-context.js";

bindTickBudget(() => currentScope()?.budget);

const STRING_VARS = [
  "SESSION_SECRET",
  "STARHOLD_UNIVERSE_NAME",
  "STARHOLD_UNIVERSE_SPEED",
  "STARHOLD_UNIVERSE_KEY",
  "STARHOLD_PASSWORD_KDF",
  "STARHOLD_RUNTIME",
  "STARHOLD_E2E",
  "ALLOW_E2E_HOOKS",
  "STARHOLD_CPU_PROFILE",
  "ALLOWED_ORIGINS",
  "APP_URL",
  "CLAIM_MAIL_URL",
] as const;

export interface WorkerEnv {
  DB: D1Like;
  ASSETS: { fetch(input: Request): Promise<Response> };
  SESSION_SECRET?: string;
  STARHOLD_UNIVERSE_NAME?: string;
  STARHOLD_UNIVERSE_SPEED?: string;
  STARHOLD_UNIVERSE_KEY?: string;
  STARHOLD_PASSWORD_KDF?: string;
  STARHOLD_RUNTIME?: string;
  STARHOLD_E2E?: string;
  ALLOW_E2E_HOOKS?: string;
  STARHOLD_CPU_PROFILE?: string;
  ALLOWED_ORIGINS?: string;
  APP_URL?: string;
  CLAIM_MAIL_URL?: string;
}

function applyEnv(env: WorkerEnv): void {
  process.env.STARHOLD_RUNTIME = "workers";
  process.env.STARHOLD_PASSWORD_KDF ??= "pbkdf2";
  for (const key of STRING_VARS) {
    const value = env[key];
    if (typeof value === "string") process.env[key] = value;
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api")) {
      return env.ASSETS.fetch(request);
    }
    if (!env.DB) {
      return Response.json(
        { error: "D1 binding DB is missing. Check wrangler.toml." },
        { status: 500 },
      );
    }
    applyEnv(env);
    const store = createD1Store(env.DB);
    return runWithScope(
      {
        kv: store,
        mode: "d1",
        method: request.method,
        budget: workersTickBudget(),
        cpuMs: 0,
      },
      () => app.fetch(request),
    );
  },
};
