import { AsyncLocalStorage } from "node:async_hooks";
import type { HighscoreEntry, TickBudget } from "@starhold/game";
import type { D1Like } from "./d1-store.js";
import type { KvStore, StorageMode } from "./kv.js";

export interface RequestScope {
  kv: KvStore | null;
  /** Present on Workers. Row saves use this; the kv binding stays for accounts and the legacy universe. */
  db?: D1Like;
  mode?: StorageMode;
  /** HTTP method for this request. Unset on Vercel, so saves stay unconditional. */
  method?: string;
  budget?: TickBudget;
  cpuMs: number;
  /** Cached highscore board for this request. Only set on the row-save path. */
  highscores?: HighscoreEntry[];
  /** Page loads on the row path must not recompute rankings. */
  rowSave?: boolean;
}

const scopes = new AsyncLocalStorage<RequestScope>();

export function runWithScope<T>(scope: RequestScope, fn: () => T): T {
  return scopes.run(scope, fn);
}

export function currentScope(): RequestScope | undefined {
  return scopes.getStore();
}

export function currentMethod(): string | undefined {
  return scopes.getStore()?.method;
}

/** Add elapsed milliseconds that were spent on CPU-ish work (not D1 I/O). */
export function addCpu(ms: number): void {
  const scope = scopes.getStore();
  if (scope) scope.cpuMs += ms;
}

export function readCpuMs(): number {
  return scopes.getStore()?.cpuMs ?? 0;
}

let reportError: ((err: unknown) => void) | null = null;

/** Worker installs this when SENTRY_DSN is set. No-op otherwise. */
export function setServerErrorReporter(
  fn: ((err: unknown) => void) | null,
): void {
  reportError = fn;
}

export function reportServerError(err: unknown): void {
  try {
    reportError?.(err);
  } catch {
    /* a reporter must not replace the player-facing error */
  }
}
