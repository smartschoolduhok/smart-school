-- Phase 18A.2: teacher availability overrides and timetable constraints.
-- Missing availability rows intentionally mean that the teacher is available.

ALTER TABLE timetable_slots
ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));

CREATE TABLE IF NOT EXISTS timetable_teacher_availability (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id           INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id    INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  employee_id         INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  slot_id             INTEGER NOT NULL REFERENCES timetable_slots(id) ON DELETE CASCADE,
  status              TEXT NOT NULL CHECK (status IN ('unavailable', 'preferred', 'avoid')),
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (school_id, academic_year_id, employee_id, slot_id)
);

CREATE INDEX IF NOT EXISTS idx_timetable_teacher_availability_scope
ON timetable_teacher_availability(school_id, academic_year_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_timetable_teacher_availability_slot
ON timetable_teacher_availability(slot_id);

CREATE TABLE IF NOT EXISTS timetable_teacher_constraints (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id                 INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id          INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  employee_id               INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  max_periods_per_day       INTEGER CHECK (max_periods_per_day IS NULL OR max_periods_per_day > 0),
  max_consecutive_periods   INTEGER CHECK (max_consecutive_periods IS NULL OR max_consecutive_periods > 0),
  max_working_days          INTEGER CHECK (max_working_days IS NULL OR max_working_days BETWEEN 1 AND 7),
  prefer_compact_schedule   INTEGER NOT NULL DEFAULT 0 CHECK (prefer_compact_schedule IN (0, 1)),
  avoid_first_period        INTEGER NOT NULL DEFAULT 0 CHECK (avoid_first_period IN (0, 1)),
  avoid_last_period         INTEGER NOT NULL DEFAULT 0 CHECK (avoid_last_period IN (0, 1)),
  created_by_user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at                INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at                INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (school_id, academic_year_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_timetable_teacher_constraints_scope
ON timetable_teacher_constraints(school_id, academic_year_id, employee_id);

CREATE TRIGGER IF NOT EXISTS trg_timetable_slots_preserve_teacher_availability
BEFORE UPDATE OF school_id, academic_year_id, slot_type ON timetable_slots
WHEN EXISTS (
  SELECT 1 FROM timetable_teacher_availability
  WHERE slot_id = OLD.id
)
AND (
  NEW.school_id != OLD.school_id
  OR NEW.academic_year_id != OLD.academic_year_id
  OR NEW.slot_type != 'lesson'
)
BEGIN
  SELECT RAISE(ABORT, 'timetable slot has teacher availability settings');
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_teacher_availability_validate_insert
BEFORE INSERT ON timetable_teacher_availability
BEGIN
  SELECT RAISE(ABORT, 'teacher availability academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'teacher availability employee invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = NEW.employee_id AND school_id = NEW.school_id
      AND status = 'active' AND role = 'teacher'
  );

  SELECT RAISE(ABORT, 'teacher availability slot invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM timetable_slots
    WHERE id = NEW.slot_id AND school_id = NEW.school_id
      AND academic_year_id = NEW.academic_year_id AND slot_type = 'lesson'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_teacher_availability_validate_update
BEFORE UPDATE OF school_id, academic_year_id, employee_id, slot_id, status
ON timetable_teacher_availability
BEGIN
  SELECT RAISE(ABORT, 'teacher availability academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'teacher availability employee invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = NEW.employee_id AND school_id = NEW.school_id
      AND status = 'active' AND role = 'teacher'
  );

  SELECT RAISE(ABORT, 'teacher availability slot invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM timetable_slots
    WHERE id = NEW.slot_id AND school_id = NEW.school_id
      AND academic_year_id = NEW.academic_year_id AND slot_type = 'lesson'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_teacher_constraints_validate_insert
BEFORE INSERT ON timetable_teacher_constraints
BEGIN
  SELECT RAISE(ABORT, 'teacher constraints academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'teacher constraints employee invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = NEW.employee_id AND school_id = NEW.school_id
      AND status = 'active' AND role = 'teacher'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_teacher_constraints_validate_update
BEFORE UPDATE OF school_id, academic_year_id, employee_id,
  max_periods_per_day, max_consecutive_periods, max_working_days,
  prefer_compact_schedule, avoid_first_period, avoid_last_period
ON timetable_teacher_constraints
BEGIN
  SELECT RAISE(ABORT, 'teacher constraints academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'teacher constraints employee invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = NEW.employee_id AND school_id = NEW.school_id
      AND status = 'active' AND role = 'teacher'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_teacher_availability_updated_at
AFTER UPDATE ON timetable_teacher_availability
BEGIN
  UPDATE timetable_teacher_availability SET updated_at = unixepoch() WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_timetable_teacher_constraints_updated_at
AFTER UPDATE ON timetable_teacher_constraints
BEGIN
  UPDATE timetable_teacher_constraints SET updated_at = unixepoch() WHERE id = NEW.id;
END;
