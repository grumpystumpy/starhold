import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayerView } from "@starhold/game";
import { createApp } from "./app.js";
import { withUniverse } from "./store.js";

const NOW = 1_700_000_000_000;

function stamp(label: string): string {
  return `${label}-${Math.random().toString(36).slice(2, 8)}`;
}

async function commander(app: ReturnType<typeof createApp>, label: string) {
  const id = stamp(label);
  const signup = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${id}@example.com`, password: "hunter2xx" }),
  });
  assert.equal(signup.status, 200);
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0]!;
  const join = await app.request("/api/auth/join", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: id.slice(0, 24) }),
  });
  assert.equal(join.status, 200);
  const view = (await join.json()) as PlayerView;
  return { cookie, view };
}

async function fund(playerId: string, planetId: string, newbie = false): Promise<void> {
  await withUniverse((universe) => {
    const planet = universe.planets[planetId]!;
    planet.lastTickAt = NOW;
    planet.resources = { metal: 20_000, crystal: 20_000, deuterium: 5_000 };
    if (!newbie) planet.ships.hauler = 5000;
  });
}

describe("player trade market routes", () => {
  it("requires a session, refuses another player, and keeps the book off /api/state", async () => {
    const originalNow = Date.now;
    Date.now = () => NOW;
    try {
      const app = createApp();
      const seller = await commander(app, "Seller");
      const buyer = await commander(app, "Buyer");
      await fund(seller.view.player.id, seller.view.planet.id);
      await fund(buyer.view.player.id, buyer.view.planet.id);

      const unauthenticated = await app.request("/api/market/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: seller.view.player.id,
          planetId: seller.view.planet.id,
          offerResource: "metal",
          offerAmount: 10_000,
          requestResource: "crystal",
          requestAmount: 4_000,
        }),
      });
      assert.equal(unauthenticated.status, 401);

      const forbidden = await app.request("/api/market/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: seller.cookie },
        body: JSON.stringify({
          playerId: buyer.view.player.id,
          planetId: buyer.view.planet.id,
          offerResource: "metal",
          offerAmount: 10_000,
          requestResource: "crystal",
          requestAmount: 4_000,
        }),
      });
      assert.equal(forbidden.status, 403);

      const posted = await app.request("/api/market/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: seller.cookie },
        body: JSON.stringify({
          playerId: seller.view.player.id,
          planetId: seller.view.planet.id,
          offerResource: "metal",
          offerAmount: 10_000,
          requestResource: "crystal",
          requestAmount: 4_000,
        }),
      });
      assert.equal(posted.status, 200);
      const postedBody = (await posted.json()) as PlayerView & {
        market: { offers: Array<{ id: string; acceptorReceives: number; posterReceives: number }> };
      };
      const offerId = postedBody.market.offers[0]?.id;
      assert.ok(offerId);
      assert.equal(postedBody.market.offers[0]!.acceptorReceives, 9_000);
      assert.equal(postedBody.market.offers[0]!.posterReceives, 3_600);
      assert.equal(postedBody.planet.resources.metal, 10_000);

      const listed = await app.request(
        `/api/market/offers?playerId=${encodeURIComponent(buyer.view.player.id)}&planetId=${encodeURIComponent(buyer.view.planet.id)}`,
        { headers: { Cookie: buyer.cookie } },
      );
      assert.equal(listed.status, 200);
      const book = (await listed.json()) as { offers: Array<{ id: string }> };
      assert.equal(book.offers.some((offer) => offer.id === offerId), true);
      assert.equal("player" in book, false);

      const state = await app.request(
        `/api/state?playerId=${encodeURIComponent(seller.view.player.id)}`,
        { headers: { Cookie: seller.cookie } },
      );
      assert.equal(state.status, 200);
      const stateText = await state.text();
      assert.equal(stateText.includes(offerId!), false);
      assert.equal(stateText.includes("playerTradeOffers"), false);

      const accepted = await app.request("/api/market/offers/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: buyer.cookie },
        body: JSON.stringify({
          playerId: buyer.view.player.id,
          offerId,
          planetId: buyer.view.planet.id,
        }),
      });
      assert.equal(accepted.status, 200);
      const after = (await accepted.json()) as PlayerView;
      assert.equal(after.planet.resources.metal, 29_000);
      assert.equal(after.planet.resources.crystal, 16_000);

      const self = await app.request("/api/market/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: seller.cookie },
        body: JSON.stringify({
          playerId: seller.view.player.id,
          planetId: seller.view.planet.id,
          offerResource: "crystal",
          offerAmount: 2_000,
          requestResource: "metal",
          requestAmount: 1_000,
        }),
      });
      assert.equal(self.status, 200);
      const selfBody = (await self.json()) as { market: { offers: Array<{ id: string }> } };
      const ownId = selfBody.market.offers.find((offer) => offer.id !== offerId)?.id;
      assert.ok(ownId);
      const ownAccept = await app.request("/api/market/offers/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: seller.cookie },
        body: JSON.stringify({
          playerId: seller.view.player.id,
          offerId: ownId,
          planetId: seller.view.planet.id,
        }),
      });
      assert.equal(ownAccept.status, 400);
      assert.match((await ownAccept.json() as { error: string }).error, /own offer/);

      const cancelled = await app.request("/api/market/offers/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: seller.cookie },
        body: JSON.stringify({ playerId: seller.view.player.id, offerId: ownId }),
      });
      assert.equal(cancelled.status, 200);

      const newbie = await commander(app, "Newbie");
      await fund(newbie.view.player.id, newbie.view.planet.id, true);
      const newbiePost = await app.request("/api/market/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: newbie.cookie },
        body: JSON.stringify({
          playerId: newbie.view.player.id,
          planetId: newbie.view.planet.id,
          offerResource: "metal",
          offerAmount: 1_000,
          requestResource: "crystal",
          requestAmount: 1_000,
        }),
      });
      assert.equal(newbiePost.status, 400);
      assert.match((await newbiePost.json() as { error: string }).error, /Newbie/);

      const short = await app.request("/api/market/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: seller.cookie },
        body: JSON.stringify({
          playerId: seller.view.player.id,
          planetId: seller.view.planet.id,
          offerResource: "metal",
          offerAmount: 1,
          requestResource: "crystal",
          requestAmount: 1,
        }),
      });
      assert.equal(short.status, 400);
      assert.match((await short.json() as { error: string }).error, /nothing after the fee/);

      const missing = await app.request("/api/market/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: seller.cookie },
        body: JSON.stringify({
          playerId: seller.view.player.id,
          planetId: seller.view.planet.id,
          offerResource: "metal",
          offerAmount: 100_000,
          requestResource: "crystal",
          requestAmount: 1_000,
        }),
      });
      assert.equal(missing.status, 400);
      assert.match((await missing.json() as { error: string }).error, /Not enough metal/);

      const tight = await app.request("/api/market/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: seller.cookie },
        body: JSON.stringify({
          playerId: seller.view.player.id,
          planetId: seller.view.planet.id,
          offerResource: "metal",
          offerAmount: 1_000,
          requestResource: "crystal",
          requestAmount: 4_000,
        }),
      });
      assert.equal(tight.status, 200);
      const tightBody = (await tight.json()) as { market: { offers: Array<{ id: string }> } };
      const tightId = tightBody.market.offers[0]?.id;
      assert.ok(tightId);
      await withUniverse((universe) => {
        const buyerPlayer = universe.players[buyer.view.player.id]!;
        buyerPlayer.tradeAcceptDay = new Date(NOW).toISOString().slice(0, 10);
        buyerPlayer.tradeAcceptValue = 1_000_000;
      });
      const capped = await app.request("/api/market/offers/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: buyer.cookie },
        body: JSON.stringify({
          playerId: buyer.view.player.id,
          offerId: tightId,
          planetId: buyer.view.planet.id,
        }),
      });
      assert.equal(capped.status, 400);
      assert.match((await capped.json() as { error: string }).error, /cap/);

      await withUniverse((universe) => {
        universe.players[buyer.view.player.id]!.tradeAcceptValue = 0;
        universe.planets[seller.view.planet.id]!.resources.crystal = 30_000;
      });
      const full = await app.request("/api/market/offers/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: buyer.cookie },
        body: JSON.stringify({
          playerId: buyer.view.player.id,
          offerId: tightId,
          planetId: buyer.view.planet.id,
        }),
      });
      assert.equal(full.status, 400);
      assert.match((await full.json() as { error: string }).error, /room|storage/);
    } finally {
      Date.now = originalNow;
    }
  });
});
