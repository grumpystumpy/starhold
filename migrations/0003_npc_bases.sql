-- Pirate and alien bases leave the save_world document.
-- Additive only. An old blob is copied into these rows on its next load.
-- A second load finds an empty map on the world document and does not write again.

-- One row per faction per galaxy. The doc is that galaxy's base map.
CREATE TABLE IF NOT EXISTS save_npc_bases (
  kind TEXT NOT NULL,
  galaxy INTEGER NOT NULL,
  destroyed INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL,
  doc TEXT NOT NULL,
  PRIMARY KEY (kind, galaxy)
);

CREATE INDEX IF NOT EXISTS save_npc_bases_destroyed ON save_npc_bases (destroyed);
