import { setApiFailureReporter } from "./api";

type PostHog = {
  init: (key: string, options: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (id: string, properties?: Record<string, unknown>) => void;
  captureException?: (error: unknown) => void;
};

let posthog: PostHog | null = null;
let sentryReady = false;

function scrub(message: string): string {
  if (message.includes("@")) return "Request failed.";
  return message.slice(0, 200);
}

async function reportFailure(status: number, message: string): Promise<void> {
  if (status !== 0 && status < 500) return;
  const safe = scrub(message);
  const err = new Error(safe);
  if (sentryReady) {
    const Sentry = await import("@sentry/browser");
    Sentry.captureException(err);
  }
  posthog?.capture("$exception", {
    $exception_message: safe,
    $exception_type: "ApiError",
  });
}

/** Pageviews and a few game events. No-ops when the keys are unset. */
export async function initTelemetry(): Promise<void> {
  const dsn = __STARHOLD_SENTRY_DSN__;
  if (dsn) {
    const Sentry = await import("@sentry/browser");
    Sentry.init({
      dsn,
      sampleRate: 1,
      tracesSampleRate: 0.05,
      beforeSend(event) {
        const message = event.exception?.values?.[0]?.value ?? "";
        if (message.includes("@")) return null;
        return event;
      },
    });
    sentryReady = true;
    if (typeof window !== "undefined") {
      window.addEventListener("error", (ev) => {
        const message = ev.error instanceof Error ? ev.error.message : ev.message;
        if (!String(message).includes("@")) Sentry.captureException(ev.error ?? message);
      });
      window.addEventListener("unhandledrejection", (ev) => {
        const reason = ev.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        if (!message.includes("@")) Sentry.captureException(reason);
      });
    }
  }

  const key = __STARHOLD_POSTHOG_KEY__;
  if (key && typeof window !== "undefined") {
    const mod = await import("posthog-js");
    const client = mod.default;
    client.init(key, {
      api_host: "https://us.i.posthog.com",
      ui_host: "https://us.posthog.com",
      capture_pageview: true,
      autocapture: false,
      disable_session_recording: true,
      persistence: "localStorage",
      person_profiles: "identified_only",
      before_send(event) {
        if (!event) return null;
        const current = event.properties?.$current_url;
        if (typeof current === "string") {
          try {
            const url = new URL(current);
            url.search = "";
            event.properties.$current_url = url.toString();
          } catch {
            /* keep the original */
          }
        }
        return event;
      },
    });
    posthog = client;
  }

  setApiFailureReporter((status, message) => {
    void reportFailure(status, message);
  });
}

export function capturePageview(path: string): void {
  posthog?.capture("$pageview", { path });
}

export function identifyCommander(username: string): void {
  if (!username) return;
  posthog?.identify(username, { username });
}

export function captureGameEvent(
  name: "login" | "build_start" | "research_start" | "fleet_send",
  props?: Record<string, string | number | boolean>,
): void {
  posthog?.capture(name, props);
}
