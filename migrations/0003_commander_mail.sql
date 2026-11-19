CREATE TABLE IF NOT EXISTS save_commander_mail (
  id TEXT PRIMARY KEY,
  to_player_id TEXT NOT NULL,
  from_player_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  doc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS save_commander_mail_to
  ON save_commander_mail (to_player_id, created_at);
