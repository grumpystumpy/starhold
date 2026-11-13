import type { PlayerTradeList } from "@starhold/game";

let book: PlayerTradeList | null = null;

export function setMarketBook(next: PlayerTradeList | null): void {
  book = next;
}

export function marketBook(): PlayerTradeList | null {
  return book;
}
