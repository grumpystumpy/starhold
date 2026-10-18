import {
  NAV_PAGES,
  pageFromPath,
  pathForPage,
  type NavPage,
} from "./nav";
import { schedulePaint, session } from "../session";

export type DeepLinkQuery = {
  playerId?: string | null;
  planetId?: string | null;
};

export type SessionUrlOpts = DeepLinkQuery & {
  /** Push a new history entry (default) vs replace current. */
  replace?: boolean;
  /** Override page; defaults to session.activePage. */
  page?: NavPage;
};

/** Read the active page from the current URL. */
export function pageFromLocation(
  loc: Pick<Location, "pathname"> = window.location,
): NavPage {
  return pageFromPath(loc.pathname);
}

/** Build a path + query for a nav destination. */
export function hrefForPage(
  page: NavPage,
  query: DeepLinkQuery = {},
): string {
  const url = new URL(pathForPage(page), "http://starhold.local");
  if (query.playerId) url.searchParams.set("playerId", query.playerId);
  if (query.planetId) url.searchParams.set("planet", query.planetId);
  return `${url.pathname}${url.search}`;
}

export function deepLinkFromSession(): DeepLinkQuery {
  return {
    playerId: session.view?.player.id ?? null,
    planetId: session.view?.planet.id ?? null,
  };
}

/**
 * Keep pathname + `playerId` / `planet` query in sync with session.
 * Drops `commander` (join bootstrap only).
 */
export function syncSessionUrl(opts: SessionUrlOpts = {}): void {
  if (typeof window === "undefined") return;
  const page = opts.page ?? session.activePage;
  session.activePage = page;

  const url = new URL(window.location.href);
  url.pathname = pathForPage(page);
  url.searchParams.delete("commander");

  const playerId =
    opts.playerId !== undefined
      ? opts.playerId
      : (session.view?.player.id ?? null);
  if (playerId) url.searchParams.set("playerId", playerId);
  else url.searchParams.delete("playerId");

  const planetId =
    opts.planetId !== undefined
      ? opts.planetId
      : (session.view?.planet.id ?? null);
  if (planetId) url.searchParams.set("planet", planetId);
  else url.searchParams.delete("planet");

  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current || opts.replace) {
    window.history.replaceState({ page }, "", next);
    return;
  }
  window.history.pushState({ page }, "", next);
}

/** Navigate to a page (History API) and repaint. */
export function navigateTo(
  page: NavPage,
  opts: { replace?: boolean } = {},
): void {
  if (session.activePage === page) {
    syncSessionUrl({ replace: true, page });
    return;
  }
  session.activePage = page;
  syncSessionUrl({ replace: opts.replace, page });
  schedulePaint();
}

let popBound = false;

/** Bind once: back/forward restores the routed page. */
export function ensurePopstateHandler(): void {
  if (popBound || typeof window === "undefined") return;
  popBound = true;
  window.addEventListener("popstate", () => {
    const page = pageFromLocation();
    if (session.activePage !== page) {
      session.activePage = page;
      schedulePaint();
    }
  });
}

export function navHrefMap(query: DeepLinkQuery): Record<NavPage, string> {
  const out = {} as Record<NavPage, string>;
  for (const page of NAV_PAGES) {
    out[page] = hrefForPage(page, query);
  }
  return out;
}
