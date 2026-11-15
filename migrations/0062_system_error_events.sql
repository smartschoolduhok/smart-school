-- Server errors recorded by the Worker for the system admin's health page and
-- Telegram alerts. Messages are truncated and carry no request body or query.
CREATE TABLE system_error_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at INTEGER NOT NULL DEFAULT (unixepoch()),
  fingerprint TEXT NOT NULL CHECK(length(fingerprint) BETWEEN 1 AND 64),
  method TEXT NOT NULL CHECK(length(method) BETWEEN 1 AND 10),
  route TEXT NOT NULL CHECK(length(route) BETWEEN 1 AND 200),
  status INTEGER NOT NULL CHECK(typeof(status)='integer' AND status BETWEEN 400 AND 599),
  error_name TEXT CHECK(error_name IS NULL OR length(error_name)<=80),
  error_message TEXT CHECK(error_message IS NULL OR length(error_message)<=500),
  school_id INTEGER,
  user_id INTEGER
);
CREATE INDEX idx_system_error_events_time ON system_error_events(occurred_at);
CREATE INDEX idx_system_error_events_fingerprint ON system_error_events(fingerprint, occurred_at);

-- One row per error fingerprint: when it was last sent to Telegram, so a
-- repeating error alerts at most once per throttle window.
CREATE TABLE system_alert_state (
  fingerprint TEXT PRIMARY KEY CHECK(length(fingerprint) BETWEEN 1 AND 64),
  last_alerted_at INTEGER NOT NULL CHECK(typeof(last_alerted_at)='integer')
);
