import {
  BUILDING_ORDER,
  BUILDINGS,
  DEFENSE_ORDER,
  DEFENSES,
  RESEARCH,
  RESEARCH_ORDER,
  SHIP_ORDER,
  SHIPS,
  type CombatReport,
  type EspionageReport,
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

export type InboxFilter = "all" | "combat" | "spy" | "alerts";

const INBOX_FILTERS: readonly InboxFilter[] = [
  "all",
  "combat",
  "spy",
  "alerts",
];

export function isInboxFilter(value: string | null): value is InboxFilter {
  return value != null && (INBOX_FILTERS as readonly string[]).includes(value);
}

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
let confirmDelete: InboxFilter | null = null;

export function setInboxFilter(next: InboxFilter): void {
  inboxFilter = next;
}

export function currentInboxFilter(): InboxFilter {
  return inboxFilter;
}

export function setConfirmDelete(next: InboxFilter | null): void {
  confirmDelete = next;
}

export function currentConfirmDelete(): InboxFilter | null {
  return confirmDelete;
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

export function inboxBucket(kind: InboxKind): "combat" | "spy" | "alerts" {
  switch (kind) {
    case "combat":
    case "expedition":
      return "combat";
    case "spy":
      return "spy";
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

function namedLevels(
  order: readonly string[],
  names: { [id: string]: { name: string } | undefined },
  levels: object | null | undefined,
): string {
  if (!levels) return "";
  const bag = levels as Record<string, number | undefined>;
  const parts = order
    .filter((id) => (bag[id] ?? 0) > 0 && names[id])
    .map((id) => `${names[id]!.name} L${fmt(bag[id] ?? 0)}`);
  return parts.join(", ");
}

function resourceNames(
  resources: { metal?: number; crystal?: number; deuterium?: number } | null | undefined,
): string {
  if (!resources) return "";
  const parts: string[] = [];
  if ((resources.metal ?? 0) > 0) parts.push(`${fmt(resources.metal ?? 0)} metal`);
  if ((resources.crystal ?? 0) > 0) parts.push(`${fmt(resources.crystal ?? 0)} crystal`);
  if ((resources.deuterium ?? 0) > 0) parts.push(`${fmt(resources.deuterium ?? 0)} deuterium`);
  return parts.join(", ");
}

function combatMailBody(report: CombatReport): string {
  const bits = [report.summary];
  const debris = resourceNames(report.debrisCreated);
  if (debris) bits.push(`Debris: ${debris}`);
  const destroyed = namedCounts(DEFENSE_ORDER, DEFENSES, report.defensesDestroyed);
  if (destroyed) {
    const rebuilt = namedCounts(DEFENSE_ORDER, DEFENSES, report.defensesRebuilt) || "none";
    const lost =
      namedCounts(DEFENSE_ORDER, DEFENSES, report.defensesPermanentlyLost) || "none";
    bits.push(
      `Defenses destroyed: ${destroyed}. Rebuilt: ${rebuilt}. Permanently lost: ${lost}.`,
    );
  }
  return bits.join(" ");
}

function namedCounts(
  order: readonly string[],
  names: { [id: string]: { name: string } | undefined },
  counts: object | null | undefined,
): string {
  if (!counts) return "";
  const bag = counts as Record<string, number | undefined>;
  const parts = order
    .filter((id) => (bag[id] ?? 0) > 0 && names[id])
    .map((id) => `${fmt(bag[id] ?? 0)}× ${names[id]!.name}`);
  return parts.join(", ");
}

/** Full espionage layers, using display names. Closed until the player opens it. */
export function spyReportDetailsHtml(report: EspionageReport): string {
  const lines: string[] = [];
  if (report.resources) {
    lines.push(
      `Metal ${fmt(report.resources.metal)} · Crystal ${fmt(report.resources.crystal)} · Deut ${fmt(report.resources.deuterium)}`,
    );
  }
  const ships = namedCounts(SHIP_ORDER, SHIPS, report.ships);
  if (ships) lines.push(`Ships: ${ships}`);
  const defenses = namedCounts(DEFENSE_ORDER, DEFENSES, report.defenses);
  if (defenses) lines.push(`Defenses: ${defenses}`);
  const buildings = namedLevels(BUILDING_ORDER, BUILDINGS, report.buildings);
  if (buildings) lines.push(`Buildings: ${buildings}`);
  const research = namedLevels(RESEARCH_ORDER, RESEARCH, report.research);
  if (research) lines.push(`Research: ${research}`);
  const body =
    lines.length > 0
      ? lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")
      : `<p>No further detail in this scan.</p>`;
  return `<details class="message-detail" data-testid="spy-detail-${escapeAttr(report.id)}"><summary>Full report</summary>${body}</details>`;
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
    body: combatMailBody(r),
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
    const debris = resourceNames(r.debrisCreated);
    const debrisAt = debris
      ? ` Debris: ${debris} at ${fmtCoords({
          galaxy: r.targetCoords.galaxy,
          system: r.targetCoords.system,
          slot: 16,
        })}`
      : "";
    return {
      kind: "expedition" as const,
      id: r.id,
      at: r.at,
      title: "Expedition returned",
      body: `${r.summary} @ ${fmtCoords(r.targetCoords)}${cargo}${shards}${debrisAt}`,
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

function deleteControl(
  id: InboxFilter,
  count: number,
  busy: boolean,
): string {
  if (confirmDelete === id) {
    const noun =
      id === "all"
        ? "every message"
        : id === "combat"
          ? "every combat message"
          : id === "spy"
            ? "every spy message"
            : "every alert";
    return `<span class="inbox-delete-confirm" data-testid="delete-confirm-${id}">Delete ${noun}? <button type="button" data-delete-messages-confirm="${id}" data-testid="delete-all-${id}-confirm" ${busy ? "disabled" : ""}>Confirm</button> <button type="button" class="ghost" data-delete-messages-cancel data-testid="delete-all-cancel" ${busy ? "disabled" : ""}>Cancel</button></span>`;
  }
  const disabled = busy || count < 1;
  return `<button type="button" class="ghost" data-delete-messages="${id}" data-testid="delete-all-${id}" ${disabled ? "disabled" : ""}>Delete all</button>`;
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
  const spyCount = items.filter((item) => inboxBucket(item.kind) === "spy").length;
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
            const spy =
              item.kind === "spy"
                ? (view.spyReports ?? []).find((r) => r.id === item.id)
                : undefined;
            const spyDetail = spy ? spyReportDetailsHtml(spy) : "";
            return `<li class="message-row${item.unread ? " message-unread" : ""}" id="msg-${escapeAttr(item.kind)}-${escapeAttr(item.id)}" data-testid="message-${escapeAttr(item.kind)}-${escapeAttr(item.id)}" data-kind="${escapeAttr(item.kind)}" data-bucket="${inboxBucket(item.kind)}"${item.unread ? ' data-unread="1"' : ""}>
              <div class="message-head">
                <span class="message-kind" data-testid="message-kind">${escapeHtml(kindLabel(item.kind))}</span>
                <time class="message-when meta" datetime="${escapeAttr(new Date(item.at).toISOString())}">${escapeHtml(fmtWhen(item.at))}</time>
              </div>
              ${title}
              <span class="meta message-body">${escapeHtml(item.body)}</span>
              ${extras}
              ${spyDetail}
              ${readBtn}
            </li>`;
          })
          .join("")}
      </ul>`;

  const markAll =
    unread > 0
      ? `<button type="button" class="ghost" data-event-read-all data-testid="mark-all-read" ${busy ? "disabled" : ""}>Mark all read</button>`
      : "";
  const deleteCount =
    filter === "all"
      ? items.length
      : filter === "combat"
        ? combatCount
        : filter === "spy"
          ? spyCount
          : alertCount;

  return `
    <section class="panel" data-testid="messages-panel" data-inbox-filter="${filter}">
      <h2>Messages</h2>
      <p class="hint" data-testid="messages-summary">All · Combat · Spy · Alerts — ${fmt(items.length)} item${items.length === 1 ? "" : "s"} (${fmt(combatCount)} combat · ${fmt(spyCount)} spy · ${fmt(alertCount)} alerts${unread > 0 ? ` · ${fmt(unread)} unread` : ""}).</p>
      <div class="inbox-filters" role="tablist" aria-label="Message filters">
        ${filterButton("all", "All", filter)}
        ${filterButton("combat", "Combat", filter)}
        ${filterButton("spy", "Spy", filter)}
        ${filterButton("alerts", "Alerts", filter)}
        ${markAll}
      </div>
      <div class="inbox-filters" aria-label="Delete messages">
        ${deleteControl(filter, deleteCount, busy)}
      </div>
      ${list}
    </section>`;
}
