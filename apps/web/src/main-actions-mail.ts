import {
  ApiError,
  COULD_NOT_CONFIRM_MESSAGE,
  deleteCommanderMailRequest,
  fetchCommanderMail,
  NOT_APPLIED_MESSAGE,
  postCommanderMail,
} from "./api";
import { clearFlash, schedulePaint, session, setFlash } from "./session";
import { removeCommanderMail, setMailComposeDraft } from "./ui/render-messages";

function inboxFrom(payload: { messages?: unknown }): { id: string; body: string; senderId: string }[] | null {
  if (!Array.isArray(payload.messages)) return null;
  return payload.messages.flatMap((line) => {
    if (!line || typeof line !== "object") return [];
    const row = line as { id?: unknown; body?: unknown; senderId?: unknown };
    if (typeof row.id !== "string" || typeof row.body !== "string") return [];
    return [{ id: row.id, body: row.body, senderId: typeof row.senderId === "string" ? row.senderId : "" }];
  });
}

export async function doSendCommanderMail(to: string, body: string): Promise<void> {
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
    await postCommanderMail(to, body);
    setMailComposeDraft(to, "");
    setFlash("notice", "Message sent.");
  } catch (err) {
    if (!(err instanceof ApiError) || !err.retryable) {
      setFlash("error", err instanceof Error ? err.message : "Mail send failed.");
    } else {
      try {
        await fetchCommanderMail();
      } catch {
        /* the inbox read is only a confirmation attempt */
      }
      setFlash("error", COULD_NOT_CONFIRM_MESSAGE);
    }
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doDeleteCommanderMail(id: string): Promise<void> {
  if (!session.view || !id) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    await deleteCommanderMailRequest(id);
    removeCommanderMail(id);
    setFlash("notice", "Message deleted.");
  } catch (err) {
    if (!(err instanceof ApiError) || !err.retryable) {
      setFlash("error", err instanceof Error ? err.message : "Could not delete that message.");
      return;
    }
    try {
      const payload = await fetchCommanderMail();
      const messages = inboxFrom(payload);
      if (!messages) {
        setFlash("error", COULD_NOT_CONFIRM_MESSAGE);
        return;
      }
      if (!messages.some((line) => line.id === id)) {
        removeCommanderMail(id);
        setFlash("notice", "Message deleted.");
        return;
      }
      setFlash("error", NOT_APPLIED_MESSAGE);
    } catch {
      setFlash("error", COULD_NOT_CONFIRM_MESSAGE);
    }
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
