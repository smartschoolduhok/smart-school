-- Phase 18A.1: weekly timetable structure and canonical teaching loads.
-- day_of_week uses the stable mapping 0=Sunday through 6=Saturday.

CREATE TABLE IF NOT EXISTS timetable_days (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id         INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  day_of_week       INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_active         INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  order_index       INTEGER NOT NULL DEFAULT 0 CHECK (order_index >= 0),
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (school_id, academic_year_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_timetable_days_school_year
ON timetable_days(school_id, academic_year_id, order_index);

CREATE TABLE IF NOT EXISTS timetable_slots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id         INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  day_of_week       INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  slot_index        INTEGER NOT NULL CHECK (slot_index > 0),
  slot_type         TEXT NOT NULL CHECK (slot_type IN ('lesson', 'break')),
  lesson_number     INTEGER,
  label             TEXT NOT NULL CHECK (length(trim(label)) > 0),
  start_time        TEXT NOT NULL CHECK (
    length(start_time) = 5
    AND start_time GLOB '[0-2][0-9]:[0-5][0-9]'
    AND CAST(substr(start_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23
  ),
  end_time          TEXT NOT NULL CHECK (
    length(end_time) = 5
    AND end_time GLOB '[0-2][0-9]:[0-5][0-9]'
    AND CAST(substr(end_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23
  ),
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (start_time < end_time),
  CHECK (
    (slot_type = 'lesson' AND lesson_number IS NOT NULL AND lesson_number > 0)
    OR (slot_type = 'break' AND lesson_number IS NULL)
  ),
  UNIQUE (school_id, academic_year_id, day_of_week, slot_index),
  FOREIGN KEY (school_id, academic_year_id, day_of_week)
    REFERENCES timetable_days(school_id, academic_year_id, day_of_week)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_timetable_slots_school_year_day
ON timetable_slots(school_id, academic_year_id, day_of_week, slot_index);

CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_slots_lesson_number
ON timetable_slots(school_id, academic_year_id, day_of_week, lesson_number)
WHERE slot_type = 'lesson';

CREATE TABLE IF NOT EXISTS timetable_teaching_loads (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id           INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id    INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  class_id             INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  section_id           INTEGER REFERENCES sections(id) ON DELETE RESTRICT,
  subject_id           INTEGER NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  employee_id          INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  weekly_periods       INTEGER NOT NULL CHECK (weekly_periods > 0),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at           INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_timetable_loads_school_year
ON timetable_teaching_loads(school_id, academic_year_id);

CREATE INDEX IF NOT EXISTS idx_timetable_loads_placement
ON timetable_teaching_loads(school_id, academic_year_id, class_id, section_id, status);

CREATE INDEX IF NOT EXISTS idx_timetable_loads_employee
ON timetable_teaching_loads(school_id, academic_year_id, employee_id, status);

-- SQLite treats NULL values as distinct in ordinary UNIQUE constraints. These
-- complementary partial indexes make one active canonical load per placement.
CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_loads_active_without_section
ON timetable_teaching_loads(school_id, academic_year_id, class_id, subject_id)
WHERE status = 'active' AND section_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_loads_active_with_section
ON timetable_teaching_loads(school_id, academic_year_id, class_id, section_id, subject_id)
WHERE status = 'active' AND section_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_timetable_days_validate_insert
BEFORE INSERT ON timetable_days
BEGIN
  SELECT RAISE(ABORT, 'timetable academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_days_validate_update
BEFORE UPDATE OF school_id, academic_year_id ON timetable_days
BEGIN
  SELECT RAISE(ABORT, 'timetable academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_slots_validate_insert
BEFORE INSERT ON timetable_slots
BEGIN
  SELECT RAISE(ABORT, 'timetable slot day mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM timetable_days
    WHERE school_id = NEW.school_id
      AND academic_year_id = NEW.academic_year_id
      AND day_of_week = NEW.day_of_week
  );

  SELECT RAISE(ABORT, 'timetable slot overlap')
  WHERE EXISTS (
    SELECT 1 FROM timetable_slots existing
    WHERE existing.school_id = NEW.school_id
      AND existing.academic_year_id = NEW.academic_year_id
      AND existing.day_of_week = NEW.day_of_week
      AND existing.start_time < NEW.end_time
      AND existing.end_time > NEW.start_time
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_slots_validate_update
BEFORE UPDATE OF school_id, academic_year_id, day_of_week, start_time, end_time
ON timetable_slots
BEGIN
  SELECT RAISE(ABORT, 'timetable slot day mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM timetable_days
    WHERE school_id = NEW.school_id
      AND academic_year_id = NEW.academic_year_id
      AND day_of_week = NEW.day_of_week
  );

  SELECT RAISE(ABORT, 'timetable slot overlap')
  WHERE EXISTS (
    SELECT 1 FROM timetable_slots existing
    WHERE existing.school_id = NEW.school_id
      AND existing.academic_year_id = NEW.academic_year_id
      AND existing.day_of_week = NEW.day_of_week
      AND existing.id <> OLD.id
      AND existing.start_time < NEW.end_time
      AND existing.end_time > NEW.start_time
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_loads_validate_insert
BEFORE INSERT ON timetable_teaching_loads
BEGIN
  SELECT RAISE(ABORT, 'timetable load academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'timetable load class invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM classes
    WHERE id = NEW.class_id AND school_id = NEW.school_id AND status = 'active'
  );

  SELECT RAISE(ABORT, 'timetable load section invalid')
  WHERE NEW.section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sections
    WHERE id = NEW.section_id AND school_id = NEW.school_id
      AND class_id = NEW.class_id AND status = 'active'
  );

  SELECT RAISE(ABORT, 'timetable load requires section')
  WHERE NEW.section_id IS NULL AND EXISTS (
    SELECT 1 FROM sections
    WHERE school_id = NEW.school_id AND class_id = NEW.class_id AND status = 'active'
  );

  SELECT RAISE(ABORT, 'timetable load subject invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM subjects
    WHERE id = NEW.subject_id AND school_id = NEW.school_id
      AND class_id = NEW.class_id AND status = 'active'
      AND (section_id IS NULL OR section_id = NEW.section_id)
  );

  SELECT RAISE(ABORT, 'timetable load employee invalid')
  WHERE NEW.employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = NEW.employee_id AND school_id = NEW.school_id AND status = 'active'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_loads_validate_update
BEFORE UPDATE OF school_id, academic_year_id, class_id, section_id, subject_id, employee_id, status
ON timetable_teaching_loads
BEGIN
  SELECT RAISE(ABORT, 'timetable load academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'timetable load class invalid')
  WHERE NEW.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM classes
    WHERE id = NEW.class_id AND school_id = NEW.school_id AND status = 'active'
  );

  SELECT RAISE(ABORT, 'timetable load section invalid')
  WHERE NEW.status = 'active' AND NEW.section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sections
    WHERE id = NEW.section_id AND school_id = NEW.school_id
      AND class_id = NEW.class_id AND status = 'active'
  );

  SELECT RAISE(ABORT, 'timetable load requires section')
  WHERE NEW.status = 'active' AND NEW.section_id IS NULL AND EXISTS (
    SELECT 1 FROM sections
    WHERE school_id = NEW.school_id AND class_id = NEW.class_id AND status = 'active'
  );

  SELECT RAISE(ABORT, 'timetable load subject invalid')
  WHERE NEW.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM subjects
    WHERE id = NEW.subject_id AND school_id = NEW.school_id
      AND class_id = NEW.class_id AND status = 'active'
      AND (section_id IS NULL OR section_id = NEW.section_id)
  );

  SELECT RAISE(ABORT, 'timetable load employee invalid')
  WHERE NEW.status = 'active' AND NEW.employee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = NEW.employee_id AND school_id = NEW.school_id AND status = 'active'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_days_updated_at
AFTER UPDATE ON timetable_days
BEGIN
  UPDATE timetable_days SET updated_at = unixepoch() WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_slots_updated_at
AFTER UPDATE ON timetable_slots
BEGIN
  UPDATE timetable_slots SET updated_at = unixepoch() WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_loads_updated_at
AFTER UPDATE ON timetable_teaching_loads
BEGIN
  UPDATE timetable_teaching_loads SET updated_at = unixepoch() WHERE id = NEW.id;
END;
