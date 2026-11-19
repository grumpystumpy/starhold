import {
  RESOURCE_MERCHANT_FEE_PERCENT,
  RESOURCE_MERCHANT_VALUE,
} from "./data/tuning.js";
import type { Resources, UniverseState } from "./types.js";
import { storageForPlanet } from "./world-boosts.js";
import { advanceUniverse } from "./world-arrival.js";

export { RESOURCE_MERCHANT_FEE_PERCENT, RESOURCE_MERCHANT_VALUE };

const MERCHANT_RESOURCES = ["metal", "crystal", "deuterium"] as const;

export type MerchantResource = (typeof MERCHANT_RESOURCES)[number];

export type ResourceMerchantQuote =
  | { ok: true; gross: number; output: number; fee: number }
  | { ok: false; error: string; output: number | null };

export type ResourceMerchantTradeResult =
  | { ok: true; output: number }
  | { ok: false; error: string };

export function isMerchantResource(value: string): value is MerchantResource {
  return (MERCHANT_RESOURCES as readonly string[]).includes(value);
}

function configuredRates(
  give: MerchantResource,
  get: MerchantResource,
): { giveRate: number; getRate: number; feePercent: number } | { error: string } {
  const giveRate = RESOURCE_MERCHANT_VALUE[give];
  const getRate = RESOURCE_MERCHANT_VALUE[get];
  const feePercent = RESOURCE_MERCHANT_FEE_PERCENT;
  if (
    !Number.isInteger(giveRate) ||
    giveRate <= 0 ||
    !Number.isInteger(getRate) ||
    getRate <= 0 ||
    !Number.isInteger(feePercent) ||
    feePercent < 0 ||
    feePercent > 100
  ) {
    return { error: "Merchant rates are not configured." };
  }
  return { giveRate, getRate, feePercent };
}

/** Exact received amount for a give/get pair. Does not look at a planet. */
export function quoteResourceMerchant(
  give: string,
  get: string,
  amount: number,
): ResourceMerchantQuote {
  if (!isMerchantResource(give) || !isMerchantResource(get)) {
    return { ok: false, error: "Unknown resource.", output: null };
  }
  if (give === get) {
    return { ok: false, error: "Choose a different resource to receive.", output: null };
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, error: "Enter a whole amount.", output: null };
  }
  const rates = configuredRates(give, get);
  if ("error" in rates) return { ok: false, error: rates.error, output: null };
  if (amount > Math.floor(Number.MAX_SAFE_INTEGER / rates.getRate)) {
    return { ok: false, error: "Amount is too large.", output: null };
  }
  const gross = Math.floor((amount * rates.getRate) / rates.giveRate);
  const output = Math.floor((gross * (100 - rates.feePercent)) / 100);
  if (output < 1) {
    return { ok: false, error: "Amount is too small for this trade.", output: 0 };
  }
  return { ok: true, gross, output, fee: gross - output };
}

/** Quote plus the selected planet's stock and storage. */
export function assessResourceMerchant(input: {
  give: string;
  get: string;
  amount: number;
  have: Resources;
  storage: Resources;
}): ResourceMerchantQuote {
  const quote = quoteResourceMerchant(input.give, input.get, input.amount);
  if (!quote.ok) return quote;
  if (!isMerchantResource(input.give) || !isMerchantResource(input.get)) {
    return { ok: false, error: "Unknown resource.", output: null };
  }
  if (Math.floor(input.have[input.give]) < input.amount) {
    return { ok: false, error: `Not enough ${input.give}.`, output: quote.output };
  }
  if (input.have[input.get] + quote.output > input.storage[input.get]) {
    return {
      ok: false,
      error: `${input.get} storage is too full for this trade.`,
      output: quote.output,
    };
  }
  return quote;
}

/**
 * Swap resources on `planetId` only. Does not fall back to the home planet
 * and does not spend Starshards.
 */
export function tradeWithResourceMerchant(
  universe: UniverseState,
  playerId: string,
  planetId: string,
  give: string,
  get: string,
  amount: number,
  now = Date.now(),
): ResourceMerchantTradeResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!planetId) return { ok: false, error: "Select a planet." };
  if (!player.planetIds.includes(planetId)) {
    return { ok: false, error: "You do not own that planet." };
  }

  advanceUniverse(universe, now);
  const live = universe.players[playerId];
  if (!live || !live.planetIds.includes(planetId)) {
    return { ok: false, error: "You do not own that planet." };
  }
  const planet = universe.planets[planetId];
  if (!planet) return { ok: false, error: "Planet missing." };

  const assessment = assessResourceMerchant({
    give,
    get,
    amount,
    have: planet.resources,
    storage: storageForPlanet(universe, planet, now),
  });
  if (!assessment.ok) return { ok: false, error: assessment.error };
  if (!isMerchantResource(give) || !isMerchantResource(get)) {
    return { ok: false, error: "Unknown resource." };
  }

  const next: Resources = {
    metal: planet.resources.metal,
    crystal: planet.resources.crystal,
    deuterium: planet.resources.deuterium,
  };
  next[give] = planet.resources[give] - amount;
  next[get] = planet.resources[get] + assessment.output;
  planet.resources = next;
  universe.planets[planet.id] = planet;
  return { ok: true, output: assessment.output };
}
