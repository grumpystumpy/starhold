import type {
  BuildingId,
  DefenseId,
  PlayerView,
  ResearchId,
  ShipId,
} from "@starhold/game";
import type { NavPage } from "./ui/nav";

export const SESSION_KEY = "starhold.playerId";
/** Keep reject/success flashes readable across 1s polls. */
export const FLASH_TTL_MS = 12_000;
/**
 * After pointerup, keep deferring full paints briefly so a click (or armed
 * pointerup action) can land before 1s poll innerHTML replaces the button.
 */
export const GESTURE_PAINT_GRACE_MS = 200;

const rootEl = document.querySelector<HTMLElement>("#app");
if (!rootEl) {
  throw new Error("#app missing");
}
export const root: HTMLElement = rootEl;

export const session = {
  view: null as PlayerView | null,
  error: null as string | null,
  notice: null as string | null,
  flashUntil: 0,
  busy: false,
  joinDraft: "",
  pollTimer: undefined as number | undefined,
  flashTimer: undefined as number | undefined,
  /** Defer full paints while a pointer is down so polls cannot swallow clicks. */
  pointersDown: 0,
  paintQueued: false,
  handlersBound: false,
  gestureGraceUntil: 0,
  graceFlushTimer: undefined as number | undefined,
  /** Armed from pointerdown capture — survives button node replacement mid-gesture. */
  armedUpgrade: null as BuildingId | null,
  armedShip: null as ShipId | null,
  armedDefense: null as DefenseId | null,
  armedResearch: null as ResearchId | null,
  /** Galaxy browser system override (null = follow active planet). */
  galaxySystem: null as number | null,
  /** Active routed page (synced to URL pathname). */
  activePage: "overview" as NavPage,
  /** Ignore duplicate click after pointerup already dispatched the armed action. */
  suppressClickUntil: 0,
};

let paintImpl: () => void = () => {};

export function setPaintImpl(fn: () => void): void {
  paintImpl = fn;
}

export function paintsDeferred(): boolean {
  return (
    session.pointersDown > 0 || Date.now() < session.gestureGraceUntil
  );
}

export function schedulePaint(): void {
  if (paintsDeferred()) {
    session.paintQueued = true;
    return;
  }
  session.paintQueued = false;
  paintImpl();
}

/** Flush a poll paint that was deferred across a pointer gesture — after click. */
export function flushDeferredPaint(): void {
  if (paintsDeferred() || !session.paintQueued) return;
  session.paintQueued = false;
  paintImpl();
}

export function armGestureGrace(): void {
  session.gestureGraceUntil = Date.now() + GESTURE_PAINT_GRACE_MS;
  if (session.graceFlushTimer !== undefined) {
    window.clearTimeout(session.graceFlushTimer);
  }
  session.graceFlushTimer = window.setTimeout(() => {
    session.graceFlushTimer = undefined;
    flushDeferredPaint();
  }, GESTURE_PAINT_GRACE_MS + 5);
}

export function setFlash(kind: "error" | "notice", message: string): void {
  if (kind === "error") {
    session.error = message;
    session.notice = null;
  } else {
    session.notice = message;
    session.error = null;
  }
  session.flashUntil = Date.now() + FLASH_TTL_MS;
  if (session.flashTimer !== undefined) window.clearTimeout(session.flashTimer);
  session.flashTimer = window.setTimeout(() => {
    if (Date.now() >= session.flashUntil) {
      session.error = null;
      session.notice = null;
      schedulePaint();
    }
  }, FLASH_TTL_MS + 50);
}

export function clearFlash(): void {
  session.error = null;
  session.notice = null;
  session.flashUntil = 0;
  if (session.flashTimer !== undefined) {
    window.clearTimeout(session.flashTimer);
    session.flashTimer = undefined;
  }
}

export function closestActionEl(
  target: EventTarget | null,
  selector: string,
): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(selector);
}

export function readShipCount(shipId: ShipId): number {
  const countInput = root.querySelector<HTMLInputElement>(
    `[data-ship-count="${shipId}"]`,
  );
  return Math.max(1, Math.min(50, Number(countInput?.value) || 1));
}

export function readDefenseCount(defenseId: DefenseId): number {
  const countInput = root.querySelector<HTMLInputElement>(
    `[data-defense-count="${defenseId}"]`,
  );
  return Math.max(1, Math.min(50, Number(countInput?.value) || 1));
}

/**
 * Drop join-only `commander` bootstrap param.
 * Deep-link `playerId` / `planet` are kept by `syncSessionUrl` after resume.
 */
export function stripJoinParams(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("commander")) return;
  url.searchParams.delete("commander");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", next || "/");
}
