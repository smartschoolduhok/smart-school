-- Phase 18A.6: authoritative timetable adoption, persistent locks, revisions,
-- and immutable schedule versions.

ALTER TABLE timetable_entries
ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1));

CREATE TABLE IF NOT EXISTS timetable_revisions (
  school_id         INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  revision          INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (school_id, academic_year_id)
);

INSERT OR IGNORE INTO timetable_revisions (school_id, academic_year_id, revision)
SELECT school_id, id, 0 FROM academic_years;

CREATE INDEX IF NOT EXISTS idx_timetable_revisions_year
ON timetable_revisions(academic_year_id, school_id);

CREATE TRIGGER IF NOT EXISTS trg_timetable_revisions_validate_insert
BEFORE INSERT ON timetable_revisions
BEGIN
  SELECT RAISE(ABORT, 'timetable revision academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_revisions_validate_update
BEFORE UPDATE OF school_id, academic_year_id, revision ON timetable_revisions
BEGIN
  SELECT RAISE(ABORT, 'timetable revision academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );
END;

-- A short-lived assertion row is inserted as the first statement of an
-- adoption/restore D1 batch. The trigger turns the expected revision check into
-- a compare-and-swap guard in the same atomic operation as the replacement.
CREATE TABLE IF NOT EXISTS timetable_revision_assertions (
  token             TEXT PRIMARY KEY CHECK (length(trim(token)) > 0),
  school_id         INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_timetable_revision_assertions_scope
ON timetable_revision_assertions(school_id, academic_year_id);

CREATE TRIGGER IF NOT EXISTS trg_timetable_revision_assertions_validate_insert
BEFORE INSERT ON timetable_revision_assertions
BEGIN
  SELECT RAISE(ABORT, 'timetable assertion academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'stale_timetable_proposal')
  WHERE COALESCE((
    SELECT revision FROM timetable_revisions
    WHERE school_id = NEW.school_id AND academic_year_id = NEW.academic_year_id
  ), 0) != NEW.expected_revision;
END;

CREATE TABLE IF NOT EXISTS timetable_schedule_versions (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  version_key              TEXT NOT NULL UNIQUE CHECK (length(trim(version_key)) > 0),
  school_id                INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id         INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  source                   TEXT NOT NULL CHECK (source IN ('automatic_adoption', 'manual_restore')),
  previous_revision        INTEGER NOT NULL CHECK (previous_revision >= 0),
  created_by_user_id       INTEGER,
  restored_from_version_id INTEGER REFERENCES timetable_schedule_versions(id) ON DELETE RESTRICT,
  old_entry_count          INTEGER NOT NULL CHECK (old_entry_count >= 0),
  new_entry_count          INTEGER NOT NULL CHECK (new_entry_count >= 0),
  locked_entry_count       INTEGER NOT NULL CHECK (locked_entry_count >= 0),
  proposal_digest          TEXT NOT NULL CHECK (length(trim(proposal_digest)) > 0),
  created_at               INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_timetable_schedule_versions_scope_created
ON timetable_schedule_versions(school_id, academic_year_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS timetable_schedule_version_entries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id        INTEGER NOT NULL REFERENCES timetable_schedule_versions(id) ON DELETE RESTRICT,
  original_entry_id INTEGER,
  school_id         INTEGER NOT NULL,
  academic_year_id  INTEGER NOT NULL,
  slot_id           INTEGER NOT NULL,
  teaching_load_id  INTEGER NOT NULL,
  is_locked         INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (version_id, slot_id, teaching_load_id)
);

CREATE INDEX IF NOT EXISTS idx_timetable_schedule_version_entries_version
ON timetable_schedule_version_entries(version_id, teaching_load_id, slot_id);

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

CREATE TRIGGER IF NOT EXISTS trg_timetable_schedule_version_entries_immutable_update
BEFORE UPDATE ON timetable_schedule_version_entries
BEGIN
  SELECT RAISE(ABORT, 'timetable schedule version entry is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_schedule_version_entries_immutable_delete
BEFORE DELETE ON timetable_schedule_version_entries
BEGIN
  SELECT RAISE(ABORT, 'timetable schedule version entry is immutable');
END;

-- Explicit, short-lived authorization for a deliberate manual unlock combined
-- with an unlock, move, or delete. Ordinary SQL cannot silently alter a lock.
CREATE TABLE IF NOT EXISTS timetable_locked_entry_overrides (
  token             TEXT PRIMARY KEY CHECK (length(trim(token)) > 0),
  entry_id          INTEGER NOT NULL REFERENCES timetable_entries(id) ON DELETE CASCADE,
  school_id         INTEGER NOT NULL,
  academic_year_id  INTEGER NOT NULL,
  action            TEXT NOT NULL CHECK (action IN ('unlock', 'move', 'delete')),
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_timetable_locked_entry_overrides_entry
ON timetable_locked_entry_overrides(entry_id, school_id, academic_year_id, action);

CREATE TRIGGER IF NOT EXISTS trg_timetable_locked_entry_overrides_validate_insert
BEFORE INSERT ON timetable_locked_entry_overrides
BEGIN
  SELECT RAISE(ABORT, 'timetable locked entry override scope mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM timetable_entries entry
    WHERE entry.id = NEW.entry_id
      AND entry.school_id = NEW.school_id
      AND entry.academic_year_id = NEW.academic_year_id
      AND entry.is_locked = 1
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_entries_require_unlock_for_move
BEFORE UPDATE OF slot_id, teaching_load_id ON timetable_entries
WHEN OLD.is_locked = 1
  AND (NEW.slot_id != OLD.slot_id OR NEW.teaching_load_id != OLD.teaching_load_id)
  AND NOT EXISTS (
    SELECT 1 FROM timetable_locked_entry_overrides override
    WHERE override.entry_id = OLD.id
      AND override.school_id = OLD.school_id
      AND override.academic_year_id = OLD.academic_year_id
      AND override.action = 'move'
  )
BEGIN
  SELECT RAISE(ABORT, 'timetable locked entry requires explicit unlock');
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_entries_require_override_for_unlock
BEFORE UPDATE OF is_locked ON timetable_entries
WHEN OLD.is_locked = 1 AND NEW.is_locked = 0
  AND NOT EXISTS (
    SELECT 1 FROM timetable_locked_entry_overrides override
    WHERE override.entry_id = OLD.id
      AND override.school_id = OLD.school_id
      AND override.academic_year_id = OLD.academic_year_id
      AND override.action IN ('unlock', 'move', 'delete')
  )
BEGIN
  SELECT RAISE(ABORT, 'timetable locked entry requires explicit unlock');
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_entries_require_unlock_for_delete
BEFORE DELETE ON timetable_entries
WHEN OLD.is_locked = 1
  AND NOT EXISTS (
    SELECT 1 FROM timetable_locked_entry_overrides override
    WHERE override.entry_id = OLD.id
      AND override.school_id = OLD.school_id
      AND override.academic_year_id = OLD.academic_year_id
      AND override.action = 'delete'
  )
BEGIN
  SELECT RAISE(ABORT, 'timetable locked entry requires explicit unlock');
END;

-- Revision helpers. UPDATE triggers name the business columns explicitly so
-- existing updated_at maintenance triggers do not double-count one mutation.
CREATE TRIGGER IF NOT EXISTS trg_timetable_days_revision_insert
AFTER INSERT ON timetable_days
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (NEW.school_id, NEW.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_days_revision_update
AFTER UPDATE OF school_id, academic_year_id, day_of_week, is_active, order_index ON timetable_days
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (NEW.school_id, NEW.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_days_revision_delete
AFTER DELETE ON timetable_days
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (OLD.school_id, OLD.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_slots_revision_insert
AFTER INSERT ON timetable_slots
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (NEW.school_id, NEW.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_slots_revision_update
AFTER UPDATE OF school_id, academic_year_id, day_of_week, slot_index, slot_type,
  lesson_number, label, start_time, end_time, is_active ON timetable_slots
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (NEW.school_id, NEW.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_slots_revision_delete
AFTER DELETE ON timetable_slots
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (OLD.school_id, OLD.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_loads_revision_insert
AFTER INSERT ON timetable_teaching_loads
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (NEW.school_id, NEW.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_loads_revision_update
AFTER UPDATE OF school_id, academic_year_id, class_id, section_id, subject_id,
  employee_id, weekly_periods, status ON timetable_teaching_loads
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (NEW.school_id, NEW.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_loads_revision_delete
AFTER DELETE ON timetable_teaching_loads
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (OLD.school_id, OLD.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_availability_revision_insert
AFTER INSERT ON timetable_teacher_availability
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (NEW.school_id, NEW.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_availability_revision_update
AFTER UPDATE OF school_id, academic_year_id, employee_id, slot_id, status ON timetable_teacher_availability
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (NEW.school_id, NEW.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_availability_revision_delete
AFTER DELETE ON timetable_teacher_availability
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (OLD.school_id, OLD.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_constraints_revision_insert
AFTER INSERT ON timetable_teacher_constraints
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (NEW.school_id, NEW.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_constraints_revision_update
AFTER UPDATE OF school_id, academic_year_id, employee_id, max_periods_per_day,
  max_consecutive_periods, max_working_days, prefer_compact_schedule,
  avoid_first_period, avoid_last_period ON timetable_teacher_constraints
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (NEW.school_id, NEW.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_constraints_revision_delete
AFTER DELETE ON timetable_teacher_constraints
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (OLD.school_id, OLD.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_entries_revision_insert
AFTER INSERT ON timetable_entries
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (NEW.school_id, NEW.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_entries_revision_update
AFTER UPDATE OF school_id, academic_year_id, slot_id, teaching_load_id, is_locked ON timetable_entries
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (NEW.school_id, NEW.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_entries_revision_delete
AFTER DELETE ON timetable_entries
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (OLD.school_id, OLD.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

-- If a still-unreferenced configuration row is deliberately moved between
-- scopes, both the old and new school/year proposals become stale. The normal
-- UPDATE triggers above increment the new scope; these guards increment the
-- old scope as well.
CREATE TRIGGER IF NOT EXISTS trg_timetable_days_revision_rescope
AFTER UPDATE OF school_id, academic_year_id ON timetable_days
WHEN OLD.school_id != NEW.school_id OR OLD.academic_year_id != NEW.academic_year_id
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (OLD.school_id, OLD.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_slots_revision_rescope
AFTER UPDATE OF school_id, academic_year_id ON timetable_slots
WHEN OLD.school_id != NEW.school_id OR OLD.academic_year_id != NEW.academic_year_id
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (OLD.school_id, OLD.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_loads_revision_rescope
AFTER UPDATE OF school_id, academic_year_id ON timetable_teaching_loads
WHEN OLD.school_id != NEW.school_id OR OLD.academic_year_id != NEW.academic_year_id
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (OLD.school_id, OLD.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_availability_revision_rescope
AFTER UPDATE OF school_id, academic_year_id ON timetable_teacher_availability
WHEN OLD.school_id != NEW.school_id OR OLD.academic_year_id != NEW.academic_year_id
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (OLD.school_id, OLD.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_constraints_revision_rescope
AFTER UPDATE OF school_id, academic_year_id ON timetable_teacher_constraints
WHEN OLD.school_id != NEW.school_id OR OLD.academic_year_id != NEW.academic_year_id
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (OLD.school_id, OLD.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_entries_revision_rescope
AFTER UPDATE OF school_id, academic_year_id ON timetable_entries
WHEN OLD.school_id != NEW.school_id OR OLD.academic_year_id != NEW.academic_year_id
BEGIN
  INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
  VALUES (OLD.school_id, OLD.academic_year_id, 1)
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET
    revision = revision + 1, updated_at = unixepoch();
END;
