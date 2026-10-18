-- Row save alongside the legacy kv universe document.
-- Additive only. The kv rows are the rollback snapshot and are not dropped.

CREATE TABLE IF NOT EXISTS save_meta (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS save_world (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS save_players (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  doc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS save_planets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  galaxy INTEGER NOT NULL,
  system INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  doc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS save_planets_owner ON save_planets (owner_id);
CREATE INDEX IF NOT EXISTS save_planets_system ON save_planets (galaxy, system);

CREATE TABLE IF NOT EXISTS save_fleets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  target_owner_id TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL,
  doc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS save_fleets_owner ON save_fleets (owner_id);
CREATE INDEX IF NOT EXISTS save_fleets_target ON save_fleets (target_owner_id);

CREATE TABLE IF NOT EXISTS save_messages (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  defender_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  doc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS save_messages_owner ON save_messages (owner_id);
CREATE INDEX IF NOT EXISTS save_messages_defender ON save_messages (defender_id);

CREATE TABLE IF NOT EXISTS save_systems (
  galaxy INTEGER NOT NULL,
  system INTEGER NOT NULL,
  version INTEGER NOT NULL,
  asteroids TEXT NOT NULL,
  debris TEXT NOT NULL,
  PRIMARY KEY (galaxy, system)
);

CREATE TABLE IF NOT EXISTS save_highscores (
  id TEXT PRIMARY KEY,
  built_at INTEGER NOT NULL,
  doc TEXT NOT NULL
);
