import {
  commanderMailDropIds,
  commanderMailRateError,
  commanderMailSendAllowed,
  normalizeCommanderMailBody,
  resetCommanderMailRateLimit,
  visibleCommanderMail,
  type CommanderMailMessage,
} from "@starhold/game";
import type { D1Like } from "./d1-store.js";
import { currentScope } from "./request-context.js";
import { ensureRowTables } from "./row-store.js";
import { setMemoryResetHook, storageMode, withUniverse } from "./store.js";

const DELETE_CHUNK = 5;

interface MailRow {
  id: string;
  senderId: string;
  senderName: string;
  recipientId: string;
  body: string;
  createdAt: number;
}

const memoryRows: MailRow[] = [];
let mailNow = (): number => Date.now();
let lastStamp = 0;

function nextStamp(): number {
  const stamped = Math.max(mailNow(), lastStamp + 1);
  lastStamp = stamped;
  return stamped;
}

/** Test hook. Production uses Date.now. */
export function setCommanderMailClockForTests(next: (() => number) | null): void {
  mailNow = next ?? (() => Date.now());
}

export function resetCommanderMailForTests(): void {
  memoryRows.length = 0;
  resetCommanderMailRateLimit();
  mailNow = () => Date.now();
  lastStamp = 0;
}

setMemoryResetHook(() => {
  memoryRows.length = 0;
  resetCommanderMailRateLimit();
});

function useD1(): D1Like | null {
  const db = currentScope()?.db;
  if (!db || storageMode() !== "d1") return null;
  return db;
}

async function sqlAll<T>(db: D1Like, sql: string, ...values: unknown[]): Promise<T[]> {
  const rows = await db.prepare(sql).bind(...values).all<T>();
  return rows.results ?? [];
}

async function sqlFirst<T>(db: D1Like, sql: string, ...values: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...values).first<T>();
}

async function sqlRun(db: D1Like, sql: string, ...values: unknown[]): Promise<number> {
  const result = await db.prepare(sql).bind(...values).run();
  return result.meta?.changes ?? 0;
}

function toMessage(row: MailRow): CommanderMailMessage {
  return {
    id: row.id,
    senderId: row.senderId,
    senderName: row.senderName,
    body: row.body,
    createdAt: row.createdAt,
  };
}

async function findNamed(
  name: string,
): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const db = useD1();
  if (db) {
    await ensureRowTables(db);
    const rows = await sqlAll<{ id: string; name: string | null }>(
      db,
      `SELECT id, json_extract(doc, '$.name') AS name
       FROM save_players
       WHERE lower(json_extract(doc, '$.name')) = lower(?)
       LIMIT 2`,
      name,
    );
    if (rows.length > 1) {
      return { ok: false, error: "More than one commander has that name." };
    }
    const row = rows[0];
    if (!row?.id || typeof row.name !== "string" || !row.name) {
      return { ok: false, error: "No commander by that name." };
    }
    return { ok: true, id: row.id, name: row.name };
  }
  return withUniverse((universe) => {
    const matches = Object.values(universe.players).filter(
      (player) => player.name.toLowerCase() === name.toLowerCase(),
    );
    if (matches.length > 1) {
      return { ok: false as const, error: "More than one commander has that name." };
    }
    const player = matches[0];
    if (!player) return { ok: false as const, error: "No commander by that name." };
    return { ok: true as const, id: player.id, name: player.name };
  });
}

async function senderName(senderId: string): Promise<string | null> {
  const db = useD1();
  if (db) {
    await ensureRowTables(db);
    const row = await sqlFirst<{ name: string | null }>(
      db,
      "SELECT json_extract(doc, '$.name') AS name FROM save_players WHERE id = ?",
      senderId,
    );
    return typeof row?.name === "string" && row.name ? row.name : null;
  }
  return withUniverse((universe) => universe.players[senderId]?.name ?? null);
}

async function inboxRows(recipientId: string): Promise<MailRow[]> {
  const db = useD1();
  if (db) {
    await ensureRowTables(db);
    const rows = await sqlAll<{
      id: string;
      sender_id: string;
      sender_name: string;
      body: string;
      created_at: number;
    }>(
      db,
      `SELECT id, sender_id, sender_name, body, created_at
       FROM commander_mail
       WHERE recipient_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
      recipientId,
    );
    return rows.map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      recipientId,
      body: row.body,
      createdAt: row.created_at,
    }));
  }
  return memoryRows.filter((row) => row.recipientId === recipientId);
}

async function deleteIds(recipientId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = useD1();
  if (db) {
    for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
      const chunk = ids.slice(i, i + DELETE_CHUNK);
      const marks = chunk.map(() => "?").join(", ");
      await sqlRun(
        db,
        `DELETE FROM commander_mail WHERE recipient_id = ? AND id IN (${marks})`,
        recipientId,
        ...chunk,
      );
    }
    return;
  }
  const drop = new Set(ids);
  for (let i = memoryRows.length - 1; i >= 0; i--) {
    const row = memoryRows[i];
    if (row && row.recipientId === recipientId && drop.has(row.id)) {
      memoryRows.splice(i, 1);
    }
  }
}

export async function listCommanderMail(
  recipientId: string,
  since?: number,
): Promise<CommanderMailMessage[]> {
  const rows = await inboxRows(recipientId);
  return visibleCommanderMail(rows, since).map(toMessage);
}

export async function deleteCommanderMail(
  recipientId: string,
  id: string,
): Promise<boolean> {
  const db = useD1();
  if (db) {
    await ensureRowTables(db);
    const changes = await sqlRun(
      db,
      "DELETE FROM commander_mail WHERE id = ? AND recipient_id = ?",
      id,
      recipientId,
    );
    return changes > 0;
  }
  const index = memoryRows.findIndex(
    (row) => row.id === id && row.recipientId === recipientId,
  );
  if (index < 0) return false;
  memoryRows.splice(index, 1);
  return true;
}

export async function sendCommanderMail(
  senderId: string,
  toRaw: string,
  rawBody: string,
): Promise<
  | { ok: true; message: CommanderMailMessage }
  | { ok: false; error: string }
> {
  const to = toRaw.trim();
  if (!to || to.length > 24) {
    return { ok: false, error: "No commander by that name." };
  }
  const body = normalizeCommanderMailBody(rawBody);
  if (!body.ok) return body;
  const fromName = await senderName(senderId);
  if (!fromName) return { ok: false, error: "Unknown player." };
  const recipient = await findNamed(to);
  if (!recipient.ok) return recipient;
  if (recipient.id === senderId) {
    return { ok: false, error: "You cannot mail yourself." };
  }
  const now = nextStamp();
  if (!commanderMailSendAllowed(senderId, now)) {
    return { ok: false, error: commanderMailRateError() };
  }
  const message: MailRow = {
    id: `mail_${now.toString(36)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
    senderId,
    senderName: fromName,
    recipientId: recipient.id,
    body: body.body,
    createdAt: now,
  };
  const existing = await inboxRows(recipient.id);
  await deleteIds(recipient.id, commanderMailDropIds(existing));
  const db = useD1();
  if (db) {
    await sqlRun(
      db,
      `INSERT INTO commander_mail
        (id, sender_id, sender_name, recipient_id, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      message.id,
      message.senderId,
      message.senderName,
      message.recipientId,
      message.body,
      message.createdAt,
    );
  } else {
    memoryRows.push(message);
  }
  return { ok: true, message: toMessage(message) };
}
