import type { AllianceJoinMode, AllianceRole } from "@starhold/game";
import {
  createAllianceRequest,
  disbandAllianceRequest,
  inviteAllianceRequest,
  joinAllianceRequest,
  kickAllianceRequest,
  leaveAllianceRequest,
  setAllianceJoinModeRequest,
  setAllianceRoleRequest,
} from "./api";
import { clearFlash, schedulePaint, session, setFlash } from "./session";

export async function doCreateAlliance(
  name: string,
  tag: string,
  joinMode: AllianceJoinMode,
): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await createAllianceRequest(session.view.player.id, {
      name,
      tag,
      joinMode,
    });
    setFlash("notice", `Alliance [${session.view.alliance?.tag ?? tag}] created.`);
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Alliance create failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doJoinAlliance(allianceId: string): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await joinAllianceRequest(session.view.player.id, {
      allianceId,
    });
    setFlash("notice", `Joined [${session.view.alliance?.tag ?? ""}].`);
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Alliance join failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doLeaveAlliance(): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await leaveAllianceRequest(session.view.player.id);
    setFlash("notice", "Left alliance.");
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Alliance leave failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doDisbandAlliance(): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await disbandAllianceRequest(session.view.player.id);
    setFlash("notice", "Alliance disbanded.");
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Disband failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doKickAllianceMember(targetPlayerId: string): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await kickAllianceRequest(
      session.view.player.id,
      targetPlayerId,
    );
    setFlash("notice", "Member kicked.");
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Kick failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doSetAllianceRole(
  targetPlayerId: string,
  role: AllianceRole,
): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await setAllianceRoleRequest(
      session.view.player.id,
      targetPlayerId,
      role,
    );
    setFlash("notice", "Role updated.");
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Role change failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doSetAllianceJoinMode(
  joinMode: AllianceJoinMode,
): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await setAllianceJoinModeRequest(
      session.view.player.id,
      joinMode,
    );
    setFlash("notice", `Join mode: ${joinMode}.`);
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Join mode change failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doInviteAlliance(targetPlayerId: string): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    session.view = await inviteAllianceRequest(
      session.view.player.id,
      targetPlayerId,
    );
    setFlash("notice", "Invite sent.");
  } catch (err) {
    setFlash(
      "error",
      err instanceof Error ? err.message : "Invite failed.",
    );
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
