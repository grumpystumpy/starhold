import {
  BUILDINGS,
  CHRONO_LATHE_RIG_FOUNDRY_REQ,
  CHRONO_LATHE_SHIPYARD_REQ,
  MANTLE_LOOM_LAB_REQ,
  MANTLE_LOOM_SOLAR_REQ,
  RIG_FOUNDRY_SHIPYARD_REQ,
  buildingUpgradeSeconds,
  levelBonuses,
  previewBuildingUpgrade,
  storageCap,
  type BuildingId,
  type BuildingPreviewMods,
  type PlayerView,
} from "@starhold/game";
import { BUILDING_ART, PLANET_ART } from "./assets";
import { fmt, fmtCost, fmtEta } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";
import { blockedActionNote, costTooltip } from "./render-tooltips";
import { recoverFormHtml } from "./render-security";

export type JoinScreenState = {
  error: string | null;
  notice: string | null;
  busy: boolean;
  joinDraft: string;
  emailDraft?: string;
  passwordDraft?: string;
  accountEmail?: string | null;
  claimablePlayerId?: string | null;
  /** When set, OAuth buttons render for these provider ids. Omit to fetch once. */
  oauthProviders?: string[];
  /** Email reset link. Omitted until GET /api/auth/providers says it is on. */
  emailReset?: boolean;
  /** `?reset=` token. Renders the one-time password form. */
  passwordResetToken?: string | null;
};

/** Join / sign-in markup. Auth fields stay off once an account exists. */
const OAUTH_BUTTON_LABEL: Record<string, string> = {
  google: "Continue with Google",
  discord: "Continue with Discord",
  mock: "Continue with Mock",
};

let oauthProvidersCache: string[] | null = null;
let oauthProvidersPromise: Promise<string[]> | null = null;
let emailResetCache = false;

export function resetOAuthProvidersCacheForTests(): void {
  oauthProvidersCache = null;
  oauthProvidersPromise = null;
  emailResetCache = false;
}

export function peekOAuthProviders(): string[] | null {
  return oauthProvidersCache;
}

export function peekEmailReset(): boolean {
  return emailResetCache;
}

/** Buttons for configured providers only. An empty list renders nothing. */
export function oauthButtonsHtml(providers: readonly string[]): string {
  const buttons = providers.filter((provider) => provider in OAUTH_BUTTON_LABEL);
  if (buttons.length === 0) return "";
  return `<div class="join-row oauth-row" data-testid="oauth-buttons">${buttons
    .map(
      (provider) =>
        `<a class="oauth-btn" data-testid="oauth-${provider}" href="/api/auth/oauth/${provider}/start">${OAUTH_BUTTON_LABEL[provider]}</a>`,
    )
    .join("")}</div>`;
}

/** One fetch per page load. Failures hide the buttons. */
export function loadOAuthProviders(): Promise<string[]> {
  if (oauthProvidersCache) return Promise.resolve(oauthProvidersCache);
  if (!oauthProvidersPromise) {
    oauthProvidersPromise = fetch("/api/auth/providers", { credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) return [] as string[];
        const body = (await res.json()) as { providers?: unknown; emailReset?: unknown };
        if (!Array.isArray(body.providers)) return [];
        emailResetCache = body.emailReset === true;
        return body.providers.filter((item): item is string => typeof item === "string");
      })
      .catch(() => [] as string[])
      .then((list) => {
        oauthProvidersCache = list;
        return list;
      });
  }
  return oauthProvidersPromise;
}

function paintOAuthButtons(root: HTMLElement, providers: readonly string[]): void {
  const html = oauthButtonsHtml(providers);
  const existing = root.querySelector("[data-testid='oauth-buttons']");
  if (!html) {
    existing?.remove();
    return;
  }
  if (existing) return;
  root.querySelector("#auth-form")?.insertAdjacentHTML("afterend", html);
}

function queueOAuthButtons(root: HTMLElement, state: JoinScreenState): void {
  if (state.accountEmail || state.oauthProviders) {
    paintEmailResetOffer(root, Boolean(state.emailReset));
    return;
  }
  const cached = peekOAuthProviders();
  if (cached) {
    paintOAuthButtons(root, cached);
    paintEmailResetOffer(root, Boolean(state.emailReset));
    return;
  }
  void loadOAuthProviders().then((list) => {
    if (!root.querySelector("#auth-form")) return;
    paintOAuthButtons(root, list);
    paintEmailResetOffer(root, Boolean(state.emailReset));
  });
}

/** Shown only when email reset is configured. Hidden form until the button is used. */
export function emailResetOfferHtml(): string {
  return `<div data-testid="email-reset-offer">
      <p class="hint"><button type="button" data-testid="auth-email-reset-link" data-auth-email-reset>Email me a reset link</button></p>
      <form id="email-reset-request-form" data-testid="email-reset-request-form" hidden>
        <label for="email-reset-address">Email</label>
        <div class="join-row" style="margin-top:0.5rem;flex-wrap:wrap;gap:0.5rem">
          <input id="email-reset-address" name="email" type="email" maxlength="254" placeholder="you@example.com" autocomplete="email" data-testid="email-reset-address" />
          <button type="submit" data-testid="email-reset-request-submit">Send reset link</button>
        </div>
      </form>
    </div>`;
}

export function passwordResetFormHtml(token: string): string {
  return `<form id="password-reset-form" data-testid="password-reset-form">
      <h2>Choose a new password</h2>
      <p class="hint">This reset link works once.</p>
      <input type="hidden" data-testid="password-reset-token" value="${escapeAttr(token)}" />
      <div class="join-row" style="margin-top:0.5rem;flex-wrap:wrap;gap:0.5rem">
        <input id="password-reset-password" name="password" type="password" minlength="8" maxlength="128" placeholder="new password (8+)" autocomplete="new-password" data-testid="password-reset-password" />
        <button type="submit" data-testid="password-reset-submit">Set new password</button>
      </div>
    </form>`;
}

function paintEmailResetOffer(root: HTMLElement, enabled = false): void {
  const existing = root.querySelector("[data-testid='email-reset-offer']");
  if (!enabled && !peekEmailReset()) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const forgot = root.querySelector("[data-testid='auth-forgot-link']");
  forgot?.insertAdjacentHTML("afterend", emailResetOfferHtml());
}

export function joinScreenHtml(state: JoinScreenState): string {
  const signedIn = Boolean(state.accountEmail);
  const accountLine = state.accountEmail
    ? `<p class="hint" data-testid="account-email">Signed in as <strong>${escapeHtml(state.accountEmail)}</strong> — pick a commander name to enter.</p>`
    : "";
  const claimBlock =
    state.accountEmail && state.claimablePlayerId
      ? `<div class="join-row" style="margin-top:0.75rem">
          <button type="button" id="claim-btn" data-testid="claim-btn" data-claim-anonymous ${state.busy ? "disabled" : ""}>Claim guest save</button>
        </div>
        <p class="hint">Links local guest <code>${escapeHtml(state.claimablePlayerId)}</code> to this account. Closing the tab will keep progress via your sign-in cookie.</p>`
      : "";
  const joinLabel = signedIn
    ? "Commander name (linked to your account)"
    : "Commander name (guest)";
  const joinBtn = signedIn ? "Enter as signed-in" : "Enter universe";
  const resetBlock = state.passwordResetToken
    ? passwordResetFormHtml(state.passwordResetToken)
    : "";
  const authBlock = signedIn
    ? ""
    : `<hr style="margin:1.25rem 0;border:none;border-top:1px solid rgba(255,255,255,0.12)" />
      <form id="auth-form" data-testid="auth-form">
        <label for="auth-email">Email + password</label>
        <div class="join-row" style="margin-top:0.5rem;flex-wrap:wrap;gap:0.5rem">
          <input id="auth-email" name="email" type="email" maxlength="254" placeholder="you@example.com" autocomplete="email" data-testid="auth-email" value="${escapeAttr(state.emailDraft ?? "")}" />
          <input id="auth-password" name="password" type="password" minlength="8" maxlength="128" placeholder="password (8+)" autocomplete="current-password" data-testid="auth-password" value="${escapeAttr(state.passwordDraft ?? "")}" />
        </div>
        <div class="join-row" style="margin-top:0.5rem;gap:0.5rem">
          <button type="submit" id="auth-login-btn" data-testid="auth-login-btn" data-auth-action="login" ${state.busy ? "disabled" : ""}>Log in</button>
          <button type="submit" id="auth-signup-btn" data-testid="auth-signup-btn" data-auth-action="signup" ${state.busy ? "disabled" : ""}>Sign up</button>
        </div>
      </form>
      ${oauthButtonsHtml(state.oauthProviders ?? [])}
      <p class="hint"><button type="button" data-testid="auth-forgot-link" data-auth-forgot>Forgot password?</button></p>
      ${state.emailReset ? emailResetOfferHtml() : ""}
      ${recoverFormHtml()}
      <p class="hint">Sign up with email and password to keep this commander after you close the tab. Guest play stays on this browser only.</p>
`;

  return `
    <header class="join-hero">
      <img class="thumb thumb-hero" src="${PLANET_ART.rocky}" alt="Rocky world" width="72" height="72" />
      <div>
        <h1 class="brand">Starhold</h1>
        <p class="tagline">Mine the crust, raise the yard, launch hulls — and raid rival colonies. One shared universe — open another tab for attacking another rival.</p>
      </div>
    </header>
    <div data-flash-slot>${flashHtml(state.error, state.notice)}</div>
    <section class="join-panel">
      ${accountLine}
      ${resetBlock}
      <form id="join-form" data-testid="join-form">
        <label for="commander">${joinLabel}</label>
        <div class="join-row" style="margin-top:0.5rem">
          <input id="commander" name="commander" type="text" maxlength="24" placeholder="e.g. Mira Vale" autocomplete="nickname" data-testid="commander-input" value="${escapeAttr(state.joinDraft)}" />
          <button type="submit" id="join-btn" data-testid="join-btn" ${state.busy ? "disabled" : ""}>${joinBtn}</button>
        </div>
      </form>
      ${claimBlock}
      ${authBlock}
      <p class="hint"><a href="/credits" data-account-nav="credits" data-testid="join-credits">Art credits</a></p>
    </section>
  `;
}

/** Shown when resume failed with a 5xx or a network error. No join form. */
export function reconnectScreenHtml(state: {
  error: string | null;
  notice: string | null;
}): string {
  return `
    <header class="join-hero">
      <img class="thumb thumb-hero" src="${PLANET_ART.rocky}" alt="Rocky world" width="72" height="72" />
      <div>
        <h1 class="brand">Starhold</h1>
        <p class="tagline">Reconnecting to the universe…</p>
      </div>
    </header>
    <div data-flash-slot>${flashHtml(state.error, null)}</div>
    <section class="join-panel" data-testid="reconnect">
      <p>Couldn't sign in — try again</p>
    </section>
  `;
}

/** Keep the commander input mounted so automation / IME is not wiped by re-paints. */
export function renderJoin(root: HTMLElement, state: JoinScreenState): void {
  const existingForm = root.querySelector<HTMLFormElement>("#join-form");
  const existingInput = root.querySelector<HTMLInputElement>("#commander");
  const emailInput = root.querySelector<HTMLInputElement>("#auth-email");
  const passwordInput = root.querySelector<HTMLInputElement>("#auth-password");
  const hasAuthForm = Boolean(root.querySelector("#auth-form"));
  const hasAccountLine = Boolean(
    root.querySelector("[data-testid='account-email']"),
  );
  const hasClaimBtn = Boolean(root.querySelector("#claim-btn"));
  const wantClaim = Boolean(state.accountEmail && state.claimablePlayerId);
  const wantAuth = !state.accountEmail;
  const hasReset = Boolean(root.querySelector("#password-reset-form"));
  const wantReset = Boolean(state.passwordResetToken);
  const structureOk =
    existingForm &&
    existingInput &&
    hasAuthForm === wantAuth &&
    Boolean(state.accountEmail) === hasAccountLine &&
    wantClaim === hasClaimBtn &&
    hasReset === wantReset;

  if (structureOk) {
    patchFlash(root, state.error, state.notice);
    const btn = root.querySelector<HTMLButtonElement>("#join-btn");
    if (btn) btn.disabled = state.busy;
    for (const id of [
      "auth-login-btn",
      "auth-signup-btn",
    ]) {
      const authBtn = root.querySelector<HTMLButtonElement>(`#${id}`);
      if (authBtn) authBtn.disabled = state.busy;
    }
    const claimBtn = root.querySelector<HTMLButtonElement>("#claim-btn");
    if (claimBtn) claimBtn.disabled = state.busy;
    if (
      document.activeElement !== existingInput &&
      state.joinDraft !== existingInput.value
    ) {
      existingInput.value = state.joinDraft;
    }
    if (
      emailInput &&
      document.activeElement !== emailInput &&
      (state.emailDraft ?? "") !== emailInput.value
    ) {
      emailInput.value = state.emailDraft ?? "";
    }
    if (
      passwordInput &&
      document.activeElement !== passwordInput &&
      (state.passwordDraft ?? "") !== passwordInput.value
    ) {
      passwordInput.value = state.passwordDraft ?? "";
    }
    queueOAuthButtons(root, state);
    return;
  }

  root.innerHTML = joinScreenHtml({
    ...state,
    oauthProviders: state.oauthProviders ?? peekOAuthProviders() ?? [],
  });
  queueOAuthButtons(root, state);

  const input = root.querySelector<HTMLInputElement>("#commander");
  input?.focus();
  if (input && state.joinDraft) {
    input.selectionStart = input.selectionEnd = input.value.length;
  }
}

function syncInput(input: HTMLInputElement | null, value: string): void {
  if (!input) return;
  if (document.activeElement === input) return;
  if (input.value !== value) input.value = value;
}

export function patchFlash(
  root: HTMLElement,
  error: string | null,
  notice: string | null,
): void {
  let slot = root.querySelector<HTMLElement>("[data-flash-slot]");
  if (!slot) {
    slot = document.createElement("div");
    slot.dataset.flashSlot = "";
    const panel = root.querySelector(".join-panel, .topbar");
    if (panel?.parentElement) {
      panel.parentElement.insertBefore(slot, panel);
    } else {
      root.prepend(slot);
    }
  }
  slot.innerHTML = flashHtml(error, notice);
}

export function flashHtml(error: string | null, notice: string | null): string {
  if (error) {
    return `<p class="flash flash-error" role="alert" aria-live="assertive" data-testid="flash-error">${escapeHtml(error)} <button type="button" class="flash-dismiss" data-dismiss-flash aria-label="Dismiss">×</button></p>`;
  }
  if (notice) {
    return `<p class="flash flash-ok" role="status" aria-live="polite" data-testid="flash-ok">${escapeHtml(notice)} <button type="button" class="flash-dismiss" data-dismiss-flash aria-label="Dismiss">×</button></p>`;
  }
  return "";
}

export function resBlock(
  cls: string,
  label: string,
  amount: number,
  perHour: number,
  cap: number,
  icon: string,
): string {
  return `
    <div class="res ${cls}" data-testid="res-${cls}">
      <span class="res-head"><img class="icon" src="${icon}" alt="" width="28" height="28" /><span class="label">${label}</span></span>
      <span class="value">${fmt(amount)}</span>
      <span class="sub">+${fmt(perHour)}/h · cap ${fmt(cap)}</span>
    </div>
  `;
}

function isRequirementLock(error: string): boolean {
  return (
    /needs /i.test(error) ||
    error.includes("cannot be built") ||
    error.includes("can only be built")
  );
}

/** Standing catalog gates. Shown even when the next upgrade is allowed. */
function buildingGateLines(
  id: BuildingId,
  planet: PlayerView["planet"],
): string[] {
  const have = (buildingId: BuildingId): number =>
    planet.buildings[buildingId] ?? 0;
  const need = (buildingId: BuildingId, required: number): string =>
    `${BUILDINGS[buildingId].name} L${fmt(required)}+ (current L${fmt(have(buildingId))})`;
  if (id === "sensorArray" || id === "jumpGate") {
    return [need("lunarBase", 1)];
  }
  if (id === "rigFoundry") {
    return [need("shipyard", RIG_FOUNDRY_SHIPYARD_REQ)];
  }
  if (id === "mantleLoom") {
    return [
      need("solarPlant", MANTLE_LOOM_SOLAR_REQ),
      need("researchLab", MANTLE_LOOM_LAB_REQ),
    ];
  }
  if (id === "chronoLathe") {
    return [
      need("shipyard", CHRONO_LATHE_SHIPYARD_REQ),
      need("rigFoundry", CHRONO_LATHE_RIG_FOUNDRY_REQ),
    ];
  }
  return [];
}

function upgradeButtonLabel(error: string | null): string {
  if (!error) return "Upgrade";
  if (isRequirementLock(error)) return "Locked";
  if (error.startsWith("Not enough")) return "Can't afford";
  if (error.includes("queue is full")) return "Queue full";
  if (error.includes("fields")) return "No fields";
  if (error.includes("maxed")) return "Maxed";
  return "Unavailable";
}

export function buildingRow(
  id: BuildingId,
  planet: PlayerView["planet"],
  player: PlayerView["player"],
  speed: number,
  now: number,
  _busy: boolean,
  mods?: BuildingPreviewMods & { timeMult?: number },
): string {
  const def = BUILDINGS[id];
  const preview = previewBuildingUpgrade(planet, player, id, now, mods);
  const level = planet.buildings[id] ?? 0;
  const cost = preview.cost;
  const naniteLevel =
    id === "chronoLathe"
      ? 0
      : Math.max(0, Math.floor(planet.buildings.chronoLathe ?? 0));
  const rigLevel =
    id === "chronoLathe" || id === "rigFoundry"
      ? 0
      : Math.max(0, Math.floor(planet.buildings.rigFoundry ?? 0));
  const lb = levelBonuses(player.level ?? 1);
  const secs = Math.max(
    1,
    Math.ceil(
      (buildingUpgradeSeconds(id, preview.current, naniteLevel, rigLevel) *
        lb.buildTime *
        (mods?.timeMult ?? 1)) /
        speed,
    ),
  );
  // Disable only when the server would reject. Client busy stays clickable
  // so a second tap surfaces "Still applying…" instead of a silent no-op.
  const blocked = preview.ok ? null : preview.error;
  const label = upgradeButtonLabel(blocked);
  const storageLine =
    id === "metalStorage" || id === "crystalStorage" || id === "deutTank"
      ? `Capacity ${fmt(storageCap(level))} now, ${fmt(storageCap(preview.current + 1))} at the next level. Each level doubles the cap.`
      : null;
  const tip = costTooltip({
    action: `Upgrade ${def.name} → L${fmt(preview.current + 1)}`,
    cost,
    timeSecs: secs,
    detail: [def.description, storageLine].filter(Boolean).join(" "),
    requires: [
      `Current L${fmt(level)}`,
      ...buildingGateLines(id, planet),
      ...(def.energyUsePerLevel
        ? [`Energy use +${fmt(def.energyUsePerLevel)}/level`]
        : []),
    ],
    blocked,
  });
  return `
    <article class="item item-thumb" data-building-id="${id}" data-testid="building-${id}">
      <img class="thumb" src="${BUILDING_ART[id]}" alt="${escapeAttr(def.name)}" width="48" height="48" />
      <div>
        <h3>${escapeHtml(def.name)} <span class="meta" data-testid="building-level-${id}">L${fmt(level)}</span> ${tip.html}</h3>
        <p>${escapeHtml(def.description)}</p>
        <div class="meta">Next: ${fmtCost(cost)} · ${fmtEta(secs)}${storageLine ? ` · ${escapeHtml(storageLine)}` : ""}</div>
      </div>
      <div class="actions">
        <button type="button" data-upgrade="${id}" data-building-id="${id}" data-locked="${blocked ? "1" : "0"}" data-testid="upgrade-${id}" ${blocked ? "disabled" : ""} ${blocked ? `aria-describedby="blocked-upgrade-${id}"` : ""} title="${tip.title}">${label}</button>
        ${blockedActionNote(`blocked-upgrade-${id}`, blocked)}
      </div>
    </article>
  `;
}
