import type { Context } from "hono";
import { SESSION_COOKIE, SESSION_TTL_SEC } from "./accounts.js";

export function readCookie(c: Context, name: string): string | null {
  const header = c.req.header("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function readSessionId(c: Context): string | null {
  return readCookie(c, SESSION_COOKIE);
}

function isSecureRequest(c: Context): boolean {
  if (process.env.VERCEL === "1") return true;
  const proto = c.req.header("x-forwarded-proto") ?? "";
  if (proto.split(",")[0]?.trim() === "https") return true;
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function setSessionCookie(c: Context, sessionId: string): void {
  const secure = isSecureRequest(c) ? "; Secure" : "";
  c.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${secure}`,
    { append: true },
  );
}

export function clearSessionCookie(c: Context): void {
  const secure = isSecureRequest(c) ? "; Secure" : "";
  c.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    { append: true },
  );
}
