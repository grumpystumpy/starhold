import {
  COMMANDER_MAIL_MAX_CHARS,
  COMMANDER_MAIL_MAX_PER_RECIPIENT,
  COMMANDER_MAIL_RATE_PER_MIN,
  type UniverseState,
} from "@starhold/game";
import type { D1Like } from "./d1-store.js";

export interface CommanderMailMessage {
  id: string;
  fromPlayerId: string;
  fromName: string;
  toPlayerId: string;
  toName: string;
  body: string;
  createdAt: number;
}

type MailResult<T> = ({ ok: true } & T) | { ok: false; error: string };

const memoryMail: CommanderMailMessage[] = [];
const sendTimes = new Map<string, number[]>();

export function resetCommanderMailForTests(): void {
  memoryMail.length = 0;
  sendTimes.clear();
}

function stripControls(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

function allowSend(playerId: string, now: number): boolean {
  const windowStart = now - 60_000;
  const recent = (sendTimes.get(playerId) ?? []).filter((stamp) => stamp > windowStart);
  if (recent.length >= COMMANDER_MAIL_RATE_PER_MIN) {
    sendTimes.set(playerId, recent);
    return false;
  }
  recent.push(now);
  sendTimes.set(playerId, recent);
  return true;
}

function trimRecipient(rows: CommanderMailMessage[]): CommanderMailMessage[] {
  const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return sorted.slice(-COMMANDER_MAIL_MAX_PER_RECIPIENT);
}

interface MailDoc {
  fromName?: string;
  toName?: string;
  body?: string;
}

function fromDoc(
  id: string,
  fromPlayerId: string,
  toPlayerId: string,
  createdAt: number,
  doc: string,
): CommanderMailMessage {
  let parsed: MailDoc = {};
  try {
    parsed = JSON.parse(doc) as MailDoc;
  } catch {
    parsed = {};
  }
  return {
    id,
    fromPlayerId,
    fromName: typeof parsed.fromName === "string" ? parsed.fromName : "",
    toPlayerId,
    toName: typeof parsed.toName === "string" ? parsed.toName : "",
    body: typeof parsed.body === "string" ? parsed.body : "",
    createdAt,
  };
}

async function listFromDb(
  db: D1Like,
  playerId: string,
  since: number,
): Promise<CommanderMailMessage[]> {
  const result = await db
    .prepare(
      `SELECT id, from_player_id, to_player_id, created_at, doc
       FROM save_commander_mail
       WHERE to_player_id = ? AND created_at > ?
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(playerId, since)
    .all<{
      id: string;
      from_player_id: string;
      to_player_id: string;
      created_at: number;
      doc: string;
    }>();
  return (result.results ?? []).map((row) =>
    fromDoc(row.id, row.from_player_id, row.to_player_id, row.created_at, row.doc),
  );
}

async function trimDb(db: D1Like, toPlayerId: string): Promise<void> {
  const result = await db
    .prepare(
      `SELECT id FROM save_commander_mail
       WHERE to_player_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .bind(toPlayerId)
    .all<{ id: string }>();
  const ids = (result.results ?? []).map((row) => row.id);
  const extra = ids.length - COMMANDER_MAIL_MAX_PER_RECIPIENT;
  for (let i = 0; i < extra; i += 1) {
    const id = ids[i];
    if (!id) continue;
    await db
      .prepare("DELETE FROM save_commander_mail WHERE id = ? AND to_player_id = ?")
      .bind(id, toPlayerId)
      .run();
  }
}

export async function listCommanderMail(
  db: D1Like | null | undefined,
  playerId: string,
  since?: number,
): Promise<MailResult<{ messages: CommanderMailMessage[] }>> {
  const after = since != null && Number.isFinite(since) ? since : 0;
  if (db) {
    const messages = await listFromDb(db, playerId, after);
    return { ok: true, messages };
  }
  const messages = trimRecipient(memoryMail.filter((row) => row.toPlayerId === playerId))
    .filter((row) => row.createdAt > after);
  return { ok: true, messages };
}

export async function sendCommanderMail(
  db: D1Like | null | undefined,
  universe: UniverseState,
  fromPlayerId: string,
  toNameRaw: string,
  bodyRaw: string,
  now = Date.now(),
): Promise<MailResult<{ message: CommanderMailMessage }>> {
  const sender = universe.players[fromPlayerId];
  if (!sender) return { ok: false, error: "Unknown player." };
  const toName = stripControls(toNameRaw).slice(0, 24);
  if (!toName) return { ok: false, error: "Commander name required." };
  const body = stripControls(bodyRaw);
  if (!body) return { ok: false, error: "Message is empty." };
  if (body.length > COMMANDER_MAIL_MAX_CHARS) {
    return {
      ok: false,
      error: `Message must be ${COMMANDER_MAIL_MAX_CHARS} characters or fewer.`,
    };
  }
  const matches = Object.values(universe.players).filter((player) => player.name === toName);
  if (matches.length !== 1) {
    return {
      ok: false,
      error: matches.length === 0 ? "Commander not found." : "That commander name is not unique.",
    };
  }
  const recipient = matches[0]!;
  if (recipient.id === fromPlayerId) {
    return { ok: false, error: "You cannot mail yourself." };
  }
  if (!allowSend(fromPlayerId, now)) {
    return {
      ok: false,
      error: `Mail limit is ${COMMANDER_MAIL_RATE_PER_MIN} messages per minute.`,
    };
  }
  const message: CommanderMailMessage = {
    id: `mail_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    fromPlayerId,
    fromName: sender.name,
    toPlayerId: recipient.id,
    toName: recipient.name,
    body,
    createdAt: now,
  };
  if (db) {
    await db
      .prepare(
        `INSERT INTO save_commander_mail (id, to_player_id, from_player_id, created_at, doc)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        message.id,
        message.toPlayerId,
        message.fromPlayerId,
        message.createdAt,
        JSON.stringify({
          fromName: message.fromName,
          toName: message.toName,
          body: message.body,
        }),
      )
      .run();
    await trimDb(db, message.toPlayerId);
    return { ok: true, message };
  }
  memoryMail.push(message);
  const kept = new Set(
    trimRecipient(memoryMail.filter((row) => row.toPlayerId === recipient.id)).map((row) => row.id),
  );
  for (let i = memoryMail.length - 1; i >= 0; i -= 1) {
    const row = memoryMail[i]!;
    if (row.toPlayerId === recipient.id && !kept.has(row.id)) memoryMail.splice(i, 1);
  }
  return { ok: true, message };
}

export async function deleteCommanderMail(
  db: D1Like | null | undefined,
  playerId: string,
  mailId: string,
): Promise<MailResult<{ deleted: boolean }>> {
  const id = mailId.trim();
  if (!id) return { ok: false, error: "Mail not found." };
  if (db) {
    const run = await db
      .prepare("DELETE FROM save_commander_mail WHERE id = ? AND to_player_id = ?")
      .bind(id, playerId)
      .run();
    if ((run.meta?.changes ?? 0) < 1) return { ok: false, error: "Mail not found." };
    return { ok: true, deleted: true };
  }
  const index = memoryMail.findIndex((row) => row.id === id && row.toPlayerId === playerId);
  if (index < 0) return { ok: false, error: "Mail not found." };
  memoryMail.splice(index, 1);
  return { ok: true, deleted: true };
}
