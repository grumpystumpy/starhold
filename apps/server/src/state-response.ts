import { createHash } from "node:crypto";
import type { PlayerView, Resources } from "@starhold/game";
import type { Context } from "hono";

/**
 * Structural fingerprint of a player view. Resource stocks and the clock
 * move on every read; they are not part of the fingerprint, so a quiet
 * empire can answer with a few dozen bytes instead of the full view.
 */
export function stateRevision(view: PlayerView): string {
  const { now: _now, planet, ...rest } = view;
  const { resources: _resources, lastTickAt: _lastTickAt, ...planetRest } =
    planet;
  const body = JSON.stringify({ ...rest, planet: planetRest });
  return createHash("sha1").update(body).digest("base64url").slice(0, 22);
}

function quotedToken(value: string): string {
  return value.trim().replace(/^W\//, "").replace(/^"/, "").replace(/"$/, "");
}

export function ifNoneMatchHits(
  header: string | undefined,
  revision: string,
): boolean {
  if (!header) return false;
  return header.split(",").some((part) => quotedToken(part) === revision);
}

export interface UnchangedState {
  unchanged: true;
  now: number;
  resources: Resources;
}

/**
 * Full view, or a tiny clock+stock body when the caller's ETag still matches.
 * Catalogs are static for a deploy; a client that already has them sends
 * `X-Starhold-Have-Catalogs: 1` and we leave them off the wire.
 */
export function respondWithPlayerView(c: Context, view: PlayerView): Response {
  const revision = stateRevision(view);
  c.header("ETag", `"${revision}"`);
  if (ifNoneMatchHits(c.req.header("If-None-Match"), revision)) {
    const body: UnchangedState = {
      unchanged: true,
      now: view.now,
      resources: view.planet.resources,
    };
    return c.json(body);
  }
  if (c.req.header("X-Starhold-Have-Catalogs") === "1") {
    const { officerCatalog: _officers, skillCatalog: _skills, ...rest } = view;
    return c.json({ ...rest, catalogsOmitted: true });
  }
  return c.json(view);
}
