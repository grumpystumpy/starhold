import type { PlayerView } from "@starhold/game";
import { fmt } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";
import {
  officersPanelHtml,
  skillsPanelHtml,
} from "./render-officers-skills";
import { shopTabFromUrl, type ShopTab } from "./nav";

function resourcesPanel(view: PlayerView, busy: boolean): string {
  const balance = view.starshards ?? 0;
  const resources = view.planet.resources;
  const storage = view.economy.storage;
  const bundle = { metal: 3000, crystal: 2000, deuterium: 1000 };
  const canBuy =
    balance >= 1500 &&
    resources.metal + bundle.metal <= storage.metal &&
    resources.crystal + bundle.crystal <= storage.crystal &&
    resources.deuterium + bundle.deuterium <= storage.deuterium;
  const canSell =
    resources.metal >= bundle.metal &&
    resources.crystal >= bundle.crystal &&
    resources.deuterium >= bundle.deuterium;

  return `<section class="shop-resource-trade" data-testid="shop-resources">
    <h3>Resources</h3>
    <p>Trade 1,500 Starshards for 3,000 metal, 2,000 crystal, and 1,000 deuterium, or trade that resource bundle back for 1,500 Starshards.</p>
    <ul class="shop-resource-balances">
      <li>Metal: ${fmt(resources.metal)} / ${fmt(storage.metal)}</li>
      <li>Crystal: ${fmt(resources.crystal)} / ${fmt(storage.crystal)}</li>
      <li>Deuterium: ${fmt(resources.deuterium)} / ${fmt(storage.deuterium)}</li>
      <li>Starshards: ${fmt(balance)}</li>
    </ul>
    <div class="shop-trade-actions">
      <button type="button" data-trade-resources="buy" data-testid="trade-buy-resources" ${busy || !canBuy ? "disabled" : ""}>Buy resource bundle · 1,500 ✦</button>
      <button type="button" data-trade-resources="sell" data-testid="trade-sell-resources" ${busy || !canSell ? "disabled" : ""}>Sell resource bundle · +1,500 ✦</button>
    </div>
  </section>`;
}

const TAB_LABELS: Record<ShopTab, string> = {
  resources: "Resources",
  officers: "Officers",
  skills: "Skills",
};

export function shopPageHtml(
  view: PlayerView,
  busy: boolean,
  tab: ShopTab =
    typeof window === "undefined"
      ? "resources"
      : shopTabFromUrl(window.location.pathname, window.location.search),
): string {
  const contents =
    tab === "resources"
      ? resourcesPanel(view, busy)
      : tab === "officers"
        ? officersPanelHtml(view, busy)
        : skillsPanelHtml(view, busy);
  const tabs = (["resources", "officers", "skills"] as const)
    .map(
      (id) =>
        `<button type="button" role="tab" aria-selected="${id === tab}" aria-controls="shop-tab-panel" class="shop-tab${id === tab ? " is-active" : ""}" data-shop-tab="${id}" data-testid="shop-tab-${id}">${escapeHtml(TAB_LABELS[id])}</button>`,
    )
    .join("");
  return `<section class="panel shop-panel" data-testid="shop-panel">
    <h2>Shop</h2>
    <div class="shop-tabs" data-testid="shop-tabs" role="tablist" aria-label="Shop">
      ${tabs}
    </div>
    <div id="shop-tab-panel" data-testid="${tab === "resources" ? "page-shop-resources" : `page-${tab}`}" role="tabpanel" aria-label="${escapeAttr(TAB_LABELS[tab])}">
      ${contents}
    </div>
  </section>`;
}
