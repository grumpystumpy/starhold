import {
  PLAYER_TRADE_FEE_PERCENT,
  PLAYER_TRADE_MIN_AMOUNT,
  type PlayerTradeList,
  type PlayerView,
} from "@starhold/game";
import { fmt } from "./format";
import {
  marketBook,
  marketDraft,
  type MarketDraft,
} from "./market-panel";
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

function marketNet(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.floor((amount * (100 - PLAYER_TRADE_FEE_PERCENT)) / 100);
}

function marketSpan(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 72) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

export function describeMarketPost(
  view: PlayerView,
  book: PlayerTradeList | null,
  draft: MarketDraft,
  busy: boolean,
): { reason: string | null; preview: string } {
  const buyerNet = marketNet(draft.offerAmount);
  const sellerNet = marketNet(draft.requestAmount);
  const preview = `Buyer receives ${fmt(buyerNet)} ${draft.offerResource}. You receive ${fmt(sellerNet)} ${draft.requestResource}.`;
  if (busy) return { reason: "Busy.", preview };
  if (!book || book.callerPlayerId !== view.player.id) {
    return { reason: "Loading the market…", preview };
  }
  if (book.newbie) return { reason: "Newbie protection blocks market trades.", preview };
  if (book.openOwn >= book.maxOpenPerPlayer) {
    return {
      reason: `You already have ${book.maxOpenPerPlayer} open offers.`,
      preview,
    };
  }
  if (
    !Number.isInteger(draft.offerAmount) ||
    !Number.isInteger(draft.requestAmount) ||
    draft.offerAmount < PLAYER_TRADE_MIN_AMOUNT ||
    draft.requestAmount < PLAYER_TRADE_MIN_AMOUNT
  ) {
    return {
      reason: `Amounts must be integers of at least ${fmt(PLAYER_TRADE_MIN_AMOUNT)}.`,
      preview,
    };
  }
  if (draft.offerResource === draft.requestResource) {
    return { reason: "Offer and request must be different resources.", preview };
  }
  if (buyerNet < 1 || sellerNet < 1) {
    return { reason: "That trade would deliver nothing after the fee.", preview };
  }
  const stock = view.planet.resources[draft.offerResource] ?? 0;
  if (stock < draft.offerAmount) {
    return { reason: `Not enough ${draft.offerResource} on this planet.`, preview };
  }
  return { reason: null, preview };
}

function marketPanel(view: PlayerView, busy: boolean): string {
  const book = marketBook();
  const live = book && book.callerPlayerId === view.player.id ? book : null;
  const draft = marketDraft();
  const post = describeMarketPost(view, live, draft, busy);
  const postReason = post.reason;
  const offers = (live?.offers ?? [])
    .map((offer) => {
      const acceptReason = offer.acceptBlock;
      const cancelReason = offer.cancelBlock;
      const age = marketSpan(Math.max(0, view.now - offer.createdAt));
      const left = marketSpan(Math.max(0, offer.expiresAt - view.now));
      return `<article class="market-offer" data-testid="market-offer-${escapeAttr(offer.id)}">
        <p><strong>${escapeHtml(offer.posterName)}</strong> offers ${fmt(offer.offerAmount)} ${escapeHtml(offer.offerResource)} for ${fmt(offer.requestAmount)} ${escapeHtml(offer.requestResource)}.</p>
        <p data-testid="market-offer-when-${escapeAttr(offer.id)}">Posted ${age} ago. Expires in ${left}.</p>
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
  const selected = (resource: string, value: string) =>
    resource === value ? " selected" : "";
  return `<section class="market-panel" data-testid="market-panel">
    <h3>Player market</h3>
    <p class="market-fee-preview" data-testid="market-fee-preview">Fee is ${PLAYER_TRADE_FEE_PERCENT}% of each side, floored. This is separate from the Starshard bundle.</p>
    <form class="market-form" data-testid="market-form">
      <label>Offer
        <select data-market-field="offerResource" aria-label="Offer resource">
          <option value="metal"${selected(draft.offerResource, "metal")}>Metal</option>
          <option value="crystal"${selected(draft.offerResource, "crystal")}>Crystal</option>
          <option value="deuterium"${selected(draft.offerResource, "deuterium")}>Deuterium</option>
        </select>
      </label>
      <label>Offer amount
        <input data-market-field="offerAmount" type="number" min="${PLAYER_TRADE_MIN_AMOUNT}" step="1" value="${Number.isFinite(draft.offerAmount) ? draft.offerAmount : ""}" inputmode="numeric" />
      </label>
      <label>Request
        <select data-market-field="requestResource" aria-label="Request resource">
          <option value="metal"${selected(draft.requestResource, "metal")}>Metal</option>
          <option value="crystal"${selected(draft.requestResource, "crystal")}>Crystal</option>
          <option value="deuterium"${selected(draft.requestResource, "deuterium")}>Deuterium</option>
        </select>
      </label>
      <label>Request amount
        <input data-market-field="requestAmount" type="number" min="${PLAYER_TRADE_MIN_AMOUNT}" step="1" value="${Number.isFinite(draft.requestAmount) ? draft.requestAmount : ""}" inputmode="numeric" />
      </label>
      <p>Planet: ${escapeHtml(view.planet.name)}. Stock ${fmt(view.planet.resources.metal)} metal / ${fmt(view.planet.resources.crystal)} crystal / ${fmt(view.planet.resources.deuterium)} deuterium.</p>
      <div class="market-offer-actions">
        <button type="button" data-market-post data-testid="market-post" ${postReason ? "disabled" : ""}>Post offer</button>
        <p class="market-fee-preview" data-testid="market-post-preview">${escapeHtml(post.preview)}</p>
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
