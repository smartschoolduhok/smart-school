-- Extend archive provenance without changing version IDs, snapshots or restore links.
-- D1 executes a migration transaction; defer references during the parent rebuild.
PRAGMA defer_foreign_keys = ON;
DROP TRIGGER trg_timetable_schedule_version_entries_validate_insert;
CREATE TABLE timetable_schedule_versions_new (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  version_key              TEXT NOT NULL UNIQUE CHECK (length(trim(version_key)) > 0),
  school_id                INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id         INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  source                   TEXT NOT NULL CHECK (source IN ('automatic_adoption', 'manual_restore', 'manual_clear')),
  previous_revision        INTEGER NOT NULL CHECK (previous_revision >= 0),
  created_by_user_id       INTEGER,
  restored_from_version_id INTEGER REFERENCES timetable_schedule_versions(id) ON DELETE RESTRICT,
  old_entry_count          INTEGER NOT NULL CHECK (old_entry_count >= 0),
  new_entry_count          INTEGER NOT NULL CHECK (new_entry_count >= 0),
  locked_entry_count       INTEGER NOT NULL CHECK (locked_entry_count >= 0),
  proposal_digest          TEXT NOT NULL CHECK (length(trim(proposal_digest)) > 0),
  created_at               INTEGER NOT NULL DEFAULT (unixepoch())
);


INSERT INTO timetable_schedule_versions_new SELECT * FROM timetable_schedule_versions;
DROP TABLE timetable_schedule_versions;
ALTER TABLE timetable_schedule_versions_new RENAME TO timetable_schedule_versions;
CREATE INDEX IF NOT EXISTS idx_timetable_schedule_versions_scope_created
ON timetable_schedule_versions(school_id, academic_year_id, created_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS trg_timetable_schedule_versions_validate_insert
BEFORE INSERT ON timetable_schedule_versions
BEGIN
  SELECT RAISE(ABORT, 'timetable version academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'timetable restore version scope mismatch')
  WHERE NEW.restored_from_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM timetable_schedule_versions source_version
    WHERE source_version.id = NEW.restored_from_version_id
      AND source_version.school_id = NEW.school_id
      AND source_version.academic_year_id = NEW.academic_year_id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_schedule_versions_immutable_update
BEFORE UPDATE ON timetable_schedule_versions
BEGIN
  SELECT RAISE(ABORT, 'timetable schedule version is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_schedule_versions_immutable_delete
BEFORE DELETE ON timetable_schedule_versions
BEGIN
  SELECT RAISE(ABORT, 'timetable schedule version is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_schedule_version_entries_validate_insert
BEFORE INSERT ON timetable_schedule_version_entries
BEGIN
  SELECT RAISE(ABORT, 'timetable version entry scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM timetable_schedule_versions version
    WHERE version.id = NEW.version_id
      AND version.school_id = NEW.school_id
      AND version.academic_year_id = NEW.academic_year_id
  );

  SELECT RAISE(ABORT, 'timetable version entry slot scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM timetable_slots slot
    WHERE slot.id = NEW.slot_id
      AND slot.school_id = NEW.school_id
      AND slot.academic_year_id = NEW.academic_year_id
  );

  SELECT RAISE(ABORT, 'timetable version entry load scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM timetable_teaching_loads load
    WHERE load.id = NEW.teaching_load_id
      AND load.school_id = NEW.school_id
      AND load.academic_year_id = NEW.academic_year_id
  );
END;


-- Draft attendance still needs its live lesson. Confirmed/cancelled sessions
-- already contain historical snapshots and are preserved without modification.
CREATE TRIGGER trg_timetable_clear_preserve_attendance_drafts
BEFORE INSERT ON timetable_schedule_versions
WHEN NEW.source = 'manual_clear'
BEGIN
  SELECT RAISE(ABORT, 'timetable clear draft attendance pending')
  WHERE EXISTS (
    SELECT 1 FROM lesson_attendance_sessions session
    JOIN timetable_entries entry ON entry.id = session.timetable_entry_id
      AND entry.school_id = session.school_id AND entry.academic_year_id = session.academic_year_id
    WHERE session.school_id = NEW.school_id AND session.academic_year_id = NEW.academic_year_id
      AND session.status = 'draft'
  );
END;
PRAGMA defer_foreign_keys = OFF;
