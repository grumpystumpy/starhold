import { isSeasonBoard } from "@starhold/game";
import {
  claimSeasonReward,
  setCosmeticSkin,
  setCosmeticTitle,
} from "./api";
import { clearFlash, schedulePaint, session, setFlash } from "./session";

export async function doClaimSeason(
  board: string,
  seasonId?: string | null,
): Promise<void> {
  if (!session.view || session.busy) return;
  if (!isSeasonBoard(board)) {
    setFlash("error", "Unknown board.");
    schedulePaint();
    return;
  }
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await claimSeasonReward(
      session.view.player.id,
      board,
      seasonId || undefined,
    );
    const title = session.view.player.cosmetics?.activeTitle;
    setFlash(
      "notice",
      title ? `Claimed ${title}.` : "Season reward claimed.",
    );
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Season claim failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doSetSeasonTitle(title: string): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await setCosmeticTitle(session.view.player.id, title);
    setFlash("notice", title ? "Title equipped." : "Title cleared.");
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Title change failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doSetSeasonSkin(skinId: string): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await setCosmeticSkin(session.view.player.id, skinId);
    setFlash("notice", skinId ? "Planet skin equipped." : "Planet skin cleared.");
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Skin change failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
