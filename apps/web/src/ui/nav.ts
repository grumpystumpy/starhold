/** Classic OGame-style left-nav destinations. */
export const NAV_PAGES = [
  "overview",
  "resources",
  "facilities",
  "research",
  "shipyard",
  "defense",
  "fleet",
  "galaxy",
  "officers",
  "skills",
  "highscore",
  "messages",
] as const;

export type NavPage = (typeof NAV_PAGES)[number];

export const NAV_LABELS: Record<NavPage, string> = {
  overview: "Overview",
  resources: "Resources",
  facilities: "Facilities",
  research: "Research",
  shipyard: "Shipyard",
  defense: "Defense",
  fleet: "Fleet",
  galaxy: "Galaxy",
  officers: "Officers",
  skills: "Skills",
  highscore: "Highscore",
  messages: "Messages",
};

export function isNavPage(value: string | null | undefined): value is NavPage {
  return (
    typeof value === "string" &&
    (NAV_PAGES as readonly string[]).includes(value)
  );
}
