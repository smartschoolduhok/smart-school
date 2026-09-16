-- Phase 21A: per-lesson student attendance.
-- School-gate scans are intentionally out of scope here. A lesson session is
-- anchored to the official timetable and keeps snapshots so later timetable
-- edits cannot rewrite historical attendance.

CREATE TABLE IF NOT EXISTS lesson_attendance_sessions (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id                INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id         INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  timetable_entry_id       INTEGER NOT NULL,
  session_date             TEXT NOT NULL CHECK (
    length(session_date) = 10
    AND session_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  day_of_week              INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  slot_id                  INTEGER NOT NULL,
  teaching_load_id         INTEGER NOT NULL,
  teacher_employee_id      INTEGER,
  class_id                 INTEGER NOT NULL,
  section_id               INTEGER,
  subject_id               INTEGER NOT NULL,
  lesson_number            INTEGER,
  start_time_snapshot      TEXT NOT NULL,
  end_time_snapshot        TEXT NOT NULL,
  teacher_name_snapshot    TEXT,
  class_name_snapshot      TEXT NOT NULL,
  section_name_snapshot    TEXT,
  subject_name_snapshot    TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed')),
  revision                 INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  confirmed_at             INTEGER,
  confirmed_by_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (school_id, timetable_entry_id, session_date),
  CHECK (
    (status = 'draft' AND confirmed_at IS NULL AND confirmed_by_user_id IS NULL)
    OR (status = 'confirmed' AND confirmed_at IS NOT NULL AND confirmed_by_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_lesson_attendance_sessions_school_date
ON lesson_attendance_sessions(school_id, session_date, status);

CREATE INDEX IF NOT EXISTS idx_lesson_attendance_sessions_teacher_date
ON lesson_attendance_sessions(school_id, teacher_employee_id, session_date);

CREATE INDEX IF NOT EXISTS idx_lesson_attendance_sessions_group_date
ON lesson_attendance_sessions(school_id, academic_year_id, class_id, section_id, session_date);

CREATE TABLE IF NOT EXISTS lesson_attendance_records (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id                INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id               INTEGER NOT NULL REFERENCES lesson_attendance_sessions(id) ON DELETE CASCADE,
  student_id               INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  student_name_snapshot    TEXT NOT NULL,
  student_number_snapshot  TEXT NOT NULL,
  status                   TEXT NOT NULL CHECK (
    status IN ('present', 'absent', 'excused', 'late', 'left_early', 'school_activity')
  ),
  late_minutes             INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes BETWEEN 0 AND 240),
  note                     TEXT CHECK (note IS NULL OR length(note) <= 1000),
  note_visibility          TEXT NOT NULL DEFAULT 'staff'
    CHECK (note_visibility IN ('staff', 'parent')),
  revision                 INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_change_reason       TEXT CHECK (last_change_reason IS NULL OR length(last_change_reason) <= 500),
  created_by_user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (session_id, student_id),
  CHECK (
    (status = 'late' AND late_minutes > 0)
    OR (status <> 'late' AND late_minutes = 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_lesson_attendance_records_student
ON lesson_attendance_records(school_id, student_id, session_id);

CREATE INDEX IF NOT EXISTS idx_lesson_attendance_records_session_status
ON lesson_attendance_records(session_id, status);

CREATE TABLE IF NOT EXISTS lesson_attendance_record_audit (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id                INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id               INTEGER NOT NULL REFERENCES lesson_attendance_sessions(id) ON DELETE CASCADE,
  attendance_record_id     INTEGER NOT NULL REFERENCES lesson_attendance_records(id) ON DELETE CASCADE,
  student_id               INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  old_status               TEXT,
  new_status               TEXT NOT NULL,
  old_late_minutes         INTEGER,
  new_late_minutes         INTEGER NOT NULL,
  old_note                 TEXT,
  new_note                 TEXT,
  old_note_visibility      TEXT,
  new_note_visibility      TEXT NOT NULL,
  change_reason            TEXT,
  changed_by_user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_at               INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_lesson_attendance_audit_record
ON lesson_attendance_record_audit(attendance_record_id, changed_at, id);

CREATE INDEX IF NOT EXISTS idx_lesson_attendance_audit_session
ON lesson_attendance_record_audit(school_id, session_id, changed_at, id);

-- A checked guard makes optimistic writes genuinely atomic in a D1 batch. A
-- stale revision inserts valid=0, violates the CHECK, and rolls back every
-- record change in that batch.
CREATE TABLE IF NOT EXISTS lesson_attendance_write_guards (
  token       TEXT PRIMARY KEY,
  valid       INTEGER NOT NULL CHECK (valid = 1),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TRIGGER IF NOT EXISTS trg_lesson_attendance_sessions_validate_insert
BEFORE INSERT ON lesson_attendance_sessions
BEGIN
  SELECT RAISE(ABORT, 'attendance timetable scope invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM timetable_entries entry
    JOIN timetable_slots slot
      ON slot.id = entry.slot_id
     AND slot.school_id = entry.school_id
     AND slot.academic_year_id = entry.academic_year_id
    JOIN timetable_days day
      ON day.school_id = slot.school_id
     AND day.academic_year_id = slot.academic_year_id
     AND day.day_of_week = slot.day_of_week
    JOIN timetable_teaching_loads load
      ON load.id = entry.teaching_load_id
     AND load.school_id = entry.school_id
     AND load.academic_year_id = entry.academic_year_id
    JOIN academic_years year
      ON year.id = entry.academic_year_id
     AND year.school_id = entry.school_id
    WHERE entry.id = NEW.timetable_entry_id
      AND entry.school_id = NEW.school_id
      AND entry.academic_year_id = NEW.academic_year_id
      AND slot.id = NEW.slot_id
      AND load.id = NEW.teaching_load_id
      AND load.class_id = NEW.class_id
      AND load.section_id IS NEW.section_id
      AND load.subject_id = NEW.subject_id
      AND load.employee_id IS NEW.teacher_employee_id
      AND slot.slot_type = 'lesson'
      AND slot.is_active = 1
      AND day.is_active = 1
      AND slot.day_of_week = NEW.day_of_week
      AND CAST(strftime('%w', NEW.session_date) AS INTEGER) = slot.day_of_week
      AND NEW.session_date BETWEEN year.starts_at AND year.ends_at
  );

  SELECT RAISE(ABORT, 'attendance actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.created_by_user_id
      AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  ) OR NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.updated_by_user_id
      AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_lesson_attendance_sessions_validate_update
BEFORE UPDATE OF school_id, academic_year_id, timetable_entry_id, session_date,
  day_of_week, slot_id, teaching_load_id, teacher_employee_id, class_id,
  section_id, subject_id, lesson_number, start_time_snapshot, end_time_snapshot,
  teacher_name_snapshot, class_name_snapshot, section_name_snapshot,
  subject_name_snapshot, status, revision, confirmed_by_user_id,
  created_by_user_id, updated_by_user_id
ON lesson_attendance_sessions
BEGIN
  SELECT RAISE(ABORT, 'attendance session identity immutable')
  WHERE NEW.school_id != OLD.school_id
     OR NEW.academic_year_id != OLD.academic_year_id
     OR NEW.timetable_entry_id != OLD.timetable_entry_id
     OR NEW.session_date != OLD.session_date
     OR NEW.day_of_week != OLD.day_of_week
     OR NEW.slot_id != OLD.slot_id
     OR NEW.teaching_load_id != OLD.teaching_load_id
     OR NEW.teacher_employee_id IS NOT OLD.teacher_employee_id
     OR NEW.class_id != OLD.class_id
     OR NEW.section_id IS NOT OLD.section_id
     OR NEW.subject_id != OLD.subject_id
     OR NEW.lesson_number IS NOT OLD.lesson_number
     OR NEW.start_time_snapshot != OLD.start_time_snapshot
     OR NEW.end_time_snapshot != OLD.end_time_snapshot
     OR NEW.teacher_name_snapshot IS NOT OLD.teacher_name_snapshot
     OR NEW.class_name_snapshot != OLD.class_name_snapshot
     OR NEW.section_name_snapshot IS NOT OLD.section_name_snapshot
     OR NEW.subject_name_snapshot != OLD.subject_name_snapshot
     OR NEW.created_by_user_id != OLD.created_by_user_id;

  SELECT RAISE(ABORT, 'attendance session cannot return to draft')
  WHERE OLD.status = 'confirmed' AND NEW.status != 'confirmed';

  SELECT RAISE(ABORT, 'attendance actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.updated_by_user_id
      AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_lesson_attendance_records_validate_insert
BEFORE INSERT ON lesson_attendance_records
BEGIN
  SELECT RAISE(ABORT, 'attendance record session mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM lesson_attendance_sessions
    WHERE id = NEW.session_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'attendance student invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = NEW.student_id AND school_id = NEW.school_id AND status = 'active'
  );

  SELECT RAISE(ABORT, 'attendance actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.created_by_user_id
      AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  ) OR NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.updated_by_user_id
      AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_lesson_attendance_records_validate_update
BEFORE UPDATE OF school_id, session_id, student_id, student_name_snapshot,
  student_number_snapshot, created_by_user_id, updated_by_user_id
ON lesson_attendance_records
BEGIN
  SELECT RAISE(ABORT, 'attendance record identity immutable')
  WHERE NEW.school_id != OLD.school_id
     OR NEW.session_id != OLD.session_id
     OR NEW.student_id != OLD.student_id
     OR NEW.student_name_snapshot != OLD.student_name_snapshot
     OR NEW.student_number_snapshot != OLD.student_number_snapshot
     OR NEW.created_by_user_id != OLD.created_by_user_id;

  SELECT RAISE(ABORT, 'attendance actor invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.updated_by_user_id
      AND status = 'active'
      AND (school_id = NEW.school_id OR school_id IS NULL)
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_lesson_attendance_records_audit_insert
AFTER INSERT ON lesson_attendance_records
BEGIN
  INSERT INTO lesson_attendance_record_audit (
    school_id, session_id, attendance_record_id, student_id,
    old_status, new_status, old_late_minutes, new_late_minutes,
    old_note, new_note, old_note_visibility, new_note_visibility,
    change_reason, changed_by_user_id
  ) VALUES (
    NEW.school_id, NEW.session_id, NEW.id, NEW.student_id,
    NULL, NEW.status, NULL, NEW.late_minutes,
    NULL, NEW.note, NULL, NEW.note_visibility,
    NEW.last_change_reason, NEW.updated_by_user_id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_lesson_attendance_records_audit_update
AFTER UPDATE OF status, late_minutes, note, note_visibility
ON lesson_attendance_records
WHEN NEW.status != OLD.status
  OR NEW.late_minutes != OLD.late_minutes
  OR NEW.note IS NOT OLD.note
  OR NEW.note_visibility != OLD.note_visibility
BEGIN
  INSERT INTO lesson_attendance_record_audit (
    school_id, session_id, attendance_record_id, student_id,
    old_status, new_status, old_late_minutes, new_late_minutes,
    old_note, new_note, old_note_visibility, new_note_visibility,
    change_reason, changed_by_user_id
  ) VALUES (
    NEW.school_id, NEW.session_id, NEW.id, NEW.student_id,
    OLD.status, NEW.status, OLD.late_minutes, NEW.late_minutes,
    OLD.note, NEW.note, OLD.note_visibility, NEW.note_visibility,
    NEW.last_change_reason, NEW.updated_by_user_id
  );
END;
