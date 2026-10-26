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
    { title: "Planet Field Items", cat: "fields_planet" },
    { title: "Moon Field Items", cat: "fields_moon" },
    { title: "24h Hull Buffs", cat: "buff_hull" },
    { title: "24h Armor Buffs", cat: "buff_armor" },
    { title: "24h Shield Buffs", cat: "buff_shield" },
    { title: "24h Fleet Slot Licenses", cat: "fleet_slots" },
  ];

  let html = `<section class="shop-items-panel" data-testid="shop-items">
    <h3>Shop Items</h3>
    <p>Starshards: <strong>${fmt(balance)} ✦</strong></p>`;

  for (const group of categories) {
    const groupItems = items.filter((i) => i.category === group.cat);
    if (groupItems.length === 0) continue;

    html += `<div class="shop-item-group">
      <h4>${escapeHtml(group.title)}</h4>
      <ul class="shop-item-list">`;

    for (const item of groupItems) {
      const canAfford = balance >= item.starshards;
      const activeBuff = activeBuffs.find((b) => b.category === item.category);
      const isBuffActive = Boolean(activeBuff);

      let targetSelector = "";
      if (item.category === "fields_planet") {
        const planets = view.ownedPlanets.filter((p) => !p.isMoon);
        const options = planets
          .map(
            (p) =>
              `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)} (${p.coords.galaxy}:${p.coords.system}:${p.coords.slot})</option>`,
          )
          .join("");
        targetSelector = `<select class="shop-item-target" data-item-target="${escapeAttr(item.id)}">${options}</select>`;
      } else if (item.category === "fields_moon") {
        const moons = view.ownedPlanets.filter((p) => p.isMoon);
        const options = moons.length > 0
          ? moons
              .map(
                (p) =>
                  `<option value="${escapeAttr(p.id)}">${escapeHtml(p.name)} (${p.coords.galaxy}:${p.coords.system}:${p.coords.slot})</option>`,
              )
              .join("")
          : `<option value="">No Moons Owned</option>`;
        targetSelector = `<select class="shop-item-target" data-item-target="${escapeAttr(item.id)}" ${moons.length === 0 ? "disabled" : ""}>${options}</select>`;
      }

      let activeBadge = "";
      if (activeBuff) {
        const remMinutes = Math.ceil(activeBuff.remainingMs / (60 * 1000));
        activeBadge = `<span class="shop-buff-active">Active (${fmt(remMinutes)}m left)</span>`;
      }

      const disabled =
        busy ||
        !canAfford ||
        isBuffActive ||
        (item.category === "fields_moon" &&
          view.ownedPlanets.filter((p) => p.isMoon).length === 0);

      html += `<li class="shop-item-card" data-testid="shop-item-${escapeAttr(item.id)}">
        <div class="shop-item-info">
          <strong>${escapeHtml(item.name)}</strong> <span class="shop-item-cost">${fmt(item.starshards)} ✦</span>
          <p>${escapeHtml(item.description)}</p>
          ${activeBadge}
        </div>
        <div class="shop-item-buy-controls">
          ${targetSelector}
          <button type="button" data-buy-shop-item="${escapeAttr(item.id)}" data-testid="buy-item-${escapeAttr(item.id)}" ${disabled ? "disabled" : ""}>Buy · ${fmt(item.starshards)} ✦</button>
        </div>
      </li>`;
    }

    html += `</ul></div>`;
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
