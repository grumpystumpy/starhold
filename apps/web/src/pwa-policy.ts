/** Install, offline, and update decisions. No network and no storage writes. */

export const INSTALL_DISMISS_KEY = "starhold-pwa-install-dismissed";

export type InstallKind = "hidden" | "ios" | "android" | "manual";

export type OfflinePhase = "online" | "offline" | "recovered";

export interface PwaView {
  kind: InstallKind;
  offline: OfflinePhase;
  updateReady: boolean;
  fleetFormOpen: boolean;
}

export function isStandalone(standaloneFlag: boolean | undefined, displayModeStandalone: boolean): boolean {
  return standaloneFlag === true || displayModeStandalone;
}

/** iPhone, iPad, and iPadOS desktop-class Safari. Android is never this path. */
export function isIosInstall(userAgent: string, touchPoints = 0): boolean {
  if (/Android/i.test(userAgent)) return false;
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return userAgent.includes("Macintosh") && touchPoints > 1;
}

export function installKind(opts: {
  standalone: boolean;
  dismissed: boolean;
  ios: boolean;
  hasPrompt: boolean;
}): InstallKind {
  if (opts.standalone || opts.dismissed) return "hidden";
  if (opts.ios) return "ios";
  if (opts.hasPrompt) return "android";
  return "manual";
}

/** A reload would drop the fleet composer. Do not apply an update then. */
export function mayApplyAppUpdate(fleetFormOpen: boolean): boolean {
  return !fleetFormOpen;
}

/**
 * A newer worker is ready for the next visit. `skipWaiting` can move the
 * worker to `activating` or `activated` before a listener reads `installed`,
 * so those states count too. The page is not reloaded here.
 */
export function serviceWorkerUpdateReady(phase: string, hasController: boolean): boolean {
  if (!hasController) return false;
  return phase === "installed" || phase === "activating" || phase === "activated";
}

/** Production builds load a hashed chunk. Vite dev loads `/src/main.ts`. */
export function shouldRegisterServiceWorker(moduleSrc: string | null | undefined): boolean {
  return /^\/assets\/[^/]+\.js$/.test(moduleSrc ?? "");
}

export function renderPwaChrome(view: PwaView): string {
  const parts: string[] = [];
  if (view.offline === "offline") {
    parts.push(
      `<div class="pwa-note" data-testid="pwa-offline" role="status">You're offline. Starhold is not playable offline, and orders are not queued on this device.</div>`,
    );
  } else if (view.offline === "recovered") {
    parts.push(
      `<div class="pwa-note" data-testid="pwa-online" role="status">Back online. Nothing was replayed while the connection was down.</div>`,
    );
  }
  if (view.updateReady) {
    if (!mayApplyAppUpdate(view.fleetFormOpen)) {
      parts.push(
        `<div class="pwa-note" data-testid="pwa-update" role="status"><p data-testid="pwa-update-note">An update is ready. It will not reload while the fleet screen is open.</p></div>`,
      );
    } else {
      parts.push(
        `<div class="pwa-note" data-testid="pwa-update" role="status"><p>An update is ready.</p><button type="button" data-pwa="update" data-testid="pwa-update-apply">Reload to update</button></div>`,
      );
    }
  }
  if (view.kind === "ios") {
    parts.push(
      `<section class="pwa-note" data-testid="pwa-install" aria-label="Install Starhold"><p>iPhone: open the Share menu, then tap Add to Home Screen.</p><button type="button" class="ghost" data-pwa="dismiss" data-testid="pwa-install-dismiss">Don't show again</button></section>`,
    );
  } else if (view.kind === "android") {
    parts.push(
      `<section class="pwa-note" data-testid="pwa-install" aria-label="Install Starhold"><p>Install Starhold on this device. It still needs a connection to play.</p><button type="button" data-pwa="install" data-testid="pwa-install-action">Install app</button><button type="button" class="ghost" data-pwa="dismiss" data-testid="pwa-install-dismiss">Don't show again</button></section>`,
    );
  } else if (view.kind === "manual") {
    parts.push(
      `<section class="pwa-note" data-testid="pwa-install" aria-label="Install Starhold"><p>This browser did not offer an install prompt. Use its menu to add Starhold to your home screen if that choice is there. There is no Install button because it would not install anything.</p><button type="button" class="ghost" data-pwa="dismiss" data-testid="pwa-install-dismiss">Don't show again</button></section>`,
    );
  }
  return parts.join("");
}
