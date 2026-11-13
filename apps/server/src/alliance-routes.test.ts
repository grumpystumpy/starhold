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

  it("lets only the Leader set recruiting and keeps it off /api/state", async () => {
    const app = createApp();
    const leader = await join("RecruitLead");
    const officer = await join("RecruitOfficer");
    const member = await join("RecruitMember");
    const created = await app.request("/api/alliance/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: leader,
        name: "Recruit Gate",
        tag: "rgat",
      }),
    });
    assert.equal(created.status, 200);
    const createdBody = (await created.json()) as { alliance: { id: string } };
    const allianceId = createdBody.alliance.id;
    assert.equal(
      (
        await app.request("/api/alliance/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: officer, allianceId }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await app.request("/api/alliance/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: member, allianceId }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await app.request("/api/alliance/set-role", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: leader,
            targetPlayerId: officer,
            role: "officer",
          }),
        })
      ).status,
      200,
    );

    const payload = {
      recruitmentBlurb: "Come fly",
      recruiting: true,
      applicationNote: "Say hi",
    };
    const officerDenied = await app.request("/api/alliance/set-recruiting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: officer, ...payload }),
    });
    assert.equal(officerDenied.status, 400);
    const memberDenied = await app.request("/api/alliance/set-recruiting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: member, ...payload }),
    });
    assert.equal(memberDenied.status, 400);

    const saved = await app.request("/api/alliance/set-recruiting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: leader, ...payload }),
    });
    assert.equal(saved.status, 200);
    const state = await app.request(
      `/api/state?playerId=${encodeURIComponent(leader)}`,
    );
    assert.equal(state.status, 200);
    const stateBody = (await state.json()) as {
      alliance: Record<string, unknown> | null;
      allianceDirectory: Array<Record<string, unknown>>;
    };
    const row = stateBody.allianceDirectory.find((entry) => entry.id === allianceId);
    assert.ok(row);
    assert.equal("recruitmentBlurb" in row!, false);
    assert.equal("recruiting" in row!, false);
    assert.equal("applicationNote" in row!, false);
    assert.equal("recruitmentBlurb" in (stateBody.alliance ?? {}), false);
    assert.equal("applicationNote" in (stateBody.alliance ?? {}), false);

    const list = await app.request(
      `/api/alliance/list?playerId=${encodeURIComponent(leader)}`,
    );
    assert.equal(list.status, 200);
    const listed = (await list.json()) as {
      alliances: Array<{
        id: string;
        recruitmentBlurb: string;
        recruiting: boolean;
        applicationNote: string;
      }>;
    };
    const pageRow = listed.alliances.find((entry) => entry.id === allianceId);
    assert.equal(pageRow?.recruitmentBlurb, "Come fly");
    assert.equal(pageRow?.recruiting, true);
    assert.equal(pageRow?.applicationNote, "Say hi");
  });
});
