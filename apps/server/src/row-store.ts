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
  UNIVERSE_SCHEMA_VERSION,
} from "@starhold/game";
import type { D1Like, D1Stmt } from "./d1-store.js";
import { chunkKey, splitChunkText } from "./d1-codec.js";
import type { KvStore } from "./kv.js";
import { addCpu, currentScope } from "./request-context.js";
import { sliceStamps, splitUniverse, type SliceStamps } from "./universe-docs.js";

export const HIGHSCORE_TTL_MS = 30 * 60 * 1000;
export const ROW_LOCK_MS = 2_500;
const CHUNK = 25;
/** D1 rejects a compound SELECT with 6 or more terms. Keep every multi-row write at or under 5. */
const SQL_ROWS = 5;

export class RowStaleError extends Error {
  constructor() {
    super("Row changed — retrying.");
    this.name = "RowStaleError";
  }
}

/** A mutation could not take its locks. Routes turn this into 503, not a 500. */
export class UniverseBusyError extends Error {
  readonly code = "busy" as const;
  constructor() {
    super("Universe busy — retry in a moment.");
    this.name = "UniverseBusyError";
  }
}

/** The isolate was killed. The lock is left for its TTL and the batch is not retried. */
export class SaveKilledError extends Error {
  constructor() {
    super("Worker killed before the request finished.");
    this.name = "SaveKilledError";
  }
}

let saveAbort: "before-commit" | "after-commit" | null = null;

/** Test hook. Production never sets this. */
export function setSaveAbortForTests(next: "before-commit" | "after-commit" | null): void {
  saveAbort = next;
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
  /** Cron: every owned planet, refresh highscores when due. Does not raid. */
  maintenance?: boolean;
  /** 10-minute cron: pirate and alien catch-up. Page loads leave this unset. */
  npc?: boolean;
  /** Rollback: every planet, fleet, message, and system. */
  full?: boolean;
  /** Systems to load besides the caller's home and the open galaxy. */
  extraSystems?: Array<[number, number]>;
}

interface MigrateState {
  v: number;
  stage: string;
  cursor: string;
  /** 0 copies once. 1 recopies. The seal pass is the last one and cannot be restarted. */
  pass: number;
  seen: string;
  /** Legacy writes during this pass are mirrored into rows so the copy can finish. */
  seal?: boolean;
}

interface SystemRow {
  galaxy: number;
  system: number;
  version: number;
  asteroids: Record<string, AsteroidField>;
  debris: Record<string, DebrisField>;
}

interface SystemWrite {
  galaxy: number;
  system: number;
  /** 0 means the row is not stored yet. */
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
  /** Queried by id and absent, so a fleet delete is real. */
  absentPlanetIds: Set<string>;
  loadedSystemKeys: Set<string>;
  fleetSnapshots: Map<string, FleetMission>;
  pendingSystems: SystemWrite[];
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
  `CREATE TABLE IF NOT EXISTS save_assert (ok INTEGER NOT NULL CHECK (ok = 1))`,
];

const OMIT_KEYS = new Set([
  "resources",
  "lastTickAt",
  "lastAiSimAt",
  "remainingSeconds",
  "skipNpcRaids",
  "skipPirateTopUp",
]);

const parseJson = JSON.parse;
const stringifyJson = JSON.stringify;

function timedParse<T>(text: string): T {
  const started = performance.now();
  try {
    return parseJson(text) as T;
  } finally {
    addCpu(performance.now() - started);
  }
}

function timedStringify(value: unknown): string {
  const started = performance.now();
  try {
    return stringifyJson(value);
  } finally {
    addCpu(performance.now() - started);
  }
}

function stable(value: unknown): string {
  const started = performance.now();
  try {
    return stringifyJson(value, (key, inner) => {
      if (OMIT_KEYS.has(key)) return undefined;
      // A quiet tick writes swarmProduce: null onto fleets that never had a job.
      if (key === "swarmProduce" && inner == null) return undefined;
      return inner;
    });
  } finally {
    addCpu(performance.now() - started);
  }
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

const schemaReady = new WeakSet<object>();
const migrationReady = new WeakSet<object>();
/** After a done check, skip D1 until this time. One re-check per minute per database. */
const migrationFreshUntil = new WeakMap<object, number>();
const MIGRATION_RECHECK_MS = 60_000;
let migrationNow = (): number => Date.now();

/** Test hook. Production uses Date.now. */
export function setMigrationClockForTests(next: (() => number) | null): void {
  migrationNow = next ?? (() => Date.now());
}

export async function ensureRowTables(db: D1Like): Promise<void> {
  if (schemaReady.has(db)) return;
  await db.batch(TABLE_SQL.map((sql) => db.prepare(sql).bind()));
  schemaReady.add(db);
}

async function readMigrate(db: D1Like): Promise<MigrateState> {
  const row = await first<{ value: string }>(
    db,
    "SELECT value FROM save_meta WHERE id = ?",
    "migration",
  );
  if (!row) return { v: 0, stage: "world", cursor: "", pass: 0, seen: "" };
  try {
    const parsed = timedParse(row.value) as MigrateState;
    return {
      v: parsed.v ?? 0,
      stage: parsed.stage || "world",
      cursor: parsed.cursor || "",
      pass: parsed.pass ?? 0,
      seen: parsed.seen ?? "",
      seal: Boolean(parsed.seal),
    };
  } catch {
    return { v: 0, stage: "world", cursor: "", pass: 0, seen: "" };
  }
}

async function writeMigrate(db: D1Like, state: MigrateState): Promise<void> {
  await run(
    db,
    "INSERT INTO save_meta (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
    "migration",
    timedStringify(state),
  );
}

export async function migrationDone(db: D1Like): Promise<boolean> {
  const freshUntil = migrationFreshUntil.get(db);
  if (freshUntil != null && migrationNow() < freshUntil) return true;
  if (migrationReady.has(db) && freshUntil == null) {
    migrationFreshUntil.set(db, migrationNow() + MIGRATION_RECHECK_MS);
    return true;
  }
  await ensureRowTables(db);
  const state = await readMigrate(db);
  if (state.v >= 1) {
    migrationReady.add(db);
    migrationFreshUntil.set(db, migrationNow() + MIGRATION_RECHECK_MS);
    return true;
  }
  migrationReady.delete(db);
  migrationFreshUntil.delete(db);
  return false;
}

/** Another copy, used when the legacy document changed during the last pass. */
export async function rewindMigration(db: D1Like, seen: string): Promise<void> {
  migrationReady.delete(db);
  migrationFreshUntil.delete(db);
  await writeMigrate(db, { v: 0, stage: "world", cursor: "", pass: 1, seen });
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
  delete doc.skipPirateTopUp;
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

function queue(db: D1Like, stmts: D1Stmt[], sql: string, values: unknown[]): void {
  stmts.push(bind(db, sql, values));
}

function queueWorld(db: D1Like, stmts: D1Stmt[], universe: UniverseState): void {
  queue(
    db,
    stmts,
    `INSERT INTO save_world (id, version, doc) VALUES ('world', 2, ?)
     ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, version = excluded.version
     WHERE save_world.version <= excluded.version`,
    [timedStringify(worldDoc(universe))],
  );
}

function queuePlayer(db: D1Like, stmts: D1Stmt[], player: PlayerState): void {
  queue(
    db,
    stmts,
    `INSERT INTO save_players (id, version, doc) VALUES (?, 2, ?)
     ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, version = excluded.version
     WHERE save_players.version <= excluded.version`,
    [player.id, timedStringify(playerDoc(player))],
  );
}

function queuePlanet(db: D1Like, stmts: D1Stmt[], planet: PlanetState): void {
  queue(
    db,
    stmts,
    `INSERT INTO save_planets (id, owner_id, galaxy, system, slot, kind, version, doc)
     VALUES (?, ?, ?, ?, ?, ?, 2, ?)
     ON CONFLICT(id) DO UPDATE SET
       owner_id = excluded.owner_id, galaxy = excluded.galaxy, system = excluded.system,
       slot = excluded.slot, kind = excluded.kind, doc = excluded.doc, version = excluded.version
     WHERE save_planets.version <= excluded.version`,
    [
      planet.id,
      planet.ownerPlayerId || "",
      planet.coords.galaxy,
      planet.coords.system,
      planet.coords.slot,
      planet.kind ?? "planet",
      timedStringify(planet),
    ],
  );
}

function queueFleet(db: D1Like, stmts: D1Stmt[], fleet: FleetMission): void {
  queue(
    db,
    stmts,
    `INSERT INTO save_fleets (id, owner_id, target_owner_id, version, doc)
     VALUES (?, ?, ?, 2, ?)
     ON CONFLICT(id) DO UPDATE SET
       owner_id = excluded.owner_id, target_owner_id = excluded.target_owner_id,
       doc = excluded.doc, version = excluded.version
     WHERE save_fleets.version <= excluded.version`,
    [fleet.id, fleet.ownerPlayerId, fleet.targetPlayerId || "", timedStringify(fleet)],
  );
}

function queueMessage(db: D1Like, stmts: D1Stmt[], row: MessageDraft): void {
  queue(
    db,
    stmts,
    `INSERT INTO save_messages (id, owner_id, defender_id, kind, version, doc)
     VALUES (?, ?, ?, ?, 2, ?)
     ON CONFLICT(id) DO UPDATE SET
       owner_id = excluded.owner_id, defender_id = excluded.defender_id,
       kind = excluded.kind, doc = excluded.doc, version = excluded.version
     WHERE save_messages.version <= excluded.version`,
    [row.id, row.owner, row.defender, row.kind, timedStringify(row.doc)],
  );
}

function queueSystem(db: D1Like, stmts: D1Stmt[], row: SystemRow): void {
  queue(
    db,
    stmts,
    `INSERT INTO save_systems (galaxy, system, version, asteroids, debris)
     VALUES (?, ?, 2, ?, ?)
     ON CONFLICT(galaxy, system) DO UPDATE SET
       asteroids = excluded.asteroids, debris = excluded.debris, version = excluded.version
     WHERE save_systems.version <= excluded.version`,
    [row.galaxy, row.system, timedStringify(row.asteroids), timedStringify(row.debris)],
  );
}

function changedStampIds(before: Record<string, string>, after: Record<string, string>): string[] {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...ids].filter((id) => before[id] !== after[id]).sort();
}

function unownedPlanets(universe: UniverseState): PlanetState[] {
  return Object.values(universe.planets).filter((planet) => {
    const owner = planet.ownerPlayerId;
    return !owner || !universe.players[owner];
  });
}

function sameJson(left: unknown, right: unknown): boolean {
  return stable(left) === stable(right);
}

function queuePlayerMirror(db: D1Like, stmts: D1Stmt[], universe: UniverseState, id: string): void {
  queue(db, stmts, "DELETE FROM save_planets WHERE owner_id = ? AND version <= 2", [id]);
  queue(db, stmts, "DELETE FROM save_fleets WHERE owner_id = ? AND version <= 2", [id]);
  queue(db, stmts, "DELETE FROM save_messages WHERE owner_id = ? AND version <= 2", [id]);
  const player = universe.players[id];
  if (!player) {
    queue(db, stmts, "DELETE FROM save_players WHERE id = ? AND version <= 2", [id]);
    return;
  }
  queuePlayer(db, stmts, player);
  for (const planet of Object.values(universe.planets)) {
    if (planet.ownerPlayerId === id) queuePlanet(db, stmts, planet);
  }
  for (const fleet of Object.values(universe.fleets ?? {})) {
    if (fleet.ownerPlayerId === id) queueFleet(db, stmts, fleet);
  }
  for (const row of messageDrafts(universe)) {
    if (row.owner === id) queueMessage(db, stmts, row);
  }
}

async function queueSystemMirror(
  db: D1Like,
  stmts: D1Stmt[],
  universe: UniverseState,
  previous: UniverseState | null,
): Promise<void> {
  const next = new Map(systemDrafts(universe).map((row) => [`${row.galaxy}:${row.system}`, row]));
  if (previous) {
    const prior = new Map(systemDrafts(previous).map((row) => [`${row.galaxy}:${row.system}`, row]));
    for (const [key, row] of prior) {
      const live = next.get(key);
      if (!live) {
        queue(db, stmts, "DELETE FROM save_systems WHERE galaxy = ? AND system = ? AND version <= 2", [row.galaxy, row.system]);
      } else if (!sameJson(live.asteroids, row.asteroids) || !sameJson(live.debris, row.debris)) {
        queueSystem(db, stmts, live);
      }
      next.delete(key);
    }
    for (const row of next.values()) queueSystem(db, stmts, row);
    return;
  }
  const stored = await all<{ galaxy: number; system: number; asteroids: string; debris: string }>(
    db,
    "SELECT galaxy, system, asteroids, debris FROM save_systems",
  );
  const seen = new Set<string>();
  for (const row of stored) {
    const key = `${row.galaxy}:${row.system}`;
    seen.add(key);
    const live = next.get(key);
    if (!live) {
      queue(db, stmts, "DELETE FROM save_systems WHERE galaxy = ? AND system = ? AND version <= 2", [row.galaxy, row.system]);
      continue;
    }
    let asteroids: unknown = {};
    let debris: unknown = {};
    try {
      asteroids = timedParse(row.asteroids);
      debris = timedParse(row.debris);
    } catch {
      asteroids = null;
    }
    if (!sameJson(live.asteroids, asteroids) || !sameJson(live.debris, debris)) {
      queueSystem(db, stmts, live);
    }
  }
  for (const [key, row] of next) {
    if (!seen.has(key)) queueSystem(db, stmts, row);
  }
}

async function queueUnownedPlanets(
  db: D1Like,
  stmts: D1Stmt[],
  universe: UniverseState,
  previous: UniverseState | null,
): Promise<void> {
  const next = new Map(unownedPlanets(universe).map((planet) => [planet.id, planet]));
  if (previous) {
    for (const planet of unownedPlanets(previous)) {
      const live = next.get(planet.id);
      if (!live) queue(db, stmts, "DELETE FROM save_planets WHERE id = ? AND version <= 2", [planet.id]);
      else if (!sameJson(live, planet)) queuePlanet(db, stmts, live);
      next.delete(planet.id);
    }
    for (const planet of next.values()) queuePlanet(db, stmts, planet);
    return;
  }
  const stored = await all<{ id: string; doc: string }>(
    db,
    "SELECT id, doc FROM save_planets WHERE owner_id = ''",
  );
  const seen = new Set<string>();
  for (const row of stored) {
    seen.add(row.id);
    const live = next.get(row.id);
    if (!live) {
      queue(db, stmts, "DELETE FROM save_planets WHERE id = ? AND version <= 2", [row.id]);
      continue;
    }
    let parsed: unknown = null;
    try {
      parsed = timedParse(row.doc);
    } catch {
      parsed = null;
    }
    if (!sameJson(live, parsed)) queuePlanet(db, stmts, live);
  }
  for (const [id, planet] of next) {
    if (!seen.has(id)) queuePlanet(db, stmts, planet);
  }
}

/**
 * Version-2 upserts for the rows this request actually changed.
 * One batch, so it is one D1 subrequest. Unchanged rows stay put:
 * a later version-1 chunk cannot overwrite version 2.
 */
async function writeMirror(
  db: D1Like,
  universe: UniverseState,
  before: SliceStamps,
  after: SliceStamps,
  previous: UniverseState | null,
): Promise<void> {
  const worldChanged = before.world !== after.world;
  const piratesChanged = before.pirates !== after.pirates;
  const aliensChanged = before.aliens !== after.aliens;
  const asteroidsChanged = before.asteroids !== after.asteroids;
  const players = changedStampIds(before.players, after.players);
  if (!worldChanged && !piratesChanged && !aliensChanged && !asteroidsChanged && !players.length) {
    return;
  }
  await ensureRowTables(db);
  const stmts: D1Stmt[] = [];
  if (worldChanged || piratesChanged || aliensChanged) queueWorld(db, stmts, universe);
  for (const id of players) queuePlayerMirror(db, stmts, universe, id);
  if (worldChanged || asteroidsChanged) await queueSystemMirror(db, stmts, universe, previous);
  if (worldChanged) await queueUnownedPlanets(db, stmts, universe, previous);
  if (stmts.length) await db.batch(stmts);
}

/** Diff two legacy snapshots and copy only that diff. One batch. */
export async function mirrorDelta(
  db: D1Like,
  previous: UniverseState,
  universe: UniverseState,
): Promise<void> {
  await writeMirror(db, universe, sliceStamps(previous), sliceStamps(universe), previous);
}

/**
 * The copy just reached v1, but the legacy version moved while that chunk ran.
 * Mirror the gap. If the mirror fails, reopen the seal so the next request
 * retries instead of serving rows that missed the write.
 */
export async function mirrorFreshIfVersionMoved(
  db: D1Like,
  legacy: UniverseState,
  fresh: UniverseState,
  sourceVersion: string,
  versionAfter: string,
): Promise<void> {
  if (versionAfter === sourceVersion) return;
  try {
    await mirrorDelta(db, legacy, fresh);
  } catch (err) {
    migrationReady.delete(db);
    migrationFreshUntil.delete(db);
    await writeMigrate(db, {
      v: 0,
      stage: "scores",
      cursor: "",
      pass: 1,
      seen: sourceVersion,
      seal: true,
    });
    throw err;
  }
}

/** While the last migration pass is running, a legacy save must also land in the rows. */
export async function legacyMirrorIfSealed(
  db: D1Like,
  universe: UniverseState,
  before: SliceStamps,
  after: SliceStamps,
): Promise<void> {
  const state = await readMigrate(db);
  if (!state.seal || state.v >= 1) return;
  await writeMirror(db, universe, before, after, null);
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
    timedStringify(rows),
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

function systemCursor(galaxy: number, system: number): string {
  return `${String(galaxy).padStart(4, "0")}:${String(system).padStart(4, "0")}`;
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function bind(db: D1Like, sql: string, values: unknown[]): D1Stmt {
  return db.prepare(sql).bind(...values);
}

/**
 * Copy one slice of `universe` into the row tables.
 * Safe to call again. System order is galaxy, then system, not string order.
 * The first pass copies. The next pass copies again so a write that landed
 * on the old save after a section was copied is kept. Then v becomes 1.
 * One meta write per call. The kv document is not written.
 */
export async function migrateChunk(
  db: D1Like,
  universe: UniverseState,
  limit = CHUNK,
  stopAfter?: number,
  sourceVersion?: string,
): Promise<{ done: boolean; stage: string }> {
  await ensureRowTables(db);
  const state = await readMigrate(db);
  if (state.v >= 1) {
    migrationReady.add(db);
    return { done: true, stage: "done" };
  }
  const playerIds = Object.keys(universe.players).sort();
  const planetIds = Object.keys(universe.planets).sort();
  const fleetIds = Object.keys(universe.fleets ?? {}).sort();
  const messages = messageDrafts(universe);
  const systems = systemDrafts(universe);
  const stmts: D1Stmt[] = [];
  let writes = 0;
  const room = () => writes < limit && (stopAfter == null || writes < stopAfter);
  const push = (sql: string, values: unknown[]) => {
    stmts.push(bind(db, sql, values));
    writes += 1;
  };

  while (room()) {
    if (state.stage === "world") {
      push(
        `INSERT INTO save_world (id, version, doc) VALUES ('world', 1, ?)
         ON CONFLICT(id) DO UPDATE SET doc = excluded.doc
         WHERE save_world.version <= excluded.version`,
        [timedStringify(worldDoc(universe))],
      );
      state.stage = "players";
      state.cursor = "";
      continue;
    }
    if (state.stage === "players") {
      const next = playerIds.find((id) => id > state.cursor);
      if (!next) {
        state.stage = "planets";
        state.cursor = "";
        continue;
      }
      push(
        `INSERT INTO save_players (id, version, doc) VALUES (?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET doc = excluded.doc
         WHERE save_players.version <= excluded.version`,
        [next, timedStringify(playerDoc(universe.players[next]!))],
      );
      state.cursor = next;
      continue;
    }
    if (state.stage === "planets") {
      const next = planetIds.find((id) => id > state.cursor);
      if (!next) {
        state.stage = "fleets";
        state.cursor = "";
        continue;
      }
      const planet = universe.planets[next]!;
      push(
        `INSERT INTO save_planets (id, owner_id, galaxy, system, slot, kind, version, doc)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET
           owner_id = excluded.owner_id, galaxy = excluded.galaxy, system = excluded.system,
           slot = excluded.slot, kind = excluded.kind, doc = excluded.doc
         WHERE save_planets.version <= excluded.version`,
        [
          planet.id,
          planet.ownerPlayerId || "",
          planet.coords.galaxy,
          planet.coords.system,
          planet.coords.slot,
          planet.kind ?? "planet",
          timedStringify(planet),
        ],
      );
      state.cursor = next;
      continue;
    }
    if (state.stage === "fleets") {
      const next = fleetIds.find((id) => id > state.cursor);
      if (!next) {
        state.stage = "messages";
        state.cursor = "";
        continue;
      }
      const fleet = universe.fleets[next]!;
      push(
        `INSERT INTO save_fleets (id, owner_id, target_owner_id, version, doc)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET
           owner_id = excluded.owner_id, target_owner_id = excluded.target_owner_id, doc = excluded.doc
         WHERE save_fleets.version <= excluded.version`,
        [fleet.id, fleet.ownerPlayerId, fleet.targetPlayerId || "", timedStringify(fleet)],
      );
      state.cursor = next;
      continue;
    }
    if (state.stage === "messages") {
      const next = messages.find((row) => row.id > state.cursor);
      if (!next) {
        state.stage = "systems";
        state.cursor = "";
        continue;
      }
      push(
        `INSERT INTO save_messages (id, owner_id, defender_id, kind, version, doc)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET
           owner_id = excluded.owner_id, defender_id = excluded.defender_id,
           kind = excluded.kind, doc = excluded.doc
         WHERE save_messages.version <= excluded.version`,
        [next.id, next.owner, next.defender, next.kind, timedStringify(next.doc)],
      );
      state.cursor = next.id;
      continue;
    }
    if (state.stage === "systems") {
      const next = systems.find((row) => systemCursor(row.galaxy, row.system) > state.cursor);
      if (!next) {
        state.stage = "scores";
        state.cursor = "";
        continue;
      }
      push(
        `INSERT INTO save_systems (galaxy, system, version, asteroids, debris)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(galaxy, system) DO UPDATE SET
           asteroids = excluded.asteroids, debris = excluded.debris
         WHERE save_systems.version <= excluded.version`,
        [next.galaxy, next.system, timedStringify(next.asteroids), timedStringify(next.debris)],
      );
      state.cursor = systemCursor(next.galaxy, next.system);
      continue;
    }
    if (state.stage === "scores") {
      push(
        `INSERT INTO save_highscores (id, built_at, doc) VALUES ('board', ?, ?)
         ON CONFLICT(id) DO UPDATE SET built_at = excluded.built_at, doc = excluded.doc`,
        [Date.now(), timedStringify(highscoresBoard(universe))],
      );
      if (state.pass < 1) {
        state.pass = 1;
        state.stage = "world";
        state.cursor = "";
        state.seen = sourceVersion ?? "";
      } else if (!state.seal && sourceVersion != null && sourceVersion !== state.seen) {
        state.seal = true;
        state.pass += 1;
        state.stage = "world";
        state.cursor = "";
        state.seen = sourceVersion;
      } else {
        state.v = 1;
        state.stage = "done";
        state.cursor = "";
        state.seal = false;
      }
      break;
    }
    break;
  }

  stmts.push(
    bind(
      db,
      "INSERT INTO save_meta (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
      ["migration", timedStringify(state)],
    ),
  );
  await db.batch(stmts);
  if (state.v >= 1) migrationReady.add(db);
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
    const player = timedParse(row.doc) as PlayerState;
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
  expectIds?: string[],
): Promise<void> {
  if (!sql) return;
  const rows = await all<{ id: string; version: number; doc: string }>(db, sql, ...values);
  for (const row of rows) {
    if (into.fullPlanetIds.has(row.id)) continue;
    const planet = timedParse(row.doc) as PlanetState;
    into.universe.planets[planet.id] = planet;
    into.planetVersions.set(planet.id, row.version);
    into.fullPlanetIds.add(planet.id);
    into.stubPlanetIds.delete(planet.id);
    into.absentPlanetIds.delete(planet.id);
    into.fingerprints.set(`planet:${planet.id}`, stable(planet));
  }
  if (expectIds) {
    for (const id of expectIds) {
      if (!into.fullPlanetIds.has(id)) into.absentPlanetIds.add(id);
    }
  }
}

async function loadFleets(db: D1Like, into: LoadedRows, where: string, values: unknown[]): Promise<void> {
  const rows = await all<{ id: string; version: number; doc: string }>(
    db,
    `SELECT id, version, doc FROM save_fleets ${where}`,
    ...values,
  );
  for (const row of rows) {
    const fleet = timedParse(row.doc) as FleetMission;
    into.universe.fleets[fleet.id] = fleet;
    into.fleetVersions.set(fleet.id, row.version);
    into.fleetSnapshots.set(fleet.id, structuredClone(fleet));
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
    const doc = timedParse(row.doc) as { id: string };
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

function applySystemRow(
  into: LoadedRows,
  galaxy: number,
  system: number,
  version: number,
  asteroids: Record<string, AsteroidField>,
  debris: Record<string, DebrisField>,
): void {
  const key = `${galaxy}:${system}`;
  into.systemVersions.set(key, version);
  into.loadedSystemKeys.add(key);
  Object.assign(into.universe.asteroids!, asteroids);
  Object.assign(into.universe.debris!, debris);
  into.fingerprints.set(`system:${key}`, stable({ asteroids, debris }));
}

async function loadSystems(db: D1Like, into: LoadedRows, pairs: Array<[number, number]>): Promise<void> {
  const pending = pairs.filter(([galaxy, system]) => !into.systemVersions.has(`${galaxy}:${system}`));
  for (const group of chunkRows(pending, 40)) {
    const clause = group.map(() => "(galaxy = ? AND system = ?)").join(" OR ");
    const values = group.flatMap(([galaxy, system]) => [galaxy, system]);
    const rows = await all<{
      galaxy: number;
      system: number;
      version: number;
      asteroids: string;
      debris: string;
    }>(
      db,
      `SELECT galaxy, system, version, asteroids, debris FROM save_systems WHERE ${clause}`,
      ...values,
    );
    const byKey = new Map(rows.map((row) => [`${row.galaxy}:${row.system}`, row]));
    for (const [galaxy, system] of group) {
      const row = byKey.get(`${galaxy}:${system}`);
      applySystemRow(
        into,
        galaxy,
        system,
        row?.version ?? 0,
        row ? (timedParse(row.asteroids) as Record<string, AsteroidField>) : {},
        row ? (timedParse(row.debris) as Record<string, DebrisField>) : {},
      );
    }
  }
}

async function loadAllSystems(db: D1Like, into: LoadedRows): Promise<void> {
  const rows = await all<{
    galaxy: number;
    system: number;
    version: number;
    asteroids: string;
    debris: string;
  }>(db, "SELECT galaxy, system, version, asteroids, debris FROM save_systems");
  for (const row of rows) {
    applySystemRow(
      into,
      row.galaxy,
      row.system,
      row.version,
      timedParse(row.asteroids) as Record<string, AsteroidField>,
      timedParse(row.debris) as Record<string, DebrisField>,
    );
  }
}

async function loadPlanetsAt(
  db: D1Like,
  into: LoadedRows,
  pairs: Array<[number, number]>,
): Promise<void> {
  for (const group of chunkRows(pairs, 40)) {
    const clause = group.map(() => "(galaxy = ? AND system = ?)").join(" OR ");
    const values = group.flatMap(([galaxy, system]) => [galaxy, system]);
    await loadPlanetDocs(
      db,
      into,
      `SELECT id, version, doc FROM save_planets WHERE ${clause}`,
      values,
    );
  }
}

function inList(ids: string[]): { clause: string; values: string[] } {
  return { clause: ids.map(() => "?").join(", "), values: ids };
}

function systemPairs(planets: Iterable<PlanetState>): Array<[number, number]> {
  const systems = new Map<string, [number, number]>();
  for (const planet of planets) {
    systems.set(`${planet.coords.galaxy}:${planet.coords.system}`, [
      planet.coords.galaxy,
      planet.coords.system,
    ]);
  }
  return [...systems.values()];
}

function pirateSitesNeeded(universe: UniverseState): boolean {
  return Object.values(universe.pirateBases ?? {}).some((base) => base.destroyedAt != null);
}

async function loadOccupancy(db: D1Like, loaded: LoadedRows): Promise<void> {
  const rows = await all<{
    id: string;
    owner_id: string;
    galaxy: number;
    system: number;
    slot: number;
    kind: string;
  }>(db, "SELECT id, owner_id, galaxy, system, slot, kind FROM save_planets");
  for (const row of rows) {
    if (loaded.fullPlanetIds.has(row.id) || loaded.universe.planets[row.id]) continue;
    loaded.universe.planets[row.id] = stubPlanet(row);
    loaded.stubPlanetIds.add(row.id);
  }
}

export async function loadWorkingSet(db: D1Like, work: UniverseWork | undefined): Promise<LoadedRows> {
  const world = await first<{ version: number; doc: string }>(
    db,
    "SELECT version, doc FROM save_world WHERE id = 'world'",
  );
  if (!world) throw new Error("Row save is missing the world document.");
  const universe = emptyUniverse(timedParse(world.doc) as UniverseState);
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
    absentPlanetIds: new Set(),
    loadedSystemKeys: new Set(),
    fleetSnapshots: new Map(),
    pendingSystems: [],
    fingerprints: new Map([["world", stable(worldDoc(universe))]]),
  };
  await loadPlayers(db, loaded);

  const requestedIds = [...new Set((work?.playerIds ?? []).filter(Boolean))] as string[];
  const planetIds = [...new Set((work?.planetIds ?? []).filter((id): id is string => Boolean(id)))];
  const wide =
    Boolean(work?.maintenance || work?.full) ||
    (requestedIds.length === 0 && !work?.catalog && !work?.npc);

  if (work?.full) {
    await loadPlanetDocs(db, loaded, "SELECT id, version, doc FROM save_planets", []);
    await loadFleets(db, loaded, "", []);
    await loadMessages(db, loaded, "", []);
    await loadAllSystems(db, loaded);
  } else if (work?.npc) {
    await loadPlanetDocs(
      db,
      loaded,
      "SELECT id, version, doc FROM save_planets WHERE owner_id != ''",
      [],
    );
    await loadSystems(db, loaded, systemPairs(Object.values(loaded.universe.planets)));
    // Raids need owned bodies. Placement also needs every occupied slot, below.
  } else if (work?.catalog) {
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
    const systems = systemPairs(Object.values(loaded.universe.planets));
    await loadPlanetsAt(db, loaded, systems);
    await loadFleets(db, loaded, "", []);
    await loadMessages(db, loaded, "", []);
    await loadSystems(db, loaded, systems);
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
        planetIds,
      );
    }
    const systems = new Map<string, [number, number]>();
    if (work?.galaxy && work.system) systems.set(`${work.galaxy}:${work.system}`, [work.galaxy, work.system]);
    for (const pair of work?.extraSystems ?? []) {
      systems.set(`${pair[0]}:${pair[1]}`, pair);
    }
    for (const id of requestedIds) {
      const player = loaded.universe.players[id];
      const home = player ? loaded.universe.planets[player.activePlanetId] ?? loaded.universe.planets[player.homePlanetId] : undefined;
      if (home) systems.set(`${home.coords.galaxy}:${home.coords.system}`, [home.coords.galaxy, home.coords.system]);
    }
    const pairs = [...systems.values()];
    await loadPlanetsAt(db, loaded, pairs);
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
    await loadSystems(db, loaded, pairs);
  }

  if (!work?.npc) loaded.universe.skipNpcRaids = true;
  const placePirates = Boolean(work?.npc) || pirateSitesNeeded(loaded.universe);
  if (placePirates) await loadOccupancy(db, loaded);
  else loaded.universe.skipPirateTopUp = true;
  const now = Date.now();
  if (!work?.npc && !work?.full) {
    if (work?.galaxy && work.system) ensureSystemVisited(loaded.universe, work.galaxy, work.system, now);
    for (const id of requestedIds) {
      const player = loaded.universe.players[id];
      const home = player && loaded.universe.planets[player.homePlanetId];
      if (home) ensureSystemVisited(loaded.universe, home.coords.galaxy, home.coords.system, now);
    }
  }
  return loaded;
}

function planetResolved(loaded: LoadedRows, id: string): boolean {
  return loaded.fullPlanetIds.has(id) || loaded.absentPlanetIds.has(id);
}

/** A fleet deleted only because its planet was not in this working set goes back. */
export function restoreUnresolvedFleets(loaded: LoadedRows): void {
  const fleets = loaded.universe.fleets;
  for (const [id, fleet] of loaded.fleetSnapshots) {
    if (fleets[id]) continue;
    const originOk = Boolean(fleet.originPlanetId) && planetResolved(loaded, fleet.originPlanetId);
    const targetOk = !fleet.targetPlanetId || planetResolved(loaded, fleet.targetPlanetId);
    if (!originOk || !targetOk) fleets[id] = fleet;
  }
}

function memorySystems(universe: UniverseState): Map<string, SystemWrite> {
  const map = new Map<string, SystemWrite>();
  const bucket = (galaxy: number, system: number) => {
    const key = `${galaxy}:${system}`;
    let row = map.get(key);
    if (!row) {
      row = { galaxy, system, version: 0, asteroids: {}, debris: {} };
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
  return map;
}

/** Loaded systems are written exactly, including {}. Unloaded systems merge. */
export async function planSystemWrites(db: D1Like, loaded: LoadedRows): Promise<SystemWrite[]> {
  const memory = memorySystems(loaded.universe);
  for (const key of loaded.loadedSystemKeys) {
    if (memory.has(key)) continue;
    const [galaxy, system] = key.split(":").map(Number) as [number, number];
    memory.set(key, { galaxy, system, version: 0, asteroids: {}, debris: {} });
  }
  const writes: SystemWrite[] = [];
  const merge: SystemWrite[] = [];
  for (const [key, draft] of memory) {
    const next = stable({ asteroids: draft.asteroids, debris: draft.debris });
    if (loaded.loadedSystemKeys.has(key)) {
      if (loaded.fingerprints.get(`system:${key}`) === next) continue;
      writes.push({ ...draft, version: loaded.systemVersions.get(key) ?? 0 });
    } else if (Object.keys(draft.asteroids).length || Object.keys(draft.debris).length) {
      merge.push(draft);
    }
  }
  for (const group of chunkRows(merge, 40)) {
    const clause = group.map(() => "(galaxy = ? AND system = ?)").join(" OR ");
    const values = group.flatMap((row) => [row.galaxy, row.system]);
    const stored = await all<{
      galaxy: number;
      system: number;
      version: number;
      asteroids: string;
      debris: string;
    }>(
      db,
      `SELECT galaxy, system, version, asteroids, debris FROM save_systems WHERE ${clause}`,
      ...values,
    );
    const byKey = new Map(stored.map((row) => [`${row.galaxy}:${row.system}`, row]));
    for (const draft of group) {
      const row = byKey.get(`${draft.galaxy}:${draft.system}`);
      const asteroids = {
        ...(row ? (timedParse(row.asteroids) as Record<string, AsteroidField>) : {}),
        ...draft.asteroids,
      };
      const debris = {
        ...(row ? (timedParse(row.debris) as Record<string, DebrisField>) : {}),
        ...draft.debris,
      };
      const before = stable({
        asteroids: row ? timedParse(row.asteroids) : {},
        debris: row ? timedParse(row.debris) : {},
      });
      const next = stable({ asteroids, debris });
      if (row && before === next) continue;
      writes.push({
        galaxy: draft.galaxy,
        system: draft.system,
        version: row?.version ?? 0,
        asteroids,
        debris,
      });
    }
  }
  return writes;
}

interface Check {
  sql: string;
  values: unknown[];
}

function valuesFrom(columns: string[], rows: unknown[][]): { sql: string; values: unknown[] } {
  const one = `SELECT ${columns.map((column) => `? AS ${column}`).join(", ")}`;
  return { sql: rows.map(() => one).join(" UNION ALL "), values: rows.flat() };
}

function pushUpdate(
  db: D1Like,
  stmts: D1Stmt[],
  table: string,
  columns: string[],
  keyColumns: string[],
  rows: unknown[][],
): number {
  if (!rows.length) return 0;
  let groups = 0;
  for (const group of chunkRows(rows, SQL_ROWS)) {
    const incoming = valuesFrom([...columns, ...keyColumns.map((column) => `old_${column}`), "old_version"], group);
    const assignments = columns.map((column) => `${column} = v.${column}`).join(", ");
    const where = [
      ...keyColumns.map((column) => `${table}.${column} = v.old_${column}`),
      `${table}.version = v.old_version`,
    ].join(" AND ");
    stmts.push(
      bind(
        db,
        `UPDATE ${table} SET ${assignments} FROM (${incoming.sql}) AS v WHERE ${where}`,
        incoming.values,
      ),
    );
    stmts.push(
      bind(
        db,
        "INSERT INTO save_assert (ok) SELECT CASE WHEN changes() = ? THEN 1 ELSE 0 END",
        [group.length],
      ),
    );
    groups += 1;
  }
  return groups;
}

function pushInsert(
  db: D1Like,
  stmts: D1Stmt[],
  sql: string,
  columnsPerRow: number,
  rows: unknown[][],
): void {
  for (const group of chunkRows(rows, SQL_ROWS)) {
    const values = group.flat();
    const tuple = `(${new Array(columnsPerRow).fill("?").join(", ")})`;
    stmts.push(bind(db, `${sql} ${group.map(() => tuple).join(", ")}`, values));
  }
}

function isStaleError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /CHECK constraint|constraint failed|stale row/i.test(message);
}

async function commitRows(db: D1Like, stmts: D1Stmt[]): Promise<void> {
  if (!stmts.length) return;
  if (saveAbort === "before-commit") {
    saveAbort = null;
    throw new SaveKilledError();
  }
  try {
    await db.batch(stmts);
  } catch (err) {
    if (isStaleError(err)) throw new RowStaleError();
    throw err;
  }
  if (saveAbort === "after-commit") {
    saveAbort = null;
    throw new SaveKilledError();
  }
}

function rerank(rows: HighscoreEntry[]): HighscoreEntry[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.points - a.points ||
      b.level - a.level ||
      b.xpTotal - a.xpTotal ||
      a.playerId.localeCompare(b.playerId),
  );
  return sorted.map((row, index) => ({ ...row, rank: index + 1 }));
}

async function saveWorkingSet(db: D1Like, loaded: LoadedRows, rebuildScores: boolean): Promise<void> {
  const universe = loaded.universe;
  delete universe.skipNpcRaids;
  delete universe.skipPirateTopUp;
  const stmts: D1Stmt[] = [];
  let guards = 0;
  const newPlayerIds: string[] = [];

  const nextWorld = stable(worldDoc(universe));
  if (nextWorld !== loaded.fingerprints.get("world")) {
    const version = loaded.worldVersion + 1;
    guards += pushUpdate(
      db,
      stmts,
      "save_world",
      ["doc", "version"],
      ["id"],
      [[timedStringify(worldDoc(universe)), version, "world", loaded.worldVersion]],
    );
  }

  const playerInserts: unknown[][] = [];
  const playerUpdates: unknown[][] = [];
  for (const player of Object.values(universe.players)) {
    const key = `player:${player.id}`;
    const next = stable(playerDoc(player));
    const previous = loaded.fingerprints.get(key);
    if (previous === undefined) {
      playerInserts.push([player.id, timedStringify(playerDoc(player))]);
      newPlayerIds.push(player.id);
      continue;
    }
    if (previous === next) continue;
    const version = (loaded.playerVersions.get(player.id) ?? 0) + 1;
    playerUpdates.push([timedStringify(playerDoc(player)), version, player.id, version - 1]);
  }
  pushInsert(
    db,
    stmts,
    "INSERT INTO save_players (id, version, doc) VALUES",
    3,
    playerInserts.map((row) => [row[0], 1, row[1]]),
  );
  guards += pushUpdate(db, stmts, "save_players", ["doc", "version"], ["id"], playerUpdates);

  const planetInserts: unknown[][] = [];
  const planetUpdates: unknown[][] = [];
  for (const planet of Object.values(universe.planets)) {
    if (loaded.stubPlanetIds.has(planet.id) && !loaded.fullPlanetIds.has(planet.id)) continue;
    const key = `planet:${planet.id}`;
    const next = stable(planet);
    const previous = loaded.fingerprints.get(key);
    const fresh = !loaded.fullPlanetIds.has(planet.id) || previous === undefined;
    if (fresh) {
      planetInserts.push([
        planet.id,
        planet.ownerPlayerId || "",
        planet.coords.galaxy,
        planet.coords.system,
        planet.coords.slot,
        planet.kind ?? "planet",
        1,
        timedStringify(planet),
      ]);
      continue;
    }
    if (previous === next) continue;
    const version = (loaded.planetVersions.get(planet.id) ?? 0) + 1;
    planetUpdates.push([
      planet.ownerPlayerId || "",
      planet.coords.galaxy,
      planet.coords.system,
      planet.coords.slot,
      planet.kind ?? "planet",
      timedStringify(planet),
      version,
      planet.id,
      version - 1,
    ]);
  }
  pushInsert(
    db,
    stmts,
    "INSERT INTO save_planets (id, owner_id, galaxy, system, slot, kind, version, doc) VALUES",
    8,
    planetInserts,
  );
  guards += pushUpdate(
    db,
    stmts,
    "save_planets",
    ["owner_id", "galaxy", "system", "slot", "kind", "doc", "version"],
    ["id"],
    planetUpdates,
  );

  const liveFleets = new Set(Object.keys(universe.fleets ?? {}));
  const fleetDeletes: unknown[][] = [];
  for (const [id, version] of loaded.fleetVersions) {
    if (liveFleets.has(id)) continue;
    fleetDeletes.push([id, version]);
  }
  for (const group of chunkRows(fleetDeletes, SQL_ROWS)) {
    const clause = group.map(() => "(id = ? AND version = ?)").join(" OR ");
    stmts.push(bind(db, `DELETE FROM save_fleets WHERE ${clause}`, group.flat()));
    stmts.push(bind(db, "INSERT INTO save_assert (ok) SELECT CASE WHEN changes() = ? THEN 1 ELSE 0 END", [group.length]));
    guards += 1;
  }
  const fleetInserts: unknown[][] = [];
  const fleetUpdates: unknown[][] = [];
  for (const fleet of Object.values(universe.fleets ?? {})) {
    const key = `fleet:${fleet.id}`;
    const next = stable(fleet);
    const previous = loaded.fingerprints.get(key);
    if (previous === undefined) {
      fleetInserts.push([
        fleet.id,
        fleet.ownerPlayerId,
        fleet.targetPlayerId || "",
        1,
        timedStringify(fleet),
      ]);
      continue;
    }
    if (previous === next) continue;
    const version = (loaded.fleetVersions.get(fleet.id) ?? 0) + 1;
    fleetUpdates.push([
      fleet.ownerPlayerId,
      fleet.targetPlayerId || "",
      timedStringify(fleet),
      version,
      fleet.id,
      version - 1,
    ]);
  }
  pushInsert(
    db,
    stmts,
    "INSERT INTO save_fleets (id, owner_id, target_owner_id, version, doc) VALUES",
    5,
    fleetInserts,
  );
  guards += pushUpdate(
    db,
    stmts,
    "save_fleets",
    ["owner_id", "target_owner_id", "doc", "version"],
    ["id"],
    fleetUpdates,
  );

  const drafts = messageDrafts(universe);
  const liveMessages = new Set(drafts.map((row) => row.id));
  const messageDeletes: unknown[][] = [];
  for (const [id, version] of loaded.messageVersions) {
    if (liveMessages.has(id)) continue;
    messageDeletes.push([id, version]);
  }
  for (const group of chunkRows(messageDeletes, SQL_ROWS)) {
    const clause = group.map(() => "(id = ? AND version = ?)").join(" OR ");
    stmts.push(bind(db, `DELETE FROM save_messages WHERE ${clause}`, group.flat()));
    stmts.push(bind(db, "INSERT INTO save_assert (ok) SELECT CASE WHEN changes() = ? THEN 1 ELSE 0 END", [group.length]));
    guards += 1;
  }
  const messageInserts: unknown[][] = [];
  const messageUpdates: unknown[][] = [];
  for (const row of drafts) {
    const key = `message:${row.id}`;
    const next = timedStringify(row.doc);
    const previous = loaded.fingerprints.get(key);
    if (previous === undefined) {
      messageInserts.push([row.id, row.owner, row.defender, row.kind, 1, next]);
      continue;
    }
    if (previous === next) continue;
    const version = (loaded.messageVersions.get(row.id) ?? 0) + 1;
    messageUpdates.push([row.owner, row.defender, row.kind, next, version, row.id, version - 1]);
  }
  pushInsert(
    db,
    stmts,
    "INSERT INTO save_messages (id, owner_id, defender_id, kind, version, doc) VALUES",
    6,
    messageInserts,
  );
  guards += pushUpdate(
    db,
    stmts,
    "save_messages",
    ["owner_id", "defender_id", "kind", "doc", "version"],
    ["id"],
    messageUpdates,
  );

  const systemInserts: unknown[][] = [];
  const systemUpdates: unknown[][] = [];
  for (const row of loaded.pendingSystems) {
    if (row.version === 0) {
      systemInserts.push([
        row.galaxy,
        row.system,
        1,
        timedStringify(row.asteroids),
        timedStringify(row.debris),
      ]);
    } else {
      const version = row.version + 1;
      systemUpdates.push([
        timedStringify(row.asteroids),
        timedStringify(row.debris),
        version,
        row.galaxy,
        row.system,
        row.version,
      ]);
    }
  }
  pushInsert(
    db,
    stmts,
    "INSERT INTO save_systems (galaxy, system, version, asteroids, debris) VALUES",
    5,
    systemInserts,
  );
  guards += pushUpdate(
    db,
    stmts,
    "save_systems",
    ["asteroids", "debris", "version"],
    ["galaxy", "system"],
    systemUpdates,
  );

  let boardJson: string | null = null;
  let boardAt = 0;
  if (rebuildScores) {
    boardJson = timedStringify(highscoresBoard(universe));
    boardAt = Date.now();
  } else if (newPlayerIds.length) {
    const cached = currentScope()?.highscores ?? [];
    const fresh = highscoresBoard(universe);
    const mine = fresh.filter((row) => newPlayerIds.includes(row.playerId));
    if (cached.length) {
      const kept = cached.filter((row) => !newPlayerIds.includes(row.playerId));
      boardJson = timedStringify(rerank([...kept, ...mine]));
      boardAt = Date.now();
    } else if (mine.length && Object.keys(universe.players).length === newPlayerIds.length) {
      boardJson = timedStringify(rerank(mine));
      boardAt = Date.now();
    }
  }
  if (boardJson) {
    stmts.push(
      bind(
        db,
        `INSERT INTO save_highscores (id, built_at, doc) VALUES ('board', ?, ?)
         ON CONFLICT(id) DO UPDATE SET built_at = excluded.built_at, doc = excluded.doc`,
        [boardAt, boardJson],
      ),
    );
  }

  if (guards) stmts.push(bind(db, "DELETE FROM save_assert", []));
  await commitRows(db, stmts);
}

async function readBoard(db: D1Like): Promise<{ builtAt: number; rows: HighscoreEntry[] } | null> {
  const row = await first<{ built_at: number; doc: string }>(
    db,
    "SELECT built_at, doc FROM save_highscores WHERE id = 'board'",
  );
  if (!row) return null;
  return { builtAt: row.built_at, rows: timedParse(row.doc) as HighscoreEntry[] };
}

async function resolvePlayerIds(db: D1Like, work: UniverseWork | undefined): Promise<string[]> {
  const ids = new Set((work?.playerIds ?? []).filter(Boolean) as string[]);
  const planetIds = [...new Set((work?.planetIds ?? []).filter((id): id is string => Boolean(id)))];
  if (planetIds.length) {
    const list = inList(planetIds);
    const rows = await all<{ owner_id: string }>(
      db,
      `SELECT owner_id FROM save_planets WHERE id IN (${list.clause}) AND owner_id != ''`,
      ...list.values,
    );
    for (const row of rows) ids.add(row.owner_id);
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

async function expandDueFleets(
  db: D1Like,
  playerIds: string[],
): Promise<{ planetIds: string[]; owners: string[]; systems: Array<[number, number]> }> {
  const list = inList(playerIds);
  const fleets = await all<{ doc: string }>(
    db,
    `SELECT doc FROM save_fleets WHERE owner_id IN (${list.clause}) OR target_owner_id IN (${list.clause})`,
    ...list.values,
    ...list.values,
  );
  const planetIds = new Set<string>();
  const systems = new Map<string, [number, number]>();
  for (const row of fleets) {
    const fleet = timedParse(row.doc) as FleetMission;
    if (fleet.arrivesAt > Date.now()) continue;
    if (fleet.originPlanetId) planetIds.add(fleet.originPlanetId);
    if (fleet.targetPlanetId) planetIds.add(fleet.targetPlanetId);
    const coords = fleet.targetCoords;
    if (coords?.galaxy && coords.system) {
      systems.set(`${coords.galaxy}:${coords.system}`, [coords.galaxy, coords.system]);
    }
  }
  const owners = new Set<string>();
  if (planetIds.size) {
    const ids = [...planetIds];
    const listIds = inList(ids);
    const planets = await all<{ owner_id: string; galaxy: number; system: number }>(
      db,
      `SELECT owner_id, galaxy, system FROM save_planets WHERE id IN (${listIds.clause})`,
      ...listIds.values,
    );
    for (const planet of planets) {
      if (planet.owner_id) owners.add(planet.owner_id);
      systems.set(`${planet.galaxy}:${planet.system}`, [planet.galaxy, planet.system]);
    }
  }
  return { planetIds: [...planetIds], owners: [...owners], systems: [...systems.values()] };
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
    if (loaded.stubPlanetIds.has(planet.id) && !loaded.fullPlanetIds.has(planet.id)) continue;
    if (stable(planet) !== loaded.fingerprints.get(`planet:${planet.id}`)) return true;
  }
  for (const fleet of Object.values(universe.fleets ?? {})) {
    if (stable(fleet) !== loaded.fingerprints.get(`fleet:${fleet.id}`)) return true;
  }
  for (const row of messageDrafts(universe)) {
    if (timedStringify(row.doc) !== loaded.fingerprints.get(`message:${row.id}`)) return true;
  }
  if (messageDrafts(universe).length !== loaded.messageVersions.size) return true;
  if (Object.keys(universe.fleets ?? {}).length !== loaded.fleetVersions.size) return true;
  if (loaded.pendingSystems.length > 0) return true;
  return false;
}

async function attachBoard(db: D1Like, work: UniverseWork | undefined): Promise<number | null> {
  const scope = currentScope();
  if (scope) scope.rowSave = true;
  if (work?.npc) return Date.now();
  const board = await readBoard(db);
  if (!scope) return board?.builtAt ?? null;
  if (work?.maintenance && (!board || highscoreCacheExpired(board.builtAt))) {
    scope.highscores = undefined;
    return board?.builtAt ?? null;
  }
  scope.highscores = board?.rows ?? [];
  return board?.builtAt ?? null;
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
  const broad = Boolean(work?.maintenance || work?.catalog || work?.npc || work?.full);
  const requested = [...new Set((work?.playerIds ?? []).filter(Boolean))] as string[];
  const due =
    broad || requested.length === 0
      ? { planetIds: [] as string[], owners: [] as string[], systems: [] as Array<[number, number]> }
      : await expandDueFleets(db, requested);
  const merged: UniverseWork = {
    ...work,
    playerIds: [...new Set([...requested, ...due.owners])],
    planetIds: [...new Set([...(work?.planetIds ?? []), ...due.planetIds])],
    extraSystems: [...(work?.extraSystems ?? []), ...due.systems],
  };
  const playerIds = [
    ...new Set([...(await resolvePlayerIds(db, work)), ...due.owners]),
  ].sort();
  const locks = broad || playerIds.length === 0 ? ["__world__"] : playerIds;
  const loadWork: UniverseWork = {
    ...merged,
    playerIds: playerIds.length ? playerIds : merged.playerIds,
  };

  const play = async () => {
    const loaded = await loadWorkingSet(db, loadWork);
    const builtAt = await attachBoard(db, work);
    const result = await runGame(loaded.universe, fn);
    restoreUnresolvedFleets(loaded);
    loaded.pendingSystems = await planSystemWrites(db, loaded);
    const scoresDue =
      Boolean(work?.maintenance) && (builtAt == null || highscoreCacheExpired(builtAt));
    return { loaded, result, scoresDue };
  };

  const runOnce = async () => {
    const { loaded, result } = await play();
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
      throw new UniverseBusyError();
    }
    let killed = false;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const { loaded, result, scoresDue } = await play();
          if (changed(loaded) || scoresDue) await saveWorkingSet(db, loaded, scoresDue);
          return result;
        } catch (err) {
          if (err instanceof SaveKilledError) {
            killed = true;
            throw err;
          }
          if (!(err instanceof RowStaleError) || attempt === 3) throw err;
        }
      }
      throw new RowStaleError();
    } finally {
      if (!killed) await releaseLocks(kv, locks);
    }
  }
  return runOnce();
}

const ROLLBACK_PAGE = 30;
export const ROLLBACK_STALE_MS = 5 * 60 * 1000;

interface RollbackCursor {
  stage: "world" | "players" | "done";
  cursor: string;
  written: number;
  updatedAt?: number;
}

function queueKv(db: D1Like, stmts: D1Stmt[], key: string, value: unknown): void {
  const text = timedStringify(value);
  const chunked = splitChunkText(text);
  queue(db, stmts, "DELETE FROM kv WHERE key = ? OR key GLOB ?", [key, `${key}#*`]);
  if (!chunked) {
    queue(db, stmts, "INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)", [key, text, null]);
    return;
  }
  queue(db, stmts, "INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)", [key, chunked.manifest, null]);
  chunked.parts.forEach((part, index) => {
    queue(db, stmts, "INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)", [chunkKey(key, index), part, null]);
  });
}

async function readRollback(db: D1Like): Promise<RollbackCursor> {
  const row = await first<{ value: string }>(db, "SELECT value FROM save_meta WHERE id = ?", "rollback");
  if (!row) return { stage: "world", cursor: "", written: 0, updatedAt: Date.now() };
  try {
    const parsed = timedParse(row.value) as RollbackCursor;
    const stage = parsed.stage === "players" || parsed.stage === "done" ? parsed.stage : "world";
    return {
      stage,
      cursor: parsed.cursor || "",
      written: parsed.written ?? 0,
      updatedAt: parsed.updatedAt ?? 0,
    };
  } catch {
    return { stage: "world", cursor: "", written: 0, updatedAt: Date.now() };
  }
}

/**
 * Copy row tables back into the kv slices main already loads.
 * One page per call, one atomic batch, so a 100-player universe stays under
 * the 50-query cap. Repeat until `done`. Does not delete save_*.
 * `kv` is unused: the batch writes the kv table directly so the page is one subrequest.
 */
export async function rollbackRowsToLegacy(
  db: D1Like,
  _kv: KvStore,
  options?: { restart?: boolean },
): Promise<{ players: number; systems: number; done: boolean }> {
  await ensureRowTables(db);
  if (!(await migrationDone(db))) throw new Error("Row save is not migrated.");

  const now = Date.now();
  let cursor = await readRollback(db);

  const isStale = Boolean(cursor.updatedAt && now - cursor.updatedAt > ROLLBACK_STALE_MS);
  if (options?.restart || cursor.stage === "done" || isStale) {
    cursor = { stage: "world", cursor: "", written: 0, updatedAt: now };
  }

  const base =
    process.env.STARHOLD_UNIVERSE_KEY ?? `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}`;
  const stmts: D1Stmt[] = [];
  let stage: RollbackCursor["stage"] = cursor.stage;
  let nextCursor = cursor.cursor;
  let written = cursor.written;

  const playerRows = await all<{ id: string }>(
    db,
    "SELECT id FROM save_players WHERE id > ? ORDER BY id ASC LIMIT ?",
    nextCursor,
    ROLLBACK_PAGE,
  );
  const pageIds = playerRows.map((row) => row.id);

  let loaded: LoadedRows | undefined;
  if (stage === "world") {
    loaded = await loadWorkingSet(db, { playerIds: pageIds });
    delete loaded.universe.skipNpcRaids;
    delete loaded.universe.skipPirateTopUp;
    await loadAllSystems(db, loaded);
    await loadPlanetDocs(db, loaded, "SELECT id, version, doc FROM save_planets WHERE owner_id = ''", []);
    await loadFleets(db, loaded, "WHERE owner_id = ''", []);
    await loadMessages(db, loaded, "WHERE owner_id = ''", []);

    const parts = splitUniverse(loaded.universe);
    queueKv(db, stmts, `${base}:world`, parts.world);
    queueKv(db, stmts, `${base}:asteroids`, parts.asteroids);
    queueKv(db, stmts, `${base}:pirates`, parts.pirates);
    queueKv(db, stmts, `${base}:aliens`, parts.aliens);

    stage = "players";
    nextCursor = "";
    written = 0;

    for (const id of pageIds) {
      if (parts.players[id]) queueKv(db, stmts, `${base}:player:${id}`, parts.players[id]);
    }
    written += pageIds.length;
    const finished = pageIds.length < ROLLBACK_PAGE;
    if (finished) {
      queueKv(db, stmts, `${base}:ver`, String(now));
      stage = "done";
      nextCursor = "";
    } else {
      nextCursor = pageIds[pageIds.length - 1] ?? nextCursor;
    }

    const saved: RollbackCursor = { stage, cursor: nextCursor, written, updatedAt: now };
    queue(
      db,
      stmts,
      "INSERT INTO save_meta (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
      ["rollback", timedStringify(saved)],
    );
    await db.batch(stmts);
    return {
      players: written,
      systems: loaded.loadedSystemKeys.size,
      done: finished,
    };
  }

  // stage === "players"
  let finished = false;
  if (pageIds.length > 0) {
    loaded = await loadWorkingSet(db, { playerIds: pageIds });
    delete loaded.universe.skipNpcRaids;
    delete loaded.universe.skipPirateTopUp;

    const parts = splitUniverse(loaded.universe);
    for (const id of pageIds) {
      if (parts.players[id]) queueKv(db, stmts, `${base}:player:${id}`, parts.players[id]);
    }
    written += pageIds.length;
    finished = pageIds.length < ROLLBACK_PAGE;
    if (finished) {
      queueKv(db, stmts, `${base}:ver`, String(now));
      stage = "done";
      nextCursor = "";
    } else {
      nextCursor = pageIds[pageIds.length - 1] ?? nextCursor;
    }
  } else {
    queueKv(db, stmts, `${base}:ver`, String(now));
    stage = "done";
    nextCursor = "";
    finished = true;
  }

  const saved: RollbackCursor = { stage, cursor: nextCursor, written, updatedAt: now };
  queue(
    db,
    stmts,
    "INSERT INTO save_meta (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
    ["rollback", timedStringify(saved)],
  );
  await db.batch(stmts);
  return {
    players: written,
    systems: loaded?.loadedSystemKeys.size ?? 0,
    done: finished,
  };
}

export async function readHighscoreMeta(
  db: D1Like,
): Promise<{ builtAt: number; rows: number } | null> {
  const board = await readBoard(db);
  if (!board) return null;
  return { builtAt: board.builtAt, rows: board.rows.length };
}

export { STAGES };
