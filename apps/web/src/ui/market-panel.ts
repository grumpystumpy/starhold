import type { PlayerTradeList } from "@starhold/game";

let book: PlayerTradeList | null = null;

export type MarketResource = "metal" | "crystal" | "deuterium";

export interface MarketDraft {
  offerResource: MarketResource;
  offerAmount: number;
  requestResource: MarketResource;
  requestAmount: number;
}

const DEFAULT_DRAFT: MarketDraft = {
  offerResource: "metal",
  offerAmount: 10_000,
  requestResource: "crystal",
  requestAmount: 4_000,
};

let draft: MarketDraft = { ...DEFAULT_DRAFT };

export function setMarketBook(next: PlayerTradeList | null): void {
  book = next;
}

export function marketBook(): PlayerTradeList | null {
  return book;
}

export function marketDraft(): MarketDraft {
  return draft;
}

export function setMarketDraft(next: Partial<MarketDraft> | null): void {
  if (!next) {
    draft = { ...DEFAULT_DRAFT };
    return;
  }
  draft = { ...draft, ...next };
}

export function asMarketResource(value: string): MarketResource {
  if (value === "crystal" || value === "deuterium") return value;
  return "metal";
}
