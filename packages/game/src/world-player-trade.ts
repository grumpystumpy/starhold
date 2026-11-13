import {
  NEWBIE_PROTECTION_POINTS,
  PLAYER_TRADE_CRYSTAL_WEIGHT,
  PLAYER_TRADE_DAILY_ACCEPT_VALUE_CAP,
  PLAYER_TRADE_DEUTERIUM_WEIGHT,
  PLAYER_TRADE_EXPIRE_MS,
  PLAYER_TRADE_FEE_PERCENT,
  PLAYER_TRADE_MAX_OPEN_PER_PLAYER,
  PLAYER_TRADE_MAX_OPEN_TOTAL,
  PLAYER_TRADE_METAL_WEIGHT,
  PLAYER_TRADE_MIN_AMOUNT,
} from "./data/tuning.js";
import { clampToStorage, empirePoints } from "./formulas-travel.js";
import type {
  PlayerState,
  PlayerTradeOffer,
  PlanetState,
  TradeResource,
  UniverseState,
} from "./types.js";
import { storageForPlanet, utcDayKey } from "./world-boosts.js";

export type PlayerTradeResult =
  | {
      ok: true;
      offerId?: string;
      refunded?: number;
      lost?: number;
      note?: string;
    }
  | { ok: false; error: string };

export interface PlayerTradeOfferView {
  id: string;
  posterPlayerId: string;
  posterName: string;
  planetId: string;
  offerResource: TradeResource;
  offerAmount: number;
  requestResource: TradeResource;
  requestAmount: number;
  createdAt: number;
  expiresAt: number;
  acceptorReceives: number;
  posterReceives: number;
  own: boolean;
  acceptBlock: string | null;
  cancelBlock: string | null;
}

export interface PlayerTradeList {
  callerPlayerId: string;
  feePercent: number;
  minAmount: number;
  maxOpenPerPlayer: number;
  dailyCap: number;
  dailyUsed: number;
  newbie: boolean;
  openOwn: number;
  offers: PlayerTradeOfferView[];
  note?: string;
}

const TRADE_RESOURCES: readonly TradeResource[] = ["metal", "crystal", "deuterium"];

export function playerTradeNetAmount(amount: number): number {
  return Math.floor((amount * (100 - PLAYER_TRADE_FEE_PERCENT)) / 100);
}

export function playerTradeMetalValue(resource: TradeResource, amount: number): number {
  const weight =
    resource === "metal"
      ? PLAYER_TRADE_METAL_WEIGHT
      : resource === "crystal"
        ? PLAYER_TRADE_CRYSTAL_WEIGHT
        : PLAYER_TRADE_DEUTERIUM_WEIGHT;
  return amount * weight;
}

function isTradeResource(value: unknown): value is TradeResource {
  return TRADE_RESOURCES.some((resource) => resource === value);
}

function book(universe: UniverseState): Record<string, PlayerTradeOffer> | null {
  return universe.playerTradeOffers ?? null;
}

function ensureBook(universe: UniverseState): Record<string, PlayerTradeOffer> {
  if (!universe.playerTradeOffers) universe.playerTradeOffers = {};
  return universe.playerTradeOffers;
}

function ownedPlanet(
  universe: UniverseState,
  player: PlayerState,
  planetId: string | undefined,
): PlanetState | { error: string } {
  if (!planetId) return { error: "planetId required." };
  if (!player.planetIds.includes(planetId)) {
    return { error: "You do not own that planet." };
  }
  const planet = universe.planets[planetId];
  if (!planet || planet.ownerPlayerId !== player.id) {
    return { error: "Planet missing." };
  }
  return planet;
}

function isNewbie(universe: UniverseState, player: PlayerState): boolean {
  return empirePoints(universe, player) < NEWBIE_PROTECTION_POINTS;
}

function acceptUsed(player: PlayerState, now: number): number {
  if (player.tradeAcceptDay !== utcDayKey(now)) return 0;
  return player.tradeAcceptValue ?? 0;
}

function addAcceptUsed(player: PlayerState, now: number, value: number): void {
  const day = utcDayKey(now);
  if (player.tradeAcceptDay !== day) {
    player.tradeAcceptDay = day;
    player.tradeAcceptValue = 0;
  }
  player.tradeAcceptValue = (player.tradeAcceptValue ?? 0) + value;
}

/** True when the poster's planet (or home, if the source cannot take the refund) is loaded. */
function refundTarget(
  universe: UniverseState,
  offer: PlayerTradeOffer,
): PlanetState | null {
  const poster = universe.players[offer.posterPlayerId];
  if (!poster) return null;
  const source = universe.planets[offer.planetId];
  if (source && source.ownerPlayerId === poster.id) {
    const caps = storageForPlanet(universe, source, offer.createdAt);
    const room = caps[offer.offerResource] - source.resources[offer.offerResource];
    if (room >= offer.offerAmount) return source;
  }
  const home = universe.planets[poster.homePlanetId];
  if (!home || home.ownerPlayerId !== poster.id) return null;
  return home;
}

function payRefund(
  universe: UniverseState,
  offer: PlayerTradeOffer,
  now: number,
): { refunded: number; lost: number; note?: string } {
  const poster = universe.players[offer.posterPlayerId];
  const amount = offer.offerAmount;
  const resource = offer.offerResource;
  if (!poster) {
    return {
      refunded: 0,
      lost: amount,
      note: `${amount} ${resource} could not fit in storage.`,
    };
  }
  const source = universe.planets[offer.planetId];
  const sourceOk = Boolean(source && source.ownerPlayerId === poster.id);
  if (sourceOk && source) {
    const caps = storageForPlanet(universe, source, now);
    const room = caps[resource] - source.resources[resource];
    if (room >= amount) {
      source.resources = {
        ...source.resources,
        [resource]: source.resources[resource] + amount,
      };
      universe.planets[source.id] = source;
      return { refunded: amount, lost: 0 };
    }
  }
  const home = universe.planets[poster.homePlanetId];
  if (!home || home.ownerPlayerId !== poster.id) {
    return {
      refunded: 0,
      lost: amount,
      note: `${amount} ${resource} could not fit in storage.`,
    };
  }
  const before = home.resources[resource];
  const clamped = clampToStorage(
    { ...home.resources, [resource]: before + amount },
    storageForPlanet(universe, home, now),
  );
  const refunded = Math.max(0, clamped[resource] - before);
  const lost = amount - refunded;
  home.resources = clamped;
  universe.planets[home.id] = home;
  if (lost > 0) {
    const where = sourceOk ? "homeworld" : "storage";
    return {
      refunded,
      lost,
      note: `Refunded ${refunded} ${resource} to your ${where}. ${lost} ${resource} could not fit in storage.`,
    };
  }
  return { refunded, lost: 0 };
}

/**
 * Refund expired offers whose planets are actually loaded.
 * Skips the rest so a partial working set cannot drop escrow.
 * Scans at most the open-book cap.
 */
export function expirePlayerTradeOffers(
  universe: UniverseState,
  now = Date.now(),
  limit = PLAYER_TRADE_MAX_OPEN_TOTAL,
): number {
  const offers = book(universe);
  if (!offers) return 0;
  const due = Object.values(offers)
    .filter((offer) => offer.expiresAt <= now)
    .sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id));
  let refunded = 0;
  let scanned = 0;
  for (const offer of due) {
    if (scanned >= PLAYER_TRADE_MAX_OPEN_TOTAL) break;
    scanned += 1;
    if (refunded >= limit) break;
    if (!refundTarget(universe, offer)) continue;
    payRefund(universe, offer, now);
    delete offers[offer.id];
    refunded += 1;
  }
  return refunded;
}

function openOffers(universe: UniverseState, now: number): PlayerTradeOffer[] {
  return Object.values(book(universe) ?? {}).filter((offer) => offer.expiresAt > now);
}

export function listPlayerTradeOffers(
  universe: UniverseState,
  playerId: string,
  now = Date.now(),
  planetId?: string,
): PlayerTradeList {
  expirePlayerTradeOffers(universe, now, PLAYER_TRADE_MAX_OPEN_TOTAL);
  const player = universe.players[playerId];
  const newbie = player ? isNewbie(universe, player) : true;
  const used = player ? acceptUsed(player, now) : 0;
  const planet = player ? ownedPlanet(universe, player, planetId || player.activePlanetId) : null;
  const body = planet && !("error" in planet) ? planet : null;
  const newbieById = new Map<string, boolean>();
  const newbieOf = (id: string): boolean => {
    const cached = newbieById.get(id);
    if (cached !== undefined) return cached;
    const poster = universe.players[id];
    const value = !poster || isNewbie(universe, poster);
    newbieById.set(id, value);
    return value;
  };
  const offers = openOffers(universe, now)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .map((offer) => {
      const own = offer.posterPlayerId === playerId;
      const acceptorReceives = playerTradeNetAmount(offer.offerAmount);
      const posterReceives = playerTradeNetAmount(offer.requestAmount);
      let acceptBlock: string | null = null;
      let cancelBlock: string | null = null;
      if (own) {
        acceptBlock = "You posted this offer.";
      } else if (!player) {
        acceptBlock = "Unknown player.";
      } else if (newbie) {
        acceptBlock = "Newbie protection blocks market trades.";
      } else if (newbieOf(offer.posterPlayerId)) {
        acceptBlock = "That commander is still under newbie protection.";
      } else if (!body) {
        acceptBlock = "Select a planet you own.";
      } else if (body.resources[offer.requestResource] < offer.requestAmount) {
        acceptBlock = `Not enough ${offer.requestResource} on this planet.`;
      } else if (
        body.resources[offer.offerResource] + acceptorReceives >
        storageForPlanet(universe, body, now)[offer.offerResource]
      ) {
        acceptBlock = `Not enough ${offer.offerResource} storage on this planet.`;
      } else {
        const seller = universe.planets[offer.planetId];
        const sellerCaps = seller ? storageForPlanet(universe, seller, now) : null;
        if (
          !seller ||
          !sellerCaps ||
          seller.resources[offer.requestResource] + posterReceives >
            sellerCaps[offer.requestResource]
        ) {
          acceptBlock = "The seller does not have room for the payment.";
        } else if (
          used + playerTradeMetalValue(offer.offerResource, acceptorReceives) >
          PLAYER_TRADE_DAILY_ACCEPT_VALUE_CAP
        ) {
          acceptBlock = "Daily market accept cap reached.";
        }
      }
      if (!own) cancelBlock = "Only the poster can cancel this offer.";
      return {
        id: offer.id,
        posterPlayerId: offer.posterPlayerId,
        posterName: universe.players[offer.posterPlayerId]?.name ?? "Unknown",
        planetId: offer.planetId,
        offerResource: offer.offerResource,
        offerAmount: offer.offerAmount,
        requestResource: offer.requestResource,
        requestAmount: offer.requestAmount,
        createdAt: offer.createdAt,
        expiresAt: offer.expiresAt,
        acceptorReceives,
        posterReceives,
        own,
        acceptBlock,
        cancelBlock,
      };
    });
  return {
    callerPlayerId: playerId,
    feePercent: PLAYER_TRADE_FEE_PERCENT,
    minAmount: PLAYER_TRADE_MIN_AMOUNT,
    maxOpenPerPlayer: PLAYER_TRADE_MAX_OPEN_PER_PLAYER,
    dailyCap: PLAYER_TRADE_DAILY_ACCEPT_VALUE_CAP,
    dailyUsed: used,
    newbie,
    openOwn: offers.filter((offer) => offer.own).length,
    offers,
  };
}

export function postPlayerTradeOffer(
  universe: UniverseState,
  playerId: string,
  planetId: string | undefined,
  offerResource: unknown,
  offerAmount: unknown,
  requestResource: unknown,
  requestAmount: unknown,
  now = Date.now(),
): PlayerTradeResult {
  expirePlayerTradeOffers(universe, now, PLAYER_TRADE_MAX_OPEN_TOTAL);
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const planet = ownedPlanet(universe, player, planetId);
  if ("error" in planet) return { ok: false, error: planet.error };
  if (!isTradeResource(offerResource) || !isTradeResource(requestResource)) {
    return { ok: false, error: "Resource must be metal, crystal, or deuterium." };
  }
  if (offerResource === requestResource) {
    return { ok: false, error: "Offer and request must be different resources." };
  }
  if (
    typeof offerAmount !== "number" ||
    typeof requestAmount !== "number" ||
    !Number.isInteger(offerAmount) ||
    !Number.isInteger(requestAmount) ||
    offerAmount <= 0 ||
    requestAmount <= 0
  ) {
    return { ok: false, error: "Amounts must be positive integers." };
  }
  if (playerTradeNetAmount(offerAmount) < 1 || playerTradeNetAmount(requestAmount) < 1) {
    return { ok: false, error: "That trade would deliver nothing after the fee." };
  }
  if (offerAmount < PLAYER_TRADE_MIN_AMOUNT || requestAmount < PLAYER_TRADE_MIN_AMOUNT) {
    return { ok: false, error: `Minimum trade amount is ${PLAYER_TRADE_MIN_AMOUNT}.` };
  }
  if (isNewbie(universe, player)) {
    return { ok: false, error: "Newbie protection blocks market trades." };
  }
  const live = openOffers(universe, now);
  if (live.length >= PLAYER_TRADE_MAX_OPEN_TOTAL) {
    return { ok: false, error: "The market is full." };
  }
  const own = live.filter((offer) => offer.posterPlayerId === playerId).length;
  if (own >= PLAYER_TRADE_MAX_OPEN_PER_PLAYER) {
    return { ok: false, error: `You already have ${PLAYER_TRADE_MAX_OPEN_PER_PLAYER} open offers.` };
  }
  if (planet.resources[offerResource] < offerAmount) {
    return { ok: false, error: `Not enough ${offerResource} on that planet.` };
  }
  planet.resources = {
    ...planet.resources,
    [offerResource]: planet.resources[offerResource] - offerAmount,
  };
  universe.planets[planet.id] = planet;
  const offer: PlayerTradeOffer = {
    id: `trd_${now.toString(36)}_${Object.keys(book(universe) ?? {}).length.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    posterPlayerId: playerId,
    planetId: planet.id,
    offerResource,
    offerAmount,
    requestResource,
    requestAmount,
    createdAt: now,
    expiresAt: now + PLAYER_TRADE_EXPIRE_MS,
  };
  ensureBook(universe)[offer.id] = offer;
  return { ok: true, offerId: offer.id };
}

export function cancelPlayerTradeOffer(
  universe: UniverseState,
  playerId: string,
  offerId: string | undefined,
  now = Date.now(),
): PlayerTradeResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!offerId) return { ok: false, error: "offerId required." };
  const offer = book(universe)?.[offerId];
  if (!offer) {
    expirePlayerTradeOffers(universe, now, PLAYER_TRADE_MAX_OPEN_TOTAL);
    return { ok: false, error: "Offer not found." };
  }
  if (offer.posterPlayerId !== playerId) {
    return { ok: false, error: "Only the poster can cancel this offer." };
  }
  const paid = payRefund(universe, offer, now);
  delete ensureBook(universe)[offer.id];
  expirePlayerTradeOffers(universe, now, PLAYER_TRADE_MAX_OPEN_TOTAL);
  return { ok: true, offerId, refunded: paid.refunded, lost: paid.lost, note: paid.note };
}

export function acceptPlayerTradeOffer(
  universe: UniverseState,
  playerId: string,
  offerId: string | undefined,
  planetId: string | undefined,
  now = Date.now(),
): PlayerTradeResult {
  expirePlayerTradeOffers(universe, now, PLAYER_TRADE_MAX_OPEN_TOTAL);
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!offerId) return { ok: false, error: "offerId required." };
  const offer = book(universe)?.[offerId];
  if (!offer || offer.expiresAt <= now) {
    return { ok: false, error: "Offer not found." };
  }
  if (offer.posterPlayerId === playerId) {
    return { ok: false, error: "You cannot accept your own offer." };
  }
  const poster = universe.players[offer.posterPlayerId];
  if (!poster) return { ok: false, error: "That commander is gone." };
  if (isNewbie(universe, player) || isNewbie(universe, poster)) {
    return { ok: false, error: "Newbie protection blocks market trades." };
  }
  const buyerPlanet = ownedPlanet(universe, player, planetId);
  if ("error" in buyerPlanet) return { ok: false, error: buyerPlanet.error };
  const sellerPlanet = universe.planets[offer.planetId];
  if (!sellerPlanet || sellerPlanet.ownerPlayerId !== poster.id) {
    return { ok: false, error: "The seller's planet is gone." };
  }
  const offerNet = playerTradeNetAmount(offer.offerAmount);
  const requestNet = playerTradeNetAmount(offer.requestAmount);
  if (offerNet < 1 || requestNet < 1) {
    return { ok: false, error: "That trade would deliver nothing after the fee." };
  }
  if (buyerPlanet.resources[offer.requestResource] < offer.requestAmount) {
    return { ok: false, error: `Not enough ${offer.requestResource} on your planet.` };
  }
  const buyerCaps = storageForPlanet(universe, buyerPlanet, now);
  if (buyerPlanet.resources[offer.offerResource] + offerNet > buyerCaps[offer.offerResource]) {
    return { ok: false, error: `Not enough ${offer.offerResource} storage on your planet.` };
  }
  const sellerCaps = storageForPlanet(universe, sellerPlanet, now);
  if (
    sellerPlanet.resources[offer.requestResource] + requestNet >
    sellerCaps[offer.requestResource]
  ) {
    return { ok: false, error: "The seller does not have room for the payment." };
  }
  const incoming = playerTradeMetalValue(offer.offerResource, offerNet);
  if (acceptUsed(player, now) + incoming > PLAYER_TRADE_DAILY_ACCEPT_VALUE_CAP) {
    return { ok: false, error: "Daily market accept cap reached." };
  }
  buyerPlanet.resources = {
    ...buyerPlanet.resources,
    [offer.requestResource]: buyerPlanet.resources[offer.requestResource] - offer.requestAmount,
    [offer.offerResource]: buyerPlanet.resources[offer.offerResource] + offerNet,
  };
  sellerPlanet.resources = {
    ...sellerPlanet.resources,
    [offer.requestResource]: sellerPlanet.resources[offer.requestResource] + requestNet,
  };
  universe.planets[buyerPlanet.id] = buyerPlanet;
  universe.planets[sellerPlanet.id] = sellerPlanet;
  addAcceptUsed(player, now, incoming);
  universe.players[player.id] = player;
  delete ensureBook(universe)[offer.id];
  return { ok: true, offerId };
}
