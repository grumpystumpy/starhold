import type { PlayerView } from "@starhold/game";
import type { NavPage } from "./nav";
import type { FleetDraft } from "./render-fleets";
import { pageHtml } from "./render-pages";
import { enrichResourceTitles, shellHtml } from "./render-shell";

export function dashboardHtml(
  view: PlayerView,
  state: { error: string | null; notice: string | null; busy: boolean },
  fleetDraft: FleetDraft | null,
  activePage: NavPage,
): string {
  const main = pageHtml(activePage, view, state.busy, fleetDraft);
  return enrichResourceTitles(view, shellHtml(view, state, activePage, main));
}
