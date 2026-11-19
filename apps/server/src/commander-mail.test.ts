import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  COMMANDER_MAIL_MAX_CHARS,
  COMMANDER_MAIL_MAX_PER_RECIPIENT,
  COMMANDER_MAIL_RATE_PER_MIN,
  createUniverse,
  joinUniverse,
} from "@starhold/game";
import { createApp } from "./app.js";
import { resetMemoryAccounts } from "./accounts.js";
import {
  listCommanderMail,
  resetCommanderMailForTests,
  sendCommanderMail,
  type CommanderMailMessage,
} from "./commander-mail.js";
import type { D1Like, D1Stmt } from "./d1-store.js";
import { resetMemoryUniverse } from "./store.js";

describe("commander mail", () => {
  beforeEach(() => {
    resetMemoryAccounts();
    resetMemoryUniverse();
    resetCommanderMailForTests();
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
  });

  async function signupAndJoin(email: string, name: string) {
    const app = createApp();
    const signup = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "hunter2xx" }),
    });
    assert.equal(signup.status, 200);
    const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0]!;
    const join = await app.request("/api/auth/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name }),
    });
    assert.equal(join.status, 200);
    const view = (await join.json()) as { player: { id: string; name: string } };
    return { app, cookie, view };
  }

  it("requires a session and keeps mail off the universe poll", async () => {
    const from = await signupAndJoin("mail-from@example.com", "Mailer");
    const to = await signupAndJoin("mail-to@example.com", "Inbox");
    const missing = await from.app.request("/api/mail");
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).error, "Sign in required.");

    const sent = await from.app.request("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: from.cookie },
      body: JSON.stringify({ to: "Inbox", body: "Hello <b>there</b>" }),
    });
    assert.equal(sent.status, 200);
    const message = ((await sent.json()) as { message: CommanderMailMessage }).message;
    assert.equal(message.body, "Hello <b>there</b>");
    assert.equal(message.toPlayerId, to.view.player.id);

    const listed = await to.app.request("/api/mail", {
      headers: { Cookie: to.cookie },
    });
    assert.equal(listed.status, 200);
    const messages = ((await listed.json()) as { messages: CommanderMailMessage[] }).messages;
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.body, "Hello <b>there</b>");

    const hidden = await from.app.request("/api/mail", {
      headers: { Cookie: from.cookie },
    });
    assert.equal(((await hidden.json()) as { messages: unknown[] }).messages.length, 0);

    const state = await to.app.request(`/api/state?playerId=${to.view.player.id}`, {
      headers: { Cookie: to.cookie },
    });
    assert.equal(state.status, 200);
    const stateText = await state.text();
    assert.equal(stateText.includes("Hello <b>there</b>"), false);
    assert.equal(stateText.includes("save_commander_mail"), false);

    const since = await to.app.request(`/api/mail?since=${message.createdAt}`, {
      headers: { Cookie: to.cookie },
    });
    assert.equal(((await since.json()) as { messages: unknown[] }).messages.length, 0);

    const stolen = await from.app.request(`/api/mail/${message.id}`, {
      method: "DELETE",
      headers: { Cookie: from.cookie },
    });
    assert.equal(stolen.status, 400);

    const removed = await to.app.request(`/api/mail/${message.id}`, {
      method: "DELETE",
      headers: { Cookie: to.cookie },
    });
    assert.equal(removed.status, 200);
    const after = await to.app.request("/api/mail", { headers: { Cookie: to.cookie } });
    assert.equal(((await after.json()) as { messages: unknown[] }).messages.length, 0);
  });

  it("rejects a long body, a missing commander, and mail to yourself", async () => {
    const from = await signupAndJoin("mail-rules@example.com", "Rules");
    const long = await from.app.request("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: from.cookie },
      body: JSON.stringify({ to: "Rules", body: "x".repeat(COMMANDER_MAIL_MAX_CHARS + 1) }),
    });
    assert.equal(long.status, 400);
    const self = await from.app.request("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: from.cookie },
      body: JSON.stringify({ to: "Rules", body: "hi" }),
    });
    assert.equal(self.status, 400);
    assert.equal((await self.json()).error, "You cannot mail yourself.");
    const unknown = await from.app.request("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: from.cookie },
      body: JSON.stringify({ to: "Nobody", body: "hi" }),
    });
    assert.equal(unknown.status, 400);
    assert.equal((await unknown.json()).error, "Commander not found.");
  });

  it("drops the oldest mail past the recipient cap and rate-limits the sender", async () => {
    const universe = createUniverse("Mail Cap", 8, 8);
    const sender = joinUniverse(universe, "Sender");
    const recipient = joinUniverse(universe, "Recipient");
    const firstIds: string[] = [];
    for (let i = 0; i < COMMANDER_MAIL_MAX_PER_RECIPIENT + 1; i += 1) {
      const sent = await sendCommanderMail(
        null,
        universe,
        sender.player.id,
        "Recipient",
        `note ${i}`,
        90_000_000 + i * 61_000,
      );
      assert.equal(sent.ok, true);
      if (sent.ok) firstIds.push(sent.message.id);
    }
    const kept = await listCommanderMail(null, recipient.player.id);
    assert.equal(kept.ok, true);
    if (!kept.ok) return;
    assert.equal(kept.messages.length, COMMANDER_MAIL_MAX_PER_RECIPIENT);
    assert.equal(kept.messages.some((row) => row.id === firstIds[0]), false);
    assert.equal(kept.messages.some((row) => row.body === "note 100"), true);
    assert.equal(JSON.stringify(universe).includes("note 100"), false);

    const burstNow = 90_000_000 + (COMMANDER_MAIL_MAX_PER_RECIPIENT + 2) * 61_000;
    for (let i = 0; i < COMMANDER_MAIL_RATE_PER_MIN; i += 1) {
      const allowed = await sendCommanderMail(
        null,
        universe,
        sender.player.id,
        "Recipient",
        `burst ${i}`,
        burstNow,
      );
      assert.equal(allowed.ok, true);
    }
    const burst = await sendCommanderMail(
      null,
      universe,
      sender.player.id,
      "Recipient",
      "too fast",
      burstNow,
    );
    assert.equal(burst.ok, false);
    if (!burst.ok) {
      assert.match(burst.error, new RegExp(String(COMMANDER_MAIL_RATE_PER_MIN)));
    }
  });

  it("writes the D1 table and does not touch the universe document", async () => {
    const universe = createUniverse("Mail D1", 8, 8);
    const sender = joinUniverse(universe, "DbSender");
    const recipient = joinUniverse(universe, "DbInbox");
    const rows: Array<{ id: string; to: string; doc: string; created: number }> = [];
    const db: D1Like = {
      prepare(sql: string): D1Stmt {
        const state = { sql, values: [] as unknown[] };
        const stmt: D1Stmt = {
          bind(...values: unknown[]) {
            state.values = values;
            return stmt;
          },
          async all<T>() {
            if (state.sql.includes("SELECT id, from_player_id")) {
              const to = String(state.values[0]);
              const since = Number(state.values[1]);
              return {
                results: rows
                  .filter((row) => row.to === to && row.created > since)
                  .map((row) => ({
                    id: row.id,
                    from_player_id: sender.player.id,
                    to_player_id: row.to,
                    created_at: row.created,
                    doc: row.doc,
                  })) as T[],
              };
            }
            if (state.sql.includes("SELECT id FROM")) {
              const to = String(state.values[0]);
              return {
                results: rows.filter((row) => row.to === to).map((row) => ({ id: row.id })) as T[],
              };
            }
            return { results: [] as T[] };
          },
          async run() {
            if (state.sql.includes("INSERT INTO save_commander_mail")) {
              rows.push({
                id: String(state.values[0]),
                to: String(state.values[1]),
                doc: String(state.values[4]),
                created: Number(state.values[3]),
              });
              return { meta: { changes: 1 } };
            }
            if (state.sql.includes("DELETE FROM save_commander_mail")) {
              const id = String(state.values[0]);
              const index = rows.findIndex((row) => row.id === id);
              if (index >= 0) rows.splice(index, 1);
              return { meta: { changes: index >= 0 ? 1 : 0 } };
            }
            return { meta: { changes: 0 } };
          },
        };
        return stmt;
      },
      async batch() {
        return [];
      },
    };
    const sent = await sendCommanderMail(db, universe, sender.player.id, "DbInbox", "stored", 10_000);
    assert.equal(sent.ok, true);
    assert.equal(rows.length, 1);
    assert.match(rows[0]?.doc ?? "", /stored/);
    assert.equal(JSON.stringify(universe).includes("stored"), false);
    const listed = await listCommanderMail(db, recipient.player.id);
    assert.equal(listed.ok && listed.messages[0]?.body, "stored");
  });
});
