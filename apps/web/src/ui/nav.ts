/** Classic shell destinations with real URL paths (Round 2 contract §3). */
export const NAV_PAGES = [
  "overview",
  "buildings",
  "defenses",
  "shipyard",
  "research",
  "fleet",
  "galaxy",
  "officers",
  "skills",
  "highscore",
  "alliances",
  "messages",
] as const;

export type NavPage = (typeof NAV_PAGES)[number];

export const NAV_LABELS: Record<NavPage, string> = {
  overview: "Overview",
  buildings: "Buildings",
  defenses: "Defenses",
  shipyard: "Shipyard",
  research: "Research",
  fleet: "Fleet",
  galaxy: "Galaxy",
  officers: "Officers",
  skills: "Skills",
  highscore: "Highscore",
  alliances: "Alliances",
  messages: "Messages",
};

/** Canonical path for each page (`/` also resolves to overview). */
export const NAV_PATHS: Record<NavPage, string> = {
  overview: "/overview",
  buildings: "/buildings",
  defenses: "/defenses",
  shipyard: "/shipyard",
  research: "/research",
  fleet: "/fleet",
  galaxy: "/galaxy",
  officers: "/officers",
  skills: "/skills",
  highscore: "/highscore",
  alliances: "/alliances",
  messages: "/messages",
};

/** Legacy panel ids / paths → current page (Round 1 → Round 2). */
const LEGACY_PAGE_ALIASES: Record<string, NavPage> = {
  resources: "buildings",
  facilities: "buildings",
  defense: "defenses",
};

export function isNavPage(value: string | null | undefined): value is NavPage {
  return (
    typeof value === "string" &&
    (NAV_PAGES as readonly string[]).includes(value)
  );
}

export function pathForPage(page: NavPage): string {
  return NAV_PATHS[page];
}

/**
 * Map a pathname (no query) to a nav page.
 * Accepts `/`, `/overview`, and legacy `/resources` · `/facilities` · `/defense`.
 */
export function pageFromPath(pathname: string): NavPage {
  const raw = pathname.replace(/\/+$/, "") || "/";
  if (raw === "/" || raw === "") return "overview";
  const segment = raw.startsWith("/") ? raw.slice(1) : raw;
  const first = segment.split("/")[0]?.toLowerCase() ?? "";
  if (isNavPage(first)) return first;
  const legacy = LEGACY_PAGE_ALIASES[first];
  if (legacy) return legacy;
  return "overview";
}

export function resolveNavPage(
  value: string | null | undefined,
): NavPage | null {
  if (!value) return null;
  if (isNavPage(value)) return value;
  return LEGACY_PAGE_ALIASES[value] ?? null;
}
