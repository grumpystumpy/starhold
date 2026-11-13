/**
 * Per-player / per-planet / per-fleet / per-message D1 rows.
 * The legacy kv universe document is never deleted or overwritten here.
 * It stays as the rollback snapshot from before the switch.
 */
import {
  advancePlanetNow,
  combatHallOfFame,
  combatHallOfShame,
  mergeCombatHallOfFame,
  ensureSystemVisited,
  ensureUniverseShape,
  highscoresBoard,
  allianceRankBoard,
  armQuietPirateCull,
  disarmPirateCull,
  type AllianceRankEntry,
  type AsteroidField,
  type CombatReport,
  type DebrisField,
  type EventLogEntry,
  type ExpeditionReport,
  type FleetMission,
  type HighscoreEntry,
  type HighscoreCache,
  type MessageCategory,
  type PlanetState,
  type PlayerState,
  type EspionageReport,
  type UniverseState,
  UNIVERSE_SCHEMA_VERSION,
} from "@starhold/game";
import type { D1Like, D1RunResult, D1Stmt } from "./d1-store.js";
import { chunkKey, splitChunkText } from "./d1-codec.js";
import type { KvStore } from "./kv.js";
import { addCpu, currentScope } from "./request-context.js";
import { sliceStamps, splitUniverse, type SliceStamps } from "./universe-docs.js";

export const HIGHSCORE_TTL_MS = 30 * 60 * 1000;
export const ROW_LOCK_MS = 2_500;
const CHUNK = 25;
/** D1 rejects a compound SELECT with 6 or more terms. Keep every multi-row write at or under 5. */
const SQL_ROWS = 5;
/** NPC ten-minute player page. Keeps that cron off a full save_players doc read (STARHOLD-D). */
export const NPC_PLAYER_PAGE = 25;

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
  /**
   * Oldest due fleet ids chosen for this request. Set by withRowUniverse.
   * Not a caller input.
   */
  dueFleetIds?: string[];
  /**
   * Delete every matching inbox row for this player, including rows that
   * were not loaded into the working set. Never stored on the world doc.
   */
  messagePurge?: { playerId: string; category: MessageCategory };
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
  /** Cheap world-doc fingerprint taken after ensureUniverseShape. Not persisted. */
  worldStamp: string;
  /** Planet rows as loaded, so a resource-only change can be told apart from growth. */
  planetDocs: Map<string, string>;
  messageKinds: Map<string, string>;
  messageOwners: Map<string, string>;
  /** Loaded report objects. Same reference means the 3KB doc was not edited. */
  messageRefs: Map<string, object>;
  /** Set when a purge must hit D1 even if the loaded window did not change. */
  forceSave: boolean;
  /** Report ids a purge removes, including rows outside the loaded window. */
  purgeReportIds: string[];
  messagePurge?: { playerId: string; category: MessageCategory };
  /** Stamp after the request callback. Reused by the save so the walk runs once. */
  worldStampAfter?: string;
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

/** Newest rows the per-player view reads. Wider loads stay unbounded. */
const REPORT_WINDOW = 12;
const EVENT_WINDOW = 100;
const HOSTILE_FLEET_WINDOW = 20;

const WORLD_STAMP_SKIP = new Set<string>([
  ...OMIT_KEYS,
  "players",
  "planets",
  "fleets",
  "reports",
  "spyReports",
  "expeditionReports",
  "asteroids",
  "debris",
  "pirateBases",
  "alienBases",
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

function hashTree(value: unknown): string {
  let h1 = 2166136261;
  let h2 = 2166136261 ^ 0x9e3779b9;
  let count = 0;
  let sum = 0;
  const mix = (hash: number, n: number): number => Math.imul(hash ^ n, 16777619);
  const walk = (inner: unknown): void => {
    count += 1;
    if (inner == null) {
      h1 = mix(h1, 0);
      h2 = mix(h2, 1);
      return;
    }
    const kind = typeof inner;
    if (kind === "number") {
      const n = inner as number;
      sum += n;
      const bits = (Number.isFinite(n) ? n * 1000 : 0) | 0;
      h1 = mix(h1, bits);
      h2 = mix(h2, bits >>> 8);
      return;
    }
    if (kind === "boolean") {
      h1 = mix(h1, (inner as boolean) ? 7 : 11);
      return;
    }
    if (kind === "string") {
      const text = inner as string;
      h1 = mix(h1, text.length);
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        h1 = mix(h1, code);
        h2 = mix(h2, code);
      }
      return;
    }
    if (Array.isArray(inner)) {
      h1 = mix(h1, inner.length);
      for (const item of inner) walk(item);
      return;
    }
    if (kind === "object") {
      const record = inner as Record<string, unknown>;
      const keys = Object.keys(record);
      h1 = mix(h1, keys.length);
      for (const key of keys) {
        for (let i = 0; i < key.length; i++) h1 = mix(h1, key.charCodeAt(i));
        walk(record[key]);
      }
    }
  };
  walk(value ?? null);
  return `${count}:${h1 >>> 0}:${h2 >>> 0}:${sum}`;
}

/**
 * Detects a world-doc edit without stringifying pirateBases.
 * The shell is exact JSON. Bases are a numeric walk, cached until a
 * proxy sees a write, so a quiet page tick does not walk 750 bases.
 * lastAiSimAt is ignored, matching stable().
 */
interface NpcWatch {
  dirty: boolean;
  noDestroyed: boolean;
  basesStamp: string;
  pirate: object;
  alien: object;
  seen: WeakMap<object, unknown>;
  pirateParts: Map<string, string>;
  alienParts: Map<string, string>;
  dirtyPirate: Set<string>;
  dirtyAlien: Set<string>;
}

interface ShellCacheEntry {
  version: number;
  docLength: number;
  universe: UniverseState;
}

const shellCache = new WeakMap<D1Like, ShellCacheEntry>();
const npcWatches = new WeakMap<UniverseState, NpcWatch>();
const proxyTargets = new WeakMap<object, object>();
const nativeStructuredClone = globalThis.structuredClone.bind(globalThis);

function unwrapClone(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;
  const obj = value as object;
  const cached = seen.get(obj);
  if (cached) return cached;
  const target = proxyTargets.get(obj) ?? obj;
  if (Array.isArray(target)) {
    const copy: unknown[] = [];
    seen.set(obj, copy);
    for (const item of target) copy.push(unwrapClone(item, seen));
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(obj, copy);
  const record = target as Record<string, unknown>;
  for (const key of Object.keys(record)) copy[key] = unwrapClone(record[key], seen);
  return copy;
}

function cloneTouchesProxy(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const obj = value as object;
  if (proxyTargets.has(obj)) return true;
  const record = value as { pirateBases?: object; alienBases?: object };
  if (record.pirateBases && proxyTargets.has(record.pirateBases)) return true;
  if (record.alienBases && proxyTargets.has(record.alienBases)) return true;
  return false;
}

globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
  if (!cloneTouchesProxy(value)) return nativeStructuredClone(value, options);
  return nativeStructuredClone(unwrapClone(value, new WeakMap()), options);
}) as typeof structuredClone;

function rawObject(value: object): object {
  return proxyTargets.get(value) ?? value;
}

function foldParts(parts: Map<string, string>): string {
  let h1 = 2166136261;
  let h2 = 2166136261 ^ 0x9e3779b9;
  const ids = [...parts.keys()].sort();
  for (const id of ids) {
    const hash = parts.get(id) ?? "";
    for (let i = 0; i < id.length; i++) h1 = Math.imul(h1 ^ id.charCodeAt(i), 16777619);
    for (let i = 0; i < hash.length; i++) {
      const code = hash.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 16777619);
      h2 = Math.imul(h2 ^ code, 16777619);
    }
  }
  return `${ids.length}:${h1 >>> 0}:${h2 >>> 0}`;
}

function indexParts(record: object, parts: Map<string, string>): void {
  parts.clear();
  const raw = rawObject(record) as Record<string, unknown>;
  for (const id of Object.keys(raw)) {
    const base = raw[id];
    const body = base !== null && typeof base === "object" ? rawObject(base) : base;
    parts.set(id, hashTree(body));
  }
}

function refreshDirty(watch: NpcWatch): void {
  const apply = (
    ids: Set<string>,
    record: object,
    parts: Map<string, string>,
  ) => {
    const raw = rawObject(record) as Record<string, unknown>;
    for (const id of ids) {
      if (!Object.prototype.hasOwnProperty.call(raw, id)) {
        parts.delete(id);
        continue;
      }
      const base = raw[id];
      const body = base !== null && typeof base === "object" ? rawObject(base) : base;
      parts.set(id, hashTree(body));
    }
    ids.clear();
    if (parts.size !== Object.keys(raw).length) {
      for (const id of parts.keys()) {
        if (!Object.prototype.hasOwnProperty.call(raw, id)) parts.delete(id);
      }
    }
  };
  apply(watch.dirtyPirate, watch.pirate, watch.pirateParts);
  apply(watch.dirtyAlien, watch.alien, watch.alienParts);
  watch.basesStamp = `${foldParts(watch.pirateParts)}|${foldParts(watch.alienParts)}`;
  watch.dirty = false;
}

function markBase(watch: NpcWatch, kind: "pirate" | "alien", id: string): void {
  watch.dirty = true;
  watch.noDestroyed = false;
  (kind === "pirate" ? watch.dirtyPirate : watch.dirtyAlien).add(id);
  disarmPirateCull(watch.pirate);
  if (watch.alien !== watch.pirate) disarmPirateCull(watch.alien);
}

function watchNested(
  value: unknown,
  watch: NpcWatch,
  kind: "pirate" | "alien",
  id: string,
): unknown {
  if (value === null || typeof value !== "object") return value;
  const obj = value as object;
  const existing = watch.seen.get(obj);
  if (existing) return existing;
  const proxy = new Proxy(obj, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
      const inner = Reflect.get(target, prop, receiver);
      return inner !== null && typeof inner === "object"
        ? watchNested(inner, watch, kind, id)
        : inner;
    },
    set(target, prop, val, receiver) {
      const current = Reflect.get(target, prop, receiver);
      if (!Object.is(current, val)) markBase(watch, kind, id);
      return Reflect.set(target, prop, val, receiver);
    },
    deleteProperty(target, prop) {
      markBase(watch, kind, id);
      return Reflect.deleteProperty(target, prop);
    },
  });
  proxyTargets.set(proxy, obj);
  watch.seen.set(obj, proxy);
  return proxy;
}

function watchMap(record: object, watch: NpcWatch, kind: "pirate" | "alien"): object {
  const existing = watch.seen.get(record);
  if (existing) return existing as object;
  const proxy = new Proxy(record, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
      const inner = Reflect.get(target, prop, receiver);
      return inner !== null && typeof inner === "object"
        ? watchNested(inner, watch, kind, prop)
        : inner;
    },
    set(target, prop, val, receiver) {
      if (typeof prop === "string") {
        const current = Reflect.get(target, prop, receiver);
        if (!Object.is(current, val)) markBase(watch, kind, prop);
      }
      return Reflect.set(target, prop, val, receiver);
    },
    deleteProperty(target, prop) {
      if (typeof prop === "string") markBase(watch, kind, prop);
      return Reflect.deleteProperty(target, prop);
    },
  });
  proxyTargets.set(proxy, record);
  watch.seen.set(record, proxy);
  return proxy;
}

function pinNpcWatch(universe: UniverseState): void {
  const watch: NpcWatch = {
    dirty: false,
    noDestroyed: false,
    basesStamp: "",
    pirate: {},
    alien: {},
    seen: new WeakMap(),
    pirateParts: new Map(),
    alienParts: new Map(),
    dirtyPirate: new Set(),
    dirtyAlien: new Set(),
  };
  const pirate = universe.pirateBases;
  if (pirate) {
    indexParts(pirate, watch.pirateParts);
    const wrapped = watchMap(pirate, watch, "pirate");
    universe.pirateBases = wrapped as UniverseState["pirateBases"];
    watch.pirate = wrapped;
  }
  const alien = universe.alienBases;
  if (alien) {
    indexParts(alien, watch.alienParts);
    const wrapped = watchMap(alien, watch, "alien");
    universe.alienBases = wrapped as UniverseState["alienBases"];
    watch.alien = wrapped;
  }
  watch.basesStamp = `${foldParts(watch.pirateParts)}|${foldParts(watch.alienParts)}`;
  npcWatches.set(universe, watch);
}

function shellJson(universe: UniverseState): string {
  const shell: Record<string, unknown> = {};
  const source = universe as unknown as Record<string, unknown>;
  for (const key of Object.keys(source).sort()) {
    if (WORLD_STAMP_SKIP.has(key)) continue;
    shell[key] = source[key];
  }
  return stringifyJson(shell);
}

function worldStamp(universe: UniverseState): string {
  const started = performance.now();
  try {
    const shell = shellJson(universe);
    const watch = npcWatches.get(universe);
    const pirateRef = (universe.pirateBases ?? watch?.pirate) as object | undefined;
    const alienRef = (universe.alienBases ?? watch?.alien) as object | undefined;
    const sameRefs =
      watch !== undefined &&
      pirateRef === watch.pirate &&
      alienRef === watch.alien;
    if (watch && sameRefs) {
      if (watch.dirty) refreshDirty(watch);
      return `${shell}|${watch.basesStamp}`;
    }
    pinNpcWatch(universe);
    return `${shell}|${npcWatches.get(universe)!.basesStamp}`;
  } finally {
    addCpu(performance.now() - started);
  }
}

function dropShellCache(db: D1Like, universe: UniverseState): void {
  const entry = shellCache.get(db);
  if (entry?.universe === universe) shellCache.delete(db);
}

function noteShellVersion(db: D1Like, universe: UniverseState, version: number, docLength: number): void {
  const entry = shellCache.get(db);
  if (!entry || entry.universe !== universe) return;
  entry.version = version;
  entry.docLength = docLength;
}

function readWorldStamp(loaded: LoadedRows): string {
  if (loaded.worldStampAfter === undefined) loaded.worldStampAfter = worldStamp(loaded.universe);
  return loaded.worldStampAfter;
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

async function batchAll<T>(
  db: D1Like,
  queries: Array<{ sql: string; values?: unknown[] }>,
): Promise<T[][]> {
  if (!queries.length) return [];
  const results = await db.batch(
    queries.map(({ sql, values = [] }) => db.prepare(sql).bind(...values)),
  );
  return results.map(
    (result) => (result as D1RunResult & { results?: T[] }).results ?? [],
  );
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

export async function readCombatReportByShareCode(
  db: D1Like,
  shareCode: string,
): Promise<CombatReport | null> {
  const row = await first<{ doc: string }>(
    db,
    `SELECT doc FROM save_messages
     WHERE kind = 'report' AND json_extract(doc, '$.shareCode') = ?
     LIMIT 1`,
    shareCode,
  );
  return row ? (timedParse(row.doc) as CombatReport) : null;
}

function worldDoc(universe: UniverseState): UniverseState {
  // Keep aiCatchUpCursor durable so the NPC cron resumes after each row save.
  // Stringify the raw base maps. The watch proxies would allocate a proxy per
  // nested field while walking 750 bases.
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
    pirateBases: rawBases(universe.pirateBases),
    alienBases: rawBases(universe.alienBases),
  };
  delete doc.skipNpcRaids;
  delete doc.skipPirateTopUp;
  return doc;
}

function rawBases<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  return (proxyTargets.get(value as object) as T | undefined) ?? value;
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
  cache: HighscoreCache,
  builtAt: number,
): Promise<void> {
  await run(
    db,
    `INSERT INTO save_highscores (id, built_at, doc) VALUES ('board', ?, ?)
     ON CONFLICT(id) DO UPDATE SET built_at = excluded.built_at, doc = excluded.doc`,
    builtAt,
    timedStringify(cache),
  );
}

function buildHighscoreCache(
  universe: UniverseState,
  includeCombatLists: boolean,
): HighscoreCache {
  return {
    rows: highscoresBoard(universe),
    hallOfFame: includeCombatLists ? combatHallOfFame(universe) : [],
    hallOfShame: includeCombatLists ? combatHallOfShame(universe) : [],
  };
}

/**
 * A normal save does not load every combat report. Fame keeps the cached
 * fights and overlays reports in this working set. Shame is recomputed from
 * every player row, which this save already loaded.
 */
async function combatHallsForPartialSave(
  db: D1Like,
  universe: UniverseState,
): Promise<Pick<HighscoreCache, "hallOfFame" | "hallOfShame">> {
  let cachedFame = currentScope()?.hallOfFame;
  if (cachedFame === undefined) {
    cachedFame = (await readBoard(db))?.cache.hallOfFame ?? [];
  }
  return {
    hallOfFame: mergeCombatHallOfFame(cachedFame, universe),
    hallOfShame: combatHallOfShame(universe),
  };
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
      if (state.cursor !== "board-done") {
        push(
          `INSERT INTO save_highscores (id, built_at, doc) VALUES ('board', ?, ?)
           ON CONFLICT(id) DO UPDATE SET built_at = excluded.built_at, doc = excluded.doc`,
          [Date.now(), timedStringify(buildHighscoreCache(universe, true))],
        );
        state.cursor = "board-done";
        continue;
      }
      push(
        `INSERT INTO save_highscores (id, built_at, doc) VALUES ('alliances', ?, ?)
         ON CONFLICT(id) DO UPDATE SET built_at = excluded.built_at, doc = excluded.doc`,
        [Date.now(), timedStringify(allianceRankBoard(universe))],
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
  // System rows refill these. A reused shell must not keep another request's fields.
  shell.asteroids = {};
  shell.debris = {};
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

function applyPlayerRows(into: LoadedRows, rows: Array<{ id: string; version: number; doc: string }>): void {
  for (const row of rows) {
    const player = timedParse(row.doc) as PlayerState;
    player.eventLog = [];
    into.universe.players[player.id] = player;
    into.playerVersions.set(player.id, row.version);
    into.fingerprints.set(`player:${player.id}`, stable(playerDoc(player)));
  }
}

async function loadPlayers(db: D1Like, into: LoadedRows): Promise<void> {
  const rows = await all<{ id: string; version: number; doc: string }>(
    db,
    "SELECT id, version, doc FROM save_players",
  );
  applyPlayerRows(into, rows);
}

function applyPlanetRows(
  into: LoadedRows,
  rows: Array<{ id: string; version: number; doc: string }>,
  expectIds?: string[],
): void {
  for (const row of rows) {
    if (into.fullPlanetIds.has(row.id)) continue;
    const planet = timedParse(row.doc) as PlanetState;
    into.universe.planets[planet.id] = planet;
    into.planetVersions.set(planet.id, row.version);
    into.fullPlanetIds.add(planet.id);
    into.stubPlanetIds.delete(planet.id);
    into.absentPlanetIds.delete(planet.id);
    into.fingerprints.set(`planet:${planet.id}`, stable(planet));
    into.planetDocs.set(planet.id, row.doc);
  }
  if (expectIds) {
    for (const id of expectIds) {
      if (!into.fullPlanetIds.has(id)) into.absentPlanetIds.add(id);
    }
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
  applyPlanetRows(into, rows, expectIds);
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
    into.messageKinds.set(row.id, row.kind);
    into.messageOwners.set(row.id, row.owner_id);
    into.fingerprints.set(`message:${row.id}`, row.doc);
    const doc = timedParse(row.doc) as { id: string };
    if (row.kind === "report") {
      into.messageRefs.set(row.id, doc);
      into.universe.reports[doc.id] = doc as CombatReport;
    } else if (row.kind === "spy") into.universe.spyReports[doc.id] = doc as EspionageReport;
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

const MAX_IN_BINDS = 90;

async function allInList<T>(
  db: D1Like,
  ids: string[],
  sql: (list: ReturnType<typeof inList>) => string,
  repeatedLists = 1,
): Promise<T[]> {
  const rows: T[] = [];
  const size = Math.floor(MAX_IN_BINDS / repeatedLists);
  for (const group of chunkRows(ids, size)) {
    const list = inList(group);
    const values = Array.from({ length: repeatedLists }, () => list.values).flat();
    rows.push(...(await all<T>(db, sql(list), ...values)));
  }
  return rows;
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
  const watch = npcWatches.get(universe);
  if (
    watch &&
    !watch.dirty &&
    watch.noDestroyed &&
    universe.pirateBases === watch.pirate
  ) {
    return false;
  }
  const needed = Object.values(universe.pirateBases ?? {}).some((base) => base.destroyedAt != null);
  if (watch) watch.noDestroyed = !needed;
  return needed;
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

function applyFleetRows(
  into: LoadedRows,
  rows: Array<{ id: string; version: number; doc: string }>,
): void {
  for (const row of rows) {
    const fleet = timedParse(row.doc) as FleetMission;
    into.universe.fleets[fleet.id] = fleet;
    into.fleetVersions.set(fleet.id, row.version);
    into.fleetSnapshots.set(fleet.id, structuredClone(fleet));
    into.fingerprints.set(`fleet:${fleet.id}`, stable(fleet));
  }
}

function applyMessageRows(
  into: LoadedRows,
  rows: Array<{
    id: string;
    version: number;
    kind: string;
    doc: string;
    owner_id: string;
  }>,
): void {
  for (const row of rows) {
    into.messageVersions.set(row.id, row.version);
    into.messageKinds.set(row.id, row.kind);
    into.messageOwners.set(row.id, row.owner_id);
    into.fingerprints.set(`message:${row.id}`, row.doc);
    const doc = timedParse(row.doc) as { id: string };
    if (row.kind === "report") {
      into.messageRefs.set(row.id, doc);
      into.universe.reports[doc.id] = doc as CombatReport;
    } else if (row.kind === "spy") into.universe.spyReports[doc.id] = doc as EspionageReport;
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

function applyOccupancyRows(
  loaded: LoadedRows,
  rows: Array<{
    id: string;
    owner_id: string;
    galaxy: number;
    system: number;
    slot: number;
    kind: string;
  }>,
): void {
  for (const row of rows) {
    if (loaded.fullPlanetIds.has(row.id) || loaded.universe.planets[row.id]) continue;
    loaded.universe.planets[row.id] = stubPlanet(row);
    loaded.stubPlanetIds.add(row.id);
  }
}

async function loadScheduledRows(
  db: D1Like,
  loaded: LoadedRows,
  systems: Array<[number, number]>,
  includeDetails: boolean,
  includeOccupancy: boolean,
): Promise<void> {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const planetGroups = includeDetails ? chunkRows(systems, 40) : [];
  for (const group of planetGroups) {
    const clause = group.map(() => "(galaxy = ? AND system = ?)").join(" OR ");
    queries.push({
      sql: `SELECT id, version, doc FROM save_planets WHERE ${clause}`,
      values: group.flatMap(([galaxy, system]) => [galaxy, system]),
    });
  }
  const fleetIndex = includeDetails
    ? queries.push({ sql: "SELECT id, version, doc FROM save_fleets" }) - 1
    : -1;
  const messageIndex = includeDetails
    ? queries.push({
        sql: "SELECT id, version, kind, doc, owner_id FROM save_messages",
      }) - 1
    : -1;
  const pendingSystems = systems.filter(
    ([galaxy, system]) => !loaded.systemVersions.has(`${galaxy}:${system}`),
  );
  const systemGroups = chunkRows(pendingSystems, 40);
  for (const group of systemGroups) {
    const clause = group.map(() => "(galaxy = ? AND system = ?)").join(" OR ");
    queries.push({
      sql: `SELECT galaxy, system, version, asteroids, debris FROM save_systems WHERE ${clause}`,
      values: group.flatMap(([galaxy, system]) => [galaxy, system]),
    });
  }
  const occupancyIndex = includeOccupancy
    ? queries.push({
        sql: "SELECT id, owner_id, galaxy, system, slot, kind FROM save_planets",
      }) - 1
    : -1;
  if (!queries.length) return;

  const results = await batchAll<Record<string, unknown>>(db, queries);
  for (let index = 0; index < planetGroups.length; index += 1) {
    applyPlanetRows(
      loaded,
      results[index] as Array<{ id: string; version: number; doc: string }>,
    );
  }
  if (fleetIndex >= 0) {
    applyFleetRows(
      loaded,
      results[fleetIndex] as Array<{ id: string; version: number; doc: string }>,
    );
  }
  if (messageIndex >= 0) {
    applyMessageRows(
      loaded,
      results[messageIndex] as Array<{
        id: string;
        version: number;
        kind: string;
        doc: string;
        owner_id: string;
      }>,
    );
  }
  const systemStart = planetGroups.length + (includeDetails ? 2 : 0);
  for (let index = 0; index < systemGroups.length; index += 1) {
    const rows = results[systemStart + index] as Array<{
      galaxy: number;
      system: number;
      version: number;
      asteroids: string;
      debris: string;
    }>;
    const byKey = new Map(rows.map((row) => [`${row.galaxy}:${row.system}`, row]));
    for (const [galaxy, system] of systemGroups[index]!) {
      const row = byKey.get(`${galaxy}:${system}`);
      applySystemRow(
        loaded,
        galaxy,
        system,
        row?.version ?? 0,
        row ? (timedParse(row.asteroids) as Record<string, AsteroidField>) : {},
        row ? (timedParse(row.debris) as Record<string, DebrisField>) : {},
      );
    }
  }
  if (occupancyIndex >= 0) {
    applyOccupancyRows(
      loaded,
      results[occupancyIndex] as Array<{
        id: string;
        owner_id: string;
        galaxy: number;
        system: number;
        slot: number;
        kind: string;
      }>,
    );
  }
}

/**
 * One id-ordered page of players for the NPC cron.
 * A cursor past the last id reads the first page in the same call.
 * A short page clears the cursor so the next run is not stuck at the end.
 */
async function loadNpcPlayerPage(db: D1Like, loaded: LoadedRows): Promise<void> {
  const readPage = (after: string) =>
    all<{ id: string }>(
      db,
      "SELECT id FROM save_players WHERE id > ? ORDER BY id ASC LIMIT ?",
      after,
      NPC_PLAYER_PAGE,
    );
  const start = loaded.universe.npcPlayerPageCursor ?? "";
  let idRows = await readPage(start);
  if (idRows.length === 0 && start !== "") idRows = await readPage("");
  const ids = idRows.map((row) => row.id);
  if (ids.length === 0 || ids.length < NPC_PLAYER_PAGE) delete loaded.universe.npcPlayerPageCursor;
  else loaded.universe.npcPlayerPageCursor = ids[ids.length - 1];
  if (!ids.length) return;
  const rows = await allInList<{ id: string; version: number; doc: string }>(
    db,
    ids,
    (list) => `SELECT id, version, doc FROM save_players WHERE id IN (${list.clause})`,
  );
  applyPlayerRows(loaded, rows);
}

async function loadPlayerFleets(
  db: D1Like,
  into: LoadedRows,
  playerIds: string[],
  dueFleetIds: string[],
): Promise<void> {
  const rows: Array<{ id: string; version: number; doc: string }> = [];
  let dueLeft = dueFleetIds;
  for (const group of chunkRows(playerIds, Math.floor(MAX_IN_BINDS / 2))) {
    const owners = inList(group);
    let sql = `SELECT id, version, doc FROM save_fleets WHERE owner_id IN (${owners.clause})
      UNION
      SELECT id, version, doc FROM (
        SELECT id, version, doc,
          ROW_NUMBER() OVER (
            PARTITION BY target_owner_id
            ORDER BY json_extract(doc, '$.arrivesAt') ASC
          ) AS rn
        FROM save_fleets
        WHERE target_owner_id IN (${owners.clause})
          AND json_extract(doc, '$.phase') = 'outbound'
          AND json_extract(doc, '$.mission') IN ('raid', 'espionage')
      ) WHERE rn <= ${HOSTILE_FLEET_WINDOW}`;
    const values: unknown[] = [...owners.values, ...owners.values];
    if (dueLeft.length) {
      const room = MAX_IN_BINDS - values.length;
      const take = dueLeft.slice(0, room);
      dueLeft = dueLeft.slice(take.length);
      if (take.length) {
        const due = inList(take);
        sql += ` UNION SELECT id, version, doc FROM save_fleets WHERE id IN (${due.clause})`;
        values.push(...due.values);
      }
    }
    rows.push(...(await all<{ id: string; version: number; doc: string }>(db, sql, ...values)));
  }
  if (dueLeft.length) {
    rows.push(
      ...(await allInList<{ id: string; version: number; doc: string }>(
        db,
        dueLeft,
        (list) => `SELECT id, version, doc FROM save_fleets WHERE id IN (${list.clause})`,
      )),
    );
  }
  applyFleetRows(into, [...new Map(rows.map((row) => [row.id, row])).values()]);
}

async function loadPlayerMessages(db: D1Like, into: LoadedRows, playerIds: string[]): Promise<void> {
  const rows: Array<{
    id: string;
    version: number;
    kind: string;
    doc: string;
    owner_id: string;
  }> = [];
  // Four selects per commander. D1 rejects a compound SELECT with 6 or more terms,
  // so this stays one commander per statement (4 terms).
  for (const id of playerIds) {
    const branches = [
      `SELECT id, version, kind, doc, owner_id FROM (
         SELECT id, version, kind, doc, owner_id FROM save_messages
         WHERE kind = 'report' AND (owner_id = ? OR defender_id = ?)
         ORDER BY json_extract(doc, '$.at') DESC
         LIMIT ${REPORT_WINDOW}
       )`,
      `SELECT id, version, kind, doc, owner_id FROM (
         SELECT id, version, kind, doc, owner_id FROM save_messages
         WHERE kind = 'spy' AND owner_id = ?
         ORDER BY json_extract(doc, '$.at') DESC
         LIMIT ${REPORT_WINDOW}
       )`,
      `SELECT id, version, kind, doc, owner_id FROM (
         SELECT id, version, kind, doc, owner_id FROM save_messages
         WHERE kind = 'expedition' AND owner_id = ?
         ORDER BY json_extract(doc, '$.at') DESC
         LIMIT ${REPORT_WINDOW}
       )`,
      `SELECT id, version, kind, doc, owner_id FROM (
         SELECT id, version, kind, doc, owner_id FROM save_messages
         WHERE kind = 'event' AND owner_id = ?
         ORDER BY json_extract(doc, '$.createdAt') DESC
         LIMIT ${EVENT_WINDOW}
       )`,
    ];
    rows.push(
      ...(await all<{
        id: string;
        version: number;
        kind: string;
        doc: string;
        owner_id: string;
      }>(db, branches.join(" UNION ALL "), id, id, id, id, id)),
    );
  }
  applyMessageRows(into, [...new Map(rows.map((row) => [row.id, row])).values()]);
}

export async function loadWorkingSet(db: D1Like, work: UniverseWork | undefined): Promise<LoadedRows> {
  const requestedIds = [...new Set((work?.playerIds ?? []).filter(Boolean))] as string[];
  const planetIds = [...new Set((work?.planetIds ?? []).filter((id): id is string => Boolean(id)))];
  const wide =
    Boolean(work?.maintenance || work?.full) ||
    (requestedIds.length === 0 && !work?.catalog && !work?.npc);
  // Maintenance and other wide reads still take every player.
  // The NPC cron pages by id so it does not scan every player doc at once.
  const pageNpc = Boolean(work?.npc) && !wide;
  const batchCoreRows = wide;
  let world: { version: number; doc: string } | null;
  let playerRows: Array<{ id: string; version: number; doc: string }> | undefined;
  let planetRows: Array<{ id: string; version: number; doc: string }> | undefined;
  if (batchCoreRows) {
    const planetSql = work?.full
      ? "SELECT id, version, doc FROM save_planets"
      : "SELECT id, version, doc FROM save_planets WHERE owner_id != ''";
    const [worldResult, playerResult, planetResult] = await db.batch([
      db.prepare("SELECT version, doc FROM save_world WHERE id = 'world'"),
      db.prepare("SELECT id, version, doc FROM save_players"),
      db.prepare(planetSql),
    ]);
    world = (worldResult as D1RunResult & { results?: Array<{ version: number; doc: string }> })
      .results?.[0] ?? null;
    playerRows = (playerResult as D1RunResult & {
      results?: Array<{ id: string; version: number; doc: string }>;
    }).results ?? [];
    planetRows = (planetResult as D1RunResult & {
      results?: Array<{ id: string; version: number; doc: string }>;
    }).results ?? [];
  } else {
    world = await first<{ version: number; doc: string }>(
      db,
      "SELECT version, doc FROM save_world WHERE id = 'world'",
    );
  }
  if (!world) throw new Error("Row save is missing the world document.");
  const cachedShell = shellCache.get(db);
  const reuseShell =
    cachedShell !== undefined &&
    cachedShell.version === world.version &&
    cachedShell.docLength === world.doc.length &&
    cachedShell.docLength > 0;
  const universe = reuseShell
    ? emptyUniverse(cachedShell.universe)
    : emptyUniverse(timedParse(world.doc) as UniverseState);
  const shellCursor = universe.npcPlayerPageCursor;
  if (!reuseShell) {
    shellCache.set(db, { version: world.version, docLength: world.doc.length, universe });
  }
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
    fingerprints: new Map(),
    worldStamp: worldStamp(universe),
    planetDocs: new Map(),
    messageKinds: new Map(),
    messageOwners: new Map(),
    messageRefs: new Map(),
    forceSave: false,
    purgeReportIds: [],
  };
  if (playerRows) applyPlayerRows(loaded, playerRows);
  else if (!pageNpc) await loadPlayers(db, loaded);
  if (planetRows) applyPlanetRows(loaded, planetRows);
  const placePirates = Boolean(work?.npc) || pirateSitesNeeded(loaded.universe);
  let occupancyLoaded = false;

  if (work?.full) {
    if (!planetRows) await loadPlanetDocs(db, loaded, "SELECT id, version, doc FROM save_planets", []);
    await loadFleets(db, loaded, "", []);
    await loadMessages(db, loaded, "", []);
    await loadAllSystems(db, loaded);
  } else if (work?.npc) {
    if (pageNpc) {
      await loadNpcPlayerPage(db, loaded);
      const ownerIds = Object.keys(loaded.universe.players);
      if (ownerIds.length) {
        const rows = await allInList<{ id: string; version: number; doc: string }>(
          db,
          ownerIds,
          (owners) => `SELECT id, version, doc FROM save_planets WHERE owner_id IN (${owners.clause})`,
        );
        applyPlanetRows(loaded, rows);
      }
    }
    await loadScheduledRows(
      db,
      loaded,
      systemPairs(Object.values(loaded.universe.planets)),
      false,
      placePirates,
    );
    occupancyLoaded = placePirates;
    // Raids need the owned bodies on this page. Placement still needs occupied slots.
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
    if (!planetRows) {
      await loadPlanetDocs(
        db,
        loaded,
        "SELECT id, version, doc FROM save_planets WHERE owner_id != ''",
        [],
      );
    }
    const systems = systemPairs(Object.values(loaded.universe.planets));
    await loadScheduledRows(db, loaded, systems, true, placePirates);
    occupancyLoaded = placePirates;
  } else {
    if (requestedIds.length) {
      const rows = await allInList<{ id: string; version: number; doc: string }>(
        db,
        requestedIds,
        (ids) => `SELECT id, version, doc FROM save_planets WHERE owner_id IN (${ids.clause})`,
      );
      applyPlanetRows(loaded, rows);
    }
    if (planetIds.length) {
      const rows = await allInList<{ id: string; version: number; doc: string }>(
        db,
        planetIds,
        (extra) => `SELECT id, version, doc FROM save_planets WHERE id IN (${extra.clause})`,
      );
      applyPlanetRows(loaded, rows, planetIds);
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
      await loadPlayerFleets(db, loaded, requestedIds, work?.dueFleetIds ?? []);
      await loadPlayerMessages(db, loaded, requestedIds);
    }
    await loadSystems(db, loaded, pairs);
  }

  if (!work?.npc) loaded.universe.skipNpcRaids = true;
  if (placePirates) {
    if (!occupancyLoaded) await loadOccupancy(db, loaded);
  } else {
    loaded.universe.skipPirateTopUp = true;
  }
  const now = Date.now();
  if (!work?.npc && !work?.full) {
    if (work?.galaxy && work.system) ensureSystemVisited(loaded.universe, work.galaxy, work.system, now);
    for (const id of requestedIds) {
      const player = loaded.universe.players[id];
      const home = player && loaded.universe.planets[player.homePlanetId];
      if (home) ensureSystemVisited(loaded.universe, home.coords.galaxy, home.coords.system, now);
    }
  }
  if (loaded.universe.npcPlayerPageCursor !== shellCursor) {
    dropShellCache(db, loaded.universe);
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
  const mergeGroups = chunkRows(merge, 40);
  const storedGroups = await batchAll<{
    galaxy: number;
    system: number;
    version: number;
    asteroids: string;
    debris: string;
  }>(
    db,
    mergeGroups.map((group) => {
      const clause = group.map(() => "(galaxy = ? AND system = ?)").join(" OR ");
      return {
        sql: `SELECT galaxy, system, version, asteroids, debris FROM save_systems WHERE ${clause}`,
        values: group.flatMap((row) => [row.galaxy, row.system]),
      };
    }),
  );
  for (let index = 0; index < mergeGroups.length; index += 1) {
    const group = mergeGroups[index]!;
    const stored = storedGroups[index]!;
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
  const changedPlayerIds: string[] = [];

  const nextWorld = readWorldStamp(loaded);
  if (nextWorld !== loaded.worldStamp) {
    const version = loaded.worldVersion + 1;
    const doc = timedStringify(worldDoc(universe));
    guards += pushUpdate(
      db,
      stmts,
      "save_world",
      ["doc", "version"],
      ["id"],
      [[doc, version, "world", loaded.worldVersion]],
    );
    noteShellVersion(db, universe, version, doc.length);
    loaded.worldVersion = version;
    loaded.worldStamp = nextWorld;
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
    changedPlayerIds.push(player.id);
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
    if (!planetChanged(loaded, planet, next)) continue;
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
    if (planet.ownerPlayerId) changedPlayerIds.push(planet.ownerPlayerId);
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
    const previous = loaded.fingerprints.get(key);
    const untouched = row.kind === "report" && loaded.messageRefs.get(row.id) === row.doc;
    const next = untouched && previous !== undefined ? previous : timedStringify(row.doc);
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

  const purge = loaded.messagePurge;
  if (purge) {
    const want = (bucket: "alerts" | "spy" | "combat"): boolean =>
      purge.category === "all" || purge.category === bucket;
    if (want("alerts")) {
      stmts.push(bind(db, "DELETE FROM save_messages WHERE kind = 'event' AND owner_id = ?", [purge.playerId]));
    }
    if (want("spy")) {
      stmts.push(bind(db, "DELETE FROM save_messages WHERE kind = 'spy' AND owner_id = ?", [purge.playerId]));
    }
    if (want("combat")) {
      stmts.push(bind(db, "DELETE FROM save_messages WHERE kind = 'expedition' AND owner_id = ?", [purge.playerId]));
      stmts.push(
        bind(
          db,
          `DELETE FROM save_messages
           WHERE kind = 'report' AND (owner_id = ? OR defender_id = ?)
             AND (
               json_extract(doc, '$.attackerPlayerId') IN ('npc_pirates', 'npc_aliens')
               OR json_extract(doc, '$.defenderPlayerId') IN ('npc_pirates', 'npc_aliens')
               OR json_extract(doc, '$.attackerPlayerId') IS NULL
               OR json_extract(doc, '$.defenderPlayerId') IS NULL
               OR json_extract(doc, '$.attackerPlayerId') = json_extract(doc, '$.defenderPlayerId')
             )`,
          [purge.playerId, purge.playerId],
        ),
      );
      for (const group of chunkRows(loaded.purgeReportIds, MAX_IN_BINDS)) {
        const list = inList(group);
        stmts.push(bind(db, `DELETE FROM save_messages WHERE id IN (${list.clause})`, list.values));
      }
    }
  }

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
  let allianceJson: string | null = null;
  let boardAt = 0;
  if (rebuildScores) {
    boardJson = timedStringify(buildHighscoreCache(universe, true));
    allianceJson = timedStringify(allianceRankBoard(universe));
    boardAt = Date.now();
  } else {
    // Keep the board in step with every player this save scored correctly:
    // new joiners plus changed players whose planets were all fully loaded.
    // Other rows stay as cached; a later maintenance pass rebuilds the board.
    const scoredIds = new Set(newPlayerIds);
    for (const id of changedPlayerIds) {
      const owned = Object.values(universe.planets).filter((p) => p.ownerPlayerId === id);
      if (owned.length && owned.every((p) => loaded.fullPlanetIds.has(p.id) || newPlayerIds.includes(id))) {
        scoredIds.add(id);
      }
    }
    if (scoredIds.size) {
      const cached = currentScope()?.highscores ?? [];
      const mine = highscoresBoard(universe).filter((row) => scoredIds.has(row.playerId));
      if (mine.length) {
        const kept = cached.filter((row) => !scoredIds.has(row.playerId));
        const halls = await combatHallsForPartialSave(db, universe);
        boardJson = timedStringify({
          rows: rerank([...kept, ...mine]),
          hallOfFame: halls.hallOfFame,
          hallOfShame: halls.hallOfShame,
        } satisfies HighscoreCache);
        // Merged into a cached board: keep its build time (-1) so the TTL rebuild
        // still happens. A board seeded from a partial working set gets time 0,
        // so the next maintenance pass treats it as expired and rebuilds it in full.
        boardAt = cached.length > 0
          ? -1
          : Object.keys(universe.players).length === newPlayerIds.length
            ? Date.now()
            : 0;
      }
    }
  }
  if (boardJson) {
    stmts.push(
      bind(
        db,
        `INSERT INTO save_highscores (id, built_at, doc) VALUES ('board', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           built_at = CASE WHEN excluded.built_at < 0 THEN save_highscores.built_at ELSE excluded.built_at END,
           doc = excluded.doc`,
        [boardAt, boardJson],
      ),
    );
  }
  if (allianceJson) {
    stmts.push(
      bind(
        db,
        `INSERT INTO save_highscores (id, built_at, doc) VALUES ('alliances', ?, ?)
         ON CONFLICT(id) DO UPDATE SET built_at = excluded.built_at, doc = excluded.doc`,
        [boardAt, allianceJson],
      ),
    );
  }

  if (guards) stmts.push(bind(db, "DELETE FROM save_assert", []));
  await commitRows(db, stmts);
}

async function readScoreCache(db: D1Like): Promise<{
  board: { builtAt: number; cache: HighscoreCache } | null;
  alliances: AllianceRankEntry[];
}> {
  const rows = await all<{ id: string; built_at: number; doc: string }>(
    db,
    "SELECT id, built_at, doc FROM save_highscores WHERE id IN ('board', 'alliances')",
  );
  let board: { builtAt: number; cache: HighscoreCache } | null = null;
  let alliances: AllianceRankEntry[] = [];
  for (const row of rows) {
    if (row.id === "board") {
      const parsed = timedParse(row.doc) as HighscoreCache | HighscoreEntry[];
      const cache: HighscoreCache = Array.isArray(parsed)
        ? { rows: parsed, hallOfFame: [], hallOfShame: [] }
        : {
            rows: parsed.rows ?? [],
            hallOfFame: parsed.hallOfFame ?? [],
            hallOfShame: parsed.hallOfShame ?? [],
          };
      board = { builtAt: row.built_at, cache };
    } else if (row.id === "alliances") {
      const parsed = timedParse(row.doc);
      alliances = Array.isArray(parsed) ? (parsed as AllianceRankEntry[]) : [];
    }
  }
  return { board, alliances };
}

async function readBoard(db: D1Like): Promise<{ builtAt: number; cache: HighscoreCache } | null> {
  return (await readScoreCache(db)).board;
}

async function resolvePlayerIds(db: D1Like, work: UniverseWork | undefined): Promise<string[]> {
  const ids = new Set((work?.playerIds ?? []).filter(Boolean) as string[]);
  const planetIds = [...new Set((work?.planetIds ?? []).filter((id): id is string => Boolean(id)))];
  if (planetIds.length) {
    const rows = await allInList<{ owner_id: string }>(
      db,
      planetIds,
      (list) => `SELECT owner_id FROM save_planets WHERE id IN (${list.clause}) AND owner_id != ''`,
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

function dueFleetLimit(): number | null {
  const fleets = currentScope()?.budget?.fleets;
  if (fleets == null || !Number.isFinite(fleets)) return null;
  return Math.max(0, Math.floor(fleets));
}

async function expandDueFleets(
  db: D1Like,
  playerIds: string[],
): Promise<{ planetIds: string[]; owners: string[]; systems: Array<[number, number]>; fleetIds: string[] }> {
  const limit = dueFleetLimit();
  const now = Date.now();
  // Two IN lists per statement. Chunk so a 110-player read stays under 90 binds.
  const chunkSize = Math.floor(MAX_IN_BINDS / 2);
  const found = new Map<string, {
    id: string;
    origin_planet_id: string | null;
    target_planet_id: string | null;
    galaxy: number | null;
    system: number | null;
    arrives_at: number | null;
  }>();
  for (const group of chunkRows(playerIds, chunkSize)) {
    const list = inList(group);
    const sql = `SELECT id,
        json_extract(doc, '$.originPlanetId') AS origin_planet_id,
        json_extract(doc, '$.targetPlanetId') AS target_planet_id,
        json_extract(doc, '$.targetCoords.galaxy') AS galaxy,
        json_extract(doc, '$.targetCoords.system') AS system,
        json_extract(doc, '$.arrivesAt') AS arrives_at
      FROM save_fleets
      WHERE (owner_id IN (${list.clause}) OR target_owner_id IN (${list.clause}))
        AND json_extract(doc, '$.arrivesAt') <= ?
      ORDER BY json_extract(doc, '$.arrivesAt') ASC
      ${limit == null ? "" : "LIMIT ?"}`;
    const values: unknown[] = [...list.values, ...list.values, now];
    if (limit != null) values.push(limit);
    const rows = await all<{
      id: string;
      origin_planet_id: string | null;
      target_planet_id: string | null;
      galaxy: number | null;
      system: number | null;
      arrives_at: number | null;
    }>(db, sql, ...values);
    for (const row of rows) found.set(row.id, row);
  }
  const fleets = [...found.values()].sort(
    (a, b) => (a.arrives_at ?? 0) - (b.arrives_at ?? 0) || a.id.localeCompare(b.id),
  );
  const chosen = limit == null ? fleets : fleets.slice(0, limit);
  const planetIds = new Set<string>();
  const systems = new Map<string, [number, number]>();
  const fleetIds: string[] = [];
  for (const fleet of chosen) {
    fleetIds.push(fleet.id);
    if (fleet.origin_planet_id) planetIds.add(fleet.origin_planet_id);
    if (fleet.target_planet_id) planetIds.add(fleet.target_planet_id);
    if (fleet.galaxy && fleet.system) {
      systems.set(`${fleet.galaxy}:${fleet.system}`, [fleet.galaxy, fleet.system]);
    }
  }
  const owners = new Set<string>();
  if (planetIds.size) {
    const ids = [...planetIds];
    const planets = await allInList<{ owner_id: string; galaxy: number; system: number }>(
      db,
      ids,
      (listIds) => `SELECT owner_id, galaxy, system FROM save_planets WHERE id IN (${listIds.clause})`,
    );
    for (const planet of planets) {
      if (planet.owner_id) owners.add(planet.owner_id);
      systems.set(`${planet.galaxy}:${planet.system}`, [planet.galaxy, planet.system]);
    }
  }
  return { planetIds: [...planetIds], owners: [...owners], systems: [...systems.values()], fleetIds };
}

/** Resources may drift this far from plain growth (float noise) and still count as untouched. */
const RESOURCE_EPSILON = 1e-6;

function sameResources(a: PlanetState["resources"], b: PlanetState["resources"]): boolean {
  return (
    Math.abs(a.metal - b.metal) <= RESOURCE_EPSILON &&
    Math.abs(a.crystal - b.crystal) <= RESOURCE_EPSILON &&
    Math.abs(a.deuterium - b.deuterium) <= RESOURCE_EPSILON
  );
}

/**
 * The fingerprint ignores resources so a tick-on-read does not rewrite the row.
 * A planet whose resources differ from plain growth of its loaded row (the same
 * tick, replayed on a copy) was changed by the request and must be written.
 */
function resourcesMoved(loaded: LoadedRows, planet: PlanetState): boolean {
  const raw = loaded.planetDocs.get(planet.id);
  if (raw === undefined) return false;
  const base = timedParse(raw) as PlanetState;
  if (sameResources(base.resources, planet.resources)) return false;
  const started = performance.now();
  try {
    const owner = loaded.universe.players[base.ownerPlayerId];
    const shadow = {
      ...loaded.universe,
      planets: { [base.id]: base },
      players: owner ? { [owner.id]: structuredClone(owner) } : {},
    } as UniverseState;
    if (planet.lastTickAt > base.lastTickAt) advancePlanetNow(shadow, base.id, planet.lastTickAt);
    return !sameResources(shadow.planets[base.id]!.resources, planet.resources);
  } finally {
    addCpu(performance.now() - started);
  }
}

function planetChanged(loaded: LoadedRows, planet: PlanetState, next: string): boolean {
  if (next !== loaded.fingerprints.get(`planet:${planet.id}`)) return true;
  return resourcesMoved(loaded, planet);
}

function changed(loaded: LoadedRows): boolean {
  const universe = loaded.universe;
  if (loaded.forceSave) return true;
  if (readWorldStamp(loaded) !== loaded.worldStamp) return true;
  for (const player of Object.values(universe.players)) {
    if (stable(playerDoc(player)) !== loaded.fingerprints.get(`player:${player.id}`)) return true;
  }
  for (const planet of Object.values(universe.planets)) {
    if (loaded.stubPlanetIds.has(planet.id) && !loaded.fullPlanetIds.has(planet.id)) continue;
    if (planetChanged(loaded, planet, stable(planet))) return true;
  }
  for (const fleet of Object.values(universe.fleets ?? {})) {
    if (stable(fleet) !== loaded.fingerprints.get(`fleet:${fleet.id}`)) return true;
  }
  for (const row of messageDrafts(universe)) {
    const untouched = row.kind === "report" && loaded.messageRefs.get(row.id) === row.doc;
    if (untouched) continue;
    if (timedStringify(row.doc) !== loaded.fingerprints.get(`message:${row.id}`)) return true;
  }
  if (messageDrafts(universe).length !== loaded.messageVersions.size) return true;
  if (Object.keys(universe.fleets ?? {}).length !== loaded.fleetVersions.size) return true;
  if (loaded.pendingSystems.length > 0) return true;
  return false;
}

async function attachBoard(db: D1Like, work: UniverseWork | undefined): Promise<void> {
  const scope = currentScope();
  if (scope) scope.rowSave = true;
  if (work?.npc) return;
  const cached = await readScoreCache(db);
  const board = cached.board;
  if (!scope) return;
  scope.allianceHighscores = cached.alliances;
  if (work?.maintenance) {
    scope.highscores = undefined;
    scope.hallOfFame = undefined;
    scope.hallOfShame = undefined;
    return;
  }
  scope.highscores = board?.cache.rows ?? [];
  scope.hallOfFame = board?.cache.hallOfFame ?? [];
  scope.hallOfShame = board?.cache.hallOfShame ?? [];
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

function hiddenIdSet(raw: string | null): Set<string> {
  const ids = new Set<string>();
  if (!raw) return ids;
  try {
    const parsed = timedParse(raw) as unknown;
    if (Array.isArray(parsed)) {
      for (const id of parsed) if (typeof id === "string") ids.add(id);
    }
  } catch {
    /* a bad hidden list still counts as present so the row is not dropped */
  }
  return ids;
}

/**
 * Extend a windowed delete to every matching row. NPC, spy, expedition, and
 * event rows are removed. A player-vs-player report is hidden, and the row
 * is removed only when the other commander already hid it or is not in
 * save_players. Loaded ids that leave memory stay in messageVersions so the
 * versioned delete still matches; the bulk delete then covers the rest.
 */
async function prepareMessagePurge(db: D1Like, loaded: LoadedRows): Promise<void> {
  const purge = loaded.messagePurge;
  if (!purge) return;
  const player = loaded.universe.players[purge.playerId];
  if (!player) return;
  loaded.forceSave = true;
  const want = (bucket: "alerts" | "spy" | "combat"): boolean =>
    purge.category === "all" || purge.category === bucket;
  if (!want("combat")) return;

  const rows = await all<{ id: string; attacker: string | null; defender: string | null }>(
    db,
    `SELECT id,
       json_extract(doc, '$.attackerPlayerId') AS attacker,
       json_extract(doc, '$.defenderPlayerId') AS defender
     FROM save_messages
     WHERE kind = 'report' AND (owner_id = ? OR defender_id = ?)`,
    purge.playerId,
    purge.playerId,
  );
  const others = new Set<string>();
  const pvp: Array<{ id: string; other: string }> = [];
  for (const row of rows) {
    const attacker = row.attacker ?? "";
    const defender = row.defender ?? "";
    const other = attacker === purge.playerId ? defender : attacker;
    const npc =
      !other ||
      other === purge.playerId ||
      other === "npc_pirates" ||
      other === "npc_aliens";
    if (npc) continue;
    others.add(other);
    pvp.push({ id: row.id, other });
  }
  const alive = new Map<string, Set<string>>();
  if (others.size) {
    const found = await allInList<{ id: string; hidden: string | null }>(
      db,
      [...others],
      (list) =>
        `SELECT id, json_extract(doc, '$.hiddenReportIds') AS hidden FROM save_players WHERE id IN (${list.clause})`,
    );
    for (const row of found) {
      const hidden = hiddenIdSet(row.hidden);
      const memory = loaded.universe.players[row.id];
      if (memory?.hiddenReportIds) {
        for (const id of memory.hiddenReportIds) hidden.add(id);
      }
      alive.set(row.id, hidden);
    }
  }
  if (!Array.isArray(player.hiddenReportIds)) player.hiddenReportIds = [];
  const already = new Set(player.hiddenReportIds);
  const drop: string[] = [];
  for (const row of pvp) {
    const otherHidden = alive.get(row.other);
    if (!otherHidden || otherHidden.has(row.id)) {
      drop.push(row.id);
      delete loaded.universe.reports[row.id];
      continue;
    }
    if (!already.has(row.id)) {
      player.hiddenReportIds.push(row.id);
      already.add(row.id);
    }
    // deletePlayerMessages drops a shared report when the other commander
    // was not in this working set. Put that row back out of the delete set
    // so the saved copy stays until they hide it too.
    if (!loaded.universe.reports[row.id]) loaded.messageVersions.delete(row.id);
  }
  loaded.purgeReportIds = drop;
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
      ? { planetIds: [] as string[], owners: [] as string[], systems: [] as Array<[number, number]>, fleetIds: [] as string[] }
      : await expandDueFleets(db, requested);
  const merged: UniverseWork = {
    ...work,
    playerIds: [...new Set([...requested, ...due.owners])],
    planetIds: [...new Set([...(work?.planetIds ?? []), ...due.planetIds])],
    extraSystems: [...(work?.extraSystems ?? []), ...due.systems],
    dueFleetIds: due.fleetIds,
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
    await attachBoard(db, work);
    const result = await runGame(loaded.universe, fn);
    const watch = npcWatches.get(loaded.universe);
    if (watch && !watch.dirty && loaded.universe.pirateBases === watch.pirate) {
      armQuietPirateCull(loaded.universe.pirateBases);
    }
    if (work?.messagePurge) {
      loaded.messagePurge = work.messagePurge;
      await prepareMessagePurge(db, loaded);
    }
    restoreUnresolvedFleets(loaded);
    loaded.pendingSystems = await planSystemWrites(db, loaded);
    const scoresDue = Boolean(work?.maintenance);
    return { loaded, result, scoresDue };
  };

  const runOnce = async () => {
    const { loaded, result } = await play();
    const dirty = changed(loaded);
    if (!dirty) return result;
    if (!kv || !(await acquireLocks(kv, locks, false))) {
      dropShellCache(db, loaded.universe);
      return result;
    }
    try {
      await saveWorkingSet(db, loaded, false);
      return result;
    } catch (err) {
      dropShellCache(db, loaded.universe);
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
        let loadedUniverse: UniverseState | undefined;
        try {
          const played = await play();
          loadedUniverse = played.loaded.universe;
          if (changed(played.loaded) || played.scoresDue) {
            await saveWorkingSet(db, played.loaded, played.scoresDue);
          }
          return played.result;
        } catch (err) {
          if (loadedUniverse) dropShellCache(db, loadedUniverse);
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
  return { builtAt: board.builtAt, rows: board.cache.rows.length };
}

export { STAGES };
