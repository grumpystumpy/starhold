import { MAP_GALAXIES, MAP_SYSTEMS, type PlayerView } from "@starhold/game";
import type { NavPage } from "./ui/nav";
import {
  ApiError,
  OVERLOAD_MESSAGE,
  authJoin,
  claimAnonymousPlayer,
  fetchAuthMe,
  fetchAllianceChat,
  fetchSecurity,
  fetchState,
  changeAccountPassword,
  generateRecoveryCodes,
  invalidateCachedState,
  joinGame,
  loginAccount,
  recoverAccount,
  relocateMiniFortress,
  renamePlanet,
  requestPasswordReset,
  confirmPasswordReset,
  revokeOtherSessions,
  selectPlanet,
  setAfterPlayerMutation,
  signupAccount,
} from "./api";
import {
  reconnectDelayMs,
  shouldClearSavedPlayer,
} from "./auth-resume";
import {
  SESSION_KEY,
  clearFlash,
  schedulePaint,
  session,
  setBeforePaintImpl,
  setFlash,
  stripJoinParams,
} from "./session";
import { setOnPageChange, syncSessionUrl } from "./ui/router";
import { captureGameEvent, identifyCommander } from "./telemetry";
import { settleMutation } from "./recover-action";

/** Background refresh cadence. Actions apply their own response immediately. */
export const POLL_INTERVAL_MS = 30_000;
/** One silent retry before a poll shows an overload flash. */
export const POLL_RETRY_DELAY_MS = 400;
const SCOPED_REFRESH_PAGES: ReadonlySet<NavPage> = new Set([
  "messages",
  "seasons",
  "galaxy",
  "fleet",
  "highscore",
  "shop",
  "alliances",
]);
const QUEUE_COMPLETION_REFRESH_DELAY_MS = 250;
const MAX_STALE_COMPLETION_MS = 5_000;
/** No input for this long: stop polling until the player interacts. */
export const IDLE_PAUSE_MS = 3 * 60 * 1000;

let reconnectAttempt = 0;
let reconnectTimer: number | undefined;

function httpStatus(err: unknown): number {
  return err instanceof ApiError ? err.status : 0;
}

/**
 * Join, login, and account POSTs are not checked against empire state.
 * Don't tell the player we are "checking whether the order went through".
 */
function authFlashMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : fallback;
  if (message === OVERLOAD_MESSAGE) {
    return "The server hiccuped. Try again in a moment.";
  }
  return message;
}

export function scheduleReconnect(): void {
  if (typeof window === "undefined") return;
  if (reconnectTimer !== undefined) return;
  const delay = reconnectDelayMs(reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    void retryResume();
  }, delay);
}

async function retryResume(): Promise<void> {
  const outcome = await resumeFromCookie();
  if (outcome === "ready" || outcome === "account") {
    reconnectAttempt = 0;
    return;
  }
  if (outcome === "logout") {
    reconnectAttempt = 0;
    setFlash("error", "Signed out.");
    schedulePaint();
    return;
  }
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    try {
      const view = await fetchState(saved);
      session.view = view;
      session.galaxySystem = view.planet.coords.system;
      session.galaxyGalaxy = null;
      session.joinDraft = view.player.name;
      syncSessionUrl({ replace: true });
      startPolling(saved);
      reconnectAttempt = 0;
      session.holdJoin = false;
      setFlash("notice", `Resumed ${view.player.name}.`);
      schedulePaint();
      return;
    } catch (err) {
      const status = httpStatus(err);
      if (status === 404) {
        localStorage.removeItem(SESSION_KEY);
        session.view = null;
        session.holdJoin = false;
        reconnectAttempt = 0;
        setFlash("error", "Saved session expired — join again.");
        schedulePaint();
        return;
      }
      if (shouldClearSavedPlayer(status)) {
        localStorage.removeItem(SESSION_KEY);
        session.view = null;
        session.holdJoin = false;
        reconnectAttempt = 0;
        setFlash("error", "Signed out.");
        schedulePaint();
        return;
      }
      session.holdJoin = true;
    }
  } else if (outcome === "none") {
    reconnectAttempt = 0;
    return;
  }
  setFlash("notice", "Reconnecting…");
  schedulePaint();
  scheduleReconnect();
}
let pollPlayerId: string | null = null;
let pollChain: Promise<void> | null = null;
let refreshGen = 0;
let refreshInFlight: { key: string; promise: Promise<void> } | null = null;
let visibilityBound = false;
let activityBound = false;
let lastActivityAt = 0;
let idleTimer: number | undefined;
let idlePaused = false;
let queueCompletionTimer: number | undefined;
const completedQueueTimes = new Set<string>();
function tabHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function pollsAllowed(): boolean {
  return Boolean(pollPlayerId) && !tabHidden() && !idlePaused;
}

function clearPollTimer(): void {
  if (session.pollTimer !== undefined) {
    window.clearTimeout(session.pollTimer);
    session.pollTimer = undefined;
  }
}

function clearQueueCompletionTimer(): void {
  if (queueCompletionTimer !== undefined) {
    window.clearTimeout(queueCompletionTimer);
    queueCompletionTimer = undefined;
  }
}

function scheduleQueueCompletionRefresh(): void {
  clearQueueCompletionTimer();
  const view = session.view;
  if (!view) {
    completedQueueTimes.clear();
    return;
  }

  const now = Date.now();
  const finishAt = [
    ...view.planet.buildQueue.map((item) => ({ completesAt: item.completesAt, tag: `build:${item.id}:${item.completesAt}` })),
    ...view.player.researchQueue.map((item) => ({ completesAt: item.completesAt, tag: `research:${item.id}:${item.completesAt}` })),
    ...view.planet.shipQueue.map((item) => ({ completesAt: item.completesAt, tag: `ship:${item.id}:${item.completesAt}` })),
    ...(view.planet.defenseQueue ?? []).map((item) => ({ completesAt: item.completesAt, tag: `defense:${item.id}:${item.completesAt}` })),
    ...(view.fleets ?? []).map((f) => ({ completesAt: f.arrivesAt, tag: `fleet:${f.id}:${f.phase}:${f.arrivesAt}` })),
    ...(view.hostileInbound ?? []).map((f) => ({ completesAt: f.arrivesAt, tag: `hostile:${f.id}:${f.arrivesAt}` })),
  ]
    .map((item) => item.completesAt)
    .filter(
      (time) =>
        Number.isFinite(time) &&
        time >= now - MAX_STALE_COMPLETION_MS &&
        !completedQueueTimes.has(`${view.player.id}:${time}`),
    )
    .sort((a, b) => a - b)[0];
  if (finishAt === undefined) return;

  const playerId = view.player.id;
  const completionKey = `${playerId}:${finishAt}`;
  queueCompletionTimer = window.setTimeout(() => {
    queueCompletionTimer = undefined;
    if (session.view?.player.id !== playerId) return;
    completedQueueTimes.add(completionKey);
    invalidateCachedState();
    void silentRefresh(playerId);
  }, Math.max(0, finishAt - now + QUEUE_COMPLETION_REFRESH_DELAY_MS));
}

setBeforePaintImpl(scheduleQueueCompletionRefresh);

/** Push the next background poll out. Does not send a request. */
export function deferBackgroundPoll(): void {
  schedulePoll(POLL_INTERVAL_MS);
}

function schedulePoll(delay: number): void {
  clearPollTimer();
  if (!pollsAllowed()) return;
  session.pollTimer = window.setTimeout(() => {
    session.pollTimer = undefined;
    void pollNow();
  }, delay);
}

function pollNow(): Promise<void> {
  if (pollChain) return pollChain;
  const playerId = pollPlayerId;
  pollChain = (async () => {
    try {
      if (!playerId || pollPlayerId !== playerId || !pollsAllowed()) return;
      await silentRefresh(playerId);
      await refreshAllianceChatIfOpen();
    } finally {
      pollChain = null;
      if (pollPlayerId === playerId) schedulePoll(POLL_INTERVAL_MS);
    }
  })();
  return pollChain;
}

/** Incremental alliance chat. Only while the Alliances page is open. */
export async function refreshAllianceChatIfOpen(): Promise<void> {
  if (session.activePage !== "alliances") return;
  const view = session.view;
  if (!view?.alliance) return;
  const since = (view.alliance.chat ?? []).reduce(
    (max, message) => Math.max(max, message.createdAt),
    0,
  );
  try {
    const payload = await fetchAllianceChat(since > 0 ? since : undefined);
    const current = session.view;
    if (!current?.alliance || current.alliance.id !== view.alliance.id) return;
    const incoming = payload.messages ?? [];
    if (incoming.length === 0) return;
    const byId = new Map(current.alliance.chat.map((message) => [message.id, message]));
    let added = false;
    for (const message of incoming) {
      if (!byId.has(message.id)) {
        byId.set(message.id, message);
        added = true;
      }
    }
    if (!added) return;
    const merged = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
    session.view = {
      ...current,
      alliance: { ...current.alliance, chat: merged.slice(-50) },
    };
    schedulePaint();
  } catch {
    /* a chat poll must not fail the state refresh */
  }
}

function clearIdleTimer(): void {
  if (idleTimer !== undefined) {
    window.clearTimeout(idleTimer);
    idleTimer = undefined;
  }
}

function pauseForIdle(): void {
  if (!pollPlayerId || idlePaused) return;
  if (Date.now() - lastActivityAt < IDLE_PAUSE_MS) {
    scheduleIdleCheck();
    return;
  }
  idlePaused = true;
  session.idlePaused = true;
  clearPollTimer();
  schedulePaint();
}

function scheduleIdleCheck(): void {
  clearIdleTimer();
  if (!pollPlayerId) return;
  const delay = Math.max(0, IDLE_PAUSE_MS - (Date.now() - lastActivityAt));
  idleTimer = window.setTimeout(() => {
    idleTimer = undefined;
    pauseForIdle();
  }, delay);
}

function resumeFromIdle(): void {
  idlePaused = false;
  session.idlePaused = false;
  schedulePaint();
  if (pollPlayerId && !tabHidden()) void pollNow();
}

/** Pointer, key, touch, scroll, or focus. The first event after idle wakes polling. */
function onActivity(): void {
  lastActivityAt = Date.now();
  if (idlePaused) resumeFromIdle();
  scheduleIdleCheck();
}

function onVisibilityChange(): void {
  if (!pollPlayerId) return;
  if (tabHidden()) {
    clearPollTimer();
    return;
  }
  if (idlePaused || Date.now() - lastActivityAt >= IDLE_PAUSE_MS) {
    pauseForIdle();
    return;
  }
  void pollNow();
}

function ensureActivityListeners(): void {
  if (activityBound || typeof document === "undefined") return;
  activityBound = true;
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  document.addEventListener("pointerdown", onActivity, opts);
  document.addEventListener("keydown", onActivity, opts);
  document.addEventListener("touchstart", onActivity, opts);
  document.addEventListener("touchmove", onActivity, opts);
  document.addEventListener("wheel", onActivity, opts);
  // `scroll` also fires when a poll repaints the page. Wheel, touch, and
  // pointer cover a person scrolling; layout shifts must not reset idle.
  window.addEventListener("focus", onActivity);
}

function ensureVisibilityListener(): void {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
}

export function startPolling(playerId: string): void {
  if (pollPlayerId !== playerId) {
    completedQueueTimes.clear();
  }
  pollPlayerId = playerId;
  lastActivityAt = Date.now();
  idlePaused = false;
  session.idlePaused = false;
  ensureVisibilityListener();
  ensureActivityListeners();
  scheduleIdleCheck();
  schedulePoll(POLL_INTERVAL_MS);
}

export function stopPolling(): void {
  pollPlayerId = null;
  clearPollTimer();
  clearQueueCompletionTimer();
  completedQueueTimes.clear();
  clearIdleTimer();
}

/** Drop a background read that started before a player action returned. */
export function bumpInFlightRefresh(): void {
  refreshGen += 1;
}

function refreshKey(playerId: string): string {
  const g = session.galaxyGalaxy ?? session.view?.galaxy.galaxy ?? "";
  const s = session.galaxySystem ?? session.view?.galaxy.system ?? "";
  return `${playerId}:${g}:${s}`;
}

export function silentRefresh(
  playerId: string,
  errorLabel = "Server unreachable",
  prefixLabel = true,
): Promise<void> {
  const key = refreshKey(playerId);
  if (refreshInFlight?.key === key) return refreshInFlight.promise;
  const promise = refreshOnce(playerId, errorLabel, prefixLabel).finally(() => {
    if (refreshInFlight?.promise === promise) refreshInFlight = null;
  });
  refreshInFlight = { key, promise };
  return promise;
}

function isPollOverload(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return (
    err.kind === "overload" ||
    err.kind === "busy" ||
    err.status === 502 ||
    err.status === 503 ||
    err.status === 504 ||
    err.status === 1102
  );
}

function pollFailureMessage(
  err: unknown,
  errorLabel: string,
  prefixLabel: boolean,
): string {
  if (isPollOverload(err)) return OVERLOAD_MESSAGE;
  if (err instanceof Error) {
    return prefixLabel ? `${errorLabel}: ${err.message}` : err.message;
  }
  return errorLabel;
}

function waitForPollRetry(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, POLL_RETRY_DELAY_MS);
  });
}

async function fetchPolledState(
  playerId: string,
  galaxy: number | undefined,
  system: number | undefined,
): Promise<PlayerView> {
  const load = () =>
    fetchState(playerId, galaxy, system, {
      page: session.activePage,
      base: session.view,
    });
  try {
    return await load();
  } catch (err) {
    if (!isPollOverload(err)) throw err;
    await waitForPollRetry();
    return await load();
  }
}

async function refreshOnce(
  playerId: string,
  errorLabel: string,
  prefixLabel: boolean,
): Promise<void> {
  const gen = ++refreshGen;
  try {
    const g = session.galaxyGalaxy ?? session.view?.galaxy.galaxy;
    const s = session.galaxySystem ?? session.view?.galaxy.system;
    const view = await fetchPolledState(playerId, g, s);
    if (gen !== refreshGen) return;
    session.view = view;
    schedulePaint();
  } catch (err) {
    if (gen !== refreshGen) return;
    if (!session.error || Date.now() >= session.flashUntil) {
      setFlash("error", pollFailureMessage(err, errorLabel, prefixLabel));
      schedulePaint();
    }
  }
}

function pageNeedsScopedFetch(page: NavPage, view: PlayerView): boolean {
  if (!SCOPED_REFRESH_PAGES.has(page)) return false;
  // The fleet composer is already on screen. A refresh here repaints it
  // mid-entry. Fleet still polls, and the slice is loaded when slots exist.
  if (page === "fleet") {
    return view.galaxy.slots.length === 0 || view.roster.length === 0;
  }
  return true;
}

setOnPageChange((page) => {
  const view = session.view;
  if (!view) return;
  if (!pageNeedsScopedFetch(page, view)) return;
  void silentRefresh(view.player.id);
});

setAfterPlayerMutation(() => {
  invalidateCachedState();
  bumpInFlightRefresh();
  deferBackgroundPoll();
  onActivity();
});

export async function doJoin(name: string): Promise<void> {
  const trimmed = name.trim();
  session.joinDraft = name;
  if (!trimmed) {
    setFlash("error", "Commander name is required.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = session.account
      ? await authJoin(trimmed)
      : await joinGame(trimmed);
    session.galaxySystem = session.view.planet.coords.system;
    session.galaxyGalaxy = null;
    session.joinDraft = session.view.player.name;
    localStorage.setItem(SESSION_KEY, session.view.player.id);
    if (session.account) {
      session.account = {
        ...session.account,
        playerId: session.view.player.id,
      };
      session.claimablePlayerId = null;
    }
    setFlash(
      "notice",
      session.account
        ? `Signed in as ${session.view.player.name}.`
        : `Joined as ${session.view.player.name}.`,
    );
    stripJoinParams();
    syncSessionUrl({ replace: true });
    startPolling(session.view.player.id);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    session.holdJoin = status === 0 || status >= 500;
    session.error = null;
    setFlash("error", authFlashMessage(err, "Could not join."));
    session.view = null;
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

async function applyAuthSuccess(opts: {
  account: { id: string; email: string; playerId: string | null };
  view?: Awaited<ReturnType<typeof fetchState>> | null;
  notice: string;
}): Promise<void> {
  session.account = opts.account;
  session.passwordDraft = "";
  let view = opts.view ?? null;
  if (!view?.player?.id && opts.account.playerId) {
    try {
      view = await fetchState(opts.account.playerId);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if (status === 404) {
        view = null;
      } else if (status === 0 || status >= 500) {
        session.holdJoin = true;
        session.view = null;
        setFlash("notice", "Reconnecting… your commander is still saved");
        scheduleReconnect();
        return;
      } else {
        setFlash(
          "error",
          err instanceof Error
            ? err.message
            : "Could not load your empire. Retry in a moment.",
        );
        return;
      }
    }
  }
  if (view?.player?.id) {
    session.view = view;
    session.galaxySystem = view.planet.coords.system;
    session.galaxyGalaxy = null;
    session.joinDraft = view.player.name;
    localStorage.setItem(SESSION_KEY, view.player.id);
    session.claimablePlayerId = null;
    stripJoinParams();
    syncSessionUrl({ replace: true });
    startPolling(view.player.id);
    identifyCommander(view.player.name);
    captureGameEvent("login");
    setFlash("notice", opts.notice);
    return;
  }
  const guest = localStorage.getItem(SESSION_KEY);
  session.claimablePlayerId = guest;
  if (opts.account.email) session.emailDraft = opts.account.email;
  setFlash("notice", opts.notice);
}

export async function doSignup(
  email: string,
  password: string,
): Promise<void> {
  if (session.busy) return;
  const trimmed = email.trim();
  session.emailDraft = email;
  session.passwordDraft = password;
  if (!trimmed) {
    setFlash("error", "Email is required.");
    schedulePaint();
    return;
  }
  if (!password || password.length < 8) {
    setFlash("error", "Password must be at least 8 characters.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    const claimPlayerId =
      session.claimablePlayerId ??
      localStorage.getItem(SESSION_KEY) ??
      session.view?.player.id ??
      null;
    const res = await signupAccount(trimmed, password, claimPlayerId);
    await applyAuthSuccess({
      account: res.account,
      view: res.view ?? null,
      notice: res.view
        ? `Signed up — welcome back, ${res.view.player.name}.`
        : "Account created — enter a commander name.",
    });
  } catch (err) {
    setFlash("error", authFlashMessage(err, "Sign up failed."));
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doLogin(
  email: string,
  password: string,
): Promise<void> {
  if (session.busy) return;
  const trimmed = email.trim();
  session.emailDraft = email;
  session.passwordDraft = password;
  if (!trimmed || !password) {
    setFlash("error", "Email and password required.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    const res = await loginAccount(trimmed, password);
    await applyAuthSuccess({
      account: res.account,
      view: res.view,
      notice: res.view
        ? `Signed in as ${res.view.player.name}.`
        : "Signed in — enter a commander name.",
    });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    if (status === 0 || status >= 500) {
      session.holdJoin = true;
      session.view = null;
      setFlash("notice", "Reconnecting… your commander is still saved");
      scheduleReconnect();
    } else {
      setFlash(
        "error",
        err instanceof Error ? err.message : "Log in failed.",
      );
    }
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function loadSecurity(): Promise<void> {
  if (!session.account) return;
  try {
    session.security = await fetchSecurity();
  } catch (err) {
    setFlash("error", err instanceof Error ? err.message : "Could not load security.");
  } finally {
    schedulePaint();
  }
}

export async function doChangePassword(current: string, next: string): Promise<void> {
  if (session.busy) return;
  if (!current || !next || next.length < 8) {
    setFlash("error", "Enter your current password and a new one (8+ characters).");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    await changeAccountPassword(current, next);
    setFlash("notice", "Password updated. Other devices were signed out.");
  } catch (err) {
    setFlash("error", authFlashMessage(err, "Could not change password."));
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doRevokeOtherSessions(): Promise<void> {
  if (session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    await revokeOtherSessions();
    setFlash("notice", "Other devices were signed out.");
  } catch (err) {
    setFlash("error", authFlashMessage(err, "Could not sign out other devices."));
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doGenerateRecoveryCodes(current: string): Promise<void> {
  if (session.busy) return;
  if (!current) {
    setFlash("error", "Enter your current password to generate recovery codes.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    const res = await generateRecoveryCodes(current);
    session.recoveryCodes = res.codes;
    if (session.security) {
      session.security = {
        ...session.security,
        recoveryCodesRemaining: res.recoveryCodesRemaining,
      };
    }
    setFlash("notice", "Recovery codes generated. Copy them now.");
  } catch (err) {
    setFlash("error", authFlashMessage(err, "Could not generate recovery codes."));
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doRecover(email: string, code: string, next: string): Promise<void> {
  if (session.busy) return;
  const trimmed = email.trim();
  if (!trimmed || !code.trim() || next.length < 8) {
    setFlash("error", "Email, recovery code, and a new password (8+) are required.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    const res = await recoverAccount(trimmed, code.trim(), next);
    await applyAuthSuccess({
      account: res.account,
      view: null,
      notice: "Password reset. You are signed in.",
    });
  } catch (err) {
    setFlash("error", authFlashMessage(err, "Recovery failed."));
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doRequestEmailReset(email: string): Promise<void> {
  if (session.busy) return;
  const trimmed = email.trim();
  if (!trimmed) {
    setFlash("error", "Email required.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    const res = await requestPasswordReset(trimmed);
    setFlash("notice", res.message);
  } catch (err) {
    setFlash("error", authFlashMessage(err, "Could not send a reset link."));
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doConfirmEmailReset(token: string, newPassword: string): Promise<void> {
  if (session.busy) return;
  if (!token || newPassword.length < 8) {
    setFlash("error", "Enter a new password (8+ characters).");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    await confirmPasswordReset(token, newPassword);
    session.passwordResetToken = null;
    const url = new URL(window.location.href);
    if (url.searchParams.has("reset")) {
      url.searchParams.delete("reset");
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, "", next || "/");
    }
    setFlash("notice", "Password updated. Log in with the new password.");
  } catch (err) {
    setFlash("error", authFlashMessage(err, "Reset failed."));
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doClaimAnonymous(): Promise<void> {
  const playerId =
    session.claimablePlayerId ?? localStorage.getItem(SESSION_KEY);
  if (!session.account) {
    setFlash("error", "Sign in before claiming a guest save.");
    schedulePaint();
    return;
  }
  if (!playerId) {
    setFlash("error", "No guest save found to claim.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    const res = await claimAnonymousPlayer(playerId);
    session.account = res.account;
    session.view = res.view;
    session.galaxySystem = session.view.planet.coords.system;
    session.galaxyGalaxy = null;
    session.claimablePlayerId = null;
    localStorage.setItem(SESSION_KEY, session.view.player.id);
    setFlash("notice", `Claimed ${session.view.player.name} to your email.`);
    stripJoinParams();
    syncSessionUrl({ replace: true });
    startPolling(session.view.player.id);
  } catch (err) {
    let refreshedAccount: Awaited<ReturnType<typeof fetchAuthMe>>["account"] = null;
    try {
      refreshedAccount = (await fetchAuthMe()).account;
    } catch {
      // settleMutation still refreshes the player view and reports failure.
    }
    await settleMutation({
      err,
      failureFallback: "Claim failed.",
      applied: (view) => Boolean(
        refreshedAccount?.email &&
        refreshedAccount.playerId === view.player.id &&
        view.player.id === playerId
      ),
      successNotice: (view) => `Claimed ${view.player.name} to your email.`,
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

/** Resume from HttpOnly session cookie via /api/auth/me. */
export async function resumeFromCookie(): Promise<
  "ready" | "account" | "none" | "retry" | "logout"
> {
  try {
    const me = await fetchAuthMe();
    if (!me.account) {
      session.holdJoin = false;
      return "none";
    }
    session.account = me.account;
    if (me.view?.player?.id) {
      session.view = me.view;
      session.galaxySystem = me.view.planet.coords.system;
      session.galaxyGalaxy = null;
      session.joinDraft = me.view.player.name;
      session.holdJoin = false;
      localStorage.setItem(SESSION_KEY, me.view.player.id);
      session.claimablePlayerId = null;
      syncSessionUrl({ replace: true });
      startPolling(me.view.player.id);
      setFlash("notice", `Signed in as ${me.view.player.name}.`);
      // Paint immediately — boot() returns early on true and would otherwise
      // leave the join screen up until the next background poll.
      schedulePaint();
      return "ready";
    }
    const guest = localStorage.getItem(SESSION_KEY);
    session.claimablePlayerId = guest;
    session.holdJoin = false;
    if (me.account.email) session.emailDraft = me.account.email;
    return "account";
  } catch (err) {
    if (shouldClearSavedPlayer(httpStatus(err))) {
      localStorage.removeItem(SESSION_KEY);
      session.account = null;
      session.view = null;
      session.holdJoin = false;
      return "logout";
    }
    session.holdJoin = true;
    return "retry";
  }
}

export async function doRefresh(): Promise<void> {
  if (!session.view) return;
  session.busy = true;
  schedulePaint();
  try {
    await silentRefresh(session.view.player.id, "Refresh failed.", false);
  } finally {
    session.busy = false;
    schedulePaint();
    deferBackgroundPoll();
  }
}

export async function doGalaxyNav(dir: "prev" | "next"): Promise<void> {
  if (!session.view) return;
  const current = session.galaxySystem ?? session.view.galaxy.system;
  const next =
    dir === "next"
      ? current >= MAP_SYSTEMS
        ? 1
        : current + 1
      : current <= 1
        ? MAP_SYSTEMS
        : current - 1;
  session.galaxySystem = next;
  session.busy = true;
  schedulePaint();
  try {
    await silentRefresh(session.view.player.id, "Galaxy nav failed.", false);
  } finally {
    session.busy = false;
    schedulePaint();
    deferBackgroundPoll();
  }
}

export async function doGalaxyJump(galaxy: number, system: number): Promise<void> {
  if (!session.view) return;
  if (session.view.galaxy.galaxy === galaxy && session.view.galaxy.system === system) return;
  session.galaxyGalaxy = galaxy;
  session.galaxySystem = system;
  session.busy = true;
  schedulePaint();
  try {
    await silentRefresh(session.view.player.id, "Galaxy nav failed.", false);
  } finally {
    session.busy = false;
    schedulePaint();
    deferBackgroundPoll();
  }
}

export async function doGalaxyGalaxyNav(dir: "prev" | "next"): Promise<void> {
  if (!session.view) return;
  const current = session.galaxyGalaxy ?? session.view.galaxy.galaxy;
  const next = dir === "next"
    ? current >= MAP_GALAXIES ? 1 : current + 1
    : current <= 1 ? MAP_GALAXIES : current - 1;
  return doGalaxyJump(next, session.galaxySystem ?? session.view.galaxy.system);
}

export async function doSelectPlanet(planetId: string): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await selectPlanet(session.view.player.id, planetId);
    session.galaxySystem = session.view.planet.coords.system;
    session.galaxyGalaxy = null;
    syncSessionUrl({ replace: true, planetId });
    setFlash("notice", `Switched to ${session.view.planet.name}.`);
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Planet switch failed.",
      applied: (view) => view.planet.id === planetId,
      successNotice: (view) => `Switched to ${view.planet.name}.`,
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doRenamePlanet(name: string): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await renamePlanet(
      session.view.player.id,
      session.view.planet.id,
      name,
    );
    setFlash("notice", `Colony renamed to ${session.view.planet.name}.`);
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Rename failed.",
      applied: (view) => view.planet.name === name,
      successNotice: (view) => `Colony renamed to ${view.planet.name}.`,
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doRelocateFortress(
  galaxy: number,
  system: number,
): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await relocateMiniFortress(
      session.view.player.id,
      session.view.planet.id,
      galaxy,
      system,
    );
    const c = session.view.planet.coords;
    setFlash(
      "notice",
      `Moving Fortress landed at ${c.galaxy}:${c.system}:${c.slot}.`,
    );
  } catch (err) {
    const before = session.view.planet.coords;
    await settleMutation({
      err,
      failureFallback: "Fortress jump failed.",
      applied: (view) =>
        (view.planet.coords.galaxy !== before.galaxy ||
          view.planet.coords.system !== before.system) &&
        view.planet.coords.galaxy === galaxy &&
        view.planet.coords.system === system,
      successNotice: (view) => {
        const c = view.planet.coords;
        return `Moving Fortress landed at ${c.galaxy}:${c.system}:${c.slot}.`;
      },
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
