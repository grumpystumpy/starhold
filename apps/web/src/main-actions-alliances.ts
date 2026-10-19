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
import { settleMutation } from "./recover-action";

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
    session.view = await createAllianceRequest(session.view.player.id, {
      name,
      tag,
      joinMode,
    });
    setFlash("notice", `Alliance [${session.view.alliance?.tag ?? tag}] created.`);
  } catch (err) {
    const beforeAllianceId = session.view?.alliance?.id;
    await settleMutation({
      err,
      failureFallback: "Alliance create failed.",
      applied: (view) => view.alliance != null && view.alliance.id !== beforeAllianceId,
      successNotice: (view) => `Alliance [${view.alliance?.tag ?? tag}] created.`,
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doJoinAlliance(allianceId: string): Promise<void> {
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
    session.view = await joinAllianceRequest(session.view.player.id, {
      allianceId,
    });
    setFlash("notice", `Joined [${session.view.alliance?.tag ?? ""}].`);
  } catch (err) {
    const beforeAllianceId = session.view?.alliance?.id;
    await settleMutation({
      err,
      failureFallback: "Alliance join failed.",
      applied: (view) =>
        view.alliance?.id === allianceId ||
        (view.alliance?.id != null && view.alliance.id !== beforeAllianceId),
      successNotice: (view) => `Joined [${view.alliance?.tag ?? ""}].`,
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doLeaveAlliance(): Promise<void> {
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
    session.view = await leaveAllianceRequest(session.view.player.id);
    setFlash("notice", "Left alliance.");
  } catch (err) {
    const beforeAllianceId = session.view?.alliance?.id;
    await settleMutation({
      err,
      failureFallback: "Alliance leave failed.",
      applied: (view) => beforeAllianceId != null && view.alliance == null,
      successNotice: () => "Left alliance.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doDisbandAlliance(): Promise<void> {
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
    session.view = await disbandAllianceRequest(session.view.player.id);
    setFlash("notice", "Alliance disbanded.");
  } catch (err) {
    const beforeAllianceId = session.view?.alliance?.id;
    await settleMutation({
      err,
      failureFallback: "Disband failed.",
      applied: (view) => beforeAllianceId != null && view.alliance == null,
      successNotice: () => "Alliance disbanded.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doKickAllianceMember(targetPlayerId: string): Promise<void> {
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
    session.view = await kickAllianceRequest(
      session.view.player.id,
      targetPlayerId,
    );
    setFlash("notice", "Member kicked.");
  } catch (err) {
    const beforeMember = session.view?.alliance?.members.some(
      (m) => m.playerId === targetPlayerId,
    );
    await settleMutation({
      err,
      failureFallback: "Kick failed.",
      applied: (view) =>
        beforeMember === true &&
        !view.alliance?.members.some((m) => m.playerId === targetPlayerId),
      successNotice: () => "Member kicked.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doSetAllianceRole(
  targetPlayerId: string,
  role: AllianceRole,
): Promise<void> {
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
    session.view = await setAllianceRoleRequest(
      session.view.player.id,
      targetPlayerId,
      role,
    );
    setFlash("notice", "Role updated.");
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Role change failed.",
      applied: (view) =>
        view.alliance?.members.find((m) => m.playerId === targetPlayerId)
          ?.role === role,
      successNotice: () => "Role updated.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doSetAllianceJoinMode(
  joinMode: AllianceJoinMode,
): Promise<void> {
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
    session.view = await setAllianceJoinModeRequest(
      session.view.player.id,
      joinMode,
    );
    setFlash("notice", `Join mode: ${joinMode}.`);
  } catch (err) {
    await settleMutation({
      err,
      failureFallback: "Join mode change failed.",
      applied: (view) => view.alliance?.joinMode === joinMode,
      successNotice: () => `Join mode: ${joinMode}.`,
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doPostAllianceChat(body: string): Promise<void> {
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
    session.view = await postAllianceChatRequest(body);
    setFlash("notice", "Message posted.");
  } catch (err) {
    const beforeChatIds = new Set(
      session.view?.alliance?.chat?.map((m) => m.id) ?? [],
    );
    await settleMutation({
      err,
      failureFallback: "Chat post failed.",
      applied: (view) =>
        view.alliance?.chat?.some(
          (m) => !beforeChatIds.has(m.id) || m.body === body,
        ) ?? false,
      successNotice: () => "Message posted.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doShareAllianceIntel(spyReportId: string): Promise<void> {
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
    session.view = await shareAllianceIntelRequest(spyReportId);
    setFlash("notice", "Spy report shared with the alliance.");
  } catch (err) {
    const beforeIntelIds = new Set(
      session.view?.alliance?.intel?.map((i) => i.id) ?? [],
    );
    await settleMutation({
      err,
      failureFallback: "Intel share failed.",
      applied: (view) =>
        view.alliance?.intel?.some(
          (i) => !beforeIntelIds.has(i.id) || i.spyReportId === spyReportId,
        ) ?? false,
      successNotice: () => "Spy report shared with the alliance.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doDeleteAllianceIntel(intelId: string): Promise<void> {
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
    session.view = await deleteAllianceIntelRequest(intelId);
    setFlash("notice", "Intel removed.");
  } catch (err) {
    const beforeIntel = session.view?.alliance?.intel?.some(
      (i) => i.id === intelId,
    );
    await settleMutation({
      err,
      failureFallback: "Intel remove failed.",
      applied: (view) =>
        beforeIntel === true &&
        !view.alliance?.intel?.some((i) => i.id === intelId),
      successNotice: () => "Intel removed.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doUpsertAllianceMarker(
  coords: Coordinates,
  note: string,
): Promise<void> {
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
    session.view = await upsertAllianceMarkerRequest(coords, note);
    setFlash("notice", `Marker set on ${fmtCoords(coords)}.`);
  } catch (err) {
    const beforeMarkerId = session.view?.alliance?.markers?.find(
      (m) =>
        m.coords.galaxy === coords.galaxy &&
        m.coords.system === coords.system &&
        m.coords.slot === coords.slot,
    )?.id;
    await settleMutation({
      err,
      failureFallback: "Marker failed.",
      applied: (view) => {
        const match = view.alliance?.markers?.find(
          (m) =>
            m.coords.galaxy === coords.galaxy &&
            m.coords.system === coords.system &&
            m.coords.slot === coords.slot,
        );
        return (
          match != null &&
          (match.id !== beforeMarkerId || match.note === note)
        );
      },
      successNotice: () => `Marker set on ${fmtCoords(coords)}.`,
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doDeleteAllianceMarker(markerId: string): Promise<void> {
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
    session.view = await deleteAllianceMarkerRequest(markerId);
    setFlash("notice", "Marker removed.");
  } catch (err) {
    const beforeMarker = session.view?.alliance?.markers?.some(
      (m) => m.id === markerId,
    );
    await settleMutation({
      err,
      failureFallback: "Marker remove failed.",
      applied: (view) =>
        beforeMarker === true &&
        !view.alliance?.markers?.some((m) => m.id === markerId),
      successNotice: () => "Marker removed.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}

export async function doProposeJointStrike(
  coords: Coordinates,
  note?: string,
  mission?: "raid" | "pirateRaid",
): Promise<void> {
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
  } catch (err) {
    const beforeAcsIds = new Set(
      (session.view?.openAcsGroups ?? []).map((g) => g.id),
    );
    const label = fmtCoords(coords);
    await settleMutation({
      err,
      failureFallback: "Joint Strike proposal failed.",
      applied: (view) =>
        view.openAcsGroups.some(
          (g) =>
            !beforeAcsIds.has(g.id) ||
            (g.targetCoords.galaxy === coords.galaxy &&
              g.targetCoords.system === coords.system &&
              g.targetCoords.slot === coords.slot),
        ),
      successNotice: () => `Proposed Joint Strike on ${label}.`,
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
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
    session.view = await inviteAllianceRequest(
      session.view.player.id,
      targetPlayerId,
    );
    setFlash("notice", "Invite sent.");
  } catch (err) {
    const beforeInvites = new Set(
      session.view?.alliance?.pendingInvites?.map((i) => i.playerId) ?? [],
    );
    await settleMutation({
      err,
      failureFallback: "Invite failed.",
      applied: (view) =>
        view.alliance?.pendingInvites?.some(
          (i) => i.playerId === targetPlayerId || !beforeInvites.has(i.playerId),
        ) ?? false,
      successNotice: () => "Invite sent.",
    });
  } finally {
    session.busy = false;
    schedulePaint();
  }
}
