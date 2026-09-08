-- Grade writes use this monotonic revision for optimistic concurrency.
-- It prevents one editor from silently overwriting a grade loaded by another.
ALTER TABLE grades ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_grades_school_revision
ON grades(school_id, revision);

-- A bulk request inserts a validated sentinel at the beginning of its D1 batch
-- and removes it at the end. CHECK failure aborts the whole transaction when
-- any reviewed grade revision has changed before the batch begins.
CREATE TABLE IF NOT EXISTS grade_write_assertions (
  request_id  TEXT PRIMARY KEY,
  validated   INTEGER NOT NULL CHECK (validated = 1),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
