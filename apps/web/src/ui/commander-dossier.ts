import type { HallOfFameEntry, HighscoreEntry, PlayerView } from "@starhold/game";
import { fmt, fmtCompact, fmtCoordsLink } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";

/**
 * Public card for one commander. Hall of Fame rows have names only, so a
 * fight is included only when this highscore row is the sole board entry
 * with that name. A shared name cannot be matched to a player id.
 */
export function publicFightsForCommander(
  row: HighscoreEntry,
  rows: readonly HighscoreEntry[],
  hall: readonly HallOfFameEntry[] | undefined,
): HallOfFameEntry[] {
  let sameName = 0;
  for (const other of rows) {
    if (other.name === row.name) sameName += 1;
  }
  if (sameName !== 1) return [];
  return (hall ?? []).filter(
    (fight) =>
      fight.attackerName === row.name || fight.defenderName === row.name,
  );
}

/** One highscore row owns this name. Used when a galaxy body has no player id. */
export function uniqueCommanderId(
  rows: readonly HighscoreEntry[] | undefined,
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  let found: string | null = null;
  for (const row of rows ?? []) {
    if (row.name !== name) continue;
    if (found) return null;
    found = row.playerId;
  }
  return found;
}

export function commanderNameButton(
  playerId: string,
  name: string,
  testId: string,
): string {
  return `<button type="button" class="commander-name" data-open-commander="${escapeAttr(playerId)}" data-testid="${escapeAttr(testId)}" aria-label="Commander dossier for ${escapeAttr(name)}">${escapeHtml(name)}</button>`;
}

let openPlayerId: string | null = null;

export function openCommanderDossier(playerId: string): void {
  const id = playerId.trim();
  if (!id) return;
  openPlayerId = id;
}

export function closeCommanderDossier(): void {
  openPlayerId = null;
}

export function commanderDossierOpenId(): string | null {
  return openPlayerId;
}

function fightSide(fight: HallOfFameEntry, name: string): string {
  const attack = fight.attackerName === name;
  const defense = fight.defenderName === name;
  if (attack && defense) return "Both sides";
  return attack ? "Attack" : "Defense";
}

function dossierShell(title: string, body: string): string {
  return `<div class="report-subwindow-backdrop" data-testid="commander-dossier" data-commander-dossier-backdrop>
    <section class="report-subwindow commander-dossier" role="dialog" aria-modal="true" aria-labelledby="commander-dossier-title" data-testid="commander-dossier-card">
      <div class="report-subwindow-header">
        <h3 class="report-subwindow-title" id="commander-dossier-title">${title}</h3>
        <button type="button" class="report-subwindow-close ghost" data-close-commander-dossier data-testid="commander-dossier-close" aria-label="Close">✕</button>
      </div>
      ${body}
    </section>
  </div>`;
}

/** Empty when no dossier is open. Uses only the highscore row and hallOfFame. */
export function commanderDossierHtml(
  view: PlayerView,
  playerId: string | null,
): string {
  if (!playerId) return "";
  const rows = view.highscores ?? [];
  const row = rows.find((entry) => entry.playerId === playerId);
  if (!row) {
    return dossierShell(
      "Commander",
      `<p data-testid="commander-dossier-missing">This commander is not on the public board.</p>`,
    );
  }
  const you = view.player?.id === row.playerId ? " (you)" : "";
  const alliance = row.allianceTag
    ? `[${escapeHtml(row.allianceTag)}]`
    : "None";
  const fights = publicFightsForCommander(row, rows, view.hallOfFame);
  const sharedName =
    rows.filter((entry) => entry.name === row.name).length !== 1;
  const fightHtml = sharedName
    ? `<p data-testid="commander-dossier-fights-hidden">Another commander uses this name, so Hall of Fame fights stay hidden.</p>`
    : fights.length
      ? `<ol class="commander-dossier-fights" data-testid="commander-dossier-fights">${fights
          .map((fight, index) => {
            const share = fight.shareCode
              ? ` · <a href="/?report=${escapeAttr(encodeURIComponent(fight.shareCode))}" data-testid="commander-dossier-share-${index + 1}">Battle report</a>`
              : "";
            return `<li data-testid="commander-dossier-fight-${index + 1}"><span>${escapeHtml(fightSide(fight, row.name))} · ${escapeHtml(fight.attackerName)} vs ${escapeHtml(fight.defenderName)} · ${escapeHtml(fight.outcome.replaceAll("_", " "))}</span><span>${fmtCompact(fight.destroyedValue)} value · ${escapeHtml(new Date(fight.at).toLocaleDateString())} · ${fmtCoordsLink(fight.targetCoords)}${share}</span></li>`;
          })
          .join("")}</ol>`
      : `<p data-testid="commander-dossier-fights-empty">No public Hall of Fame fights.</p>`;
  return dossierShell(
    `${escapeHtml(row.name)}${you}`,
    `<dl class="commander-dossier-stats">
      <dt>Rank</dt><dd data-testid="commander-dossier-rank">#${fmt(row.rank)}</dd>
      <dt>Points</dt><dd data-testid="commander-dossier-points">${fmtCompact(row.points)}</dd>
      <dt>Level</dt><dd data-testid="commander-dossier-level">${fmt(row.level ?? 1)}</dd>
      <dt>Alliance</dt><dd data-testid="commander-dossier-alliance">${alliance}</dd>
      <dt>Home</dt><dd data-testid="commander-dossier-home">${escapeHtml(row.planetName || "world")} · ${fmtCoordsLink(row.coords)}</dd>
      <dt>Planets</dt><dd data-testid="commander-dossier-planets">${fmt(row.planetCount)}</dd>
    </dl>
    <h4>Hall of Fame</h4>
    ${fightHtml}`,
  );
}

export function syncCommanderDossier(root: ParentNode, view: PlayerView): void {
  const shell = root.querySelector<HTMLElement>('[data-testid="game-shell"]');
  if (!shell) return;
  const next = commanderDossierHtml(view, openPlayerId);
  const existing = shell.querySelector<HTMLElement>(
    '[data-testid="commander-dossier"]',
  );
  if (!next) {
    existing?.remove();
    return;
  }
  if (!existing) {
    shell.insertAdjacentHTML("beforeend", next);
    return;
  }
  existing.outerHTML = next;
}
