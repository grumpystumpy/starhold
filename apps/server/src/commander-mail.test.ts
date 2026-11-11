import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, it } from "node:test";
import { COMMANDER_MAIL_MAX_PER_RECIPIENT, COMMANDER_MAIL_RATE_PER_MIN } from "@starhold/game";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import {
  listCommanderMail,
  resetCommanderMailForTests,
  sendCommanderMail,
  setCommanderMailClockForTests,
} from "./commander-mail.js";
import type { D1Like, D1RunResult, D1Stmt } from "./d1-store.js";
import { runWithScope } from "./request-context.js";
import { ensureRowTables } from "./row-store.js";
import { resetMemoryUniverse } from "./store.js";

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(/starhold_session=[^;]+/);
  assert.ok(match, `session cookie missing: ${raw}`);
  return match[0]!;
}

function sqliteD1(): D1Like {
  const raw = new DatabaseSync(":memory:");
  return {
    prepare(sql: string): D1Stmt {
      const bound: { values: unknown[] } = { values: [] };
      let stmt: ReturnType<DatabaseSync["prepare"]> | null = null;
      const compiled = () => {
        if (!stmt) stmt = raw.prepare(sql);
        return stmt;
      };
      const api: D1Stmt = {
        bind(...values: unknown[]) {
          bound.values = values;
          return api;
        },
        async first<T>() {
          const row = compiled().get(...(bound.values as never[])) as T | undefined;
          return row ?? null;
        },
        async all<T>() {
          const rows = compiled().all(...(bound.values as never[])) as T[];
          return { results: rows };
        },
        async run(): Promise<D1RunResult> {
          if (/^\s*SELECT\b/i.test(sql)) {
            return { results: compiled().all(...(bound.values as never[])) as unknown[] };
          }
          const result = compiled().run(...(bound.values as never[]));
          return { meta: { changes: Number(result.changes ?? 0) } };
        },
      };
      return api;
    },
    async batch(statements) {
      const results: D1RunResult[] = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
}

async function commander(
  app: ReturnType<typeof createApp>,
  email: string,
  name: string,
): Promise<{ cookie: string; id: string }> {
  const signup = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "hunter2xx" }),
  });
  assert.equal(signup.status, 200);
  const cookie = cookieFrom(signup);
  const join = await app.request("/api/auth/join", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name }),
  });
  assert.equal(join.status, 200);
  const view = (await join.json()) as { player: { id: string; name: string } };
  assert.equal(view.player.name, name);
  return { cookie, id: view.player.id };
}

describe("commander mail routes", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
    resetCommanderMailForTests();
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
    delete process.env.STARHOLD_RUNTIME;
  });

  it("requires a session and keeps mail off the state poll", async () => {
    const app = createApp();
    const anon = await app.request("/api/mail");
    assert.equal(anon.status, 401);

    const ada = await commander(app, "ada@starhold.test", "Ada");
    const bea = await commander(app, "bea@starhold.test", "Bea");
    const body = `<script>alert("x")</script>`;
    const sent = await app.request("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ada.cookie },
      body: JSON.stringify({ to: "bea", body }),
    });
    assert.equal(sent.status, 200);
    const sentBody = (await sent.json()) as {
      message: { id: string; senderName: string; body: string; createdAt: number };
    };
    assert.equal(sentBody.message.senderName, "Ada");
    assert.equal(sentBody.message.body, body);

    const state = await app.request(`/api/state?playerId=${encodeURIComponent(bea.id)}`);
    assert.equal(state.status, 200);
    const stateText = await state.text();
    assert.equal(stateText.includes(body), false);
    assert.equal(stateText.includes("commander_mail"), false);

    const inbox = await app.request("/api/mail", { headers: { Cookie: bea.cookie } });
    assert.equal(inbox.status, 200);
    const inboxBody = (await inbox.json()) as {
      messages: { id: string; body: string; senderName: string }[];
    };
    assert.equal(inboxBody.messages.length, 1);
    assert.equal(inboxBody.messages[0]?.body, body);

    const senderInbox = await app.request("/api/mail", { headers: { Cookie: ada.cookie } });
    const senderBody = (await senderInbox.json()) as { messages: unknown[] };
    assert.equal(senderBody.messages.length, 0);

    const self = await app.request("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ada.cookie },
      body: JSON.stringify({ to: "Ada", body: "nope" }),
    });
    assert.equal(self.status, 400);

    const missing = await app.request("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ada.cookie },
      body: JSON.stringify({ to: "Nobody", body: "hi" }),
    });
    assert.equal(missing.status, 400);

    const adaDelete = await app.request("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ada.cookie },
      body: JSON.stringify({ deleteId: sentBody.message.id }),
    });
    assert.equal(adaDelete.status, 404);
    const beaDelete = await app.request("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: bea.cookie },
      body: JSON.stringify({ deleteId: sentBody.message.id }),
    });
    assert.equal(beaDelete.status, 200);
    const after = await app.request("/api/mail", { headers: { Cookie: bea.cookie } });
    const afterBody = (await after.json()) as { messages: unknown[] };
    assert.equal(afterBody.messages.length, 0);
  });

  it("returns only newer notes and enforces the send cap and inbox cap", async () => {
    const app = createApp();
    const ada = await commander(app, "ada2@starhold.test", "Ada");
    const bea = await commander(app, "bea2@starhold.test", "Bea");
    const first = await app.request("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ada.cookie },
      body: JSON.stringify({ to: "Bea", body: "one" }),
    });
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as { message: { createdAt: number } };
    const second = await app.request("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ada.cookie },
      body: JSON.stringify({ to: "Bea", body: "two" }),
    });
    assert.equal(second.status, 200);
    const since = await app.request(
      `/api/mail?since=${firstBody.message.createdAt}`,
      { headers: { Cookie: bea.cookie } },
    );
    const sinceBody = (await since.json()) as { messages: { body: string }[] };
    assert.deepEqual(sinceBody.messages.map((message) => message.body), ["two"]);

    resetCommanderMailForTests();
    for (let i = 0; i < COMMANDER_MAIL_RATE_PER_MIN; i++) {
      const ok = await app.request("/api/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: ada.cookie },
        body: JSON.stringify({ to: "Bea", body: `rate-${i}` }),
      });
      assert.equal(ok.status, 200);
    }
    const limited = await app.request("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ada.cookie },
      body: JSON.stringify({ to: "Bea", body: "too many" }),
    });
    assert.equal(limited.status, 400);

    resetCommanderMailForTests();
    let clock = 1_700_000_000_000;
    setCommanderMailClockForTests(() => {
      clock += 61_000;
      return clock;
    });
    for (let i = 0; i <= COMMANDER_MAIL_MAX_PER_RECIPIENT; i++) {
      const ok = await app.request("/api/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: ada.cookie },
        body: JSON.stringify({ to: "Bea", body: `note-${i}` }),
      });
      assert.equal(ok.status, 200);
    }
    const capped = await app.request("/api/mail", { headers: { Cookie: bea.cookie } });
    const cappedBody = (await capped.json()) as { messages: { body: string }[] };
    assert.equal(cappedBody.messages.length, COMMANDER_MAIL_MAX_PER_RECIPIENT);
    assert.equal(cappedBody.messages.some((message) => message.body === "note-0"), false);
    assert.equal(cappedBody.messages.at(-1)?.body, `note-${COMMANDER_MAIL_MAX_PER_RECIPIENT}`);
  });
});

describe("commander mail D1 table", () => {
  beforeEach(() => {
    resetCommanderMailForTests();
  });

  it("stores notes in commander_mail and drops the oldest past the cap", async () => {
    const db = sqliteD1();
    await ensureRowTables(db);
    await db.prepare(
      "INSERT INTO save_players (id, version, doc) VALUES (?, 1, ?)",
    ).bind("p1", JSON.stringify({ id: "p1", name: "Ada" })).run();
    await db.prepare(
      "INSERT INTO save_players (id, version, doc) VALUES (?, 1, ?)",
    ).bind("p2", JSON.stringify({ id: "p2", name: "Bea" })).run();

    let clock = 1_700_000_000_000;
    setCommanderMailClockForTests(() => {
      clock += 61_000;
      return clock;
    });
    await runWithScope({ kv: null, db, mode: "d1", cpuMs: 0 }, async () => {
      for (let i = 0; i <= COMMANDER_MAIL_MAX_PER_RECIPIENT; i++) {
        const sent = await sendCommanderMail("p1", "Bea", `row-${i}`);
        assert.equal(sent.ok, true);
      }
      const inbox = await listCommanderMail("p2");
      assert.equal(inbox.length, COMMANDER_MAIL_MAX_PER_RECIPIENT);
      assert.equal(inbox.some((message) => message.body === "row-0"), false);
      assert.equal(inbox.at(-1)?.body, `row-${COMMANDER_MAIL_MAX_PER_RECIPIENT}`);
      const hidden = await listCommanderMail("p1");
      assert.equal(hidden.length, 0);
    });

    const count = await db.prepare(
      "SELECT COUNT(*) AS n FROM commander_mail",
    ).bind().first<{ n: number }>();
    assert.equal(count?.n, COMMANDER_MAIL_MAX_PER_RECIPIENT);
    const world = await db.prepare(
      "SELECT id FROM save_world",
    ).bind().first<{ id: string }>();
    assert.equal(world, null);
  });
});
