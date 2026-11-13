import {
  PLAYER_TRADE_FEE_PERCENT,
  type PlayerTradeList,
  type PlayerView,
} from "@starhold/game";
import { fmt } from "./format";
import { marketBook } from "./market-panel";
import { escapeAttr, escapeHtml } from "./render-escape";
import {
  officersPanelHtml,
  skillsPanelHtml,
} from "./render-officers-skills";
import { SHOP_TABS, shopTabFromUrl, type ShopTab } from "./nav";

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
  market: "Market",
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

const MARKET_PREVIEW_OFFER = 10_000;
const MARKET_PREVIEW_REQUEST = 4_000;

function marketNet(amount: number): number {
  return Math.floor((amount * (100 - PLAYER_TRADE_FEE_PERCENT)) / 100);
}

function marketPostBlock(view: PlayerView, book: PlayerTradeList | null, busy: boolean): string | null {
  if (busy) return "Busy.";
  if (!book || book.callerPlayerId !== view.player.id) return "Loading the market…";
  if (book.newbie) return "Newbie protection blocks market trades.";
  if (book.openOwn >= book.maxOpenPerPlayer) {
    return `You already have ${book.maxOpenPerPlayer} open offers.`;
  }
  if (view.planet.resources.metal < MARKET_PREVIEW_OFFER) {
    return "Not enough metal on this planet.";
  }
  return null;
}

function marketPanel(view: PlayerView, busy: boolean): string {
  const book = marketBook();
  const live = book && book.callerPlayerId === view.player.id ? book : null;
  const postReason = marketPostBlock(view, live, busy);
  const offers = (live?.offers ?? [])
    .map((offer) => {
      const acceptReason = offer.acceptBlock;
      const cancelReason = offer.cancelBlock;
      return `<article class="market-offer" data-testid="market-offer-${escapeAttr(offer.id)}">
        <p><strong>${escapeHtml(offer.posterName)}</strong> offers ${fmt(offer.offerAmount)} ${escapeHtml(offer.offerResource)} for ${fmt(offer.requestAmount)} ${escapeHtml(offer.requestResource)}.</p>
        <p>Fee ${live?.feePercent ?? 10}%. Buyer receives ${fmt(offer.acceptorReceives)} ${escapeHtml(offer.offerResource)}. Seller receives ${fmt(offer.posterReceives)} ${escapeHtml(offer.requestResource)}.</p>
        <div class="market-offer-actions">
          <button type="button" data-market-accept="${escapeAttr(offer.id)}" data-testid="market-accept-${escapeAttr(offer.id)}" ${busy || acceptReason ? "disabled" : ""}>Accept</button>
          ${acceptReason ? `<span class="market-reason">${escapeHtml(acceptReason)}</span>` : ""}
          <button type="button" data-market-cancel="${escapeAttr(offer.id)}" data-testid="market-cancel-${escapeAttr(offer.id)}" ${busy || cancelReason ? "disabled" : ""}>Cancel</button>
          ${cancelReason ? `<span class="market-reason">${escapeHtml(cancelReason)}</span>` : ""}
        </div>
      </article>`;
    })
    .join("");
  return `<section class="market-panel" data-testid="market-panel">
    <h3>Player market</h3>
    <p class="market-fee-preview" data-testid="market-fee-preview">Fee is ${PLAYER_TRADE_FEE_PERCENT}% of each side, floored. A ${fmt(MARKET_PREVIEW_OFFER)} metal offer pays the buyer ${fmt(marketNet(MARKET_PREVIEW_OFFER))} metal. A ${fmt(MARKET_PREVIEW_REQUEST)} crystal request pays you ${fmt(marketNet(MARKET_PREVIEW_REQUEST))} crystal. This is separate from the Starshard bundle.</p>
    <form class="market-form" data-testid="market-form">
      <label>Offer
        <select data-market-field="offerResource" aria-label="Offer resource">
          <option value="metal" selected>Metal</option>
          <option value="crystal">Crystal</option>
          <option value="deuterium">Deuterium</option>
        </select>
      </label>
      <label>Offer amount
        <input data-market-field="offerAmount" type="number" min="1000" step="1" value="${MARKET_PREVIEW_OFFER}" inputmode="numeric" />
      </label>
      <label>Request
        <select data-market-field="requestResource" aria-label="Request resource">
          <option value="metal">Metal</option>
          <option value="crystal" selected>Crystal</option>
          <option value="deuterium">Deuterium</option>
        </select>
      </label>
      <label>Request amount
        <input data-market-field="requestAmount" type="number" min="1000" step="1" value="${MARKET_PREVIEW_REQUEST}" inputmode="numeric" />
      </label>
      <p>Planet: ${escapeHtml(view.planet.name)}. Stock ${fmt(view.planet.resources.metal)} metal / ${fmt(view.planet.resources.crystal)} crystal / ${fmt(view.planet.resources.deuterium)} deuterium.</p>
      <div class="market-offer-actions">
        <button type="button" data-market-post data-testid="market-post" ${postReason ? "disabled" : ""}>Post offer</button>
        ${postReason ? `<span class="market-reason" data-testid="market-post-reason">${escapeHtml(postReason)}</span>` : ""}
      </div>
    </form>
    <div class="market-offers" data-testid="market-offers">
      ${offers || "<p>No open offers.</p>"}
    </div>
  </section>`;
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
          : tab === "market"
            ? marketPanel(view, busy)
            : skillsPanelHtml(view, busy);
  const tabs = SHOP_TABS
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
