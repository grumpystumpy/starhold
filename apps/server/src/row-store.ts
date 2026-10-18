/**
 * Per-player / per-planet / per-fleet / per-message D1 rows.
 * The legacy kv universe document is never deleted or overwritten here.
 * It stays as the rollback snapshot from before the switch.
 */
import {
  ensureSystemVisited,
  ensureUniverseShape,
  highscoresBoard,
  type AsteroidField,
  type CombatReport,
  type DebrisField,
  type EventLogEntry,
  type ExpeditionReport,
  type FleetMission,
  type HighscoreEntry,
  type PlanetState,
  type PlayerState,
  type EspionageReport,
  type UniverseState,
} from "@starhold/game";
import type { D1Like } from "./d1-store.js";
import type { KvStore } from "./kv.js";
import { addCpu, currentScope } from "./request-context.js";

export const HIGHSCORE_TTL_MS = 30 * 60 * 1000;
export const ROW_LOCK_MS = 2_500;
const CHUNK = 25;

export class RowStaleError extends Error {
  constructor() {
    super("Row changed — retrying.");
    this.name = "RowStaleError";
  }
}

export interface UniverseWork {
  playerIds?: string[];
  planetIds?: Array<string | null | undefined>;
  galaxy?: number;
  system?: number;
  /** Occupied slot at galaxy/system. Its owner is locked with the actor. */
  slot?: number;
  /** System scan touches every owner in that system, so they are locked too. */
  lockSystemOwners?: boolean;
  /** Join: player names and slot coordinates, not planet bodies. */
  catalog?: boolean;
  /** Cron: every owned planet, NPC combat, refresh highscores when due. */
  maintenance?: boolean;
}

interface MigrateState {
  v: number;
  stage: string;
  cursor: string;
}

interface SystemRow {
  galaxy: number;
  system: number;
  version: number;
  asteroids: Record<string, AsteroidField>;
  debris: Record<string, DebrisField>;
}

interface LoadedRows {
  universe: UniverseState;
  worldVersion: number;
  playerVersions: Map<string, number>;
  planetVersions: Map<string, number>;
  fleetVersions: Map<string, number>;
  messageVersions: Map<string, number>;
  systemVersions: Map<string, number>;
  /** Planet bodies safe to write back. Stubs used for slot checks are not. */
  fullPlanetIds: Set<string>;
  stubPlanetIds: Set<string>;
  fingerprints: Map<string, string>;
}

const TABLE_SQL = [
  `CREATE TABLE IF NOT EXISTS save_meta (id TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS save_world (id TEXT PRIMARY KEY, version INTEGER NOT NULL, doc TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS save_players (id TEXT PRIMARY KEY, version INTEGER NOT NULL, doc TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS save_planets (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, galaxy INTEGER NOT NULL,
    system INTEGER NOT NULL, slot INTEGER NOT NULL, kind TEXT NOT NULL,
    version INTEGER NOT NULL, doc TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS save_planets_owner ON save_planets (owner_id)`,
  `CREATE INDEX IF NOT EXISTS save_planets_system ON save_planets (galaxy, system)`,
  `CREATE TABLE IF NOT EXISTS save_fleets (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, target_owner_id TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL, doc TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS save_fleets_owner ON save_fleets (owner_id)`,
  `CREATE INDEX IF NOT EXISTS save_fleets_target ON save_fleets (target_owner_id)`,
  `CREATE TABLE IF NOT EXISTS save_messages (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, defender_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL, version INTEGER NOT NULL, doc TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS save_messages_owner ON save_messages (owner_id)`,
  `CREATE INDEX IF NOT EXISTS save_messages_defender ON save_messages (defender_id)`,
  `CREATE TABLE IF NOT EXISTS save_systems (
    galaxy INTEGER NOT NULL, system INTEGER NOT NULL, version INTEGER NOT NULL,
    asteroids TEXT NOT NULL, debris TEXT NOT NULL, PRIMARY KEY (galaxy, system))`,
  `CREATE TABLE IF NOT EXISTS save_highscores (
    id TEXT PRIMARY KEY, built_at INTEGER NOT NULL, doc TEXT NOT NULL)`,
];

const OMIT_KEYS = new Set([
  "resources",
  "lastTickAt",
  "lastAiSimAt",
  "remainingSeconds",
  "skipNpcRaids",
]);

function stable(value: unknown): string {
  return JSON.stringify(value, (key, inner) =>
    OMIT_KEYS.has(key) ? undefined : inner,
  );
}

async function run(db: D1Like, sql: string, ...values: unknown[]): Promise<number> {
  const result = await db.prepare(sql).bind(...values).run();
  return result.meta?.changes ?? 0;
}

async function first<T>(db: D1Like, sql: string, ...values: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...values).first<T>();
}

async function all<T>(db: D1Like, sql: string, ...values: unknown[]): Promise<T[]> {
  const rows = await db.prepare(sql).bind(...values).all<T>();
  return rows.results ?? [];
}

export async function ensureRowTables(db: D1Like): Promise<void> {
  for (const sql of TABLE_SQL) await run(db, sql);
}

async function readMigrate(db: D1Like): Promise<MigrateState> {
  const row = await first<{ value: string }>(
    db,
    "SELECT value FROM save_meta WHERE id = ?",
    "migration",
  );
  if (!row) return { v: 0, stage: "world", cursor: "" };
  try {
    const parsed = JSON.parse(row.value) as MigrateState;
    return {
      v: parsed.v ?? 0,
      stage: parsed.stage || "world",
      cursor: parsed.cursor || "",
    };
  } catch {
    return { v: 0, stage: "world", cursor: "" };
  }
}

async function writeMigrate(db: D1Like, state: MigrateState): Promise<void> {
  await run(
    db,
    "INSERT INTO save_meta (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
    "migration",
    JSON.stringify(state),
  );
}

export async function migrationDone(db: D1Like): Promise<boolean> {
  await ensureRowTables(db);
  const state = await readMigrate(db);
  return state.v >= 1;
}

export function highscoreCacheExpired(builtAt: number, now = Date.now()): boolean {
  return now - builtAt >= HIGHSCORE_TTL_MS;
}

function worldDoc(universe: UniverseState): UniverseState {
  const doc = {
    ...universe,
    players: {},
    planets: {},
    fleets: {},
    reports: {},
    spyReports: {},
    expeditionReports: {},
    asteroids: {},
    debris: {},
  };
  delete doc.skipNpcRaids;
  return doc;
}

function playerDoc(player: PlayerState): PlayerState {
  return { ...player, eventLog: [] };
}

interface MessageDraft {
  id: string;
  owner: string;
  defender: string;
  kind: string;
  doc: unknown;
}

function messageDrafts(universe: UniverseState): MessageDraft[] {
  const rows: MessageDraft[] = [];
  for (const report of Object.values(universe.reports ?? {})) {
    rows.push({
      id: report.id,
      owner: report.attackerPlayerId,
      defender: report.defenderPlayerId ?? "",
      kind: "report",
      doc: report,
    });
  }
  for (const report of Object.values(universe.spyReports ?? {})) {
    rows.push({
      id: report.id,
      owner: report.spyPlayerId,
      defender: "",
      kind: "spy",
      doc: report,
    });
  }
  for (const report of Object.values(universe.expeditionReports ?? {})) {
    rows.push({
      id: report.id,
      owner: report.playerId,
      defender: "",
      kind: "expedition",
      doc: report,
    });
  }
  for (const player of Object.values(universe.players)) {
    for (const event of player.eventLog ?? []) {
      rows.push({
        id: `${player.id}:${event.id}`,
        owner: player.id,
        defender: "",
        kind: "event",
        doc: event,
      });
    }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

function systemDrafts(universe: UniverseState): SystemRow[] {
  const map = new Map<string, SystemRow>();
  const bucket = (galaxy: number, system: number) => {
    const key = `${galaxy}:${system}`;
    let row = map.get(key);
    if (!row) {
      row = { galaxy, system, version: 1, asteroids: {}, debris: {} };
      map.set(key, row);
    }
    return row;
  };
  for (const [id, field] of Object.entries(universe.asteroids ?? {})) {
    bucket(field.coords.galaxy, field.coords.system).asteroids[id] = field;
  }
  for (const [id, field] of Object.entries(universe.debris ?? {})) {
    bucket(field.coords.galaxy, field.coords.system).debris[id] = field;
  }
  return [...map.values()].sort((a, b) => a.galaxy - b.galaxy || a.system - b.system);
}

async function upsertWorld(db: D1Like, universe: UniverseState): Promise<void> {
  await run(
    db,
    `INSERT INTO save_world (id, version, doc) VALUES ('world', 1, ?)
     ON CONFLICT(id) DO UPDATE SET doc = excluded.doc`,
    JSON.stringify(worldDoc(universe)),
  );
}

async function upsertPlayer(db: D1Like, player: PlayerState): Promise<void> {
  await run(
    db,
    `INSERT INTO save_players (id, version, doc) VALUES (?, 1, ?)
     ON CONFLICT(id) DO UPDATE SET doc = excluded.doc`,
    player.id,
    JSON.stringify(playerDoc(player)),
  );
}

async function upsertPlanet(db: D1Like, planet: PlanetState): Promise<void> {
  await run(
    db,
    `INSERT INTO save_planets (id, owner_id, galaxy, system, slot, kind, version, doc)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(id) DO UPDATE SET
       owner_id = excluded.owner_id, galaxy = excluded.galaxy, system = excluded.system,
       slot = excluded.slot, kind = excluded.kind, doc = excluded.doc`,
    planet.id,
    planet.ownerPlayerId || "",
    planet.coords.galaxy,
    planet.coords.system,
    planet.coords.slot,
    planet.kind ?? "planet",
    JSON.stringify(planet),
  );
}

async function upsertFleet(db: D1Like, fleet: FleetMission): Promise<void> {
  await run(
    db,
    `INSERT INTO save_fleets (id, owner_id, target_owner_id, version, doc)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(id) DO UPDATE SET
       owner_id = excluded.owner_id, target_owner_id = excluded.target_owner_id, doc = excluded.doc`,
    fleet.id,
    fleet.ownerPlayerId,
    fleet.targetPlayerId || "",
    JSON.stringify(fleet),
  );
}

async function upsertMessage(db: D1Like, row: MessageDraft): Promise<void> {
  await run(
    db,
    `INSERT INTO save_messages (id, owner_id, defender_id, kind, version, doc)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(id) DO UPDATE SET
       owner_id = excluded.owner_id, defender_id = excluded.defender_id,
       kind = excluded.kind, doc = excluded.doc`,
    row.id,
    row.owner,
    row.defender,
    row.kind,
    JSON.stringify(row.doc),
  );
}

async function upsertSystem(db: D1Like, row: SystemRow): Promise<void> {
  await run(
    db,
    `INSERT INTO save_systems (galaxy, system, version, asteroids, debris)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(galaxy, system) DO UPDATE SET
       asteroids = excluded.asteroids, debris = excluded.debris`,
    row.galaxy,
    row.system,
    JSON.stringify(row.asteroids),
    JSON.stringify(row.debris),
  );
}

async function writeHighscoreCache(
  db: D1Like,
  rows: HighscoreEntry[],
  builtAt: number,
): Promise<void> {
  await run(
    db,
    `INSERT INTO save_highscores (id, built_at, doc) VALUES ('board', ?, ?)
     ON CONFLICT(id) DO UPDATE SET built_at = excluded.built_at, doc = excluded.doc`,
    builtAt,
    JSON.stringify(rows),
  );
}

const STAGES = [
  "world",
  "players",
  "planets",
  "fleets",
  "messages",
  "systems",
  "scores",
  "done",
] as const;

/**
 * Copy one slice of `universe` into the row tables.
 * Safe to call again: rows are replaced from the legacy object, and the
 * cursor only moves forward. `stopAfter` forces an interrupt for tests.
 * The kv document is not written.
 */
export async function migrateChunk(
  db: D1Like,
  universe: UniverseState,
  limit = CHUNK,
  stopAfter?: number,
): Promise<{ done: boolean; stage: string }> {
  await ensureRowTables(db);
  const state = await readMigrate(db);
  if (state.v >= 1) return { done: true, stage: "done" };
  let writes = 0;
  const stop = () => stopAfter != null && writes >= stopAfter;

  const advance = async (stage: string, cursor: string) => {
    state.stage = stage;
    state.cursor = cursor;
    await writeMigrate(db, state);
  };

  if (state.stage === "world") {
    if (!stop()) {
      await upsertWorld(db, universe);
      writes += 1;
    }
    if (stop()) return { done: false, stage: state.stage };
    await advance("players", "");
  }

  if (state.stage === "players") {
    const ids = Object.keys(universe.players).sort();
    for (const id of ids) {
      if (id <= state.cursor) continue;
      if (stop()) return { done: false, stage: "players" };
      await upsertPlayer(db, universe.players[id]!);
      writes += 1;
      await advance("players", id);
    }
    await advance("planets", "");
  }

  if (state.stage === "planets") {
    const ids = Object.keys(universe.planets).sort();
    let n = 0;
    for (const id of ids) {
      if (id <= state.cursor) continue;
      if (stop() || n >= limit) return { done: false, stage: "planets" };
      await upsertPlanet(db, universe.planets[id]!);
      writes += 1;
      n += 1;
      await advance("planets", id);
    }
    await advance("fleets", "");
  }

  if (state.stage === "fleets") {
    const ids = Object.keys(universe.fleets ?? {}).sort();
    for (const id of ids) {
      if (id <= state.cursor) continue;
      if (stop()) return { done: false, stage: "fleets" };
      await upsertFleet(db, universe.fleets[id]!);
      writes += 1;
      await advance("fleets", id);
    }
    await advance("messages", "");
  }

  if (state.stage === "messages") {
    const rows = messageDrafts(universe);
    let n = 0;
    for (const row of rows) {
      if (row.id <= state.cursor) continue;
      if (stop() || n >= limit) return { done: false, stage: "messages" };
      await upsertMessage(db, row);
      writes += 1;
      n += 1;
      await advance("messages", row.id);
    }
    await advance("systems", "");
  }

  if (state.stage === "systems") {
    const rows = systemDrafts(universe);
    let n = 0;
    for (const row of rows) {
      const key = `${row.galaxy}:${row.system}`;
      if (key <= state.cursor) continue;
      if (stop() || n >= limit) return { done: false, stage: "systems" };
      await upsertSystem(db, row);
      writes += 1;
      n += 1;
      await advance("systems", key);
    }
    await advance("scores", "");
  }

  if (state.stage === "scores") {
    if (!stop()) {
      await writeHighscoreCache(db, highscoresBoard(universe), Date.now());
      writes += 1;
    }
    if (stop()) return { done: false, stage: "scores" };
    state.v = 1;
    state.stage = "done";
    state.cursor = "";
    await writeMigrate(db, state);
  }

  return { done: state.v >= 1, stage: state.stage };
}

export async function migrateAll(
  db: D1Like,
  universe: UniverseState,
): Promise<void> {
  for (let i = 0; i < 100_000; i++) {
    const step = await migrateChunk(db, universe, CHUNK);
    if (step.done) return;
  }
  throw new Error("Row migration did not finish.");
}

function lockName(id: string): string {
  return id === "__world__"
    ? "starhold:row:lock:world"
    : `starhold:row:lock:player:${id}`;
}

async function tryLock(kv: KvStore, id: string): Promise<boolean> {
  const result = await kv.set(lockName(id), String(Date.now()), {
    nx: true,
    px: ROW_LOCK_MS,
  });
  return result === "OK";
}

async function unlock(kv: KvStore, id: string): Promise<void> {
  await kv.del(lockName(id));
}

async function acquireLocks(kv: KvStore, ids: string[], wait: boolean): Promise<boolean> {
  const held: string[] = [];
  const attempt = async () => {
    for (const id of ids) {
      if (!(await tryLock(kv, id))) {
        for (const got of held) await unlock(kv, got);
        held.length = 0;
        return false;
      }
      held.push(id);
    }
    return true;
  };
  if (!wait) return attempt();
  for (let i = 0; i < 12; i++) {
    if (await attempt()) return true;
    await new Promise((resolve) => setTimeout(resolve, 40 + i * 40));
  }
  return false;
}

async function releaseLocks(kv: KvStore, ids: string[]): Promise<void> {
  for (const id of ids) await unlock(kv, id);
}

function emptyUniverse(shell: UniverseState): UniverseState {
  ensureUniverseShape(shell);
  shell.players = {};
  shell.planets = {};
  shell.fleets = {};
  shell.reports = {};
  shell.spyReports = {};
  shell.expeditionReports = {};
  shell.asteroids = shell.asteroids ?? {};
  shell.debris = shell.debris ?? {};
  return shell;
}

function stubPlanet(row: {
  id: string;
  owner_id: string;
  galaxy: number;
  system: number;
  slot: number;
  kind: string;
}): PlanetState {
  return {
    id: row.id,
    ownerPlayerId: row.owner_id,
    name: "",
    coords: { galaxy: row.galaxy, system: row.system, slot: row.slot },
    kind: (row.kind as PlanetState["kind"]) ?? "planet",
    resources: { metal: 0, crystal: 0, deuterium: 0 },
    lastTickAt: 0,
    buildings: {},
    ships: {},
    defenses: {},
    buildQueue: [],
    shipQueue: [],
    defenseQueue: [],
  } as unknown as PlanetState;
}

async function loadPlayers(db: D1Like, into: LoadedRows): Promise<void> {
  const rows = await all<{ id: string; version: number; doc: string }>(
    db,
    "SELECT id, version, doc FROM save_players",
  );
  for (const row of rows) {
    const player = JSON.parse(row.doc) as PlayerState;
    player.eventLog = [];
    into.universe.players[player.id] = player;
    into.playerVersions.set(player.id, row.version);
    into.fingerprints.set(`player:${player.id}`, stable(playerDoc(player)));
  }
}

async function loadPlanetDocs(
  db: D1Like,
  into: LoadedRows,
  sql: string,
  values: unknown[],
): Promise<void> {
  if (!sql) return;
  const rows = await all<{ id: string; version: number; doc: string }>(db, sql, ...values);
  for (const row of rows) {
    if (into.fullPlanetIds.has(row.id)) continue;
    const planet = JSON.parse(row.doc) as PlanetState;
    into.universe.planets[planet.id] = planet;
    into.planetVersions.set(planet.id, row.version);
    into.fullPlanetIds.add(planet.id);
    into.stubPlanetIds.delete(planet.id);
    into.fingerprints.set(`planet:${planet.id}`, stable(planet));
  }
}

async function loadFleets(db: D1Like, into: LoadedRows, where: string, values: unknown[]): Promise<void> {
  const rows = await all<{ id: string; version: number; doc: string }>(
    db,
    `SELECT id, version, doc FROM save_fleets ${where}`,
    ...values,
  );
  for (const row of rows) {
    const fleet = JSON.parse(row.doc) as FleetMission;
    into.universe.fleets[fleet.id] = fleet;
    into.fleetVersions.set(fleet.id, row.version);
    into.fingerprints.set(`fleet:${fleet.id}`, stable(fleet));
  }
}

async function loadMessages(
  db: D1Like,
  into: LoadedRows,
  where: string,
  values: unknown[],
): Promise<void> {
  const rows = await all<{
    id: string;
    version: number;
    kind: string;
    doc: string;
    owner_id: string;
  }>(db, `SELECT id, version, kind, doc, owner_id FROM save_messages ${where}`, ...values);
  for (const row of rows) {
    into.messageVersions.set(row.id, row.version);
    into.fingerprints.set(`message:${row.id}`, row.doc);
    const doc = JSON.parse(row.doc) as { id: string };
    if (row.kind === "report") into.universe.reports[doc.id] = doc as CombatReport;
    else if (row.kind === "spy") into.universe.spyReports[doc.id] = doc as EspionageReport;
    else if (row.kind === "expedition") {
      into.universe.expeditionReports[doc.id] = doc as ExpeditionReport;
    } else if (row.kind === "event") {
      const player = into.universe.players[row.owner_id];
      if (player) {
        player.eventLog = player.eventLog ?? [];
        player.eventLog.push(doc as EventLogEntry);
      }
    }
  }
  for (const player of Object.values(into.universe.players)) {
    player.eventLog?.sort((a, b) => a.createdAt - b.createdAt);
  }
}

async function loadSystems(db: D1Like, into: LoadedRows, pairs: Array<[number, number]>): Promise<void> {
  for (const [galaxy, system] of pairs) {
    const key = `${galaxy}:${system}`;
    if (into.systemVersions.has(key)) continue;
    const row = await first<{ version: number; asteroids: string; debris: string }>(
      db,
      "SELECT version, asteroids, debris FROM save_systems WHERE galaxy = ? AND system = ?",
      galaxy,
      system,
    );
    into.systemVersions.set(key, row?.version ?? 0);
    const asteroids = row ? (JSON.parse(row.asteroids) as Record<string, AsteroidField>) : {};
    const debris = row ? (JSON.parse(row.debris) as Record<string, DebrisField>) : {};
    Object.assign(into.universe.asteroids!, asteroids);
    Object.assign(into.universe.debris!, debris);
    into.fingerprints.set(`system:${key}`, stable({ asteroids, debris }));
  }
}

function inList(ids: string[]): { clause: string; values: string[] } {
  return { clause: ids.map(() => "?").join(", "), values: ids };
}

export async function loadWorkingSet(db: D1Like, work: UniverseWork | undefined): Promise<LoadedRows> {
  const world = await first<{ version: number; doc: string }>(
    db,
    "SELECT version, doc FROM save_world WHERE id = 'world'",
  );
  if (!world) throw new Error("Row save is missing the world document.");
  const universe = emptyUniverse(JSON.parse(world.doc) as UniverseState);
  const loaded: LoadedRows = {
    universe,
    worldVersion: world.version,
    playerVersions: new Map(),
    planetVersions: new Map(),
    fleetVersions: new Map(),
    messageVersions: new Map(),
    systemVersions: new Map(),
    fullPlanetIds: new Set(),
    stubPlanetIds: new Set(),
    fingerprints: new Map([["world", stable(worldDoc(universe))]]),
  };
  await loadPlayers(db, loaded);

  const requestedIds = [...new Set((work?.playerIds ?? []).filter(Boolean))] as string[];
  const planetIds = [...new Set((work?.planetIds ?? []).filter((id): id is string => Boolean(id)))];
  const wide = Boolean(work?.maintenance) || (requestedIds.length === 0 && !work?.catalog);

  if (work?.catalog) {
    const stubs = await all<{
      id: string;
      owner_id: string;
      galaxy: number;
      system: number;
      slot: number;
      kind: string;
    }>(db, "SELECT id, owner_id, galaxy, system, slot, kind FROM save_planets");
    for (const row of stubs) {
      loaded.universe.planets[row.id] = stubPlanet(row);
      loaded.stubPlanetIds.add(row.id);
    }
    await loadPlanetDocs(
      db,
      loaded,
      "SELECT id, version, doc FROM save_planets WHERE owner_id != ''",
      [],
    );
    await loadFleets(db, loaded, "", []);
    await loadMessages(db, loaded, "", []);
  } else if (wide) {
    await loadPlanetDocs(
      db,
      loaded,
      "SELECT id, version, doc FROM save_planets WHERE owner_id != ''",
      [],
    );
    const systems = new Map<string, [number, number]>();
    for (const planet of Object.values(loaded.universe.planets)) {
      systems.set(`${planet.coords.galaxy}:${planet.coords.system}`, [
        planet.coords.galaxy,
        planet.coords.system,
      ]);
    }
    for (const [galaxy, system] of systems.values()) {
      await loadPlanetDocs(
        db,
        loaded,
        "SELECT id, version, doc FROM save_planets WHERE galaxy = ? AND system = ?",
        [galaxy, system],
      );
    }
    await loadFleets(db, loaded, "", []);
    await loadMessages(db, loaded, "", []);
    await loadSystems(db, loaded, [...systems.values()]);
  } else {
    const ids = inList(requestedIds);
    if (requestedIds.length) {
      await loadPlanetDocs(
        db,
        loaded,
        `SELECT id, version, doc FROM save_planets WHERE owner_id IN (${ids.clause})`,
        ids.values,
      );
    }
    if (planetIds.length) {
      const extra = inList(planetIds);
      await loadPlanetDocs(
        db,
        loaded,
        `SELECT id, version, doc FROM save_planets WHERE id IN (${extra.clause})`,
        extra.values,
      );
    }
    const systems = new Map<string, [number, number]>();
    if (work?.galaxy && work.system) systems.set(`${work.galaxy}:${work.system}`, [work.galaxy, work.system]);
    for (const id of requestedIds) {
      const player = loaded.universe.players[id];
      const home = player ? loaded.universe.planets[player.activePlanetId] ?? loaded.universe.planets[player.homePlanetId] : undefined;
      if (home) systems.set(`${home.coords.galaxy}:${home.coords.system}`, [home.coords.galaxy, home.coords.system]);
    }
    for (const [galaxy, system] of systems.values()) {
      await loadPlanetDocs(
        db,
        loaded,
        "SELECT id, version, doc FROM save_planets WHERE galaxy = ? AND system = ?",
        [galaxy, system],
      );
    }
    if (requestedIds.length) {
      const list = inList(requestedIds);
      await loadFleets(
        db,
        loaded,
        `WHERE owner_id IN (${list.clause}) OR target_owner_id IN (${list.clause})`,
        [...list.values, ...list.values],
      );
      await loadMessages(
        db,
        loaded,
        `WHERE owner_id IN (${list.clause}) OR defender_id IN (${list.clause})`,
        [...list.values, ...list.values],
      );
    }
    await loadSystems(db, loaded, [...systems.values()]);
  }

  if (!work?.maintenance) loaded.universe.skipNpcRaids = true;
  const now = Date.now();
  if (work?.galaxy && work.system) ensureSystemVisited(loaded.universe, work.galaxy, work.system, now);
  for (const id of requestedIds) {
    const player = loaded.universe.players[id];
    const home = player && loaded.universe.planets[player.homePlanetId];
    if (home) ensureSystemVisited(loaded.universe, home.coords.galaxy, home.coords.system, now);
  }
  return loaded;
}

async function bump(
  db: D1Like,
  sql: string,
  values: unknown[],
): Promise<void> {
  const changes = await run(db, sql, ...values);
  if (changes !== 1) throw new RowStaleError();
}

async function saveWorkingSet(db: D1Like, loaded: LoadedRows, rebuildScores: boolean): Promise<void> {
  const universe = loaded.universe;
  delete universe.skipNpcRaids;
  const nextWorld = stable(worldDoc(universe));
  if (nextWorld !== loaded.fingerprints.get("world")) {
    const version = loaded.worldVersion + 1;
    await bump(
      db,
      "UPDATE save_world SET doc = ?, version = ? WHERE id = 'world' AND version = ?",
      [JSON.stringify(worldDoc(universe)), version, loaded.worldVersion],
    );
    loaded.worldVersion = version;
    loaded.fingerprints.set("world", nextWorld);
  }

  for (const player of Object.values(universe.players)) {
    const key = `player:${player.id}`;
    const next = stable(playerDoc(player));
    const previous = loaded.fingerprints.get(key);
    if (previous === undefined) {
      await run(
        db,
        "INSERT INTO save_players (id, version, doc) VALUES (?, 1, ?)",
        player.id,
        JSON.stringify(playerDoc(player)),
      );
      loaded.playerVersions.set(player.id, 1);
      loaded.fingerprints.set(key, next);
      continue;
    }
    if (previous === next) continue;
    const version = (loaded.playerVersions.get(player.id) ?? 0) + 1;
    await bump(
      db,
      "UPDATE save_players SET doc = ?, version = ? WHERE id = ? AND version = ?",
      [JSON.stringify(playerDoc(player)), version, player.id, version - 1],
    );
    loaded.playerVersions.set(player.id, version);
    loaded.fingerprints.set(key, next);
  }

  for (const planet of Object.values(universe.planets)) {
    if (loaded.stubPlanetIds.has(planet.id)) continue;
    const key = `planet:${planet.id}`;
    const next = stable(planet);
    const previous = loaded.fingerprints.get(key);
    if (!loaded.fullPlanetIds.has(planet.id) || previous === undefined) {
      await upsertPlanet(db, planet);
      const row = await first<{ version: number }>(
        db,
        "SELECT version FROM save_planets WHERE id = ?",
        planet.id,
      );
      loaded.fullPlanetIds.add(planet.id);
      loaded.planetVersions.set(planet.id, row?.version ?? 1);
      loaded.fingerprints.set(key, next);
      continue;
    }
    if (previous === next) continue;
    const version = (loaded.planetVersions.get(planet.id) ?? 0) + 1;
    await bump(
      db,
      `UPDATE save_planets SET owner_id = ?, galaxy = ?, system = ?, slot = ?, kind = ?, doc = ?, version = ?
       WHERE id = ? AND version = ?`,
      [
        planet.ownerPlayerId || "",
        planet.coords.galaxy,
        planet.coords.system,
        planet.coords.slot,
        planet.kind ?? "planet",
        JSON.stringify(planet),
        version,
        planet.id,
        version - 1,
      ],
    );
    loaded.planetVersions.set(planet.id, version);
    loaded.fingerprints.set(key, next);
  }

  const liveFleets = new Set(Object.keys(universe.fleets ?? {}));
  for (const [id, version] of loaded.fleetVersions) {
    if (liveFleets.has(id)) continue;
    await bump(db, "DELETE FROM save_fleets WHERE id = ? AND version = ?", [id, version]);
    loaded.fleetVersions.delete(id);
  }
  for (const fleet of Object.values(universe.fleets ?? {})) {
    const key = `fleet:${fleet.id}`;
    const next = stable(fleet);
    const previous = loaded.fingerprints.get(key);
    if (previous === undefined) {
      await run(
        db,
        "INSERT INTO save_fleets (id, owner_id, target_owner_id, version, doc) VALUES (?, ?, ?, 1, ?)",
        fleet.id,
        fleet.ownerPlayerId,
        fleet.targetPlayerId || "",
        JSON.stringify(fleet),
      );
      loaded.fleetVersions.set(fleet.id, 1);
      loaded.fingerprints.set(key, next);
      continue;
    }
    if (previous === next) continue;
    const version = (loaded.fleetVersions.get(fleet.id) ?? 0) + 1;
    await bump(
      db,
      `UPDATE save_fleets SET owner_id = ?, target_owner_id = ?, doc = ?, version = ?
       WHERE id = ? AND version = ?`,
      [
        fleet.ownerPlayerId,
        fleet.targetPlayerId || "",
        JSON.stringify(fleet),
        version,
        fleet.id,
        version - 1,
      ],
    );
    loaded.fleetVersions.set(fleet.id, version);
    loaded.fingerprints.set(key, next);
  }

  const drafts = messageDrafts(universe);
  const liveMessages = new Set(drafts.map((row) => row.id));
  for (const [id, version] of loaded.messageVersions) {
    if (liveMessages.has(id)) continue;
    await bump(db, "DELETE FROM save_messages WHERE id = ? AND version = ?", [id, version]);
    loaded.messageVersions.delete(id);
  }
  for (const row of drafts) {
    const key = `message:${row.id}`;
    const next = JSON.stringify(row.doc);
    const previous = loaded.fingerprints.get(key);
    if (previous === undefined) {
      await run(
        db,
        "INSERT INTO save_messages (id, owner_id, defender_id, kind, version, doc) VALUES (?, ?, ?, ?, 1, ?)",
        row.id,
        row.owner,
        row.defender,
        row.kind,
        next,
      );
      loaded.messageVersions.set(row.id, 1);
      loaded.fingerprints.set(key, next);
      continue;
    }
    if (previous === next) continue;
    const version = (loaded.messageVersions.get(row.id) ?? 0) + 1;
    await bump(
      db,
      `UPDATE save_messages SET owner_id = ?, defender_id = ?, kind = ?, doc = ?, version = ?
       WHERE id = ? AND version = ?`,
      [row.owner, row.defender, row.kind, next, version, row.id, version - 1],
    );
    loaded.messageVersions.set(row.id, version);
    loaded.fingerprints.set(key, next);
  }

  for (const row of systemDrafts(universe)) {
    const key = `${row.galaxy}:${row.system}`;
    const next = stable({ asteroids: row.asteroids, debris: row.debris });
    const previous = loaded.fingerprints.get(`system:${key}`);
    if (previous === undefined || loaded.systemVersions.get(key) === 0) {
      await upsertSystem(db, row);
      loaded.systemVersions.set(key, 1);
      loaded.fingerprints.set(`system:${key}`, next);
      continue;
    }
    if (previous === next) continue;
    const version = (loaded.systemVersions.get(key) ?? 0) + 1;
    await bump(
      db,
      `UPDATE save_systems SET asteroids = ?, debris = ?, version = ?
       WHERE galaxy = ? AND system = ? AND version = ?`,
      [
        JSON.stringify(row.asteroids),
        JSON.stringify(row.debris),
        version,
        row.galaxy,
        row.system,
        version - 1,
      ],
    );
    loaded.systemVersions.set(key, version);
    loaded.fingerprints.set(`system:${key}`, next);
  }

  if (rebuildScores) {
    await writeHighscoreCache(db, highscoresBoard(universe), Date.now());
  }
}

async function readBoard(db: D1Like): Promise<{ builtAt: number; rows: HighscoreEntry[] } | null> {
  const row = await first<{ built_at: number; doc: string }>(
    db,
    "SELECT built_at, doc FROM save_highscores WHERE id = 'board'",
  );
  if (!row) return null;
  return { builtAt: row.built_at, rows: JSON.parse(row.doc) as HighscoreEntry[] };
}

async function resolvePlayerIds(db: D1Like, work: UniverseWork | undefined): Promise<string[]> {
  const ids = new Set((work?.playerIds ?? []).filter(Boolean) as string[]);
  for (const planetId of work?.planetIds ?? []) {
    if (!planetId) continue;
    const row = await first<{ owner_id: string }>(
      db,
      "SELECT owner_id FROM save_planets WHERE id = ?",
      planetId,
    );
    if (row?.owner_id) ids.add(row.owner_id);
  }
  if (work?.lockSystemOwners && work.galaxy && work.system) {
    const rows = await all<{ owner_id: string }>(
      db,
      "SELECT owner_id FROM save_planets WHERE galaxy = ? AND system = ? AND owner_id != ''",
      work.galaxy,
      work.system,
    );
    for (const row of rows) ids.add(row.owner_id);
  }
  if (work?.galaxy && work.system && work.slot) {
    const row = await first<{ owner_id: string }>(
      db,
      "SELECT owner_id FROM save_planets WHERE galaxy = ? AND system = ? AND slot = ? AND owner_id != ''",
      work.galaxy,
      work.system,
      work.slot,
    );
    if (row?.owner_id) ids.add(row.owner_id);
  }
  return [...ids].sort();
}

function changed(loaded: LoadedRows): boolean {
  const universe = loaded.universe;
  if (stable(worldDoc({ ...universe, skipNpcRaids: undefined })) !== loaded.fingerprints.get("world")) {
    return true;
  }
  for (const player of Object.values(universe.players)) {
    if (stable(playerDoc(player)) !== loaded.fingerprints.get(`player:${player.id}`)) return true;
  }
  for (const planet of Object.values(universe.planets)) {
    if (loaded.stubPlanetIds.has(planet.id)) continue;
    if (stable(planet) !== loaded.fingerprints.get(`planet:${planet.id}`)) return true;
  }
  for (const fleet of Object.values(universe.fleets ?? {})) {
    if (stable(fleet) !== loaded.fingerprints.get(`fleet:${fleet.id}`)) return true;
  }
  for (const row of messageDrafts(universe)) {
    if (JSON.stringify(row.doc) !== loaded.fingerprints.get(`message:${row.id}`)) return true;
  }
  if (messageDrafts(universe).length !== loaded.messageVersions.size) return true;
  if (Object.keys(universe.fleets ?? {}).length !== loaded.fleetVersions.size) return true;
  for (const row of systemDrafts(universe)) {
    const key = `${row.galaxy}:${row.system}`;
    const next = stable({ asteroids: row.asteroids, debris: row.debris });
    if (next !== loaded.fingerprints.get(`system:${key}`)) return true;
  }
  return false;
}

async function attachBoard(db: D1Like, work: UniverseWork | undefined): Promise<void> {
  const scope = currentScope();
  if (!scope) return;
  scope.rowSave = true;
  const board = await readBoard(db);
  if (work?.maintenance && (!board || highscoreCacheExpired(board.builtAt))) {
    scope.highscores = undefined;
    return;
  }
  scope.highscores = board?.rows ?? [];
}

async function runGame<T>(
  universe: UniverseState,
  fn: (universe: UniverseState) => T | Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    return await fn(universe);
  } finally {
    addCpu(performance.now() - started);
  }
}

/**
 * Writes lock the named players (or the world, when the action is global)
 * and reject a stale row version. Reads never wait on a lock.
 */
export async function withRowUniverse<T>(
  db: D1Like,
  kv: KvStore | null,
  fn: (universe: UniverseState) => T | Promise<T>,
  work: UniverseWork | undefined,
  wait: boolean,
): Promise<T> {
  await ensureRowTables(db);
  if (!(await migrationDone(db))) {
    throw new Error("Row save is not migrated.");
  }
  const playerIds = await resolvePlayerIds(db, work);
  const locks =
    work?.maintenance || work?.catalog || playerIds.length === 0
      ? ["__world__"]
      : playerIds;
  const runOnce = async () => {
    const loaded = await loadWorkingSet(db, {
      ...work,
      playerIds: playerIds.length ? playerIds : work?.playerIds,
    });
    await attachBoard(db, work);
    const result = await runGame(loaded.universe, fn);
    if (!changed(loaded)) return result;
    if (!kv || !(await acquireLocks(kv, locks, false))) return result;
    try {
      await saveWorkingSet(db, loaded, false);
      return result;
    } catch (err) {
      if (!(err instanceof RowStaleError)) throw err;
      return result;
    } finally {
      await releaseLocks(kv, locks);
    }
  };

  if (wait) {
    if (!kv) throw new Error("Row save needs the kv lock table.");
    if (!(await acquireLocks(kv, locks, true))) {
      throw new Error("Universe busy — retry in a moment.");
    }
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const loaded = await loadWorkingSet(db, {
            ...work,
            playerIds: playerIds.length ? playerIds : work?.playerIds,
          });
          await attachBoard(db, work);
          const result = await runGame(loaded.universe, fn);
          const board = await readBoard(db);
          const scoresDue =
            Boolean(work?.maintenance) &&
            (!board || highscoreCacheExpired(board.builtAt));
          await saveWorkingSet(db, loaded, scoresDue);
          return result;
        } catch (err) {
          if (!(err instanceof RowStaleError) || attempt === 3) throw err;
        }
      }
      throw new RowStaleError();
    } finally {
      await releaseLocks(kv, locks);
    }
  }
  return runOnce();
}

export async function readHighscoreMeta(
  db: D1Like,
): Promise<{ builtAt: number; rows: number } | null> {
  const board = await readBoard(db);
  if (!board) return null;
  return { builtAt: board.builtAt, rows: board.rows.length };
}

export { STAGES };
