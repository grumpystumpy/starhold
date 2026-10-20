import type { PlayerView } from "@starhold/game";
import { deleteMessages, markEventsRead } from "./api";
import { setConfirmDelete } from "./ui/render-messages";
import { clearFlash, schedulePaint, session, setFlash } from "./session";
import { settleMutation } from "./recover-action";

function countCategoryMessages(
  view: PlayerView,
  category: "all" | "combat" | "spy" | "alerts",
): number {
  if (category === "combat") return view.reports.length;
  if (category === "spy") return view.spyReports.length;
  if (category === "alerts") {
    return view.player.eventLog?.filter((e) => !e.readAt).length ?? 0;
  }
  return (
    view.reports.length +
    view.spyReports.length +
    view.expeditionReports.length +
    (view.player.eventLog?.length ?? 0)
  );
}

function deleteNoticeLabel(category: "all" | "combat" | "spy" | "alerts"): string {
  return category === "all"
    ? "All messages deleted."
    : category === "combat"
      ? "Combat messages deleted."
      : category === "spy"
        ? "Spy messages deleted."
        : "Alerts deleted.";
}

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
    setFlash("notice", deleteNoticeLabel(category));
  } catch (err) {
    const beforeCount = countCategoryMessages(session.view, category);
    await settleMutation({
      err,
      failureFallback: "Could not delete messages.",
      applied: (view) =>
        countCategoryMessages(view, category) < beforeCount || beforeCount === 0,
      successNotice: () => deleteNoticeLabel(category),
    });
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
    setFlash(
      "notice",
      ids && ids.length > 0 ? "Alert marked read." : "Alerts marked read.",
    );
  } catch (err) {
    const noticeLabel =
      ids && ids.length > 0 ? "Alert marked read." : "Alerts marked read.";
    await settleMutation({
      err,
      failureFallback: "Could not mark alerts read.",
      applied: (view) => {
        const events = view.player.eventLog ?? [];
        if (ids && ids.length > 0) {
          return ids.every(
            (id) => events.find((e) => e.id === id)?.readAt != null,
          );
        }
        return !events.some((e) => !e.readAt);
      },
      successNotice: () => noticeLabel,
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
