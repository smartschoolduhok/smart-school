-- Phase 20B: resource-level access links for parents and teachers.
-- These links are authoritative. Names, email addresses and phone numbers are
-- deliberately not used to infer access to a student or employee record.

CREATE TABLE IF NOT EXISTS parent_student_links (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id           INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  parent_user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id          INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relationship        TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (school_id, parent_user_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_student_links_parent
ON parent_student_links(school_id, parent_user_id, status, student_id);

CREATE INDEX IF NOT EXISTS idx_parent_student_links_student
ON parent_student_links(school_id, student_id, status, parent_user_id);

CREATE TABLE IF NOT EXISTS teacher_employee_links (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id           INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id         INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (school_id, teacher_user_id),
  UNIQUE (school_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_employee_links_user
ON teacher_employee_links(school_id, teacher_user_id, status, employee_id);

CREATE INDEX IF NOT EXISTS idx_teacher_employee_links_employee
ON teacher_employee_links(school_id, employee_id, status, teacher_user_id);

CREATE TRIGGER IF NOT EXISTS trg_parent_student_links_validate_insert
BEFORE INSERT ON parent_student_links
BEGIN
  SELECT RAISE(ABORT, 'parent access user invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM users user_record
    JOIN roles role_record ON role_record.id = user_record.role_id
    WHERE user_record.id = NEW.parent_user_id
      AND user_record.school_id = NEW.school_id
      AND user_record.status = 'active'
      AND role_record.key = 'parent'
  );
  SELECT RAISE(ABORT, 'parent access student invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = NEW.student_id AND school_id = NEW.school_id
  );
  SELECT RAISE(ABORT, 'parent access creator invalid')
  WHERE NEW.created_by_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.created_by_user_id
        AND (school_id = NEW.school_id OR school_id IS NULL)
        AND status = 'active'
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_parent_student_links_validate_update
BEFORE UPDATE OF school_id, parent_user_id, student_id, status ON parent_student_links
BEGIN
  SELECT RAISE(ABORT, 'parent access user invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM users user_record
    JOIN roles role_record ON role_record.id = user_record.role_id
    WHERE user_record.id = NEW.parent_user_id
      AND user_record.school_id = NEW.school_id
      AND user_record.status = 'active'
      AND role_record.key = 'parent'
  );
  SELECT RAISE(ABORT, 'parent access student invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = NEW.student_id AND school_id = NEW.school_id
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_teacher_employee_links_validate_insert
BEFORE INSERT ON teacher_employee_links
BEGIN
  SELECT RAISE(ABORT, 'teacher access user invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM users user_record
    JOIN roles role_record ON role_record.id = user_record.role_id
    WHERE user_record.id = NEW.teacher_user_id
      AND user_record.school_id = NEW.school_id
      AND user_record.status = 'active'
      AND role_record.key = 'teacher'
  );
  SELECT RAISE(ABORT, 'teacher access employee invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = NEW.employee_id
      AND school_id = NEW.school_id
      AND status = 'active'
      AND role = 'teacher'
  );
  SELECT RAISE(ABORT, 'teacher access creator invalid')
  WHERE NEW.created_by_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.created_by_user_id
        AND (school_id = NEW.school_id OR school_id IS NULL)
        AND status = 'active'
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_teacher_employee_links_validate_update
BEFORE UPDATE OF school_id, teacher_user_id, employee_id, status ON teacher_employee_links
BEGIN
  SELECT RAISE(ABORT, 'teacher access user invalid')
  WHERE NOT EXISTS (
    SELECT 1
    FROM users user_record
    JOIN roles role_record ON role_record.id = user_record.role_id
    WHERE user_record.id = NEW.teacher_user_id
      AND user_record.school_id = NEW.school_id
      AND user_record.status = 'active'
      AND role_record.key = 'teacher'
  );
  SELECT RAISE(ABORT, 'teacher access employee invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM employees
    WHERE id = NEW.employee_id
      AND school_id = NEW.school_id
      AND status = 'active'
      AND role = 'teacher'
  );
END;
