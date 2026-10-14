import {
  SHIP_ORDER,
  SHIPS,
  type CombatReport,
  type PlayerView,
} from "@starhold/game";
import { fmt, fmtCoords } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";
import { combatBattleExtrasHtml } from "./render-fleets-panels";

export type InboxKind = "combat" | "espionage" | "expedition";

export interface InboxItem {
  kind: InboxKind;
  id: string;
  at: number;
  title: string;
  body: string;
}

function fmtWhen(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return "—";
  try {
    return new Date(at).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function kindLabel(kind: InboxKind): string {
  switch (kind) {
    case "combat":
      return "Combat";
    case "espionage":
      return "Spy";
    case "expedition":
      return "Expedition";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function combatTitle(r: CombatReport, selfId: string): string {
  const role = r.attackerPlayerId === selfId ? "Attack" : "Defense";
  const foe =
    r.attackerPlayerId === selfId ? r.defenderName : r.attackerName;
  const loot =
    r.loot.metal + r.loot.crystal + r.loot.deuterium > 0
      ? ` · loot ${fmt(r.loot.metal)}/${fmt(r.loot.crystal)}/${fmt(r.loot.deuterium)}`
      : "";
  const debris =
    (r.debrisCreated?.metal ?? 0) + (r.debrisCreated?.crystal ?? 0) > 0
      ? ` · debris ${fmt(r.debrisCreated.metal)}/${fmt(r.debrisCreated.crystal)}`
      : "";
  const moon = r.moonFormed ? " · moon formed" : "";
  const moonKill = r.moonDestroyed ? " · moon destroyed" : "";
  const rounds = typeof r.rounds === "number" ? ` · ${r.rounds}r` : "";
  const xp =
    r.xpAwarded != null
      ? ` · XP atk +${fmt(r.xpAwarded.attacker)} / def +${fmt(r.xpAwarded.defender)}`
      : "";
  const share =
    r.shareCode != null ? ` · share ${r.shareCode}` : "";
  return `${role}: ${r.outcome}${rounds} vs ${foe} @ ${fmtCoords(r.targetCoords)}${loot}${debris}${moon}${moonKill}${xp}${share}`;
}

function combatItems(
  reports: PlayerView["reports"],
  selfId: string,
): InboxItem[] {
  return (reports ?? []).map((r) => ({
    kind: "combat" as const,
    id: r.id,
    at: r.at,
    title: combatTitle(r, selfId),
    body: r.summary,
  }));
}

function spyItems(reports: PlayerView["spyReports"]): InboxItem[] {
  return (reports ?? []).map((r) => {
    const bits: string[] = [];
    if (r.resources) {
      bits.push(
        `res ${fmt(r.resources.metal)}/${fmt(r.resources.crystal)}/${fmt(r.resources.deuterium)}`,
      );
    }
    if (r.ships) {
      const ships = SHIP_ORDER.filter((id) => (r.ships?.[id] ?? 0) > 0)
        .map((id) => `${fmt(r.ships![id] ?? 0)}×${SHIPS[id].name}`)
        .join(", ");
      if (ships) bits.push(ships);
    }
    const detail = bits.length ? ` · ${bits.join(" · ")}` : "";
    return {
      kind: "espionage" as const,
      id: r.id,
      at: r.at,
      title: `Spy L${fmt(r.detail)} ${r.targetName} @ ${fmtCoords(r.targetCoords)}`,
      body: `${r.summary}${detail}`,
    };
  });
}

function expeditionItems(
  reports: PlayerView["expeditionReports"],
): InboxItem[] {
  return (reports ?? []).map((r) => {
    const cargo =
      r.cargoGained.metal +
        r.cargoGained.crystal +
        r.cargoGained.deuterium >
      0
        ? ` · ${fmt(r.cargoGained.metal)}/${fmt(r.cargoGained.crystal)}/${fmt(r.cargoGained.deuterium)}`
        : "";
    const shards =
      (r.starshardsGained ?? 0) > 0
        ? ` · +${fmt(r.starshardsGained!)} ✦`
        : "";
    return {
      kind: "expedition" as const,
      id: r.id,
      at: r.at,
      title: `${r.kind} @ ${fmtCoords(r.targetCoords)}${cargo}${shards}`,
      body: r.summary,
    };
  });
}

/** Merge combat / spy / expedition reports newest-first (empire mail inbox). */
export function collectInbox(view: PlayerView): InboxItem[] {
  const items: InboxItem[] = [
    ...combatItems(view.reports ?? [], view.player.id),
    ...spyItems(view.spyReports ?? []),
    ...expeditionItems(view.expeditionReports ?? []),
  ];
  items.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return items;
}

export function messagesPageHtml(view: PlayerView): string {
  const items = collectInbox(view);
  const counts = {
    combat: items.filter((i) => i.kind === "combat").length,
    espionage: items.filter((i) => i.kind === "espionage").length,
    expedition: items.filter((i) => i.kind === "expedition").length,
  };
  const empty = items.length === 0;
  const combatById = new Map(
    (view.reports ?? []).map((r) => [r.id, r] as const),
  );
  const list = empty
    ? `<p class="hint" data-testid="messages-empty">No mail yet. Combat, spy, and expedition reports appear here when fleets return.</p>`
    : `<ul class="reports messages-inbox" data-testid="messages-inbox">
        ${items
          .map((item) => {
            const combat =
              item.kind === "combat" ? combatById.get(item.id) : undefined;
            const extras = combat ? combatBattleExtrasHtml(combat) : "";
            return `<li class="message-row" data-testid="message-${escapeAttr(item.kind)}-${escapeAttr(item.id)}" data-kind="${escapeAttr(item.kind)}"${combat ? ` data-report-id="${escapeAttr(combat.id)}"` : ""}>
              <div class="message-head">
                <span class="message-kind" data-testid="message-kind">${escapeHtml(kindLabel(item.kind))}</span>
                <time class="message-when meta" datetime="${escapeAttr(new Date(item.at).toISOString())}">${escapeHtml(fmtWhen(item.at))}</time>
              </div>
              <strong class="message-title">${escapeHtml(item.title)}</strong>
              <span class="meta message-body">${escapeHtml(item.body)}</span>
              ${extras}
            </li>`;
          })
          .join("")}
      </ul>`;

  return `
    <section class="panel" data-testid="messages-panel">
      <h2>Messages</h2>
      <p class="hint" data-testid="messages-summary">Empire mail — ${fmt(items.length)} report${items.length === 1 ? "" : "s"} (${fmt(counts.combat)} combat · ${fmt(counts.espionage)} spy · ${fmt(counts.expedition)} expedition). Player-to-player mail lands with alliances later.</p>
      ${list}
    </section>`;
}
