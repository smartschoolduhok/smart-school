-- P0 authentication and API security hardening.
-- Raw bearer tokens are intentionally not stored in either table.

CREATE TABLE IF NOT EXISTS revoked_sessions (
  jti         TEXT PRIMARY KEY,
  user_id     INTEGER,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_revoked_sessions_expires_at
  ON revoked_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_revoked_sessions_user_id
  ON revoked_sessions(user_id);

CREATE TABLE IF NOT EXISTS login_throttles (
  subject_hash       TEXT PRIMARY KEY,
  failed_attempts    INTEGER NOT NULL DEFAULT 0,
  window_started_at  INTEGER NOT NULL,
  locked_until       INTEGER,
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_login_throttles_locked_until
  ON login_throttles(locked_until);
CREATE INDEX IF NOT EXISTS idx_login_throttles_updated_at
  ON login_throttles(updated_at);
