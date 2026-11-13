import type { PlayerView } from "@starhold/game";
import { session } from "../session";
import type { NavPage } from "./nav";
import type { FleetDraft } from "./render-fleets";
import { pageHtml } from "./render-pages";
import { creditsPageHtml } from "./render-credits";
import { securityPageHtml } from "./render-security";
import { enrichResourceTitles, shellHtml } from "./render-shell";

export function mainColumnHtml(
  view: PlayerView,
  busy: boolean,
  fleetDraft: FleetDraft | null,
  activePage: NavPage,
): string {
  const menu = session.accountMenu;
  switch (menu) {
    case "security":
      return securityPageHtml(session.security, session.recoveryCodes, busy);
    case "credits":
      return creditsPageHtml();
    case null:
      return pageHtml(activePage, view, busy, fleetDraft, {
        directory: session.alliancePageDirectory,
        requestAllianceId: session.allianceRequestId,
      });
    default: {
      const exhaustive: never = menu;
      return exhaustive;
    }
  }
}

export function dashboardHtml(
  view: PlayerView,
  state: { error: string | null; notice: string | null; busy: boolean },
  fleetDraft: FleetDraft | null,
  activePage: NavPage,
): string {
  const main = mainColumnHtml(view, state.busy, fleetDraft, activePage);
  return enrichResourceTitles(view, shellHtml(view, state, activePage, main));
}
