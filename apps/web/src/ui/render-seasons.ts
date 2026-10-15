import {
  SEASON_BOARDS,
  SEASON_ECONOMY_SPEND_DIV,
  type PlayerView,
  type SeasonBoardId,
  type SeasonClaimView,
  type SeasonStanding,
} from "@starhold/game";
import { fmt } from "./format";
import { escapeAttr, escapeHtml } from "./render-escape";
import { infoTooltip } from "./render-tooltips";

function boardLabel(board: SeasonBoardId): string {
  switch (board) {
    case "combat":
      return "Combat";
    case "economy":
      return "Economy";
    case "pirateKills":
      return "Pirate kills";
    default: {
      const exhaustive: never = board;
      return exhaustive;
    }
  }
}

function boardHint(board: SeasonBoardId): string {
  switch (board) {
    case "combat":
      return "Raid wins against commanders, and wins against pirates.";
    case "economy":
      return `1 point for every ${fmt(SEASON_ECONOMY_SPEND_DIV)} resources spent on buildings, ships, defenses, and research that finish this month.`;
    case "pirateKills":
      return "Pirate bases destroyed.";
    default: {
      const exhaustive: never = board;
      return exhaustive;
    }
  }
}

function monthLabel(seasonId: string): string {
  const [year, month] = seasonId.split("-");
  const names = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const index = Number(month) - 1;
  const name = names[index] ?? month;
  return `${name} ${year ?? ""}`.trim();
}

function standingRows(
  rows: SeasonStanding[],
  youId: string,
  board: SeasonBoardId,
): string {
  if (rows.length === 0) {
    return `<p class="hint">No scores yet this month.</p>`;
  }
  return `<ol class="season-list" data-testid="season-list-${board}">
    ${rows
      .map(
        (row) =>
          `<li data-testid="season-row-${board}-${row.rank}" data-player-id="${escapeAttr(row.playerId)}"><span>#${fmt(row.rank)} ${escapeHtml(row.name)}${row.playerId === youId ? " (you)" : ""}</span><span>${fmt(row.score)}</span></li>`,
      )
      .join("")}
  </ol>`;
}

function claimCard(
  claim: SeasonClaimView,
  index: number,
  busy: boolean,
): string {
  const rows = claim.offers
    .map((offer) => {
      const testId =
        index === 0
          ? `season-claim-${offer.board}`
          : `season-claim-${claim.seasonId}-${offer.board}`;
      const reward = offer.title
        ? `${escapeHtml(offer.title)}${offer.skinId ? " · skin" : ""}`
        : "No reward";
      const rank = offer.rank == null ? "—" : `#${fmt(offer.rank)}`;
      const button =
        offer.title == null
          ? ""
          : `<button type="button" data-season-claim="${offer.board}" data-season-id="${escapeAttr(claim.seasonId)}" data-testid="${testId}" ${offer.claimed || busy ? "disabled" : ""}>${offer.claimed ? "Claimed" : "Claim"}</button>`;
      return `<li class="season-claim-row">
        <span>${escapeHtml(boardLabel(offer.board))} · ${rank} · ${fmt(offer.score)} · ${reward}</span>
        ${button}
      </li>`;
    })
    .join("");
  return `<section class="season-claim" data-testid="season-claim-${claim.seasonId}">
    <h3>Sealed ${escapeHtml(monthLabel(claim.seasonId))}</h3>
    <ul class="season-list">${rows}</ul>
  </section>`;
}

export function seasonsPage(view: PlayerView, busy: boolean): string {
  const board = view.seasonLeaderboard;
  const cosmetics = view.player.cosmetics;
  const titles = cosmetics?.titles ?? [];
  const skins = cosmetics?.planetSkinIds ?? [];
  const activeTitle = cosmetics?.activeTitle ?? "";
  const activeSkin = cosmetics?.activePlanetSkinId ?? "";
  const titleOptions = [
    `<option value="">None</option>`,
    ...titles.map(
      (title) =>
        `<option value="${escapeAttr(title)}"${title === activeTitle ? " selected" : ""}>${escapeHtml(title)}</option>`,
    ),
  ].join("");
  const skinOptions = [
    `<option value="">None</option>`,
    ...skins.map(
      (skin) =>
        `<option value="${escapeAttr(skin)}"${skin === activeSkin ? " selected" : ""}>${escapeHtml(skin)}</option>`,
    ),
  ].join("");
  const claims =
    board.claims.length > 0
      ? board.claims.map((claim, index) => claimCard(claim, index, busy)).join("")
      : `<p class="hint" data-testid="season-claim-locked">Claims open after this month seals.</p>`;

  const economyTip = infoTooltip({
    title: "Economy score",
    lines: [
      `1 point for every ${fmt(SEASON_ECONOMY_SPEND_DIV)} metal, crystal, and deuterium spent on buildings, ships, defenses, and research that finish this month.`,
      board.economyRemainder > 0
        ? `${fmt(board.economyRemainder)} resources are banked toward the next point.`
        : "Leftover spend is banked until it reaches the next point.",
    ],
    testId: "season-economy-tip",
  });
  const boards = SEASON_BOARDS.map((id) => {
    const rank = board.ranks[id];
    const tip = id === "economy" ? economyTip.html : "";
    return `<article class="season-board" data-testid="season-board-${id}">
      <h3>${escapeHtml(boardLabel(id))} ${tip}</h3>
      <p class="hint">${escapeHtml(boardHint(id))}</p>
      <p data-testid="season-score-${id}">You · ${rank == null ? "unranked" : `#${fmt(rank)}`} · ${fmt(board.scores[id])}</p>
      ${standingRows(board.boards[id], view.player.id, id)}
    </article>`;
  }).join("");

  return `<section class="panel" data-testid="seasons-panel">
    <h2>Seasons</h2>
    <p class="hint" data-testid="season-id">${escapeHtml(monthLabel(board.seasonId))} · titles and planet skins from placement.</p>
    <div class="season-boards">${boards}</div>
    <h3 class="subhead">Claim</h3>
    ${claims}
    <h3 class="subhead">Cosmetics</h3>
    <div class="season-pickers">
      <label>Active title
        <select data-season-title data-testid="title-picker" ${busy ? "disabled" : ""}>${titleOptions}</select>
      </label>
      <label>Planet skin
        <select data-season-skin data-testid="skin-picker" ${busy ? "disabled" : ""}>${skinOptions}</select>
      </label>
    </div>
  </section>`;
}
