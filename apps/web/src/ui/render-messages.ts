import {
  SHIP_ORDER,
  SHIPS,
  type CombatReport,
  type EventLogEntry,
  type PlayerView,
} from "@starhold/game";
import { fmt, fmtCoords } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";
import { combatBattleExtrasHtml } from "./render-fleets-panels";

export type InboxKind =
  | "combat"
  | "spy"
  | "expedition"
  | "buildComplete"
  | "fleetReturn"
  | "raidAlert"
  | "miniNearby";

export type InboxFilter = "all" | "combat" | "alerts";

export interface InboxItem {
  kind: InboxKind;
  id: string;
  at: number;
  title: string;
  body: string;
  unread: boolean;
  href?: string;
}

let inboxFilter: InboxFilter = "all";

export function setInboxFilter(next: InboxFilter): void {
  inboxFilter = next;
}

export function currentInboxFilter(): InboxFilter {
  return inboxFilter;
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
    case "spy":
      return "Spy";
    case "expedition":
      return "Expedition";
    case "buildComplete":
      return "Build";
    case "fleetReturn":
      return "Fleet";
    case "raidAlert":
      return "Raid";
    case "miniNearby":
      return "Mini";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function inboxBucket(kind: InboxKind): "combat" | "alerts" {
  switch (kind) {
    case "combat":
    case "spy":
    case "expedition":
      return "combat";
    case "buildComplete":
    case "fleetReturn":
    case "raidAlert":
    case "miniNearby":
      return "alerts";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  if (href.startsWith("#") || href.startsWith("/")) return href;
  return null;
}

function viewerResult(
  report: CombatReport,
  selfId: string,
): "victory" | "defeat" | "draw" {
  if (report.outcome === "draw") return "draw";
  const won =
    (report.outcome === "attacker_win" && report.attackerPlayerId === selfId) ||
    (report.outcome === "defender_win" && report.defenderPlayerId === selfId);
  return won ? "victory" : "defeat";
}

function combatItems(
  reports: PlayerView["reports"],
  selfId: string,
): InboxItem[] {
  return (reports ?? []).map((r) => ({
    kind: "combat" as const,
    id: r.id,
    at: r.at,
    title: `Raid at ${fmtCoords(r.targetCoords)} — ${viewerResult(r, selfId)}`,
    body: r.summary,
    unread: false,
    href: `#msg-combat-${r.id}`,
  }));
}

function spyItems(reports: PlayerView["spyReports"]): InboxItem[] {
  return (reports ?? []).map((r) => {
    const bits: string[] = [r.summary];
    if (r.resources) {
      bits.push(
        `res ${fmt(r.resources.metal)}/${fmt(r.resources.crystal)}/${fmt(r.resources.deuterium)}`,
      );
    }
    if (r.ships) {
      const ships = SHIP_ORDER.filter((id) => (r.ships?.[id] ?? 0) > 0)
        .map((id) => `${fmt(r.ships![id] ?? 0)}× ${SHIPS[id].name}`)
        .join(", ");
      if (ships) bits.push(ships);
    }
    return {
      kind: "spy" as const,
      id: r.id,
      at: r.at,
      title: `Espionage of ${fmtCoords(r.targetCoords)}`,
      body: bits.filter(Boolean).join(" · "),
      unread: false,
    };
  });
}

function expeditionItems(
  reports: PlayerView["expeditionReports"],
): InboxItem[] {
  return (reports ?? []).map((r) => {
    const cargo =
      r.cargoGained.metal + r.cargoGained.crystal + r.cargoGained.deuterium > 0
        ? ` · ${fmt(r.cargoGained.metal)}/${fmt(r.cargoGained.crystal)}/${fmt(r.cargoGained.deuterium)}`
        : "";
    const shards =
      (r.starshardsGained ?? 0) > 0 ? ` · +${fmt(r.starshardsGained!)} ✦` : "";
    return {
      kind: "expedition" as const,
      id: r.id,
      at: r.at,
      title: "Expedition returned",
      body: `${r.summary} @ ${fmtCoords(r.targetCoords)}${cargo}${shards}`,
      unread: false,
    };
  });
}

function eventItems(log: EventLogEntry[] | undefined): InboxItem[] {
  return (log ?? []).map((entry) => ({
    kind: entry.kind,
    id: entry.id,
    at: entry.createdAt,
    title: entry.title,
    body: entry.body,
    unread: entry.readAt == null,
    href: entry.href,
  }));
}

/** Merge combat / spy / expedition reports with the player event log, newest first. */
export function collectInbox(view: PlayerView): InboxItem[] {
  const items: InboxItem[] = [
    ...combatItems(view.reports ?? [], view.player.id),
    ...spyItems(view.spyReports ?? []),
    ...expeditionItems(view.expeditionReports ?? []),
    ...eventItems(view.player.eventLog),
  ];
  items.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return items;
}

function filterButton(id: InboxFilter, label: string, active: InboxFilter): string {
  const pressed = id === active;
  return `<button type="button" class="ghost inbox-filter${pressed ? " active" : ""}" data-inbox-filter="${id}" data-testid="inbox-filter-${id}" aria-pressed="${pressed ? "true" : "false"}">${label}</button>`;
}

export function messagesPageHtml(
  view: PlayerView,
  opts?: { busy?: boolean; filter?: InboxFilter },
): string {
  const filter = opts?.filter ?? currentInboxFilter();
  const busy = Boolean(opts?.busy);
  const items = collectInbox(view);
  const visible =
    filter === "all" ? items : items.filter((item) => inboxBucket(item.kind) === filter);
  const combatCount = items.filter((item) => inboxBucket(item.kind) === "combat").length;
  const alertCount = items.filter((item) => inboxBucket(item.kind) === "alerts").length;
  const unread = items.filter((item) => item.unread).length;
  const emptyAll = items.length === 0;
  const emptyFilter = !emptyAll && visible.length === 0;

  const list = emptyAll
    ? `<p class="hint" data-testid="messages-empty">No mail yet. Combat reports and empire alerts appear here.</p>`
    : emptyFilter
      ? `<p class="hint" data-testid="messages-empty">Nothing in this filter.</p>`
      : `<ul class="reports messages-inbox" data-testid="messages-inbox">
        ${visible
          .map((item) => {
            const href = safeHref(item.href);
            const title = href
              ? `<a class="message-title" href="${escapeAttr(href)}">${escapeHtml(item.title)}</a>`
              : `<strong class="message-title">${escapeHtml(item.title)}</strong>`;
            const readBtn = item.unread
              ? `<button type="button" class="ghost message-read" data-event-read="${escapeAttr(item.id)}" data-testid="mark-read-${escapeAttr(item.id)}" ${busy ? "disabled" : ""}>Mark read</button>`
              : "";
            const report =
              item.kind === "combat"
                ? (view.reports ?? []).find((r) => r.id === item.id)
                : undefined;
            const extras = report ? combatBattleExtrasHtml(report) : "";
            return `<li class="message-row${item.unread ? " message-unread" : ""}" id="msg-${escapeAttr(item.kind)}-${escapeAttr(item.id)}" data-testid="message-${escapeAttr(item.kind)}-${escapeAttr(item.id)}" data-kind="${escapeAttr(item.kind)}" data-bucket="${inboxBucket(item.kind)}"${item.unread ? ' data-unread="1"' : ""}>
              <div class="message-head">
                <span class="message-kind" data-testid="message-kind">${escapeHtml(kindLabel(item.kind))}</span>
                <time class="message-when meta" datetime="${escapeAttr(new Date(item.at).toISOString())}">${escapeHtml(fmtWhen(item.at))}</time>
              </div>
              ${title}
              <span class="meta message-body">${escapeHtml(item.body)}</span>
              ${extras}
              ${readBtn}
            </li>`;
          })
          .join("")}
      </ul>`;

  const markAll =
    unread > 0
      ? `<button type="button" class="ghost" data-event-read-all data-testid="mark-all-read" ${busy ? "disabled" : ""}>Mark all read</button>`
      : "";

  return `
    <section class="panel" data-testid="messages-panel" data-inbox-filter="${filter}">
      <h2>Messages</h2>
      <p class="hint" data-testid="messages-summary">All · Combat · Alerts — ${fmt(items.length)} item${items.length === 1 ? "" : "s"} (${fmt(combatCount)} combat · ${fmt(alertCount)} alerts${unread > 0 ? ` · ${fmt(unread)} unread` : ""}).</p>
      <div class="inbox-filters" role="tablist" aria-label="Message filters">
        ${filterButton("all", "All", filter)}
        ${filterButton("combat", "Combat", filter)}
        ${filterButton("alerts", "Alerts", filter)}
        ${markAll}
      </div>
      ${list}
    </section>`;
}
