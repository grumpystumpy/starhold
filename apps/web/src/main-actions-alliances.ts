import type {
  AcsPrefill,
  AllianceJoinMode,
  AllianceRole,
  Coordinates,
  PlayerView,
} from "@starhold/game";
import {
  createAllianceRequest,
  deleteAllianceIntelRequest,
  deleteAllianceMarkerRequest,
  disbandAllianceRequest,
  inviteAllianceRequest,
  joinAllianceRequest,
  kickAllianceRequest,
  leaveAllianceRequest,
  postAllianceChatRequest,
  proposeAllianceStrikeRequest,
  setAllianceJoinModeRequest,
  setAllianceRoleRequest,
  shareAllianceIntelRequest,
  upsertAllianceMarkerRequest,
} from "./api";
import { clearFlash, root, schedulePaint, session, setFlash } from "./session";
import { fmtCoords } from "./ui/format";
import { navigateTo } from "./ui/router";

/** Fill Joint Strike controls when that fleet UI is on the page. */
export function wireJointStrikeForm(prefill: AcsPrefill): boolean {
  const open = root.querySelector<HTMLInputElement>("#fleet-open-acs");
  const target = root.querySelector<HTMLSelectElement>("#fleet-target");
  if (!open || !target) return false;
  const mission = root.querySelector<HTMLInputElement>(
    `input[name="fleet-mission"][value="${prefill.mission}"]`,
  );
  if (mission) mission.checked = true;
  open.checked = true;
  const key = `${prefill.coords.galaxy}:${prefill.coords.system}:${prefill.coords.slot}`;
  const value = `coords:${key}`;
  let match = [...target.options].find(
    (option) => option.value === value || option.value.includes(key) || option.text.includes(key),
  );
  if (!match) {
    match = document.createElement("option");
    match.value = value;
    match.text = `Joint Strike ${key}`;
    target.append(match);
  }
  target.value = match.value;
  return true;
}

function coordsFromFleetTarget(view: PlayerView, raw: string): Coordinates | null {
  if (raw.startsWith("coords:")) {
    const [galaxy, system, slot] = raw
      .slice("coords:".length)
      .split(":")
      .map((part) => Number(part));
    if (
      Number.isInteger(galaxy) &&
      Number.isInteger(system) &&
      Number.isInteger(slot)
    ) {
      return { galaxy: galaxy!, system: system!, slot: slot! };
    }
    return null;
  }
  if (raw.startsWith("pirate:")) {
    const id = raw.slice("pirate:".length);
    return view.galaxy.pirateBase?.id === id
      ? view.galaxy.pirateBase.coords
      : null;
  }
  if (raw.startsWith("planet:")) {
    const id = raw.slice("planet:".length);
    const owned = view.ownedPlanets.find((planet) => planet.id === id);
    if (owned) return owned.coords;
    const rival = view.roster.find((row) => row.planetId === id);
    if (rival) return rival.coords;
    const slot = view.galaxy.slots.find(
      (row) => row.planetId === id || row.moonId === id,
    );
    if (slot) return slot.coords;
  }
  return null;
}

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

async function runAllianceAction(
  work: () => Promise<void>,
  fallback: string,
): Promise<void> {
  if (!session.view || session.busy) return;
  session.busy = true;
  clearFlash();
  schedulePaint();
  try {
    await work();
  } catch (err) {
    setFlash("error", err instanceof Error ? err.message : fallback);
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doPostAllianceChat(body: string): Promise<void> {
  await runAllianceAction(async () => {
    session.view = await postAllianceChatRequest(body);
    setFlash("notice", "Message posted.");
  }, "Chat post failed.");
}

export async function doShareAllianceIntel(spyReportId: string): Promise<void> {
  await runAllianceAction(async () => {
    session.view = await shareAllianceIntelRequest(spyReportId);
    setFlash("notice", "Spy report shared with the alliance.");
  }, "Intel share failed.");
}

export async function doDeleteAllianceIntel(intelId: string): Promise<void> {
  await runAllianceAction(async () => {
    session.view = await deleteAllianceIntelRequest(intelId);
    setFlash("notice", "Intel removed.");
  }, "Intel remove failed.");
}

export async function doUpsertAllianceMarker(
  coords: Coordinates,
  note: string,
): Promise<void> {
  await runAllianceAction(async () => {
    session.view = await upsertAllianceMarkerRequest(coords, note);
    setFlash("notice", `Marker set on ${fmtCoords(coords)}.`);
  }, "Marker failed.");
}

export async function doDeleteAllianceMarker(markerId: string): Promise<void> {
  await runAllianceAction(async () => {
    session.view = await deleteAllianceMarkerRequest(markerId);
    setFlash("notice", "Marker removed.");
  }, "Marker remove failed.");
}

export async function doProposeJointStrike(
  coords: Coordinates,
  note?: string,
  mission?: "raid" | "pirateRaid",
): Promise<void> {
  await runAllianceAction(async () => {
    const result = await proposeAllianceStrikeRequest({
      coords,
      note,
      mission,
    });
    session.view = result.view;
    const label = fmtCoords(coords);
    if (result.acsPrefill) {
      session.pendingAcsPrefill = result.acsPrefill;
      navigateTo("fleet");
      if (wireJointStrikeForm(result.acsPrefill)) {
        session.pendingAcsPrefill = null;
      }
      setFlash(
        "notice",
        `Joint Strike armed for ${label}. Launch to open it for alliance mates.`,
      );
      return;
    }
    setFlash("notice", `Proposed Joint Strike on ${label}.`);
  }, "Joint Strike proposal failed.");
}

export function fleetStrikeTarget(): {
  coords: Coordinates;
  mission: "raid" | "pirateRaid";
} | null {
  const view = session.view;
  const form = root.querySelector<HTMLFormElement>("#fleet-form");
  if (!view || !form) return null;
  const target = form.querySelector<HTMLSelectElement>("#fleet-target");
  const raw = target?.value ?? "";
  const coords = coordsFromFleetTarget(view, raw);
  if (!coords) return null;
  const selected = form.querySelector<HTMLInputElement>(
    'input[name="fleet-mission"]:checked',
  );
  const mission = selected?.value === "pirateRaid" ? "pirateRaid" : "raid";
  return { coords, mission };
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
