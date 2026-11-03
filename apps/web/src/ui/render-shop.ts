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
    <p>Trade ${fmt(1500)} Starshards for ${fmt(bundle.metal)} metal, ${fmt(bundle.crystal)} crystal, and ${fmt(bundle.deuterium)} deuterium, or trade that resource bundle back for ${fmt(1500)} Starshards.</p>
    <ul class="shop-resource-balances">
      <li>Metal: ${fmt(resources.metal)} / ${fmt(storage.metal)}</li>
      <li>Crystal: ${fmt(resources.crystal)} / ${fmt(storage.crystal)}</li>
      <li>Deuterium: ${fmt(resources.deuterium)} / ${fmt(storage.deuterium)}</li>
      <li>Starshards: ${fmt(balance)}</li>
    </ul>
    <div class="shop-trade-actions">
      <button type="button" data-trade-resources="buy" data-testid="trade-buy-resources" ${busy || !canBuy ? "disabled" : ""}>Buy resource bundle · ${fmt(1500)} ✦</button>
      <button type="button" data-trade-resources="sell" data-testid="trade-sell-resources" ${busy || !canSell ? "disabled" : ""}>Sell resource bundle · +${fmt(1500)} ✦</button>
    </div>
  </section>`;
}

const TAB_LABELS: Record<ShopTab, string> = {
  items: "Items",
  resources: "Resources",
  officers: "Officers",
  skills: "Skills",
};

function itemsPanel(view: PlayerView, busy: boolean): string {
  const catalog = view.shopCatalog ?? {};
  const balance = view.starshards ?? 0;
  const activeBuffs = view.activeItemBuffs ?? [];
  const items = Object.values(catalog);

  const categories = [
    { title: "Planet Fields", cat: "fields_planet" },
    { title: "Moon Fields", cat: "fields_moon" },
    { title: "Hull", cat: "buff_hull" },
    { title: "Armor", cat: "buff_armor" },
    { title: "Shield", cat: "buff_shield" },
    { title: "Fleet Slots", cat: "fleet_slots" },
  ];

  let html = `<section class="shop-items-panel" data-testid="shop-items">
    <h3>Shop Items</h3>
    <p>Starshards: <strong>${fmt(balance)} ✦</strong></p>`;

  for (const group of categories) {
    const groupItems = items.filter((i) => i.category === group.cat);
    if (groupItems.length === 0) continue;

    const orderedItems = [...groupItems].sort(
      (a, b) => ["S", "M", "L"].indexOf(a.tier) - ["S", "M", "L"].indexOf(b.tier),
    );
    const selectedItem = orderedItems[0]!;
    const activeBuff = activeBuffs.find((b) => b.category === group.cat);
    const isBuffActive = Boolean(activeBuff);
    const targetRequired = group.cat === "fields_planet" || group.cat === "fields_moon";
    const selectedIsMoon = view.planet.kind === "moon";
    const targetValid = group.cat === "fields_planet"
      ? !selectedIsMoon
      : group.cat === "fields_moon"
        ? selectedIsMoon
        : true;
    const targetReason = !targetRequired
      ? ""
      : targetValid
        ? ""
        : group.cat === "fields_moon"
          ? "Select a moon to buy moon field expansions."
          : "Select a planet to buy planet field expansions.";
    const targetSelector = targetRequired
      ? `<select class="shop-item-target" data-item-target="${escapeAttr(selectedItem.id)}" disabled>${targetValid
          ? `<option value="${escapeAttr(view.planet.id)}" selected>${escapeHtml(view.planet.name)} (${view.planet.coords.galaxy}:${view.planet.coords.system}:${view.planet.coords.slot})</option>`
          : `<option value="" selected>${escapeHtml(view.planet.name)} — unavailable</option>`}</select>
        ${targetReason ? `<span class="shop-item-target-reason">${escapeHtml(targetReason)}</span>` : ""}`
      : "";
    const bonusUnit = group.cat.startsWith("buff_")
      ? "%"
      : group.cat === "fleet_slots"
        ? " fleet slots"
        : " fields";
    const options = orderedItems
      .map((item) =>
        `<option value="${escapeAttr(item.id)}" data-price="${item.starshards}" data-name="${escapeAttr(item.name)}" data-description="${escapeAttr(item.description)}" data-bonus="${escapeAttr(`+${item.bonus}${bonusUnit}`)}">${escapeHtml(item.tier)} — ${escapeHtml(item.name)}</option>`,
      )
      .join("");
    const initialDisabled =
      busy ||
      balance < selectedItem.starshards ||
      isBuffActive ||
      !targetValid;
    const activeBadge = activeBuff
      ? `<span class="shop-buff-active">Active (${fmt(Math.ceil(activeBuff.remainingMs / (60 * 1000)))}m left)</span>`
      : "";

    html += `<div class="shop-item-group">
      <h4>${escapeHtml(group.title)}</h4>
      <ul class="shop-item-list">
        <li class="shop-item-card" data-testid="shop-item-${escapeAttr(selectedItem.id)}" data-balance="${balance}" data-busy="${busy}" data-active="${isBuffActive}" data-target-valid="${targetValid}">
          <div class="shop-item-info">
            <strong data-shop-item-name>${escapeHtml(selectedItem.name)}</strong> <span class="shop-item-cost" data-shop-item-price>${fmt(selectedItem.starshards)} ✦</span>
            <p data-shop-item-bonus>Bonus: +${selectedItem.bonus}${bonusUnit}</p>
            <p data-shop-item-description>${escapeHtml(selectedItem.description)}</p>
            ${activeBadge}
          </div>
          <div class="shop-item-buy-controls">
            <select class="shop-item-tier" data-shop-item-tier aria-label="${escapeAttr(group.title)} tier" ${busy ? "disabled" : ""}>${options}</select>
            ${targetSelector}
            <button type="button" data-buy-shop-item="${escapeAttr(selectedItem.id)}" data-testid="buy-item-${escapeAttr(selectedItem.id)}" ${initialDisabled ? "disabled" : ""}>Buy · ${fmt(selectedItem.starshards)} ✦</button>
          </div>
        </li>
      </ul></div>`;
  }

  html += `</section>`;
  return html;
}

export function shopPageHtml(
  view: PlayerView,
  busy: boolean,
  tab: ShopTab =
    typeof window === "undefined"
      ? "items"
      : shopTabFromUrl(window.location.pathname, window.location.search),
): string {
  const contents =
    tab === "items"
      ? itemsPanel(view, busy)
      : tab === "resources"
        ? resourcesPanel(view, busy)
        : tab === "officers"
          ? officersPanelHtml(view, busy)
          : skillsPanelHtml(view, busy);
  const tabs = (["items", "resources", "officers", "skills"] as const)
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
