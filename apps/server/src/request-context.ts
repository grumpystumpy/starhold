import { AsyncLocalStorage } from "node:async_hooks";
import type { TickBudget } from "@starhold/game";
import type { KvStore, StorageMode } from "./kv.js";

export interface ScryptMigrateRequest {
  attemptId?: string;
  /** Peppered password. Held in the Durable Object's memory until the verify finishes. */
  password: string;
  encoded: string;
}

export interface ScryptMigrateResult {
  done: boolean;
  match: boolean;
  attemptId: string;
}

export interface RequestScope {
  kv: KvStore | null;
  mode?: StorageMode;
  /** HTTP method for this request. Unset on Vercel, so saves stay unconditional. */
  method?: string;
  budget?: TickBudget;
  cpuMs: number;
  /**
   * Workers inject this so a scrypt verify is sliced under the 10 ms CPU cap.
   * Absent in tests: the account module verifies with Node scrypt and rehashes.
   */
  migrateScrypt?: (
    request: ScryptMigrateRequest,
  ) => Promise<ScryptMigrateResult>;
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
