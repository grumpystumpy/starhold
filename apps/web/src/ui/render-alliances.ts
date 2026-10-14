import type { AllianceJoinMode, PlayerView } from "@starhold/game";
import { fmt } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";

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
            <span class="meta">${fmt(m.pointsHint)} pts</span>
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
        <p class="hint" data-testid="alliances-summary">Form a tag for galaxy and highscores. Chat and shared intel come later.</p>
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
      ${founderControls}
      <div class="alliance-leave-row">
        <button type="button" data-alliance-leave data-testid="alliance-leave-btn" ${busy ? "disabled" : ""}>Leave alliance</button>
      </div>
      <h3>Directory</h3>
      ${directoryHtml(view, busy)}
    </section>`;
}
