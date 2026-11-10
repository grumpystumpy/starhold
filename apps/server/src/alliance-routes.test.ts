import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import { resetMemoryUniverse } from "./store.js";

describe("alliance request routes", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
  });

  async function join(name: string): Promise<string> {
    const app = createApp();
    const res = await app.request("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { player: { id: string } };
    return body.player.id;
  }

  it("creates a request-mode alliance and approves, rejects, and cancels", async () => {
    const app = createApp();
    const bad = await app.request("/api/alliance/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: "missing",
        name: "Nope",
        tag: "NO",
        joinMode: "closed",
      }),
    });
    assert.equal(bad.status, 400);

    const leader = await join("RouteLead");
    const recruit = await join("RouteRecruit");
    const other = await join("RouteOther");
    const created = await app.request("/api/alliance/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: leader,
        name: "Route Gate",
        tag: "rg",
        joinMode: "request",
      }),
    });
    assert.equal(created.status, 200);
    const createdBody = (await created.json()) as {
      alliance: { id: string; joinMode: string; tag: string } | null;
    };
    assert.equal(createdBody.alliance?.joinMode, "request");
    assert.equal(createdBody.alliance?.tag, "RG");
    const allianceId = createdBody.alliance!.id;

    const requested = await app.request("/api/alliance/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: recruit, allianceId }),
    });
    assert.equal(requested.status, 200);
    const requestedBody = (await requested.json()) as {
      alliance: { id: string } | null;
      pendingAllianceRequest?: { allianceId: string } | null;
    };
    assert.equal(requestedBody.alliance, null);
    assert.equal(requestedBody.pendingAllianceRequest?.allianceId, allianceId);

    const duplicate = await app.request("/api/alliance/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: recruit, allianceId }),
    });
    assert.equal(duplicate.status, 200);

    const missing = await app.request("/api/alliance/request/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: leader }),
    });
    assert.equal(missing.status, 400);

    const approved = await app.request("/api/alliance/request/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: leader, targetPlayerId: recruit }),
    });
    assert.equal(approved.status, 200);
    const approvedBody = (await approved.json()) as {
      alliance: { members: Array<{ playerId: string }> } | null;
    };
    assert.ok(approvedBody.alliance?.members.some((m) => m.playerId === recruit));

    const asked = await app.request("/api/alliance/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: other, allianceId }),
    });
    assert.equal(asked.status, 200);
    const rejected = await app.request("/api/alliance/request/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: leader, targetPlayerId: other }),
    });
    assert.equal(rejected.status, 200);
    const again = await app.request("/api/alliance/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: other, allianceId }),
    });
    assert.equal(again.status, 200);
    const cancelled = await app.request("/api/alliance/request/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: other }),
    });
    assert.equal(cancelled.status, 200);
    const cancelledBody = (await cancelled.json()) as {
      pendingAllianceRequest?: { allianceId: string } | null;
    };
    assert.equal(cancelledBody.pendingAllianceRequest ?? null, null);
  });

  it("offers a NAP, accepts it, declares a one-sided war, and clears relations on disband", async () => {
    const app = createApp();
    const missing = await app.request("/api/alliance/diplomacy/nap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: "missing" }),
    });
    assert.equal(missing.status, 400);

    const alpha = await join("DipAlpha");
    const beta = await join("DipBeta");
    const recruit = await join("DipRecruit");
    const createdA = await app.request("/api/alliance/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: alpha, name: "Alpha Pact", tag: "alp" }),
    });
    const createdB = await app.request("/api/alliance/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: beta, name: "Beta Pact", tag: "bet" }),
    });
    assert.equal(createdA.status, 200);
    assert.equal(createdB.status, 200);
    const alphaId = ((await createdA.json()) as { alliance: { id: string } }).alliance.id;
    const betaId = ((await createdB.json()) as { alliance: { id: string } }).alliance.id;
    assert.equal(
      (await app.request("/api/alliance/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: recruit, allianceId: betaId }),
      })).status,
      200,
    );

    const offered = await app.request("/api/alliance/diplomacy/nap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: alpha, allianceId: betaId }),
    });
    assert.equal(offered.status, 200);
    const offeredBody = (await offered.json()) as {
      alliance: { relations: Array<{ kind: string; status: string; tag: string }> };
    };
    assert.equal(offeredBody.alliance.relations[0]?.kind, "nap");
    assert.equal(offeredBody.alliance.relations[0]?.status, "pending");
    assert.equal(offeredBody.alliance.relations[0]?.tag, "BET");

    const memberOffer = await app.request("/api/alliance/diplomacy/nap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: recruit, allianceId: alphaId }),
    });
    assert.equal(memberOffer.status, 400);

    const selfAccept = await app.request("/api/alliance/diplomacy/nap/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: alpha, allianceId: betaId }),
    });
    assert.equal(selfAccept.status, 400);

    const accepted = await app.request("/api/alliance/diplomacy/nap/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: beta, allianceId: alphaId }),
    });
    assert.equal(accepted.status, 200);
    const acceptedBody = (await accepted.json()) as {
      alliance: { relations: Array<{ status: string; kind: string }> };
    };
    assert.equal(acceptedBody.alliance.relations[0]?.status, "active");
    assert.equal(acceptedBody.alliance.relations[0]?.kind, "nap");

    const blockedWar = await app.request("/api/alliance/diplomacy/war", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: alpha, allianceId: betaId }),
    });
    assert.equal(blockedWar.status, 400);

    assert.equal(
      (await app.request("/api/alliance/diplomacy/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: alpha, allianceId: betaId }),
      })).status,
      200,
    );
    const war = await app.request("/api/alliance/diplomacy/war", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: alpha, allianceId: betaId }),
    });
    assert.equal(war.status, 200);
    const targetCancel = await app.request("/api/alliance/diplomacy/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: beta, allianceId: alphaId }),
    });
    assert.equal(targetCancel.status, 400);
    assert.equal(
      (await app.request("/api/alliance/diplomacy/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: alpha, allianceId: betaId }),
      })).status,
      200,
    );

    assert.equal(
      (await app.request("/api/alliance/diplomacy/nap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: alpha, allianceId: betaId }),
      })).status,
      200,
    );
    assert.equal(
      (await app.request("/api/alliance/diplomacy/nap/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: beta, allianceId: alphaId }),
      })).status,
      200,
    );
    const disbanded = await app.request("/api/alliance/disband", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: alpha }),
    });
    assert.equal(disbanded.status, 200);
    const betaView = await app.request(`/api/alliance?playerId=${beta}`);
    const betaBody = (await betaView.json()) as {
      alliance: { relations?: unknown[] } | null;
    };
    assert.deepEqual(betaBody.alliance?.relations ?? [], []);
  });
});
