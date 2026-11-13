import {
  FLEET_SAVE_MIN_LEAD_MS,
  MAP_GALAXIES,
  MAP_SYSTEMS,
  sensorPhalanxRange,
  type FleetSaveSuggestion,
  type PlayerView,
} from "@starhold/game";
import {
  ApiError,
  OVERLOAD_MESSAGE,
  authJoin,
  claimAnonymousPlayer,
  fetchAuthMe,
  fetchAllianceChat,
  fetchCommanderMail,
  fetchSecurity,
  fetchState,
  changeAccountPassword,
  generateRecoveryCodes,
  invalidateCachedState,
  joinGame,
  createInviteLink,
  loginAccount,
  recoverAccount,
  relocateMiniFortress,
  abandonColony,
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
import { fleetDraftForFleetSave } from "./ui/render-fleets-draft";
import { navigateTo, syncSessionUrl } from "./ui/router";
import {
  commanderMailRowsForView,
  setCommanderMail,
} from "./ui/render-messages";
import { captureGameEvent, identifyCommander } from "./telemetry";
import { settleMutation } from "./recover-action";
import { refreshMarketIfOpen } from "./main-actions-market";

/** Background refresh cadence. Actions apply their own response immediately. */
export const POLL_INTERVAL_MS = 30_000;
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
    void silentRefresh(playerId, "Server unreachable", true, {
      scanners: session.activePage === "galaxy",
    });
  }, Math.max(0, finishAt - now + QUEUE_COMPLETION_REFRESH_DELAY_MS));
}

/**
 * Keep the active moon's scanner level on the overlay. The level is already
 * on `planet.buildings` in every state body, including the 30s poll.
 * Other moons stay on the last Galaxy-page list until that page reads again.
 */
function scannerMoonEntry(planet: NonNullable<PlayerView["planet"]>, level: number) {
  return {
    planetId: planet.id,
    coords: planet.coords,
    sensorArray: level,
    range: sensorPhalanxRange(level),
  };
}

function sameScannerList(
  previous: NonNullable<PlayerView["scannerMoons"]>,
  next: NonNullable<PlayerView["scannerMoons"]>,
): boolean {
  return (
    previous.length === next.length &&
    previous.every((moon, index) => {
      const other = next[index];
      return (
        other !== undefined &&
        moon.planetId === other.planetId &&
        moon.sensorArray === other.sensorArray &&
        moon.range === other.range &&
        moon.coords.galaxy === other.coords.galaxy &&
        moon.coords.system === other.coords.system &&
        moon.coords.slot === other.coords.slot
      );
    })
  );
}

export function syncScannerOverlayFromPlanet(): void {
  const view = session.view;
  if (!view) return;
  const stored = view.scannerMoons ?? session.scannerMoons;
  const planet = view.planet;
  const liveLevel =
    planet?.kind === "moon" ? (planet.buildings.sensorArray ?? 0) : 0;
  if (!stored) {
    if (planet?.kind !== "moon" || liveLevel < 1) return;
    const next = [scannerMoonEntry(planet, liveLevel)];
    session.scannerMoons = next;
    session.view = { ...view, scannerMoons: next };
    return;
  }
  let next = stored.slice();
  if (planet?.kind === "moon") {
    next = next.filter((moon) => moon.planetId !== planet.id);
    if (liveLevel >= 1) next.push(scannerMoonEntry(planet, liveLevel));
  }
  session.scannerMoons = next;
  const previous = view.scannerMoons ?? [];
  if (!sameScannerList(previous, next)) {
    session.view = { ...view, scannerMoons: next };
  }
}

setBeforePaintImpl(() => {
  scheduleQueueCompletionRefresh();
  syncScannerOverlayFromPlanet();
  if (
    session.galaxyScannersDue &&
    session.activePage === "galaxy" &&
    session.view
  ) {
    session.galaxyScannersDue = false;
    void silentRefresh(session.view.player.id, "Galaxy scan failed.", false, {
      scanners: true,
    });
  }
});

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
      await refreshMarketIfOpen();
      await refreshCommanderMailIfOpen();
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

/** Private commander mail. Only while the Messages page is open. */
export async function refreshCommanderMailIfOpen(): Promise<void> {
  if (session.activePage !== "messages") return;
  if (!session.view) return;
  const since = commanderMailRowsForView().reduce(
    (max, message) => Math.max(max, message.createdAt),
    0,
  );
  try {
    const payload = await fetchCommanderMail(since > 0 ? since : undefined);
    const incoming = payload.messages ?? [];
    if (since > 0 && incoming.length === 0) return;
    const byId = new Map(commanderMailRowsForView().map((message) => [message.id, message]));
    for (const message of incoming) byId.set(message.id, message);
    setCommanderMail(
      [...byId.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-100),
    );
    schedulePaint();
  } catch {
    /* a mail poll must not fail the state refresh */
  }
}

export async function reloadCommanderMail(): Promise<void> {
  const payload = await fetchCommanderMail();
  setCommanderMail(payload.messages ?? []);
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
  void refreshMarketIfOpen();
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

function refreshKey(playerId: string, scanners: boolean): string {
  const g = session.galaxyGalaxy ?? session.view?.galaxy.galaxy ?? "";
  const s = session.galaxySystem ?? session.view?.galaxy.system ?? "";
  return `${playerId}:${g}:${s}:${scanners ? "scanners" : ""}`;
}

export function silentRefresh(
  playerId: string,
  errorLabel = "Server unreachable",
  prefixLabel = true,
  opts?: { scanners?: boolean },
): Promise<void> {
  const scanners = opts?.scanners === true;
  const key = refreshKey(playerId, scanners);
  if (refreshInFlight?.key === key) return refreshInFlight.promise;
  const promise = refreshOnce(playerId, errorLabel, prefixLabel, scanners).finally(() => {
    if (refreshInFlight?.promise === promise) refreshInFlight = null;
  });
  refreshInFlight = { key, promise };
  return promise;
}

async function refreshOnce(
  playerId: string,
  errorLabel: string,
  prefixLabel: boolean,
  scanners = false,
): Promise<void> {
  const gen = ++refreshGen;
  try {
    const g = session.galaxyGalaxy ?? session.view?.galaxy.galaxy;
    const s = session.galaxySystem ?? session.view?.galaxy.system;
    const view = await fetchState(playerId, g, s, { scanners });
    if (gen !== refreshGen) {
      if (
        scanners &&
        session.view?.player.id === playerId &&
        session.scannerMoons == null
      ) {
        session.scannerMoons = view.scannerMoons ?? [];
        session.view = {
          ...session.view,
          scannerMoons: session.scannerMoons,
        };
        syncScannerOverlayFromPlanet();
        schedulePaint();
      }
      return;
    }
    if (scanners) {
      session.scannerMoons = view.scannerMoons ?? [];
      if (view.scannerMoons === undefined) view.scannerMoons = [];
    }
    session.view = view;
    syncScannerOverlayFromPlanet();
    schedulePaint();
  } catch (err) {
    if (gen !== refreshGen) return;
    if (!session.error || Date.now() >= session.flashUntil) {
      const message =
        err instanceof Error
          ? prefixLabel
            ? `${errorLabel}: ${err.message}`
            : err.message
          : errorLabel;
      setFlash("error", message);
      schedulePaint();
    }
  }
}

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
      ? await authJoin(trimmed, session.inviteCode)
      : await joinGame(trimmed, session.inviteCode);
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

export async function doCopyInvite(): Promise<void> {
  if (!session.account?.playerId || !session.view) {
    setFlash("error", "Sign in before inviting a friend.");
    schedulePaint();
    return;
  }
  if (session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    const minted = await createInviteLink();
    const path = minted.path.startsWith("/") ? minted.path : `/?invite=${minted.code}`;
    const url = new URL(path, window.location.origin).href;
    session.inviteShareUrl = url;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (copied) setFlash("notice", "Invite link copied.");
    else setFlash("notice", "Invite link is in the box. Copy it from there.");
  } catch (err) {
    setFlash("error", authFlashMessage(err, "Could not create an invite link."));
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
      view = await fetchState(opts.account.playerId, undefined, undefined, {
        scanners: session.activePage === "galaxy",
      });
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
    await silentRefresh(session.view.player.id, "Refresh failed.", false, {
      scanners: session.activePage === "galaxy",
    });
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
    await silentRefresh(session.view.player.id, "Galaxy nav failed.", false, {
      scanners: true,
    });
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
    await silentRefresh(session.view.player.id, "Galaxy nav failed.", false, {
      scanners: true,
    });
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

/** Opens the fleet page prefilled. Does not launch. */
export async function doOpenFleetSave(attackId: string): Promise<void> {
  const view = session.view;
  if (!view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  const suggestion = fleetSaveSuggestion(view.fleetSave, attackId, view.now);
  if (!suggestion) return;
  session.pendingFleetSaveDraft = fleetDraftForFleetSave(suggestion);
  if (view.planet.id !== suggestion.originPlanetId) {
    await doSelectPlanet(suggestion.originPlanetId);
    if (session.view?.planet.id !== suggestion.originPlanetId) {
      session.pendingFleetSaveDraft = null;
      return;
    }
  }
  if (session.activePage !== "fleet") navigateTo("fleet");
  else if (session.pendingFleetSaveDraft) schedulePaint();
  const name = session.view?.planet.name;
  setFlash(
    "notice",
    name
      ? `Review the save from ${name}, then send.`
      : "Review the save, then send.",
  );
  schedulePaint();
}

function fleetSaveSuggestion(
  rows: FleetSaveSuggestion[] | undefined,
  attackId: string,
  now: number,
): FleetSaveSuggestion | null {
  const suggestion = rows?.find((row) => row.attackId === attackId) ?? null;
  if (!suggestion) return null;
  if (suggestion.arrivesAt - now <= FLEET_SAVE_MIN_LEAD_MS) return null;
  return suggestion;
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

export async function doAbandonColony(): Promise<void> {
  if (!session.view) return;
  const planetId = session.view.planet.id;
  const name = session.view.planet.name;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await abandonColony(session.view.player.id, planetId);
    session.galaxySystem = session.view.planet.coords.system;
    syncSessionUrl({ replace: true });
    setFlash("notice", `${name} abandoned.`);
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Abandon failed.",
      applied: (view) =>
        view.planet.id !== planetId &&
        !view.ownedPlanets.some((planet) => planet.id === planetId),
      successNotice: () => `${name} abandoned.`,
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
