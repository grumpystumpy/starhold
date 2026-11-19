import {
  DEFENSE_ORDER,
  DEFENSES,
  formatCombatShareCard,
  moonChanceLabel,
  SHIP_ORDER,
  SHIPS,
  type CombatReport,
  type PublicCombatReport,
} from "@starhold/game";
import { fmt, fmtCoords } from "./format";
import { escapeHtml } from "./render-escape";
import { battleReplayHtml } from "./render-fleets-panels";

export function sharedReportCodeFromSearch(search: string): string | null {
  return new URLSearchParams(search).get("report")?.trim() || null;
}

export function battleShareUrl(shareCode: string, origin: string): string {
  const url = new URL("/", origin);
  url.searchParams.set("report", shareCode);
  return url.toString();
}

/** Plaintext card plus the public report link. Copy share writes this. */
export function battleShareClipboard(
  report: CombatReport,
  origin: string,
  viewerPlayerId?: string,
): string {
  const card = formatCombatShareCard(report, viewerPlayerId);
  if (!report.shareCode) return card;
  return `${card}\n${battleShareUrl(report.shareCode, origin)}`;
}

function shipTable(
  side: "Attacker" | "Defender",
  before: PublicCombatReport["attackerBefore"],
  after: PublicCombatReport["attackerAfter"],
): string {
  const rows = SHIP_ORDER.filter((id) => (before[id] ?? 0) > 0)
    .map(
      (id) =>
        `<tr><th scope="row">${escapeHtml(SHIPS[id].name)}</th><td>${fmt(before[id] ?? 0)}</td><td>${fmt(after[id] ?? 0)}</td><td>${fmt(Math.max(0, (before[id] ?? 0) - (after[id] ?? 0)))}</td></tr>`,
    )
    .join("");
  return `<section><h3>${side} ships</h3>${rows ? `<table><thead><tr><th>Ship</th><th>Before</th><th>After</th><th>Lost</th></tr></thead><tbody>${rows}</tbody></table>` : `<p>None</p>`}</section>`;
}

function defenseTable(report: PublicCombatReport): string {
  const rows = DEFENSE_ORDER.filter(
    (id) => (report.defensesBefore[id] ?? 0) > 0,
  )
    .map((id) => {
      const destroyed =
        report.defensesDestroyed?.[id] ??
        Math.max(
          0,
          (report.defensesBefore[id] ?? 0) - (report.defensesAfter[id] ?? 0),
        );
      return `<tr><th scope="row">${escapeHtml(DEFENSES[id].name)}</th><td>${fmt(report.defensesBefore[id] ?? 0)}</td><td>${fmt(destroyed)}</td></tr>`;
    })
    .join("");
  return `<section><h3>Defender defenses</h3>${rows ? `<table><thead><tr><th>Defense</th><th>Total (before)</th><th>Lost</th></tr></thead><tbody>${rows}</tbody></table>` : `<p>None</p>`}</section>`;
}

export function sharedCombatReportPage(report: PublicCombatReport): string {
  const coordinates = report.originCoords
    ? `${fmtCoords(report.originCoords)} → ${fmtCoords(report.targetCoords)}`
    : fmtCoords(report.targetCoords);
  return `
    <main class="panel shared-combat-report" data-testid="shared-combat-report">
      <h1>Battle report</h1>
      <p>${escapeHtml(report.attackerName)} vs ${escapeHtml(report.defenderName)} · ${coordinates}</p>
      <p><strong>Result:</strong> ${escapeHtml(report.outcome.replaceAll("_", " "))} · ${fmt(report.rounds)} round${report.rounds === 1 ? "" : "s"}</p>
      <p><strong>Date:</strong> ${escapeHtml(new Date(report.at).toLocaleString())}</p>
      <p><strong>Loot:</strong> ${fmt(report.loot.metal)} metal, ${fmt(report.loot.crystal)} crystal, ${fmt(report.loot.deuterium)} deuterium</p>
      <p><strong>Debris:</strong> ${fmt(report.debrisCreated.metal)} metal, ${fmt(report.debrisCreated.crystal)} crystal · ${escapeHtml(moonChanceLabel(report.debrisCreated))}</p>
      ${battleReplayHtml({ id: report.shareCode, roundLog: report.roundLog })}
      ${shipTable("Attacker", report.attackerBefore, report.attackerAfter)}
      ${shipTable("Defender", report.defenderBefore, report.defenderAfter)}
      ${defenseTable(report)}
    </main>`;
}

export function sharedCombatReportError(message: string): string {
  return `<main class="panel" data-testid="shared-combat-report-error"><h1>Battle report unavailable</h1><p>${escapeHtml(message)}</p></main>`;
}
