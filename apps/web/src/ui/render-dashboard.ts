import type { PlayerView } from "@starhold/game";
import { session } from "../session";
import type { NavPage } from "./nav";
import type { FleetDraft } from "./render-fleets";
import { pageHtml } from "./render-pages";
import { securityPageHtml } from "./render-security";
import { enrichResourceTitles, shellHtml } from "./render-shell";

export function dashboardHtml(
  view: PlayerView,
  state: { error: string | null; notice: string | null; busy: boolean },
  fleetDraft: FleetDraft | null,
  activePage: NavPage,
): string {
  const main =
    session.accountMenu === "security"
      ? securityPageHtml(session.security, session.recoveryCodes, state.busy)
      : pageHtml(activePage, view, state.busy, fleetDraft);
  return enrichResourceTitles(view, shellHtml(view, state, activePage, main));
}
