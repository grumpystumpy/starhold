import {
  ALLIANCE_CLASS_BONUSES,
  ALLIANCE_CLASS_ORDER,
  DEFENSES,
  SHIPS,
  type AllianceClassId,
  type AllianceGalaxyMarker,
  type AllianceIntelStamp,
  type AllianceJoinMode,
  type AllianceRole,
  type PlayerView,
} from "@starhold/game";
import { fmt, fmtCompact, fmtCoords } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";

function canModerate(role: AllianceRole): boolean {
  return role === "founder" || role === "officer";
}

function stockLine(
  stock: Partial<Record<string, number>> | null,
  names: Record<string, { name: string }>,
): string {
  if (!stock) return "";
  return Object.entries(stock)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([id, count]) => `${fmt(count ?? 0)}× ${names[id]?.name ?? id}`)
    .join(", ");
}

function intelSnapshotText(stamp: AllianceIntelStamp): string {
  const snap = stamp.snapshot;
  const bits: string[] = [snap.summary];
  if (snap.resources) {
    bits.push(
      `resources ${fmt(snap.resources.metal)}/${fmt(snap.resources.crystal)}/${fmt(snap.resources.deuterium)}`,
    );
  }
  const ships = stockLine(snap.ships, SHIPS);
  if (ships) bits.push(ships);
  const defenses = stockLine(snap.defenses, DEFENSES);
  if (defenses) bits.push(defenses);
  return bits.join(" · ");
}

function chatSection(view: PlayerView, busy: boolean): string {
  const alliance = view.alliance;
  if (!alliance) return "";
  const chat = alliance.chat ?? [];
  const lines = chat.length
    ? chat
        .map(
          (m) =>
            `<p class="alliance-chat-line" data-testid="alliance-chat-${escapeAttr(m.id)}"><strong>${escapeHtml(m.displayName)}</strong> ${escapeHtml(m.body)}</p>`,
        )
        .join("")
    : `<p class="hint" data-testid="alliance-chat-empty">No messages yet.</p>`;
  return `
    <section class="alliance-section" data-testid="alliance-chat">
      <h3>Chat</h3>
      <div class="alliance-chat-log" data-testid="alliance-chat-log">${lines}</div>
      <form id="alliance-chat-form" class="alliance-form alliance-chat-form" data-testid="alliance-chat-form">
        <label>Message
          <input type="text" name="alliance-chat-body" data-testid="alliance-chat-body" maxlength="500" required ${busy ? "disabled" : ""} />
        </label>
        <button type="submit" data-testid="alliance-chat-send" ${busy ? "disabled" : ""}>Send</button>
      </form>
    </section>`;
}

function intelSection(view: PlayerView, busy: boolean): string {
  const alliance = view.alliance;
  if (!alliance) return "";
  const intel = alliance.intel ?? [];
  const rows = intel.length
    ? `<ul class="alliance-roster" data-testid="alliance-intel-list">
        ${intel
          .map((stamp) => {
            const canRemove =
              stamp.sharedByPlayerId === view.player.id ||
              canModerate(alliance.myRole);
            return `<li class="alliance-member" data-testid="alliance-intel-${escapeAttr(stamp.id)}">
              <span><strong>${escapeHtml(stamp.targetLabel)}</strong> @ ${fmtCoords(stamp.targetCoords)} · ${escapeHtml(stamp.sharedByName)}</span>
              <details>
                <summary data-testid="alliance-intel-open-${escapeAttr(stamp.id)}">Open</summary>
                <p class="meta">${escapeHtml(intelSnapshotText(stamp))}</p>
              </details>
              ${
                canRemove
                  ? `<button type="button" data-alliance-intel-delete="${escapeAttr(stamp.id)}" data-testid="alliance-intel-delete-${escapeAttr(stamp.id)}" ${busy ? "disabled" : ""}>Remove</button>`
                  : ""
              }
            </li>`;
          })
          .join("")}
      </ul>`
    : `<p class="hint" data-testid="alliance-intel-empty">No shared intel yet. Share a spy report from Fleet.</p>`;
  return `
    <section class="alliance-section" data-testid="alliance-intel">
      <h3>Intel</h3>
      ${rows}
    </section>`;
}

function markerRemoveAllowed(
  marker: AllianceGalaxyMarker,
  playerId: string,
  role: AllianceRole,
): boolean {
  return marker.createdByPlayerId === playerId || canModerate(role);
}

function markersSection(view: PlayerView, busy: boolean): string {
  const alliance = view.alliance;
  if (!alliance) return "";
  const markers = alliance.markers ?? [];
  const rows = markers.length
    ? `<ul class="alliance-roster" data-testid="alliance-marker-list">
        ${markers
          .map((marker) => {
            const note = marker.note ? ` · ${escapeHtml(marker.note)}` : "";
            const remove = markerRemoveAllowed(
              marker,
              view.player.id,
              alliance.myRole,
            )
              ? `<button type="button" data-alliance-marker-remove="${escapeAttr(marker.id)}" data-testid="alliance-marker-remove-${escapeAttr(marker.id)}" ${busy ? "disabled" : ""}>Remove</button>`
              : "";
            return `<li class="alliance-member" data-testid="alliance-marker-${escapeAttr(marker.id)}">
              <span>${fmtCoords(marker.coords)}${note} · ${escapeHtml(marker.createdByName)}</span>
              ${remove}
            </li>`;
          })
          .join("")}
      </ul>`
    : `<p class="hint" data-testid="alliance-markers-empty">No galaxy markers.</p>`;
  return `
    <section class="alliance-section" data-testid="alliance-markers">
      <h3>Markers</h3>
      ${rows}
    </section>`;
}

function roleLabel(role: string): string {
  switch (role) {
    case "founder":
      return "Founder";
    case "officer":
      return "Officer";
    case "member":
      return "Member";
    default:
      return role;
  }
}

function allianceClassBlurb(id: AllianceClassId | null): string {
  if (!id) return "No alliance class.";
  const b = ALLIANCE_CLASS_BONUSES[id];
  const parts: string[] = [];
  const mark = (n: number, label: string) => {
    if (n !== 1) parts.push(`${label} ×${n.toFixed(2)}`);
  };
  mark(b.fleetSpeed, "fleet speed");
  mark(b.shipShield, "ship shields");
  mark(b.shipWeapon, "ship weapons");
  mark(b.shipCost, "ship cost");
  mark(b.shipTime, "ship time");
  mark(b.loot, "loot");
  mark(b.buildingCost, "building cost");
  mark(b.buildingTime, "building time");
  mark(b.empireMissionSpeed, "in-empire speed");
  mark(b.defenseStat, "defense hull/armor/shields");
  mark(b.mineOutput, "mine output");
  mark(b.expeditionAmount, "expedition amount");
  mark(b.colonyFieldMult, "colony fields");
  mark(b.recyclerSpeed, "recycler speed");
  if (b.expeditionRollShift !== 0) {
    parts.push(
      `expedition good +${fmt(b.expeditionRollShift)} / bad −${fmt(b.expeditionRollShift)}`,
    );
  }
  return parts.join(" · ");
}

function allianceClassSection(
  alliance: NonNullable<PlayerView["alliance"]>,
  busy: boolean,
): string {
  const current = alliance.allianceClass ?? null;
  const title = current ? ALLIANCE_CLASS_BONUSES[current].name : "No class";
  const selector =
    alliance.myRole === "founder"
      ? `<label>Alliance class
          <select data-alliance-class-select data-testid="alliance-class-select" ${busy ? "disabled" : ""}>
            <option value="" ${current == null ? "selected" : ""}>None</option>
            ${ALLIANCE_CLASS_ORDER.map((id) => {
              const def = ALLIANCE_CLASS_BONUSES[id];
              return `<option value="${escapeAttr(id)}" ${current === id ? "selected" : ""}>${escapeHtml(def.name)}</option>`;
            }).join("")}
          </select>
        </label>`
      : "";
  return `<div class="alliance-class" data-testid="alliance-class">
    <p class="hint" data-testid="alliance-class-label">Class: ${escapeHtml(title)}</p>
    <p class="hint" data-testid="alliance-class-bonuses">${escapeHtml(allianceClassBlurb(current))}</p>
    ${selector}
  </div>`;
}

function joinModeLabel(mode: AllianceJoinMode): string {
  return mode === "invite" ? "Invite only" : "Open";
}

function createFormHtml(busy: boolean): string {
  return `
    <form id="alliance-create-form" class="alliance-form" data-testid="alliance-create-form">
      <label>Name
        <input type="text" name="alliance-name" data-testid="alliance-name" maxlength="30" minlength="3" required placeholder="Solar Guard" ${busy ? "disabled" : ""} />
      </label>
      <label>Tag
        <input type="text" name="alliance-tag" data-testid="alliance-tag" maxlength="4" minlength="2" required placeholder="SOL" ${busy ? "disabled" : ""} />
      </label>
      <label>Join mode
        <select name="alliance-join-mode" data-testid="alliance-join-mode" ${busy ? "disabled" : ""}>
          <option value="open" selected>Open</option>
          <option value="invite">Invite only</option>
        </select>
      </label>
      <button type="submit" data-testid="alliance-create-btn" ${busy ? "disabled" : ""}>Create alliance</button>
    </form>`;
}

function directoryHtml(view: PlayerView, busy: boolean): string {
  const rows = view.allianceDirectory ?? [];
  if (rows.length === 0) {
    return `<p class="hint" data-testid="alliance-directory-empty">No alliances yet — create the first.</p>`;
  }
  return `
    <ul class="alliance-directory" data-testid="alliance-directory">
      ${rows
        .map((a) => {
          const canJoin =
            !view.alliance &&
            a.joinMode === "open" &&
            a.memberCount < a.maxMembers;
          return `<li class="alliance-dir-row" data-testid="alliance-dir-${escapeAttr(a.id)}">
            <span><strong>[${escapeHtml(a.tag)}]</strong> ${escapeHtml(a.name)}</span>
            <span class="meta">${fmt(a.memberCount)}/${fmt(a.maxMembers)} · ${escapeHtml(joinModeLabel(a.joinMode))}</span>
            ${
              canJoin
                ? `<button type="button" data-alliance-join="${escapeAttr(a.id)}" data-testid="alliance-join-${escapeAttr(a.id)}" ${busy ? "disabled" : ""}>Join</button>`
                : ""
            }
          </li>`;
        })
        .join("")}
    </ul>`;
}

function rosterHtml(view: PlayerView, busy: boolean): string {
  const alliance = view.alliance;
  if (!alliance) return "";
  const canKick =
    alliance.myRole === "founder" || alliance.myRole === "officer";
  const canPromote = alliance.myRole === "founder";
  return `
    <ul class="alliance-roster" data-testid="alliance-roster">
      ${alliance.members
        .map((m) => {
          const isSelf = m.playerId === view.player.id;
          const actions: string[] = [];
          if (canKick && !isSelf && m.role !== "founder") {
            if (alliance.myRole === "founder" || m.role === "member") {
              actions.push(
                `<button type="button" data-alliance-kick="${escapeAttr(m.playerId)}" data-testid="alliance-kick-${escapeAttr(m.playerId)}" ${busy ? "disabled" : ""}>Kick</button>`,
              );
            }
          }
          if (canPromote && !isSelf && m.role === "member") {
            actions.push(
              `<button type="button" data-alliance-promote="${escapeAttr(m.playerId)}" data-testid="alliance-promote-${escapeAttr(m.playerId)}" ${busy ? "disabled" : ""}>Make Officer</button>`,
            );
          }
          if (canPromote && !isSelf) {
            actions.push(
              `<button type="button" data-alliance-transfer="${escapeAttr(m.playerId)}" data-testid="alliance-transfer-${escapeAttr(m.playerId)}" ${busy ? "disabled" : ""}>Transfer Founder</button>`,
            );
          }
          return `<li class="alliance-member" data-testid="alliance-member-${escapeAttr(m.playerId)}">
            <span><strong>${escapeHtml(m.name)}</strong>${isSelf ? " (you)" : ""} · ${escapeHtml(roleLabel(m.role))}</span>
            <span class="meta">${fmtCompact(m.pointsHint)} pts</span>
            ${actions.length ? `<span class="alliance-member-actions">${actions.join(" ")}</span>` : ""}
          </li>`;
        })
        .join("")}
    </ul>`;
}

export function alliancesPageHtml(view: PlayerView, busy: boolean): string {
  const alliance = view.alliance;
  if (!alliance) {
    return `
      <section class="panel" data-testid="alliances-panel">
        <h2>Alliances</h2>
        <p class="hint" data-testid="alliances-summary">Form a tag for galaxy and highscores.</p>
        <h3>Create</h3>
        ${createFormHtml(busy)}
        <h3>Directory</h3>
        ${directoryHtml(view, busy)}
      </section>`;
  }

  const founderControls =
    alliance.myRole === "founder"
      ? `
        <div class="alliance-founder-controls" data-testid="alliance-founder-controls">
          <label>Join mode
            <select data-alliance-join-mode-select data-testid="alliance-join-mode-select" ${busy ? "disabled" : ""}>
              <option value="open" ${alliance.joinMode === "open" ? "selected" : ""}>Open</option>
              <option value="invite" ${alliance.joinMode === "invite" ? "selected" : ""}>Invite only</option>
            </select>
          </label>
          <button type="button" data-alliance-disband data-testid="alliance-disband-btn" ${busy ? "disabled" : ""}>Disband</button>
        </div>
        ${
          alliance.joinMode === "invite"
            ? `<form id="alliance-invite-form" class="alliance-form" data-testid="alliance-invite-form">
                <label>Invite player id
                  <input type="text" name="alliance-invite-id" data-testid="alliance-invite-id" required ${busy ? "disabled" : ""} />
                </label>
                <button type="submit" data-testid="alliance-invite-btn" ${busy ? "disabled" : ""}>Invite</button>
              </form>
              ${
                alliance.pendingInvites.length
                  ? `<p class="hint" data-testid="alliance-pending">Pending: ${alliance.pendingInvites
                      .map((p) => escapeHtml(p.name))
                      .join(", ")}</p>`
                  : ""
              }`
            : ""
        }`
      : "";

  return `
    <section class="panel" data-testid="alliances-panel">
      <h2>Alliances</h2>
      <p class="hint" data-testid="alliances-summary">
        <strong data-testid="alliance-tag-badge">[${escapeHtml(alliance.tag)}]</strong>
        ${escapeHtml(alliance.name)} · ${escapeHtml(joinModeLabel(alliance.joinMode))} ·
        ${fmt(alliance.memberCount)}/${fmt(alliance.maxMembers)} · you are ${escapeHtml(roleLabel(alliance.myRole))}
      </p>
      ${rosterHtml(view, busy)}
      ${allianceClassSection(alliance, busy)}
      ${chatSection(view, busy)}
      ${intelSection(view, busy)}
      ${markersSection(view, busy)}
      ${founderControls}
      <div class="alliance-leave-row">
        <button type="button" data-alliance-leave data-testid="alliance-leave-btn" ${busy ? "disabled" : ""}>Leave alliance</button>
      </div>
      <h3>Directory</h3>
      ${directoryHtml(view, busy)}
    </section>`;
}
