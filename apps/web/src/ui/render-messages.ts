import {
  BUILDING_ORDER,
  BUILDINGS,
  DEFENSE_ORDER,
  DEFENSES,
  moonChanceLabel,
  RESEARCH,
  RESEARCH_ORDER,
  SHIP_ORDER,
  SHIPS,
  type CombatReport,
  type EspionageReport,
  type EventLogEntry,
  type PlayerView,
} from "@starhold/game";
import { fmt, fmtCompact, fmtCoords } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";
import { battleReplayRound, combatBattleExtrasHtml } from "./render-fleets-panels";

export type OpenReportState = {
  kind: "combat" | "spy" | "expedition";
  id: string;
} | null;

let openReport: OpenReportState = null;
let compareSpyId: string | null = null;

export function toggleCompareSpy(id: string): void {
  compareSpyId = compareSpyId === id ? null : id;
}

export function setCompareSpy(id: string | null): void {
  compareSpyId = id;
}

export function currentCompareSpy(): string | null {
  return compareSpyId;
}

export function openReportWindow(
  kind: "combat" | "spy" | "expedition",
  id: string,
): void {
  openReport = { kind, id };
}

export function closeReportWindow(): void {
  openReport = null;
}

export function currentOpenReport(): OpenReportState {
  return openReport;
}

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

export function categoryLabel(bucket: "combat" | "spy" | "alerts"): string {
  switch (bucket) {
    case "combat":
      return "Combat";
    case "spy":
      return "Spy";
    case "alerts":
      return "Alerts";
    default: {
      const _exhaustive: never = bucket;
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
  if (debris) bits.push(`Debris: ${debris} · ${moonChanceLabel(report.debrisCreated)}`);
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

function shipTotalsTable(
  side: "Attacker" | "Defender",
  before: CombatReport["attackerBefore"] | undefined,
  after: CombatReport["attackerAfter"] | undefined,
): string {
  const rows = SHIP_ORDER.filter((id) => (before?.[id] ?? 0) > 0)
    .map(
      (id) =>
        `<tr><th scope="row">${escapeHtml(SHIPS[id].name)}</th><td>${fmt(before?.[id] ?? 0)}</td><td>${fmt(after?.[id] ?? 0)}</td><td>${fmt(Math.max(0, (before?.[id] ?? 0) - (after?.[id] ?? 0)))}</td></tr>`,
    )
    .join("");
  return `<div class="battle-ship-totals" data-testid="battle-ship-totals-${side.toLowerCase()}"><h4>${side} ships</h4>${
    rows
      ? `<table class="report-composition-table"><thead><tr><th>Ship</th><th>Before</th><th>After</th><th>Lost</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="meta">None</p>`
  }</div>`;
}

function shipCount(ships: CombatReport["attackerBefore"] | undefined): number {
  let total = 0;
  for (const id of SHIP_ORDER) total += ships?.[id] ?? 0;
  return total;
}

function fullResourceLine(
  resources: { metal?: number; crystal?: number; deuterium?: number } | null | undefined,
): string {
  return `${fmt(resources?.metal ?? 0)} metal, ${fmt(resources?.crystal ?? 0)} crystal, ${fmt(resources?.deuterium ?? 0)} deuterium`;
}

function combatSideHtml(
  side: "Attacker" | "Defender",
  report: CombatReport,
  selfId: string,
  loss: ReturnType<typeof combatLossSummary>,
): string {
  const attacking = side === "Attacker";
  const before = attacking ? report.attackerBefore : report.defenderBefore;
  const after = attacking ? report.attackerAfter : report.defenderAfter;
  const shipsLost = attacking ? loss.attackerShipsLost : loss.defenderShipsLost;
  const pointsLost = attacking ? loss.attackerPointsLost : loss.defenderPointsLost;
  const playerId = attacking ? report.attackerPlayerId : report.defenderPlayerId;
  const you = playerId === selfId;
  return `<section class="combat-side" data-testid="combat-side-${side.toLowerCase()}"${you ? ' data-viewer="self"' : ""}><h4>${side}${you ? ' <span class="combat-you">You</span>' : ""}</h4><p class="meta">Ships before: ${fmt(shipCount(before))}</p><p class="meta">Survivors: ${fmt(shipCount(after))}</p><p class="meta">Total ships lost: ${fmt(shipsLost)}</p><p class="meta">Points lost: ${fmtCompact(pointsLost)}</p></section>`;
}

/** Losses, survivors, loot, and debris from the report's own counts. */
export function combatReadoutHtml(report: CombatReport, selfId: string): string {
  const loss = combatLossSummary(report);
  return `<div class="combat-side-compare" data-testid="combat-side-compare">${combatSideHtml("Attacker", report, selfId, loss)}${combatSideHtml("Defender", report, selfId, loss)}</div><div class="combat-spoils" data-testid="combat-spoils"><section class="combat-loot" data-testid="combat-loot"><h4>Loot</h4><p>${fullResourceLine(report.loot)}</p></section><section class="combat-debris" data-testid="combat-debris"><h4>Debris</h4><p>${fullResourceLine(report.debrisCreated)}</p><p class="meta" data-testid="combat-moon-chance">${escapeHtml(moonChanceLabel(report.debrisCreated))}</p></section></div>`;
}

export function combatLossSummary(report: CombatReport): {
  attackerShipsLost: number;
  defenderShipsLost: number;
  attackerPointsLost: number;
  defenderPointsLost: number;
} {
  let attackerShipsLost = 0;
  let attackerCost = 0;
  for (const id of SHIP_ORDER) {
    const lost = Math.max(0, (report.attackerBefore?.[id] ?? 0) - (report.attackerAfter?.[id] ?? 0));
    attackerShipsLost += lost;
    const shipCost = SHIPS[id].cost.metal + SHIPS[id].cost.crystal + SHIPS[id].cost.deuterium;
    attackerCost += lost * shipCost;
  }

  let defenderShipsLost = 0;
  let defenderCost = 0;
  for (const id of SHIP_ORDER) {
    const lost = Math.max(0, (report.defenderBefore?.[id] ?? 0) - (report.defenderAfter?.[id] ?? 0));
    defenderShipsLost += lost;
    const shipCost = SHIPS[id].cost.metal + SHIPS[id].cost.crystal + SHIPS[id].cost.deuterium;
    defenderCost += lost * shipCost;
  }

  for (const id of DEFENSE_ORDER) {
    const defLost = report.defensesPermanentlyLost?.[id] ?? Math.max(0, (report.defensesBefore?.[id] ?? 0) - (report.defensesAfter?.[id] ?? 0));
    const defCost = DEFENSES[id].cost.metal + DEFENSES[id].cost.crystal + DEFENSES[id].cost.deuterium;
    defenderCost += defLost * defCost;
  }

  return {
    attackerShipsLost,
    defenderShipsLost,
    attackerPointsLost: Math.floor(attackerCost / 1000),
    defenderPointsLost: Math.floor(defenderCost / 1000),
  };
}

export function viewerResult(
  report: CombatReport,
  selfId: string,
): "victory" | "defeat" | "draw" {
  if (report.outcome === "draw") return "draw";
  const won =
    (report.outcome === "attacker_win" && report.attackerPlayerId === selfId) ||
    (report.outcome === "defender_win" && report.defenderPlayerId === selfId);
  return won ? "victory" : "defeat";
}

function resultPresentation(
  res: "victory" | "defeat" | "draw",
): { label: "Win" | "Lose" | "Draw"; className: string; resultAttr: string } {
  if (res === "victory") {
    return { label: "Win", className: "combat-report-win", resultAttr: "win" };
  }
  if (res === "defeat") {
    return { label: "Lose", className: "combat-report-loss", resultAttr: "loss" };
  }
  return { label: "Draw", className: "combat-report-draw", resultAttr: "draw" };
}

function renderReportSubwindow(view: PlayerView): string {
  if (!openReport) return "";

  const { kind, id } = openReport;

  if (kind === "combat") {
    const report = (view.reports ?? []).find((r) => r.id === id);
    if (!report) return "";

    const res = viewerResult(report, view.player.id);
    const pres = resultPresentation(res);

    const atkCoords = report.originCoords
      ? `<a href="/galaxy?galaxy=${report.originCoords.galaxy}&amp;system=${report.originCoords.system}" class="coord-link" data-galaxy-coords="${fmtCoords(report.originCoords)}">${fmtCoords(report.originCoords)}</a>`
      : "";
    const defCoords = `<a href="/galaxy?galaxy=${report.targetCoords.galaxy}&amp;system=${report.targetCoords.system}" class="coord-link" data-galaxy-coords="${fmtCoords(report.targetCoords)}">${fmtCoords(report.targetCoords)}</a>`;

    let defenseSummaryHtml = "";
    if (report.defensesDestroyed) {
      const destroyed = namedCounts(DEFENSE_ORDER, DEFENSES, report.defensesDestroyed) || "None";
      const rebuilt = namedCounts(DEFENSE_ORDER, DEFENSES, report.defensesRebuilt) || "None";
      const lost = namedCounts(DEFENSE_ORDER, DEFENSES, report.defensesPermanentlyLost) || "None";
      defenseSummaryHtml = `<p class="meta">Defenses destroyed: ${destroyed}</p>
      <p class="meta">Defenses rebuilt: ${rebuilt}</p>
      <p class="meta">Defenses permanently lost: ${lost}</p>`;
    }

    return `
      <div class="report-subwindow-backdrop">
        <div class="report-subwindow ${pres.className}" data-combat-result="${pres.resultAttr}" data-testid="report-subwindow">
          <div class="report-subwindow-header">
            <h3 class="report-subwindow-title">Combat Report — ${escapeHtml(report.attackerName)} ${atkCoords ? `(${atkCoords})` : ""} vs ${escapeHtml(report.defenderName)} (${defCoords})</h3>
            <button type="button" class="report-subwindow-close ghost" data-close-report data-testid="close-report-window" aria-label="Close">✕</button>
          </div>
          <div class="report-section">
            <p class="meta"><strong>Result:</strong> ${pres.label} (${escapeHtml(report.outcome.replace("_", " "))})</p>
            ${combatReadoutHtml(report, view.player.id)}
          </div>
          <div class="report-section">
            <h4>Ships</h4>
            ${shipTotalsTable("Attacker", report.attackerBefore, report.attackerAfter)}
            ${shipTotalsTable("Defender", report.defenderBefore, report.defenderAfter)}
            ${defenseSummaryHtml}
            ${report.summary ? `<p class="meta"><strong>Summary:</strong> ${escapeHtml(report.summary)}</p>` : ""}
            ${combatBattleExtrasHtml(report)}
          </div>
        </div>
      </div>`;
  }

  if (kind === "spy") {
    const report = (view.spyReports ?? []).find((r) => r.id === id);
    if (!report) return "";

    const resources = resourceNames(report.resources) || "None detected";
    const ships = namedCounts(SHIP_ORDER, SHIPS, report.ships) || "None detected";
    const defenses = namedCounts(DEFENSE_ORDER, DEFENSES, report.defenses) || "None detected";
    const buildings = namedLevels(BUILDING_ORDER, BUILDINGS, report.buildings) || "None detected";
    const research = namedLevels(RESEARCH_ORDER, RESEARCH, report.research) || "None detected";

    return `
      <div class="report-subwindow-backdrop">
        <div class="report-subwindow" data-testid="report-subwindow">
          <div class="report-subwindow-header">
            <h3 class="report-subwindow-title">Espionage Report — ${escapeHtml(report.targetName)} (${fmtCoords(report.targetCoords)})</h3>
            <button type="button" class="report-subwindow-close ghost" data-close-report data-testid="close-report-window" aria-label="Close">✕</button>
          </div>
          <div class="report-section">
            <p class="meta"><strong>Target:</strong> ${escapeHtml(report.targetName)} (${fmtCoords(report.targetCoords)})</p>
            <p class="meta"><strong>Detail Level:</strong> Spy L${fmt(report.detail)}</p>
            <p class="meta"><strong>Summary:</strong> ${escapeHtml(report.summary)}</p>
          </div>
          <div class="report-section">
            <h4>Scanned Details</h4>
            <p class="meta"><strong>Resources:</strong> ${resources}</p>
            <p class="meta"><strong>Ships:</strong> ${ships}</p>
            <p class="meta"><strong>Defenses:</strong> ${defenses}</p>
            <p class="meta"><strong>Buildings:</strong> ${buildings}</p>
            <p class="meta"><strong>Research:</strong> ${research}</p>
            ${
              previousSpyReport(view.spyReports ?? [], report.id)
                ? spyCompareButton(report.id, "window")
                : ""
            }
            ${spyComparePanel(view.spyReports ?? [], report.id, "window")}
          </div>
        </div>
      </div>`;
  }

  if (kind === "expedition") {
    const report = (view.expeditionReports ?? []).find((r) => r.id === id);
    if (!report) return "";

    const cargo = resourceNames(report.cargoGained) || "None";
    const ships = namedCounts(SHIP_ORDER, SHIPS, report.shipsDelta) || "None";
    const starshards = (report.starshardsGained ?? 0) > 0 ? `+${fmt(report.starshardsGained!)} ✦` : "None";
    const debris = resourceNames(report.debrisCreated) || "None";

    return `
      <div class="report-subwindow-backdrop">
        <div class="report-subwindow" data-testid="report-subwindow">
          <div class="report-subwindow-header">
            <h3 class="report-subwindow-title">Expedition Report — ${fmtCoords(report.targetCoords)}</h3>
            <button type="button" class="report-subwindow-close ghost" data-close-report data-testid="close-report-window" aria-label="Close">✕</button>
          </div>
          <div class="report-section">
            <p class="meta"><strong>Coordinates:</strong> ${fmtCoords(report.targetCoords)}</p>
            <p class="meta"><strong>Outcome Kind:</strong> ${escapeHtml(report.kind)}</p>
            <p class="meta"><strong>Summary:</strong> ${escapeHtml(report.summary)}</p>
          </div>
          <div class="report-section">
            <h4>Findings</h4>
            <p class="meta"><strong>Cargo Gained:</strong> ${cargo}</p>
            <p class="meta"><strong>Ships Gained/Lost:</strong> ${ships}</p>
            <p class="meta"><strong>Starshards Gained:</strong> ${starshards}</p>
            <p class="meta"><strong>Ambush Debris Created:</strong> ${debris}</p>
          </div>
        </div>
      </div>`;
  }

  return "";
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

export type SpyCompareSectionId =
  | "resources"
  | "fleet"
  | "defense"
  | "buildings"
  | "research";

export type SpyCompareTone = "up" | "down" | "same" | "unknown";

export interface SpyCompareRow {
  key: string;
  label: string;
  previous: string;
  current: string;
  change: string;
  tone: SpyCompareTone;
  /** Current minus previous when both scans include the row. */
  delta: number | null;
}

export interface SpyCompareSection {
  id: SpyCompareSectionId;
  title: string;
  rows: SpyCompareRow[];
}

function sameTargetCoords(
  a: EspionageReport["targetCoords"],
  b: EspionageReport["targetCoords"],
): boolean {
  return a.galaxy === b.galaxy && a.system === b.system && a.slot === b.slot;
}

/** Newest first, then id, matching the inbox order. */
function newestSpyFirst(a: EspionageReport, b: EspionageReport): number {
  return b.at - a.at || a.id.localeCompare(b.id);
}

/**
 * The scan immediately before `currentId` on the same coordinates.
 * Reports on any other target are ignored.
 */
export function previousSpyReport(
  reports: readonly EspionageReport[] | null | undefined,
  currentId: string,
): EspionageReport | null {
  const list = reports ?? [];
  const current = list.find((report) => report.id === currentId);
  if (!current) return null;
  const same = list
    .filter((report) => sameTargetCoords(report.targetCoords, current.targetCoords))
    .sort(newestSpyFirst);
  const index = same.findIndex((report) => report.id === current.id);
  if (index < 0 || index + 1 >= same.length) return null;
  return same[index + 1] ?? null;
}

function toneForDelta(delta: number): SpyCompareTone {
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "same";
}

function changeText(delta: number): string {
  if (delta > 0) return `+${fmt(delta)}`;
  return fmt(delta);
}

function compareRows(
  order: readonly { key: string; label: string }[],
  previous: object | null,
  current: object | null,
  includeZeros: boolean,
): SpyCompareRow[] | null {
  if (previous == null && current == null) return null;
  const prevBag = previous as Record<string, number | undefined> | null;
  const curBag = current as Record<string, number | undefined> | null;
  const keys = includeZeros
    ? order
    : order.filter(
        (row) => (prevBag?.[row.key] ?? 0) > 0 || (curBag?.[row.key] ?? 0) > 0,
      );
  if (keys.length === 0) {
    const both = prevBag != null && curBag != null;
    return [
      {
        key: "none",
        label: "None",
        previous: prevBag == null ? "—" : "0",
        current: curBag == null ? "—" : "0",
        change: both ? "0" : "not scanned",
        tone: both ? "same" : "unknown",
        delta: both ? 0 : null,
      },
    ];
  }
  return keys.map((row) => {
    const prevN = prevBag == null ? null : Math.floor(prevBag[row.key] ?? 0);
    const curN = curBag == null ? null : Math.floor(curBag[row.key] ?? 0);
    if (prevN != null && curN != null) {
      const delta = curN - prevN;
      return {
        key: row.key,
        label: row.label,
        previous: fmt(prevN),
        current: fmt(curN),
        change: changeText(delta),
        tone: toneForDelta(delta),
        delta,
      };
    }
    return {
      key: row.key,
      label: row.label,
      previous: prevN == null ? "—" : fmt(prevN),
      current: curN == null ? "—" : fmt(curN),
      change: "not scanned",
      tone: "unknown" as const,
      delta: null,
    };
  });
}

function namedOrder(
  order: readonly string[],
  names: { [id: string]: { name: string } | undefined },
): { key: string; label: string }[] {
  return order
    .filter((id) => names[id])
    .map((id) => ({ key: id, label: names[id]!.name }));
}

/** Side-by-side layers for the current scan and the previous scan of that target. */
export function spyCompareSections(
  previous: EspionageReport,
  current: EspionageReport,
): SpyCompareSection[] {
  const specs: Array<{
    id: SpyCompareSectionId;
    title: string;
    order: readonly { key: string; label: string }[];
    previous: object | null;
    current: object | null;
    includeZeros: boolean;
  }> = [
    {
      id: "resources",
      title: "Resources",
      order: [
        { key: "metal", label: "Metal" },
        { key: "crystal", label: "Crystal" },
        { key: "deuterium", label: "Deuterium" },
      ],
      previous: previous.resources,
      current: current.resources,
      includeZeros: true,
    },
    {
      id: "fleet",
      title: "Fleet",
      order: namedOrder(SHIP_ORDER, SHIPS),
      previous: previous.ships,
      current: current.ships,
      includeZeros: false,
    },
    {
      id: "defense",
      title: "Defense",
      order: namedOrder(DEFENSE_ORDER, DEFENSES),
      previous: previous.defenses,
      current: current.defenses,
      includeZeros: false,
    },
    {
      id: "buildings",
      title: "Buildings",
      order: namedOrder(BUILDING_ORDER, BUILDINGS),
      previous: previous.buildings,
      current: current.buildings,
      includeZeros: false,
    },
    {
      id: "research",
      title: "Research",
      order: namedOrder(RESEARCH_ORDER, RESEARCH),
      previous: previous.research,
      current: current.research,
      includeZeros: false,
    },
  ];
  const sections: SpyCompareSection[] = [];
  for (const spec of specs) {
    const rows = compareRows(spec.order, spec.previous, spec.current, spec.includeZeros);
    if (!rows) continue;
    sections.push({ id: spec.id, title: spec.title, rows });
  }
  return sections;
}

function spyCompareButton(reportId: string, place: "inbox" | "window"): string {
  const open = compareSpyId === reportId;
  const testId =
    place === "inbox" ? `compare-spy-${reportId}` : `compare-spy-window-${reportId}`;
  return `<button type="button" class="ghost" data-compare-spy="${escapeAttr(reportId)}" data-testid="${escapeAttr(testId)}" aria-expanded="${open ? "true" : "false"}">Compare with previous</button>`;
}

function spyCompareColumn(
  side: "previous" | "current",
  report: EspionageReport,
  sections: SpyCompareSection[],
  place: "inbox" | "window",
): string {
  const heading = side === "previous" ? "Previous" : "This scan";
  const body =
    sections.length === 0
      ? `<p>No scanned layers to compare.</p>`
      : sections
          .map((section) => {
            const items = section.rows
              .map((row) => {
                const value = side === "previous" ? row.previous : row.current;
                const delta =
                  side === "current"
                    ? `<span class="spy-delta spy-delta-${row.tone}" data-testid="${escapeAttr(`spy-delta-${place}-${report.id}-${section.id}-${row.key}`)}"${row.delta == null ? "" : ` data-delta="${row.delta}"`}>${escapeHtml(row.change)}</span>`
                    : "";
                const tone = side === "current" ? ` class="spy-line-${row.tone}"` : "";
                return `<li${tone}>${escapeHtml(row.label)} ${escapeHtml(value)} ${delta}</li>`;
              })
              .join("");
            return `<h5>${escapeHtml(section.title)}</h5><ul data-testid="${escapeAttr(`spy-compare-${place}-${side}-${section.id}`)}">${items}</ul>`;
          })
          .join("");
  return `<article class="spy-compare-col" data-testid="${escapeAttr(`spy-compare-${place}-${side}`)}"><h4>${heading}</h4><p class="meta">${escapeHtml(report.targetName)} · ${escapeHtml(fmtWhen(report.at))}</p>${body}</article>`;
}

function spyComparePanel(
  reports: readonly EspionageReport[] | null | undefined,
  reportId: string,
  place: "inbox" | "window",
): string {
  if (compareSpyId !== reportId) return "";
  const list = reports ?? [];
  const current = list.find((report) => report.id === reportId);
  const previous = previousSpyReport(list, reportId);
  if (!current || !previous) return "";
  const sections = spyCompareSections(previous, current);
  const testId = place === "inbox" ? `spy-compare-${reportId}` : `spy-compare-window-${reportId}`;
  return `<div class="spy-compare" data-testid="${escapeAttr(testId)}"><p class="meta">Same target ${escapeHtml(fmtCoords(current.targetCoords))}</p><div class="spy-compare-columns">${spyCompareColumn("previous", previous, sections, place)}${spyCompareColumn("current", current, sections, place)}</div></div>`;
}

function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  if (href.startsWith("#") || href.startsWith("/")) return href;
  return null;
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

function eventItems(
  log: EventLogEntry[] | undefined,
  reports: PlayerView["reports"],
  playerId: string,
): InboxItem[] {
  return (log ?? [])
    .filter((entry) => {
      if (entry.kind !== "raidAlert") return true;
      const reportId = entry.meta?.reportId;
      if (typeof reportId === "string") {
        return !reports.some((report) => report.id === reportId);
      }
      const pirateBaseId = entry.meta?.pirateBaseId;
      return !(
        typeof pirateBaseId === "string" &&
        reports.some(
          (report) =>
            report.defenderPlayerId === playerId &&
            report.missionId === pirateBaseId &&
            report.at === entry.createdAt,
        )
      );
    })
    .map((entry) => ({
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
  const reports = view.reports ?? [];
  const items: InboxItem[] = [
    ...combatItems(reports, view.player.id),
    ...spyItems(view.spyReports ?? []),
    ...expeditionItems(view.expeditionReports ?? []),
    ...eventItems(view.player.eventLog, reports, view.player.id),
  ];
  items.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return items;
}

/** Unread rows the inbox actually shows, after duplicate combat alerts are hidden. */
export function inboxUnreadCount(view: PlayerView): number {
  let unread = 0;
  for (const item of collectInbox(view)) {
    if (item.unread) unread += 1;
  }
  return unread;
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
            let combatClasses = "";
            let combatAttr = "";
            let shareBtn = "";
            let combatDetails = "";
            if (report) {
              const res = viewerResult(report, view.player.id);
              const pres = resultPresentation(res);
              combatClasses = ` ${pres.className}`;
              combatAttr = ` data-combat-result="${pres.resultAttr}"`;
              shareBtn = combatBattleExtrasHtml(report);
              combatDetails = `<details class="inbox-combat-details" data-testid="inbox-combat-details-${escapeAttr(report.id)}"><summary>Battle details</summary>${combatReadoutHtml(report, view.player.id)}${shipTotalsTable("Attacker", report.attackerBefore, report.attackerAfter)}${shipTotalsTable("Defender", report.defenderBefore, report.defenderAfter)}</details>`;
            }
            const spy =
              item.kind === "spy"
                ? (view.spyReports ?? []).find((r) => r.id === item.id)
                : undefined;
            const spyDetail = spy ? spyReportDetailsHtml(spy) : "";
            const previousSpy = spy
              ? previousSpyReport(view.spyReports ?? [], spy.id)
              : null;
            const compareBtn = spy && previousSpy ? spyCompareButton(spy.id, "inbox") : "";
            const comparePanel = spy
              ? spyComparePanel(view.spyReports ?? [], spy.id, "inbox")
              : "";
            const spyShareBtn =
              spy && view.alliance
                ? `<span class="spy-share">&nbsp;<button type="button" data-share-intel="${escapeAttr(spy.id)}" data-testid="share-intel-${escapeAttr(spy.id)}">Share with alliance</button></span>`
                : "";
            const openReportBtn =
              item.kind === "combat" || item.kind === "spy" || item.kind === "expedition"
                ? `<button type="button" class="ghost open-report-btn" data-open-report="${escapeAttr(item.kind)}:${escapeAttr(item.id)}" data-testid="open-report-${escapeAttr(item.kind)}-${escapeAttr(item.id)}">Open report</button>`
                : "";
            const bucket = inboxBucket(item.kind);
            return `<li class="message-row${item.unread ? " message-unread" : ""}${combatClasses}" id="msg-${escapeAttr(item.kind)}-${escapeAttr(item.id)}" data-testid="message-${escapeAttr(item.kind)}-${escapeAttr(item.id)}" data-kind="${escapeAttr(item.kind)}" data-bucket="${bucket}"${combatAttr}${item.unread ? ' data-unread="1"' : ""}>
              <div class="message-head">
                <span class="message-badges">
                  <span class="message-category message-category-${escapeAttr(bucket)}" data-testid="message-category">${escapeHtml(categoryLabel(bucket))}</span>
                  <span class="message-kind" data-testid="message-kind">${escapeHtml(kindLabel(item.kind))}</span>
                </span>
                <time class="message-when meta" datetime="${escapeAttr(new Date(item.at).toISOString())}">${escapeHtml(fmtWhen(item.at))}</time>
              </div>
              ${title}
              <span class="meta message-body">${escapeHtml(item.body)}</span>
              ${openReportBtn}
              ${shareBtn}
              ${spyShareBtn}
              ${compareBtn}
              ${combatDetails}
              ${spyDetail}
              ${comparePanel}
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
      ${renderReportSubwindow(view)}
    </section>`;
}
