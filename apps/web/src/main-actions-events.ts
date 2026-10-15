import { deleteMessages, markEventsRead } from "./api";
import { setConfirmDelete } from "./ui/render-messages";
import { clearFlash, schedulePaint, session, setFlash } from "./session";

/** Delete one inbox category after the player confirms. */
export async function doDeleteMessages(
  category: "all" | "combat" | "spy" | "alerts",
): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  setConfirmDelete(null);
  schedulePaint();
  try {
    session.view = await deleteMessages(session.view.player.id, category);
    const label =
      category === "all"
        ? "All messages deleted."
        : category === "combat"
          ? "Combat messages deleted."
          : category === "spy"
            ? "Spy messages deleted."
            : "Alerts deleted.";
    setFlash("notice", label);
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Could not delete messages.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

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
