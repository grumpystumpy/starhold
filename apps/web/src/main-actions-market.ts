import type { PlayerTradeList, PlayerView } from "@starhold/game";
import {
  acceptMarketOffer,
  cancelMarketOffer,
  fetchMarketOffers,
  postMarketOffer,
} from "./api";
import { settleMutation } from "./recover-action";
import { clearFlash, schedulePaint, session, setFlash } from "./session";
import { setMarketBook } from "./ui/market-panel";
import { shopTabFromUrl } from "./ui/nav";

function applyMarket(result: PlayerView & { market: PlayerTradeList }): void {
  const { market, ...view } = result;
  session.view = view;
  setMarketBook(market);
}

export async function refreshMarketIfOpen(): Promise<void> {
  if (typeof window === "undefined") return;
  if (session.activePage !== "shop") return;
  if (shopTabFromUrl(window.location.pathname, window.location.search) !== "market") return;
  const view = session.view;
  if (!view) return;
  try {
    const book = await fetchMarketOffers(view.player.id, view.planet.id);
    if (session.view?.player.id !== view.player.id) return;
    if (session.activePage !== "shop") return;
    setMarketBook(book);
    schedulePaint();
  } catch {
    // The next poll retries. A market miss must not flash over the page.
  }
}

export async function doPostMarket(input: {
  offerResource: string;
  offerAmount: number;
  requestResource: string;
  requestAmount: number;
}): Promise<void> {
  if (!session.view || session.busy) return;
  const playerId = session.view.player.id;
  const planetId = session.view.planet.id;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    applyMarket(
      await postMarketOffer(
        playerId,
        planetId,
        input.offerResource,
        input.offerAmount,
        input.requestResource,
        input.requestAmount,
      ),
    );
    setFlash("notice", "Offer posted. The goods are in escrow.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Market post failed.",
      applied: () => false,
      successNotice: () => null,
    });
    await refreshMarketIfOpen();
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doCancelMarket(offerId: string): Promise<void> {
  if (!session.view || session.busy) return;
  const playerId = session.view.player.id;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    const result = await cancelMarketOffer(playerId, offerId);
    applyMarket(result);
    setFlash("notice", result.market.note ?? "Offer cancelled. Escrow returned.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Market cancel failed.",
      applied: () => false,
      successNotice: () => null,
    });
    await refreshMarketIfOpen();
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doAcceptMarket(offerId: string): Promise<void> {
  if (!session.view || session.busy) return;
  const playerId = session.view.player.id;
  const planetId = session.view.planet.id;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    applyMarket(await acceptMarketOffer(playerId, offerId, planetId));
    setFlash("notice", "Trade accepted.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Market accept failed.",
      applied: () => false,
      successNotice: () => null,
    });
    await refreshMarketIfOpen();
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
