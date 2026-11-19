import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NEWBIE_PROTECTION_POINTS,
  PLAYER_TRADE_DAILY_ACCEPT_VALUE_CAP,
  PLAYER_TRADE_EXPIRE_MS,
  PLAYER_TRADE_MAX_OPEN_PER_PLAYER,
  PLAYER_TRADE_MAX_OPEN_TOTAL,
} from "./data/tuning.js";
import { empirePoints } from "./formulas-travel.js";
import type { PlayerTradeOffer, UniverseState } from "./types.js";
import { ensureUniverseShape, createUniverse, joinUniverse } from "./world-bootstrap.js";
import { advanceUniverse } from "./world-arrival.js";
import { utcDayKey } from "./world-boosts.js";
import { playerView } from "./world-view.js";
import {
  acceptPlayerTradeOffer,
  cancelPlayerTradeOffer,
  expirePlayerTradeOffers,
  listPlayerTradeOffers,
  playerTradeMetalValue,
  playerTradeNetAmount,
  postPlayerTradeOffer,
} from "./world-player-trade.js";

const NOW = 1_700_000_000_000;

function universe(): UniverseState {
  const created = createUniverse("Player Trade", 1, 1, { lazySeed: true });
  created.seedCursor = { at: 0, pirates: 0, done: true };
  return created;
}

function veteran(
  created: UniverseState,
  name: string,
): { playerId: string; planetId: string } {
  const joined = joinUniverse(created, name, NOW);
  const planet = created.planets[joined.planet.id]!;
  planet.ships.hauler = 5000;
  planet.resources = { metal: 20_000, crystal: 20_000, deuterium: 5_000 };
  planet.lastTickAt = NOW;
  assert.ok(empirePoints(created, joined.player) >= NEWBIE_PROTECTION_POINTS);
  return { playerId: joined.player.id, planetId: planet.id };
}

describe("player trade market", () => {
  it("floors the 10% fee the way the 100k / 40k example does", () => {
    assert.equal(playerTradeNetAmount(100_000), 90_000);
    assert.equal(playerTradeNetAmount(40_000), 36_000);
    assert.equal(playerTradeNetAmount(1), 0);
  });

  it("escrows on post, transfers both sides, and sinks the fee", () => {
    const created = universe();
    const poster = veteran(created, "Poster");
    const buyer = veteran(created, "Buyer");
    const posted = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "metal",
      10_000,
      "crystal",
      4_000,
      NOW,
    );
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    assert.equal(created.planets[poster.planetId]!.resources.metal, 10_000);
    const accepted = acceptPlayerTradeOffer(
      created,
      buyer.playerId,
      posted.offerId,
      buyer.planetId,
      NOW,
    );
    assert.equal(accepted.ok, true);
    assert.equal(created.playerTradeOffers?.[posted.offerId!], undefined);
    assert.equal(created.planets[buyer.planetId]!.resources.metal, 29_000);
    assert.equal(created.planets[buyer.planetId]!.resources.crystal, 16_000);
    assert.equal(created.planets[poster.planetId]!.resources.metal, 10_000);
    assert.equal(created.planets[poster.planetId]!.resources.crystal, 23_600);
    assert.equal(created.players[buyer.playerId]!.tradeAcceptDay, utcDayKey(NOW));
    assert.equal(created.players[buyer.playerId]!.tradeAcceptValue, 9_000);
  });

  it("refunds the full escrow on cancel", () => {
    const created = universe();
    const poster = veteran(created, "Canceller");
    const posted = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "deuterium",
      2_000,
      "metal",
      4_000,
      NOW,
    );
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    assert.equal(created.planets[poster.planetId]!.resources.deuterium, 3_000);
    const cancelled = cancelPlayerTradeOffer(created, poster.playerId, posted.offerId, NOW);
    assert.equal(cancelled.ok, true);
    if (!cancelled.ok) return;
    assert.equal(cancelled.refunded, 2_000);
    assert.equal(cancelled.lost, 0);
    assert.equal(created.planets[poster.planetId]!.resources.deuterium, 5_000);
    assert.equal(Object.keys(created.playerTradeOffers ?? {}).length, 0);
  });

  it("clamps a refund onto the homeworld when the escrow planet is gone", () => {
    const created = universe();
    const poster = veteran(created, "Clamped");
    const home = created.planets[poster.planetId]!;
    const colony = structuredClone(home);
    colony.id = `${home.id}_colony`;
    colony.name = "Colony";
    colony.resources = { metal: 20_000, crystal: 0, deuterium: 0 };
    created.planets[colony.id] = colony;
    const player = created.players[poster.playerId]!;
    player.planetIds.push(colony.id);
    const posted = postPlayerTradeOffer(
      created,
      poster.playerId,
      colony.id,
      "metal",
      10_000,
      "crystal",
      1_000,
      NOW,
    );
    assert.equal(posted.ok, true);
    delete created.planets[colony.id];
    player.planetIds = [home.id];
    home.resources.metal = 29_900;
    const cancelled = cancelPlayerTradeOffer(created, poster.playerId, posted.offerId, NOW);
    assert.equal(cancelled.ok, true);
    if (!cancelled.ok) return;
    assert.equal(cancelled.refunded, 100);
    assert.equal(cancelled.lost, 9_900);
    assert.match(cancelled.note ?? "", /could not fit/);
    assert.equal(home.resources.metal, 30_000);
  });

  it("refunds expired offers from a market read and from advanceUniverse", () => {
    const created = universe();
    const poster = veteran(created, "Expiring");
    const posted = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "crystal",
      4_000,
      "metal",
      8_000,
      NOW,
    );
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    created.playerTradeOffers![posted.offerId!]!.expiresAt = NOW - 1;
    const listed = listPlayerTradeOffers(created, poster.playerId, NOW, poster.planetId);
    assert.equal(listed.offers.length, 0);
    assert.equal(created.planets[poster.planetId]!.resources.crystal, 20_000);

    const again = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "crystal",
      4_000,
      "metal",
      8_000,
      NOW,
    );
    assert.equal(again.ok, true);
    if (!again.ok) return;
    created.playerTradeOffers![again.offerId!]!.expiresAt = NOW - 1;
    const refunded = expirePlayerTradeOffers(created, NOW, 20);
    assert.equal(refunded, 1);
    assert.equal(created.planets[poster.planetId]!.resources.crystal, 20_000);

    const third = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "crystal",
      4_000,
      "metal",
      8_000,
      NOW,
    );
    assert.equal(third.ok, true);
    if (!third.ok) return;
    created.playerTradeOffers![third.offerId!]!.expiresAt = NOW - 1;
    advanceUniverse(created, NOW);
    assert.equal(created.playerTradeOffers?.[third.offerId!], undefined);
    assert.equal(created.planets[poster.planetId]!.resources.crystal, 20_000);
    assert.ok(PLAYER_TRADE_EXPIRE_MS > 0);
  });

  it("rejects self-trade, newbies, missing stock, full storage, and a zero fee result", () => {
    const created = universe();
    const poster = veteran(created, "Veteran");
    const buyer = veteran(created, "Counterparty");
    const posted = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "metal",
      5_000,
      "crystal",
      2_000,
      NOW,
    );
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const self = acceptPlayerTradeOffer(
      created,
      poster.playerId,
      posted.offerId,
      poster.planetId,
      NOW,
    );
    assert.equal(self.ok, false);
    if (self.ok) return;
    assert.match(self.error, /own offer/);
    assert.equal(created.planets[poster.planetId]!.resources.metal, 15_000);

    const newbie = joinUniverse(created, "Newbie", NOW);
    const newbiePost = postPlayerTradeOffer(
      created,
      newbie.player.id,
      newbie.planet.id,
      "metal",
      1_000,
      "crystal",
      1_000,
      NOW,
    );
    assert.equal(newbiePost.ok, false);
    if (newbiePost.ok) return;
    assert.match(newbiePost.error, /Newbie/);
    created.planets[newbie.planet.id]!.resources.crystal = 20_000;
    const newbieAccept = acceptPlayerTradeOffer(
      created,
      newbie.player.id,
      posted.offerId,
      newbie.planet.id,
      NOW,
    );
    assert.equal(newbieAccept.ok, false);
    if (newbieAccept.ok) return;
    assert.match(newbieAccept.error, /Newbie/);

    const short = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "metal",
      100_000,
      "crystal",
      1_000,
      NOW,
    );
    assert.equal(short.ok, false);
    if (short.ok) return;
    assert.match(short.error, /Not enough metal/);
    assert.equal(created.planets[poster.planetId]!.resources.metal, 15_000);

    created.planets[buyer.planetId]!.resources.metal = 30_000;
    const full = acceptPlayerTradeOffer(
      created,
      buyer.playerId,
      posted.offerId,
      buyer.planetId,
      NOW,
    );
    assert.equal(full.ok, false);
    if (full.ok) return;
    assert.match(full.error, /storage/);
    assert.equal(created.planets[poster.planetId]!.resources.metal, 15_000);
    assert.equal(created.planets[buyer.planetId]!.resources.crystal, 20_000);

    const zero = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "metal",
      1,
      "crystal",
      1,
      NOW,
    );
    assert.equal(zero.ok, false);
    if (zero.ok) return;
    assert.match(zero.error, /nothing after the fee/);
  });

  it("enforces the daily accept cap and resets it on the next UTC day", () => {
    const created = universe();
    const poster = veteran(created, "CapSeller");
    const buyer = veteran(created, "CapBuyer");
    const posted = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "metal",
      10_000,
      "crystal",
      4_000,
      NOW,
    );
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const buyerPlayer = created.players[buyer.playerId]!;
    buyerPlayer.tradeAcceptDay = utcDayKey(NOW);
    buyerPlayer.tradeAcceptValue = PLAYER_TRADE_DAILY_ACCEPT_VALUE_CAP;
    const blocked = acceptPlayerTradeOffer(
      created,
      buyer.playerId,
      posted.offerId,
      buyer.planetId,
      NOW,
    );
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.match(blocked.error, /cap/);
    assert.equal(created.playerTradeOffers?.[posted.offerId!]?.offerAmount, 10_000);

    buyerPlayer.tradeAcceptDay = utcDayKey(NOW - 48 * 60 * 60 * 1000);
    const accepted = acceptPlayerTradeOffer(
      created,
      buyer.playerId,
      posted.offerId,
      buyer.planetId,
      NOW,
    );
    assert.equal(accepted.ok, true);
    assert.equal(buyerPlayer.tradeAcceptDay, utcDayKey(NOW));
    assert.equal(buyerPlayer.tradeAcceptValue, 9_000);
  });

  it("rejects a fourth open offer and a full book", () => {
    const created = universe();
    const poster = veteran(created, "Triple");
    for (let i = 0; i < PLAYER_TRADE_MAX_OPEN_PER_PLAYER; i++) {
      const posted = postPlayerTradeOffer(
        created,
        poster.playerId,
        poster.planetId,
        "metal",
        1_000,
        "crystal",
        1_000,
        NOW + i,
      );
      assert.equal(posted.ok, true);
    }
    const fourth = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "metal",
      1_000,
      "crystal",
      1_000,
      NOW,
    );
    assert.equal(fourth.ok, false);
    if (fourth.ok) return;
    assert.match(fourth.error, /3 open offers/);

    const other = veteran(created, "Late");
    const seeded: Record<string, PlayerTradeOffer> = {};
    for (let i = 0; i < PLAYER_TRADE_MAX_OPEN_TOTAL; i++) {
      seeded[`trd_seed_${i}`] = {
        id: `trd_seed_${i}`,
        posterPlayerId: "ghost",
        planetId: "missing",
        offerResource: "metal",
        offerAmount: 1_000,
        requestResource: "crystal",
        requestAmount: 1_000,
        createdAt: NOW,
        expiresAt: NOW + PLAYER_TRADE_EXPIRE_MS,
      };
    }
    created.playerTradeOffers = seeded;
    const full = postPlayerTradeOffer(
      created,
      other.playerId,
      other.planetId,
      "metal",
      1_000,
      "crystal",
      1_000,
      NOW,
    );
    assert.equal(full.ok, false);
    if (full.ok) return;
    assert.match(full.error, /market is full/);
    assert.equal(created.planets[other.planetId]!.resources.metal, 20_000);
  });

  it("loads a universe that never had playerTradeOffers", () => {
    const created = universe();
    const joined = veteran(created, "OldSave");
    const raw = JSON.parse(JSON.stringify(created)) as UniverseState;
    delete raw.playerTradeOffers;
    delete raw.players[joined.playerId]!.tradeAcceptDay;
    delete raw.players[joined.playerId]!.tradeAcceptValue;
    ensureUniverseShape(raw);
    assert.equal(raw.playerTradeOffers, undefined);
    assert.equal(raw.players[joined.playerId]!.tradeAcceptDay, undefined);
    const view = playerView(raw, joined.playerId, NOW);
    assert.equal(view.player.id, joined.playerId);
    assert.equal(view.planet.id, joined.planetId);
    assert.equal((view as { playerTradeOffers?: unknown }).playerTradeOffers, undefined);
    assert.equal(raw.playerTradeOffers, undefined);
  });

  it("rejects the same resource, a missing accept planet, and a poster under 2500", () => {
    const created = universe();
    const poster = veteran(created, "Picker");
    const buyer = veteran(created, "PickerBuyer");
    const same = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "crystal",
      1_000,
      "crystal",
      1_000,
      NOW,
    );
    assert.equal(same.ok, false);
    if (same.ok) return;
    assert.match(same.error, /different resources/);
    assert.equal(created.planets[poster.planetId]!.resources.crystal, 20_000);

    const posted = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "metal",
      1_000,
      "crystal",
      1_000,
      NOW,
    );
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const missingPlanet = acceptPlayerTradeOffer(
      created,
      buyer.playerId,
      posted.offerId,
      undefined,
      NOW,
    );
    assert.equal(missingPlanet.ok, false);
    if (missingPlanet.ok) return;
    assert.match(missingPlanet.error, /planetId required/);
    assert.ok(created.playerTradeOffers?.[posted.offerId!]);

    const fresh = joinUniverse(created, "Under2500", NOW);
    assert.ok(empirePoints(created, fresh.player) < NEWBIE_PROTECTION_POINTS);
    const newbiePost = postPlayerTradeOffer(
      created,
      fresh.player.id,
      fresh.planet.id,
      "metal",
      1_000,
      "deuterium",
      1_000,
      NOW,
    );
    assert.equal(newbiePost.ok, false);
    if (newbiePost.ok) return;
    assert.match(newbiePost.error, /Newbie/);
  });

  it("weights crystal and deuterium against the daily accept cap", () => {
    assert.equal(playerTradeMetalValue("metal", 900), 900);
    assert.equal(playerTradeMetalValue("crystal", 900), 1_350);
    assert.equal(playerTradeMetalValue("deuterium", 900), 2_700);
    const created = universe();
    const poster = veteran(created, "WeightSeller");
    const buyer = veteran(created, "WeightBuyer");
    const posted = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "deuterium",
      1_000,
      "metal",
      1_000,
      NOW,
    );
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    const buyerPlayer = created.players[buyer.playerId]!;
    buyerPlayer.tradeAcceptDay = utcDayKey(NOW);
    buyerPlayer.tradeAcceptValue = PLAYER_TRADE_DAILY_ACCEPT_VALUE_CAP - 2_699;
    const blocked = acceptPlayerTradeOffer(
      created,
      buyer.playerId,
      posted.offerId,
      buyer.planetId,
      NOW,
    );
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.match(blocked.error, /cap/);
    buyerPlayer.tradeAcceptValue = PLAYER_TRADE_DAILY_ACCEPT_VALUE_CAP - 2_700;
    const accepted = acceptPlayerTradeOffer(
      created,
      buyer.playerId,
      posted.offerId,
      buyer.planetId,
      NOW,
    );
    assert.equal(accepted.ok, true);
    assert.equal(buyerPlayer.tradeAcceptValue, PLAYER_TRADE_DAILY_ACCEPT_VALUE_CAP);
    assert.equal(created.planets[buyer.planetId]!.resources.deuterium, 5_900);
  });

  it("ticks production before stock and storage checks", () => {
    const created = universe();
    const poster = veteran(created, "Producer");
    const buyer = veteran(created, "Receiver");
    const sellerPlanet = created.planets[poster.planetId]!;
    sellerPlanet.resources.metal = 100;
    sellerPlanet.lastTickAt = NOW - 10 * 60 * 60 * 1000;
    const posted = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "metal",
      1_000,
      "crystal",
      1_000,
      NOW,
    );
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    assert.ok(created.planets[poster.planetId]!.resources.metal > 100);

    const buyerPlanet = created.planets[buyer.planetId]!;
    buyerPlanet.resources.metal = 25_000;
    buyerPlanet.lastTickAt = NOW - 20 * 60 * 60 * 1000;
    const accepted = acceptPlayerTradeOffer(
      created,
      buyer.playerId,
      posted.offerId,
      buyer.planetId,
      NOW,
    );
    assert.equal(accepted.ok, false);
    if (accepted.ok) return;
    assert.match(accepted.error, /storage/);
    assert.ok(created.playerTradeOffers?.[posted.offerId!]);
    assert.ok(created.planets[buyer.planetId]!.resources.metal > 25_000);
  });

  it("writes an event when an expired refund does not fit", () => {
    const created = universe();
    const poster = veteran(created, "Overflow");
    const home = created.planets[poster.planetId]!;
    const posted = postPlayerTradeOffer(
      created,
      poster.playerId,
      poster.planetId,
      "metal",
      10_000,
      "crystal",
      1_000,
      NOW,
    );
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    home.resources.metal = 29_900;
    home.lastTickAt = NOW;
    created.playerTradeOffers![posted.offerId!]!.expiresAt = NOW - 1;
    const refunded = expirePlayerTradeOffers(created, NOW, 20);
    assert.equal(refunded, 1);
    assert.equal(home.resources.metal, 30_000);
    const entry = created.players[poster.playerId]!.eventLog?.find(
      (row) => row.title === "Market refund",
    );
    assert.ok(entry);
    assert.match(entry!.body, /could not fit/);
  });

  it("refunds using storage now, not the cap from when the offer was posted", () => {
    const created = universe();
    const poster = veteran(created, "Vault");
    const home = created.planets[poster.planetId]!;
    const colony = structuredClone(home);
    colony.id = `${home.id}_colony`;
    colony.name = "Vault Colony";
    colony.resources = { metal: 21_000, crystal: 0, deuterium: 0 };
    created.planets[colony.id] = colony;
    const player = created.players[poster.playerId]!;
    player.planetIds.push(colony.id);
    player.officers = [
      { officerId: "vaultkeeper", activatedAt: NOW - 48 * 60 * 60 * 1000, expiresAt: NOW - 1 },
    ];
    const posted = postPlayerTradeOffer(
      created,
      poster.playerId,
      colony.id,
      "metal",
      12_000,
      "crystal",
      1_000,
      NOW - 60 * 60 * 1000,
    );
    assert.equal(posted.ok, true);
    if (!posted.ok) return;
    colony.resources.metal = 21_000;
    colony.lastTickAt = NOW;
    home.resources.metal = 0;
    home.lastTickAt = NOW;
    created.playerTradeOffers![posted.offerId!]!.expiresAt = NOW - 1;
    const cancelled = cancelPlayerTradeOffer(created, poster.playerId, posted.offerId, NOW);
    assert.equal(cancelled.ok, true);
    if (!cancelled.ok) return;
    assert.equal(cancelled.refunded, 12_000);
    assert.equal(cancelled.lost, 0);
    assert.equal(colony.resources.metal, 21_000);
    assert.equal(home.resources.metal, 12_000);
  });
});
