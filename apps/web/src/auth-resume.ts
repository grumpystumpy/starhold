/**
 * Boot decides whether a failed /api/auth/me ends the saved commander.
 * Only a real 401 clears the id. 503, HTML error pages, and network
 * failures keep it and retry.
 */
export type ResumeDecision = "ready" | "guest" | "logout" | "retry";

export function resumeDecision(
  status: number,
  hasAccount: boolean,
): ResumeDecision {
  if (status === 401) return "logout";
  if (status === 200 && hasAccount) return "ready";
  if (status === 200 && !hasAccount) return "guest";
  return "retry";
}

export function shouldClearSavedPlayer(status: number): boolean {
  return resumeDecision(status, false) === "logout";
}

/** Backoff for "Reconnecting…". Caps so a long outage does not hammer D1. */
export function reconnectDelayMs(attempt: number): number {
  const step = Math.max(0, attempt);
  return Math.min(15_000, 1_000 * 2 ** step);
}
