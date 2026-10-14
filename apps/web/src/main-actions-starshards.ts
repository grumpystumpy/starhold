import type { OfficerId, PlayerClassId } from "@starhold/game";
import {
  activateOfficerHire,
  changeClass,
  chooseClass,
  claimDaily,
  unlockSkillNode,
} from "./api";
import { clearFlash, schedulePaint, session, setFlash } from "./session";

export async function doClaimDaily(): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await claimDaily(session.view.player.id);
    setFlash("notice", "Daily Starshards claimed.");
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Daily claim failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doActivateOfficer(officerId: OfficerId): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await activateOfficerHire(
      session.view.player.id,
      officerId,
    );
    setFlash("notice", "Officer hired.");
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Officer hire failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doUnlockSkill(skillId: string): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await unlockSkillNode(session.view.player.id, skillId);
    setFlash("notice", "Skill unlocked.");
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Skill unlock failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doChooseClass(classId: PlayerClassId): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await chooseClass(session.view.player.id, classId);
    setFlash("notice", "Class chosen.");
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Class choose failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doChangeClass(classId: PlayerClassId): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await changeClass(session.view.player.id, classId);
    setFlash("notice", "Class changed.");
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Class change failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
