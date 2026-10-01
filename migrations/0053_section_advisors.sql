-- One adviser per school/year/placement. Clearing keeps the revision so that
-- an older browser cannot silently recreate a superseded assignment.
CREATE TABLE section_advisors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  section_id INTEGER REFERENCES sections(id) ON DELETE RESTRICT,
  employee_id INTEGER REFERENCES employees(id) ON DELETE RESTRICT,
  attendance_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (attendance_confirmed IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (employee_id IS NOT NULL OR (attendance_confirmed = 0 AND notes = ''))
);
CREATE UNIQUE INDEX idx_section_advisors_placement
  ON section_advisors(school_id, academic_year_id, class_id, coalesce(section_id, 0));
CREATE INDEX idx_section_advisors_teacher ON section_advisors(school_id, academic_year_id, employee_id);

-- Validate identity, not present-day eligibility: old assignments must remain
-- inspectable/restorable after a teacher or a timetable becomes inactive.
CREATE TRIGGER trg_section_advisors_scope_insert BEFORE INSERT ON section_advisors
BEGIN
  SELECT RAISE(ABORT, 'section_advisor_invalid_scope') WHERE
    NOT EXISTS (SELECT 1 FROM academic_years WHERE id=NEW.academic_year_id AND school_id=NEW.school_id)
    OR NOT EXISTS (SELECT 1 FROM classes WHERE id=NEW.class_id AND school_id=NEW.school_id)
    OR (NEW.section_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sections WHERE id=NEW.section_id AND class_id=NEW.class_id AND school_id=NEW.school_id))
    OR (NEW.employee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM employees WHERE id=NEW.employee_id AND school_id=NEW.school_id))
    OR NOT EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=NEW.created_by_user_id AND (u.school_id=NEW.school_id OR r.key='system_admin'))
    OR NOT EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=NEW.updated_by_user_id AND (u.school_id=NEW.school_id OR r.key='system_admin'));
END;
CREATE TRIGGER trg_section_advisors_scope_update BEFORE UPDATE ON section_advisors
BEGIN
  SELECT RAISE(ABORT, 'section_advisor_immutable_identity') WHERE
    NEW.id IS NOT OLD.id OR NEW.school_id IS NOT OLD.school_id OR NEW.academic_year_id IS NOT OLD.academic_year_id
    OR NEW.class_id IS NOT OLD.class_id OR NEW.section_id IS NOT OLD.section_id
    OR NEW.created_by_user_id IS NOT OLD.created_by_user_id OR NEW.created_at IS NOT OLD.created_at;
  SELECT RAISE(ABORT, 'section_advisor_invalid_version') WHERE NEW.version != OLD.version + 1;
  SELECT RAISE(ABORT, 'section_advisor_invalid_scope') WHERE
    (NEW.employee_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM employees WHERE id=NEW.employee_id AND school_id=NEW.school_id))
    OR NOT EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=NEW.updated_by_user_id AND (u.school_id=NEW.school_id OR r.key='system_admin'));
END;

-- Adviser history is a placement reference even when its current assignment
-- has been cleared. Moving a referenced section would change that history.
CREATE TRIGGER trg_section_advisors_preserve_section BEFORE UPDATE OF school_id, class_id ON sections
WHEN (NEW.school_id IS NOT OLD.school_id OR NEW.class_id IS NOT OLD.class_id)
  AND EXISTS (SELECT 1 FROM section_advisors WHERE section_id=OLD.id)
BEGIN SELECT RAISE(ABORT, 'section_advisor_referenced_placement'); END;
