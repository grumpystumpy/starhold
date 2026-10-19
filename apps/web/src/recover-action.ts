import type { PlayerView } from "@starhold/game";
import {
  ApiError,
  fetchState,
  NOT_APPLIED_MESSAGE,
  OVERLOAD_MESSAGE,
} from "./api";
import { schedulePaint, session, setFlash } from "./session";

/**
 * A killed Worker may have saved the order. Never resend the POST.
 * One fresh state read tells us whether it landed.
 */
export async function settleMutation(args: {
  err: unknown;
  failureFallback: string;
  applied: (view: PlayerView) => boolean;
  successNotice: (view: PlayerView) => string;
}): Promise<void> {
  const err = args.err;
  if (!(err instanceof ApiError) || !err.retryable || !session.view) {
    setFlash(
      "error",
      err instanceof Error ? err.message : args.failureFallback,
    );
    return;
  }
  setFlash(
    "notice",
    err.kind === "overload" ? err.message : OVERLOAD_MESSAGE,
  );
  schedulePaint();
  const playerId = session.view.player.id;
  const galaxy = session.view.galaxy?.galaxy;
  const system = session.view.galaxy?.system;

  const tryFetch = () => fetchState(playerId, galaxy, system, { fresh: true });

  let view: PlayerView;
  try {
    view = await tryFetch();
  } catch (checkErr) {
    if (
      checkErr instanceof ApiError &&
      (checkErr.kind === "network" ||
        checkErr.kind === "timeout" ||
        checkErr.kind === "overload")
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        view = await tryFetch();
      } catch {
        setFlash("error", NOT_APPLIED_MESSAGE);
        return;
      }
    } else {
      setFlash("error", NOT_APPLIED_MESSAGE);
      return;
    }
  }

  session.view = view;
  if (args.applied(view)) {
    setFlash("notice", args.successNotice(view));
    return;
  }
  setFlash("error", NOT_APPLIED_MESSAGE);
}
