import type { PlayerView } from "@starhold/game";
import {
  awayRecapCounts,
  awayRecapIsEmpty,
  readBrowserLastVisit,
} from "../away-recap";
import { fmt } from "./format";
import { escapeAttr } from "./render-escape";
import { hrefForPage } from "./router";

function line(n: number, one: string, many: string): string | null {
  if (n <= 0) return null;
  return n === 1 ? `1 ${one}` : `${fmt(n)} ${many}`;
}

/** Empty when nothing happened since the device's last visit. */
export function awayRecapHtml(view: PlayerView): string {
  const counts = awayRecapCounts(view, readBrowserLastVisit(view.player.id));
  if (awayRecapIsEmpty(counts)) return "";
  const parts: string[] = [];
  const fleets = line(counts.fleetReturns, "fleet returned", "fleets returned");
  if (fleets) {
    parts.push(`<span data-testid="away-recap-fleets">${fleets}</span>`);
  }
  const raids = line(counts.raids, "raid", "raids");
  if (raids) {
    parts.push(`<span data-testid="away-recap-raids">${raids}</span>`);
  }
  const minis = line(counts.minis, "mini planet nearby", "mini planets nearby");
  if (minis) {
    parts.push(`<span data-testid="away-recap-minis">${minis}</span>`);
  }
  const unread = line(counts.unreadReports, "unread report", "unread reports");
  if (unread) {
    const href = hrefForPage("messages", {
      playerId: view.player.id,
      planetId: view.planet?.id,
    });
    parts.push(
      `<a href="${escapeAttr(href)}" data-nav="messages" data-testid="away-recap-unread">${unread}</a>`,
    );
  }
  return `<aside class="away-recap" data-testid="away-recap" role="status">
      <div class="away-recap-copy">
        <p class="away-recap-title">While you were away</p>
        <p class="away-recap-line">${parts.join(" · ")}</p>
      </div>
      <button type="button" class="ghost" data-away-recap-dismiss data-testid="away-recap-dismiss">Dismiss</button>
    </aside>`;
}
