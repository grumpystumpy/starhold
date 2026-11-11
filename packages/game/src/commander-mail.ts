import {
  COMMANDER_MAIL_MAX_CHARS,
  COMMANDER_MAIL_MAX_PER_RECIPIENT,
  COMMANDER_MAIL_RATE_PER_MIN,
} from "./data/tuning.js";

/** One private note delivered to a commander's inbox. */
export interface CommanderMailMessage {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: number;
}

const sendTimes = new Map<string, number[]>();

/** Test hook. The send cap is in-process, same as alliance chat. */
export function resetCommanderMailRateLimit(): void {
  sendTimes.clear();
}

function stripControls(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

export function normalizeCommanderMailBody(
  raw: string,
): { ok: true; body: string } | { ok: false; error: string } {
  const body = stripControls(raw);
  if (!body) return { ok: false, error: "Message is empty." };
  if (body.length > COMMANDER_MAIL_MAX_CHARS) {
    return {
      ok: false,
      error: `Message must be ${COMMANDER_MAIL_MAX_CHARS} characters or fewer.`,
    };
  }
  return { ok: true, body };
}

/** True when this sender may post. Consumes one slot on success. */
export function commanderMailSendAllowed(senderId: string, now: number): boolean {
  const windowStart = now - 60_000;
  const recent = (sendTimes.get(senderId) ?? []).filter((t) => t > windowStart);
  if (recent.length >= COMMANDER_MAIL_RATE_PER_MIN) {
    sendTimes.set(senderId, recent);
    return false;
  }
  recent.push(now);
  sendTimes.set(senderId, recent);
  return true;
}

export function commanderMailRateError(): string {
  return `Mail limit is ${COMMANDER_MAIL_RATE_PER_MIN} messages per minute.`;
}

/**
 * Ids to delete before inserting one more row, so the recipient stays at the cap.
 * `existing` must not include the row about to be inserted.
 */
export function commanderMailDropIds(
  existing: { id: string; createdAt: number }[],
): string[] {
  if (existing.length < COMMANDER_MAIL_MAX_PER_RECIPIENT) return [];
  const sorted = [...existing].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  const keep = COMMANDER_MAIL_MAX_PER_RECIPIENT - 1;
  return sorted.slice(0, sorted.length - keep).map((row) => row.id);
}

/** Newest cap, oldest first, optionally only rows newer than `since`. */
export function visibleCommanderMail<T extends { id: string; createdAt: number }>(
  rows: T[],
  since?: number,
): T[] {
  const sorted = [...rows].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  const capped =
    sorted.length > COMMANDER_MAIL_MAX_PER_RECIPIENT
      ? sorted.slice(sorted.length - COMMANDER_MAIL_MAX_PER_RECIPIENT)
      : sorted;
  if (since == null || !Number.isFinite(since)) return capped;
  return capped.filter((row) => row.createdAt > since);
}
