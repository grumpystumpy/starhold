import { MAP_SYSTEMS } from "@starhold/game";
import {
  authJoin,
  claimAnonymousPlayer,
  fetchAuthMe,
  fetchState,
  joinGame,
  loginAccount,
  renamePlanet,
  selectPlanet,
  signupAccount,
} from "./api";
import {
  SESSION_KEY,
  clearFlash,
  schedulePaint,
  session,
  setFlash,
  stripJoinParams,
} from "./session";
import { syncSessionUrl } from "./ui/router";

export function startPolling(playerId: string): void {
  stopPolling();
  session.pollTimer = window.setInterval(() => {
    void silentRefresh(playerId);
  }, 1000);
}

export function stopPolling(): void {
  if (session.pollTimer !== undefined) {
    window.clearInterval(session.pollTimer);
    session.pollTimer = undefined;
  }
}

export async function silentRefresh(playerId: string): Promise<void> {
  try {
    const g = session.view?.galaxy.galaxy;
    const s = session.galaxySystem ?? session.view?.galaxy.system;
    session.view = await fetchState(playerId, g, s);
    schedulePaint();
  } catch (err) {
    if (!session.error || Date.now() >= session.flashUntil) {
      setFlash(
        "error",
        err instanceof Error
          ? `Server unreachable: ${err.message}`
          : "Server unreachable.",
      );
      schedulePaint();
    }
  }
}

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
    session.error = null;
    setFlash(
      "error",
      err instanceof Error ? err.message : "Could not join.",
    );
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
  if (opts.view?.player?.id) {
    session.view = opts.view;
    session.galaxySystem = opts.view.planet.coords.system;
    session.joinDraft = opts.view.player.name;
    localStorage.setItem(SESSION_KEY, opts.view.player.id);
    session.claimablePlayerId = null;
    stripJoinParams();
    syncSessionUrl({ replace: true });
    startPolling(opts.view.player.id);
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
    const me = await fetchAuthMe();
    await applyAuthSuccess({
      account: me.account ?? res.account,
      view: me.view,
      notice: me.view
        ? `Signed up — welcome back, ${me.view.player.name}.`
        : "Account created — enter a commander name or claim your guest save.",
    });
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Sign up failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doLogin(
  email: string,
  password: string,
): Promise<void> {
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
        : "Signed in — enter a commander name or claim your guest save.",
    });
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Log in failed.",
    );
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
    session.claimablePlayerId = null;
    localStorage.setItem(SESSION_KEY, session.view.player.id);
    setFlash("notice", `Claimed ${session.view.player.name} to your email.`);
    stripJoinParams();
    syncSessionUrl({ replace: true });
    startPolling(session.view.player.id);
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Claim failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

/** Resume from HttpOnly session cookie via /api/auth/me. */
export async function resumeFromCookie(): Promise<boolean> {
  try {
    const me = await fetchAuthMe();
    session.account = me.account;
    if (me.view?.player?.id) {
      session.view = me.view;
      session.galaxySystem = me.view.planet.coords.system;
      session.joinDraft = me.view.player.name;
      localStorage.setItem(SESSION_KEY, me.view.player.id);
      session.claimablePlayerId = null;
      syncSessionUrl({ replace: true });
      startPolling(me.view.player.id);
      setFlash("notice", `Signed in as ${me.view.player.name}.`);
      return true;
    }
    if (me.account) {
      const guest = localStorage.getItem(SESSION_KEY);
      session.claimablePlayerId = guest;
      if (me.account.email) session.emailDraft = me.account.email;
      return false;
    }
  } catch {
    /* treat as logged out */
  }
  return false;
}

export async function doRefresh(): Promise<void> {
  if (!session.view) return;
  session.busy = true;
  schedulePaint();
  try {
    session.view = await fetchState(
      session.view.player.id,
      session.view.galaxy.galaxy,
      session.galaxySystem ?? session.view.galaxy.system,
    );
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Refresh failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
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
    session.view = await fetchState(
      session.view.player.id,
      session.view.galaxy.galaxy,
      next,
    );
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Galaxy nav failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
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
    syncSessionUrl({ replace: true, planetId });
    setFlash("notice", `Switched to ${session.view.planet.name}.`);
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Planet switch failed.",
    );
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
    setFlash(
      "error",
      err instanceof Error ? err.message : "Rename failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
