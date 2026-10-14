import {
  SEASON_COMBAT_PVE_WIN,
  SEASON_COMBAT_WIN,
  SEASON_ECONOMY_SPEND_DIV,
  SEASON_LEADERBOARD_TOP,
  SEASON_REWARD_TOP_N,
} from "./catalog.js";
import type {
  PlayerState,
  Resources,
  SeasonBoardId,
  SeasonBoardRow,
  SeasonClaimOffer,
  SeasonClaimView,
  SeasonCosmetics,
  SeasonLeaderboardView,
  SeasonPlayerCounters,
  SeasonStanding,
  UniverseState,
} from "./types.js";

export const SEASON_BOARDS = [
  "combat",
  "economy",
  "pirateKills",
] as const satisfies readonly SeasonBoardId[];

const MONTHS = [
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
] as const;

export type SeasonActionResult = { ok: true } | { ok: false; error: string };

export function isSeasonBoard(value: unknown): value is SeasonBoardId {
  return (
    value === "combat" || value === "economy" || value === "pirateKills"
  );
}

/** Raid and ACS (when that mission exists) award PvP season points. */
export function isSeasonPvpMission(mission: string): boolean {
  return mission === "raid" || mission === "acs";
}

export function seasonIdFromTime(now: number): string {
  const when = Number.isFinite(now) ? now : Date.now();
  const date = new Date(when);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

function isSeasonId(id: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(id);
}

function nonNegInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function normalizeClaims(value: unknown): SeasonBoardId[] {
  if (!Array.isArray(value)) return [];
  const out: SeasonBoardId[] = [];
  for (const item of value) {
    if (isSeasonBoard(item) && !out.includes(item)) out.push(item);
  }
  return out;
}

function emptySeason(seasonId: string): SeasonPlayerCounters {
  return {
    seasonId,
    combat: 0,
    economy: 0,
    pirateKills: 0,
    economyRemainder: 0,
    claimedBoards: [],
  };
}

function copySeason(season: SeasonPlayerCounters): SeasonPlayerCounters {
  return {
    seasonId: season.seasonId,
    combat: season.combat,
    economy: season.economy,
    pirateKills: season.pirateKills,
    economyRemainder: season.economyRemainder ?? 0,
    claimedBoards: [...(season.claimedBoards ?? [])],
  };
}

function normalizeSeason(
  raw: SeasonPlayerCounters | undefined,
  fallbackId: string,
): SeasonPlayerCounters {
  if (!raw) return emptySeason(fallbackId);
  const seasonId =
    typeof raw.seasonId === "string" && isSeasonId(raw.seasonId)
      ? raw.seasonId
      : fallbackId;
  return {
    seasonId,
    combat: nonNegInt(raw.combat),
    economy: nonNegInt(raw.economy),
    pirateKills: nonNegInt(raw.pirateKills),
    economyRemainder: nonNegInt(raw.economyRemainder),
    claimedBoards: normalizeClaims(raw.claimedBoards),
  };
}

function ensureCosmetics(player: PlayerState): SeasonCosmetics {
  const raw = player.cosmetics;
  const titles = Array.isArray(raw?.titles)
    ? raw.titles.filter((title) => typeof title === "string" && title.trim())
    : [];
  const planetSkinIds = Array.isArray(raw?.planetSkinIds)
    ? raw.planetSkinIds.filter((id) => typeof id === "string" && id.trim())
    : [];
  const activeTitle =
    typeof raw?.activeTitle === "string" && titles.includes(raw.activeTitle)
      ? raw.activeTitle
      : null;
  const activePlanetSkinId =
    typeof raw?.activePlanetSkinId === "string" &&
    planetSkinIds.includes(raw.activePlanetSkinId)
      ? raw.activePlanetSkinId
      : null;
  player.cosmetics = {
    titles,
    activeTitle,
    planetSkinIds,
    activePlanetSkinId,
  };
  return player.cosmetics;
}

function scoreOf(
  season: SeasonPlayerCounters,
  board: SeasonBoardId,
): number {
  switch (board) {
    case "combat":
      return season.combat;
    case "economy":
      return season.economy;
    case "pirateKills":
      return season.pirateKills;
    default: {
      const exhaustive: never = board;
      return exhaustive;
    }
  }
}

function standingsFor(
  universe: UniverseState,
  seasonId: string,
  board: SeasonBoardId,
): SeasonBoardRow[] {
  const rows: SeasonBoardRow[] = [];
  for (const player of Object.values(universe.players)) {
    if (player.season?.seasonId !== seasonId) continue;
    const score = scoreOf(player.season, board);
    if (score <= 0) continue;
    rows.push({ playerId: player.id, name: player.name, score });
  }
  rows.sort(
    (a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId),
  );
  return rows;
}

function ranked(
  rows: SeasonBoardRow[],
  limit: number,
): SeasonStanding[] {
  return rows.slice(0, limit).map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
}

function rankOf(rows: SeasonBoardRow[], playerId: string): number | null {
  const index = rows.findIndex((row) => row.playerId === playerId);
  return index >= 0 ? index + 1 : null;
}

export function seasonPilotTitle(seasonId: string): string {
  const month = Number(seasonId.slice(5, 7));
  const label = MONTHS[month - 1] ?? seasonId;
  return `Season Pilot ${label}`;
}

export function placementReward(
  seasonId: string,
  rank: number | null,
  score: number,
): { title: string; skinId: string | null } | null {
  if (score <= 0) return null;
  if (rank === 1) {
    return {
      title: "Season Champion",
      skinId: `season-champion-${seasonId}`,
    };
  }
  if (rank != null && rank >= 2 && rank <= SEASON_REWARD_TOP_N) {
    return {
      title: "Season Contender",
      skinId: `season-contender-${seasonId}`,
    };
  }
  return { title: seasonPilotTitle(seasonId), skinId: null };
}

function archiveSeason(player: PlayerState, season: SeasonPlayerCounters): void {
  if (!player.seasonArchive) player.seasonArchive = {};
  if (player.seasonArchive[season.seasonId]) return;
  player.seasonArchive[season.seasonId] = copySeason(season);
}

function sealSeason(
  universe: UniverseState,
  seasonId: string,
  now: number,
): void {
  if (!universe.seasons) universe.seasons = {};
  if (universe.seasons[seasonId]?.sealedAt != null) return;
  const storeN = Math.max(SEASON_LEADERBOARD_TOP, SEASON_REWARD_TOP_N);
  universe.seasons[seasonId] = {
    id: seasonId,
    sealedAt: now,
    boards: {
      combat: standingsFor(universe, seasonId, "combat").slice(0, storeN),
      economy: standingsFor(universe, seasonId, "economy").slice(0, storeN),
      pirateKills: standingsFor(universe, seasonId, "pirateKills").slice(
        0,
        storeN,
      ),
    },
  };
}

/**
 * Lazy month roll. On the first read or write in a new UTC month, seal every
 * open earlier season (once) and zero those players onto the new month.
 * Players already sitting on a later month are left alone so a test seal
 * is not undone by a clock that is still in the previous month.
 */
export function rollSeasons(universe: UniverseState, now: number): void {
  if (!universe.seasons) universe.seasons = {};
  const current = seasonIdFromTime(now);
  const pending = new Set<string>();
  for (const player of Object.values(universe.players)) {
    ensureCosmetics(player);
    if (!player.seasonArchive) player.seasonArchive = {};
    player.season = normalizeSeason(player.season, current);
    if (player.season.seasonId < current) pending.add(player.season.seasonId);
  }
  const ids = [...pending].sort();
  for (const seasonId of ids) {
    sealSeason(universe, seasonId, now);
    for (const player of Object.values(universe.players)) {
      if (player.season?.seasonId !== seasonId) continue;
      archiveSeason(player, player.season);
      player.season = emptySeason(current);
    }
  }
}

export function addSeasonEconomySpend(
  player: PlayerState,
  cost: Resources,
  now: number,
): void {
  if (!player.season || !isSeasonId(player.season.seasonId)) {
    player.season = emptySeason(seasonIdFromTime(now));
  }
  const spend =
    nonNegInt(cost.metal) + nonNegInt(cost.crystal) + nonNegInt(cost.deuterium);
  if (spend <= 0) return;
  const div = Math.max(1, SEASON_ECONOMY_SPEND_DIV);
  const bank = (player.season.economyRemainder ?? 0) + spend;
  player.season.economy += Math.floor(bank / div);
  player.season.economyRemainder = bank % div;
}

export function awardSeasonPvpWin(
  universe: UniverseState,
  player: PlayerState,
  now: number,
): void {
  rollSeasons(universe, now);
  if (!player.season) return;
  player.season.combat += SEASON_COMBAT_WIN;
}

/** Pirate and alien combat wins (player beat the NPC). */
export function awardSeasonPveWin(
  universe: UniverseState,
  player: PlayerState,
  now: number,
): void {
  rollSeasons(universe, now);
  if (!player.season) return;
  player.season.combat += SEASON_COMBAT_PVE_WIN;
}

export function awardSeasonPirateKill(
  universe: UniverseState,
  player: PlayerState,
  now: number,
): void {
  rollSeasons(universe, now);
  if (!player.season) return;
  player.season.pirateKills += 1;
}

/** Test / e2e hook — adds already-converted points on the open season. */
export function grantSeasonPoints(
  universe: UniverseState,
  playerId: string,
  delta: { combat?: number; economy?: number; pirateKills?: number },
  now = Date.now(),
): SeasonActionResult {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  rollSeasons(universe, now);
  if (!player.season) return { ok: false, error: "Season missing." };
  const add = (value: unknown) =>
    Math.min(1_000_000, nonNegInt(value));
  player.season.combat += add(delta.combat);
  player.season.economy += add(delta.economy);
  player.season.pirateKills += add(delta.pirateKills);
  return { ok: true };
}

function newestSealedId(
  player: PlayerState,
  universe: UniverseState,
): string | null {
  const ids = Object.keys(player.seasonArchive ?? {})
    .filter((id) => universe.seasons?.[id]?.sealedAt != null)
    .sort();
  return ids.length > 0 ? ids[ids.length - 1]! : null;
}

function grantCosmetic(
  player: PlayerState,
  title: string,
  skinId: string | null,
): void {
  const cosmetics = ensureCosmetics(player);
  if (!cosmetics.titles.includes(title)) cosmetics.titles.push(title);
  cosmetics.activeTitle = title;
  if (skinId) {
    if (!cosmetics.planetSkinIds.includes(skinId)) {
      cosmetics.planetSkinIds.push(skinId);
    }
    cosmetics.activePlanetSkinId = skinId;
  }
}

export function claimSeasonReward(
  universe: UniverseState,
  playerId: string,
  board: unknown,
  now = Date.now(),
  seasonId?: string,
): SeasonActionResult {
  if (!isSeasonBoard(board)) return { ok: false, error: "Unknown board." };
  rollSeasons(universe, now);
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const id = seasonId?.trim() || newestSealedId(player, universe);
  if (!id) return { ok: false, error: "This season has not sealed yet." };
  const snapshot = universe.seasons?.[id];
  if (snapshot?.sealedAt == null) {
    return { ok: false, error: "This season has not sealed yet." };
  }
  const archived = player.seasonArchive?.[id];
  if (!archived) return { ok: false, error: "No score on that season." };
  const claimed = archived.claimedBoards ?? [];
  if (claimed.includes(board)) {
    return { ok: false, error: "Already claimed for this board." };
  }
  const score = scoreOf(archived, board);
  const rank = rankOf(snapshot.boards[board], playerId);
  const reward = placementReward(id, rank, score);
  if (!reward) return { ok: false, error: "No reward on that board." };
  archived.claimedBoards = [...claimed, board];
  grantCosmetic(player, reward.title, reward.skinId);
  return { ok: true };
}

export function setSeasonTitle(
  universe: UniverseState,
  playerId: string,
  title: string | null,
  now = Date.now(),
): SeasonActionResult {
  rollSeasons(universe, now);
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const cosmetics = ensureCosmetics(player);
  if (title == null || title.trim() === "") {
    cosmetics.activeTitle = null;
    return { ok: true };
  }
  if (!cosmetics.titles.includes(title)) {
    return { ok: false, error: "You have not earned that title." };
  }
  cosmetics.activeTitle = title;
  return { ok: true };
}

export function setSeasonSkin(
  universe: UniverseState,
  playerId: string,
  skinId: string | null,
  now = Date.now(),
): SeasonActionResult {
  rollSeasons(universe, now);
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const cosmetics = ensureCosmetics(player);
  if (skinId == null || skinId.trim() === "") {
    cosmetics.activePlanetSkinId = null;
    return { ok: true };
  }
  if (!cosmetics.planetSkinIds.includes(skinId)) {
    return { ok: false, error: "You have not earned that planet skin." };
  }
  cosmetics.activePlanetSkinId = skinId;
  return { ok: true };
}

function claimOffers(
  universe: UniverseState,
  player: PlayerState,
  seasonId: string,
): SeasonClaimOffer[] {
  const archived = player.seasonArchive?.[seasonId];
  const snapshot = universe.seasons?.[seasonId];
  if (!archived || snapshot?.sealedAt == null) return [];
  const claimed = archived.claimedBoards ?? [];
  return SEASON_BOARDS.map((board) => {
    const score = scoreOf(archived, board);
    const rank = rankOf(snapshot.boards[board], player.id);
    const reward = placementReward(seasonId, rank, score);
    return {
      board,
      score,
      rank,
      title: reward?.title ?? null,
      skinId: reward?.skinId ?? null,
      claimed: claimed.includes(board),
    };
  });
}

export function seasonLeaderboardView(
  universe: UniverseState,
  player: PlayerState,
  now: number,
): SeasonLeaderboardView {
  rollSeasons(universe, now);
  const seasonId = seasonIdFromTime(now);
  const mine =
    player.season?.seasonId === seasonId ? player.season : emptySeason(seasonId);
  const full = {
    combat: standingsFor(universe, seasonId, "combat"),
    economy: standingsFor(universe, seasonId, "economy"),
    pirateKills: standingsFor(universe, seasonId, "pirateKills"),
  };
  const claims: SeasonClaimView[] = Object.keys(player.seasonArchive ?? {})
    .filter((id) => universe.seasons?.[id]?.sealedAt != null)
    .sort()
    .reverse()
    .map((id) => ({ seasonId: id, offers: claimOffers(universe, player, id) }));
  return {
    seasonId,
    scores: {
      combat: mine.combat,
      economy: mine.economy,
      pirateKills: mine.pirateKills,
    },
    ranks: {
      combat: rankOf(full.combat, player.id),
      economy: rankOf(full.economy, player.id),
      pirateKills: rankOf(full.pirateKills, player.id),
    },
    boards: {
      combat: ranked(full.combat, SEASON_LEADERBOARD_TOP),
      economy: ranked(full.economy, SEASON_LEADERBOARD_TOP),
      pirateKills: ranked(full.pirateKills, SEASON_LEADERBOARD_TOP),
    },
    claims,
  };
}
