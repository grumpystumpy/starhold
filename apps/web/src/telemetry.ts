import { setApiFailureReporter, setStatePollOkHandler, type ApiFailureContext } from "./api";

type PostHog = {
  init: (key: string, options: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (id: string, properties?: Record<string, unknown>) => void;
  captureException: (error: unknown, props?: Record<string, unknown>) => void;
};

let posthog: PostHog | null = null;
let sentryReady = false;
let statePollFailures = 0;

type SentryHint = {
  level: "warning" | "error";
  tags: Record<string, string>;
  fingerprint: string[];
};

let testSentry: ((err: unknown, hint: SentryHint) => void) | null = null;
let testPosthogException: ((err: unknown, props: Record<string, unknown>) => void) | null = null;

export function setTelemetrySinkForTests(
  sink: {
    sentry?: ((err: unknown, hint: SentryHint) => void) | null;
    posthogException?: ((err: unknown, props: Record<string, unknown>) => void) | null;
  } | null,
): void {
  testSentry = sink?.sentry ?? null;
  testPosthogException = sink?.posthogException ?? null;
}

export function resetFailureStateForTests(): void {
  statePollFailures = 0;
}

function scrub(message: string): string {
  if (message.includes("@")) return "Request failed.";
  return message.slice(0, 200);
}

function stripQuery(path: string): string {
  const q = path.indexOf("?");
  const bare = q === -1 ? path : path.slice(0, q);
  try {
    if (bare.startsWith("http://") || bare.startsWith("https://")) {
      return new URL(bare).pathname;
    }
  } catch {
    /* keep bare */
  }
  return bare;
}

export interface FailurePlan {
  skip: boolean;
  safe: string;
  level: "warning" | "error";
  tags: Record<string, string>;
  fingerprint: string[];
}

/** Decide whether a failed call is worth a Sentry event, and how to tag it. */
export function planFailureReport(
  status: number,
  message: string,
  ctx?: ApiFailureContext,
): FailurePlan {
  const method = (ctx?.method ?? "GET").toUpperCase();
  const path = stripQuery(ctx?.path ?? "");
  const kind = ctx?.kind ?? (status === 0 ? "network" : "server");
  const tags = {
    api_status: String(status),
    api_path: path,
    api_method: method,
    api_kind: kind,
  };
  const fingerprint = ["api", method, path, String(status), kind];
  const level: "warning" | "error" =
    kind === "busy" || kind === "overload" ? "warning" : "error";
  const safe = scrub(message);
  if (status !== 0 && status < 500) {
    return { skip: true, safe, level, tags, fingerprint };
  }
  if (method === "GET" && path === "/api/state") {
    statePollFailures += 1;
    if (statePollFailures < 3) {
      return { skip: true, safe, level, tags, fingerprint };
    }
  }
  return { skip: false, safe, level, tags, fingerprint };
}

export async function reportFailure(
  status: number,
  message: string,
  ctx?: ApiFailureContext,
): Promise<void> {
  const plan = planFailureReport(status, message, ctx);
  if (plan.skip) return;
  const err = new Error(plan.safe);
  const hint: SentryHint = {
    level: plan.level,
    tags: plan.tags,
    fingerprint: plan.fingerprint,
  };
  if (testSentry) testSentry(err, hint);
  else if (sentryReady) {
    const Sentry = await import("@sentry/browser");
    Sentry.captureException(err, hint);
  }
  const props = {
    ...plan.tags,
    level: plan.level,
    $exception_fingerprint: plan.fingerprint.join(":"),
  };
  if (testPosthogException) testPosthogException(err, props);
  else posthog?.captureException(err, props);
}

setStatePollOkHandler(() => {
  statePollFailures = 0;
});

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
  }

  const key = __STARHOLD_POSTHOG_KEY__;
  if (key && typeof window !== "undefined") {
    const mod = await import("posthog-js");
    const client = mod.default;
    client.init(key, {
      api_host: "https://us.i.posthog.com",
      ui_host: "https://us.posthog.com",
      capture_pageview: "history_change",
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

  setApiFailureReporter((status, message, ctx) => {
    void reportFailure(status, message, ctx);
  });
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
