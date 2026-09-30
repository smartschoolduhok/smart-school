-- Independent scheduling preferences per school. No timetable rows are changed.
CREATE TABLE timetable_school_preferences (
  school_id INTEGER PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  preferences_json TEXT NOT NULL CHECK (json_valid(preferences_json)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by_user_id INTEGER REFERENCES users(id),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- A proposal scored under an earlier policy needs a fresh preview for any year.
CREATE TRIGGER trg_timetable_preferences_insert_revision
AFTER INSERT ON timetable_school_preferences
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
    SELECT NEW.school_id, id, 1 FROM academic_years WHERE school_id = NEW.school_id
    ON CONFLICT(school_id, academic_year_id) DO UPDATE SET revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER trg_timetable_preferences_update_revision
AFTER UPDATE OF preferences_json ON timetable_school_preferences
WHEN OLD.preferences_json IS NOT NEW.preferences_json
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
    SELECT NEW.school_id, id, 1 FROM academic_years WHERE school_id = NEW.school_id
    ON CONFLICT(school_id, academic_year_id) DO UPDATE SET revision = revision + 1, updated_at = unixepoch();
END;
