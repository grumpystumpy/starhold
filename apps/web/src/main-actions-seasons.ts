import { isSeasonBoard, type SeasonBoardId } from "@starhold/game";
import {
  claimSeasonReward,
  setCosmeticSkin,
  setCosmeticTitle,
} from "./api";
import { clearFlash, schedulePaint, session, setFlash } from "./session";
import { settleMutation } from "./recover-action";

export async function doClaimSeason(
  board: string,
  seasonId?: string | null,
): Promise<void> {
  if (!session.view) return;
  if (session.busy) {
    setFlash("error", "Still applying the last action — try again in a moment.");
    schedulePaint();
    return;
  }
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
    await settleMutation({
      err,
      failureFallback: "Season claim failed.",
      applied: (view) => {
        const targetSeasonId = seasonId || view.seasonLeaderboard.seasonId;
        const claimView = view.seasonLeaderboard.claims.find(
          (c) => c.seasonId === targetSeasonId,
        );
        const offer = claimView?.offers.find((o) => o.board === board);
        if (offer?.claimed) return true;
        if (!seasonId || seasonId === view.seasonLeaderboard.seasonId) {
          if (
            view.player.season?.claimedBoards?.includes(board as SeasonBoardId)
          ) {
            return true;
          }
        }
        if (
          seasonId &&
          view.player.seasonArchive?.[seasonId]?.claimedBoards?.includes(
            board as SeasonBoardId,
          )
        ) {
          return true;
        }
        return false;
      },
      successNotice: (view) => {
        const title = view.player.cosmetics?.activeTitle;
        return title ? `Claimed ${title}.` : "Season reward claimed.";
      },
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doSetSeasonTitle(title: string): Promise<void> {
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
    session.view = await setCosmeticTitle(session.view.player.id, title);
    setFlash("notice", title ? "Title equipped." : "Title cleared.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Title change failed.",
      applied: (view) =>
        (view.player.cosmetics?.activeTitle ?? "") === (title ?? ""),
      successNotice: () => (title ? "Title equipped." : "Title cleared."),
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doSetSeasonSkin(skinId: string): Promise<void> {
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
    session.view = await setCosmeticSkin(session.view.player.id, skinId);
    setFlash("notice", skinId ? "Planet skin equipped." : "Planet skin cleared.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Skin change failed.",
      applied: (view) =>
        (view.player.cosmetics?.activePlanetSkinId ?? "") === (skinId ?? ""),
      successNotice: () =>
        skinId ? "Planet skin equipped." : "Planet skin cleared.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
