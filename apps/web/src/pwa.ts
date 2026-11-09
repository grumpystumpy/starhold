import {
  INSTALL_DISMISS_KEY,
  installKind,
  isIosInstall,
  isStandalone,
  mayApplyAppUpdate,
  renderPwaChrome,
  serviceWorkerUpdateReady,
  shouldRegisterServiceWorker,
  type OfflinePhase,
  type PwaView,
} from "./pwa-policy";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

let deferredPrompt: InstallPromptEvent | null = null;
let offline: OfflinePhase = "online";
let updateReady = false;

function moduleSrc(doc: Document): string {
  return doc.querySelector("script[type=module]")?.getAttribute("src") ?? "";
}

function viewOf(doc: Document, win: Window): PwaView {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  const standalone = isStandalone(
    nav.standalone,
    win.matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches,
  );
  return {
    kind: installKind({
      standalone,
      dismissed: win.localStorage.getItem(INSTALL_DISMISS_KEY) === "1",
      ios: isIosInstall(win.navigator.userAgent, win.navigator.maxTouchPoints ?? 0),
      hasPrompt: deferredPrompt != null,
    }),
    offline,
    updateReady,
    fleetFormOpen: Boolean(doc.querySelector("[data-testid='fleet-form']")),
  };
}

function paint(doc: Document, win: Window): void {
  const host = doc.getElementById("pwa-chrome");
  if (!host) return;
  host.innerHTML = renderPwaChrome(viewOf(doc, win));
}

function onClick(event: Event, doc: Document, win: Window): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const action = target.closest("[data-pwa]")?.getAttribute("data-pwa");
  if (!action) return;
  if (action === "dismiss") {
    win.localStorage.setItem(INSTALL_DISMISS_KEY, "1");
    paint(doc, win);
    return;
  }
  if (action === "install") {
    const prompt = deferredPrompt;
    deferredPrompt = null;
    paint(doc, win);
    void prompt?.prompt();
    return;
  }
  if (action === "update") {
    const open = Boolean(doc.querySelector("[data-testid='fleet-form']"));
    if (!mayApplyAppUpdate(open)) {
      const note = doc.querySelector("[data-testid='pwa-update-note']");
      if (note) {
        note.textContent =
          "Leave the fleet screen before updating. Starhold will not reload in the middle of a fleet order.";
      }
      return;
    }
    win.location.reload();
  }
}

function watchUpdates(win: Window, doc: Document, reg: ServiceWorkerRegistration): void {
  const mark = () => {
    updateReady = true;
    paint(doc, win);
  };
  const controllerChanged = () => {
    const controller = win.navigator.serviceWorker.controller;
    const active = reg.active;
    if (!controller || !active || controller === active) return;
    if (serviceWorkerUpdateReady(active.state, true)) mark();
  };
  const watch = (worker: ServiceWorker | null) => {
    if (!worker) return;
    const consider = () => {
      if (serviceWorkerUpdateReady(worker.state, Boolean(win.navigator.serviceWorker.controller))) mark();
      controllerChanged();
    };
    consider();
    worker.addEventListener("statechange", consider);
  };
  watch(reg.waiting);
  watch(reg.installing);
  controllerChanged();
  reg.addEventListener("updatefound", () => {
    watch(reg.installing);
    watch(reg.waiting);
    controllerChanged();
  });
}

export function startPwa(doc: Document = document, win: Window = window): void {
  if (doc.getElementById("pwa-chrome")) return;
  const host = doc.createElement("div");
  host.id = "pwa-chrome";
  doc.body.prepend(host);
  if (!win.navigator.onLine) offline = "offline";
  win.addEventListener("beforeinstallprompt", ((event: Event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    paint(doc, win);
  }) as EventListener);
  win.addEventListener("offline", () => {
    offline = "offline";
    paint(doc, win);
  });
  win.addEventListener("online", () => {
    if (offline !== "offline") return;
    offline = "recovered";
    paint(doc, win);
    win.setTimeout(() => {
      if (offline !== "recovered") return;
      offline = "online";
      paint(doc, win);
    }, 4000);
  });
  doc.addEventListener("click", (event) => onClick(event, doc, win));
  paint(doc, win);
  if (!shouldRegisterServiceWorker(moduleSrc(doc))) return;
  if (!("serviceWorker" in win.navigator)) return;
  void win.navigator.serviceWorker
    .register("/sw.js", { type: "module", scope: "/" })
    .then((reg) => watchUpdates(win, doc, reg))
    .catch(() => {
      /* The game still runs if the shell worker cannot install. */
    });
}
