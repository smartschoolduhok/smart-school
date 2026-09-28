-- Full snapshots remain readable after selected-day periods are replaced.
-- IDs inside the snapshot are historical values, not cascading foreign keys.
CREATE TABLE timetable_week_archives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_key TEXT NOT NULL UNIQUE CHECK (length(trim(archive_key)) > 0),
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 0),
  created_by_user_id INTEGER,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)
    AND json_type(snapshot_json) IS 'object'
    AND json_type(snapshot_json, '$.days') IS 'array'
    AND json_type(snapshot_json, '$.slots') IS 'array'
    AND json_type(snapshot_json, '$.entries') IS 'array'
    AND json_type(snapshot_json, '$.availability') IS 'array'
    AND json_type(snapshot_json, '$.loads') IS 'array'),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_timetable_week_archives_scope ON timetable_week_archives(school_id, academic_year_id, id DESC);

CREATE TRIGGER trg_timetable_week_archives_validate_insert
BEFORE INSERT ON timetable_week_archives
BEGIN
  SELECT RAISE(ABORT, 'timetable week archive scope mismatch')
  WHERE NOT EXISTS (SELECT 1 FROM academic_years WHERE id = NEW.academic_year_id AND school_id = NEW.school_id)
    OR EXISTS (
      SELECT 1 FROM json_each(NEW.snapshot_json) collection, json_each(collection.value) item
      WHERE json_extract(item.value, '$.school_id') IS NOT NEW.school_id
        OR json_extract(item.value, '$.academic_year_id') IS NOT NEW.academic_year_id
    );
END;

-- Attendance writes do not bump the timetable revision. Recheck drafts inside
-- the replacement transaction so a draft created after preview is protected.
CREATE TRIGGER trg_timetable_week_archives_preserve_attendance_drafts
BEFORE INSERT ON timetable_week_archives
BEGIN
  SELECT RAISE(ABORT, 'timetable week draft attendance pending')
  WHERE EXISTS (
    SELECT 1 FROM lesson_attendance_sessions session
    WHERE session.school_id = NEW.school_id AND session.academic_year_id = NEW.academic_year_id
      AND session.status = 'draft'
      AND session.timetable_entry_id IN (SELECT json_extract(value, '$.id') FROM json_each(NEW.snapshot_json, '$.entries'))
  );
END;

CREATE TRIGGER trg_timetable_week_archives_immutable_update
BEFORE UPDATE ON timetable_week_archives
BEGIN
  SELECT RAISE(ABORT, 'timetable week archive is immutable');
END;

CREATE TRIGGER trg_timetable_week_archives_immutable_delete
BEFORE DELETE ON timetable_week_archives
BEGIN
  SELECT RAISE(ABORT, 'timetable week archive is immutable');
END;
