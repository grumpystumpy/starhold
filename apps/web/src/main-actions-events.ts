import { markEventsRead } from "./api";
import { clearFlash, schedulePaint, session, setFlash } from "./session";

/** Mark event-log rows read. Omit ids to mark every unread alert. */
export async function doMarkEventsRead(ids?: string[]): Promise<void> {
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
    session.view = await markEventsRead(session.view.player.id, ids);
    setFlash("notice", ids && ids.length > 0 ? "Alert marked read." : "Alerts marked read.");
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Could not mark alerts read.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
