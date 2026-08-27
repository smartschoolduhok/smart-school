-- Phase 17A.1: permanent annual student enrollment foundation.
-- Legacy students.class_id / students.section_id remain unchanged for compatibility.
CREATE TABLE IF NOT EXISTS student_enrollments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id           INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id          INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  academic_year_id    INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  class_id            INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  section_id          INTEGER REFERENCES sections(id) ON DELETE RESTRICT,
  status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'transferred', 'withdrawn', 'cancelled')),
  promotion_status    TEXT NOT NULL DEFAULT 'pending'
    CHECK (promotion_status IN ('pending', 'promoted', 'repeated', 'graduated', 'not_applicable')),
  enrolled_at         INTEGER DEFAULT (unixepoch()),
  completed_at        INTEGER,
  notes               TEXT,
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          INTEGER DEFAULT (unixepoch()),
  updated_at          INTEGER DEFAULT (unixepoch()),
  UNIQUE (school_id, student_id, academic_year_id)
);

-- The unique index covers school_id as its leading column.
CREATE INDEX IF NOT EXISTS idx_student_enrollments_student_id
ON student_enrollments(student_id);

CREATE INDEX IF NOT EXISTS idx_student_enrollments_academic_year_id
ON student_enrollments(academic_year_id);

CREATE INDEX IF NOT EXISTS idx_student_enrollments_school_year
ON student_enrollments(school_id, academic_year_id);

CREATE INDEX IF NOT EXISTS idx_student_enrollments_class_id
ON student_enrollments(class_id);

CREATE INDEX IF NOT EXISTS idx_student_enrollments_section_id
ON student_enrollments(section_id);

CREATE INDEX IF NOT EXISTS idx_student_enrollments_status
ON student_enrollments(status);

-- SQLite foreign keys validate existence, while these triggers enforce tenant
-- ownership and the selected section's membership in the selected class.
CREATE TRIGGER IF NOT EXISTS trg_student_enrollments_validate_insert
BEFORE INSERT ON student_enrollments
BEGIN
  SELECT RAISE(ABORT, 'student enrollment student school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = NEW.student_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'student enrollment academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'student enrollment class school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM classes
    WHERE id = NEW.class_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'student enrollment section placement mismatch')
  WHERE NEW.section_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM sections
      WHERE id = NEW.section_id
        AND school_id = NEW.school_id
        AND class_id = NEW.class_id
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_student_enrollments_validate_update
BEFORE UPDATE OF school_id, student_id, academic_year_id, class_id, section_id
ON student_enrollments
BEGIN
  SELECT RAISE(ABORT, 'student enrollment student school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM students
    WHERE id = NEW.student_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'student enrollment academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'student enrollment class school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM classes
    WHERE id = NEW.class_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'student enrollment section placement mismatch')
  WHERE NEW.section_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM sections
      WHERE id = NEW.section_id
        AND school_id = NEW.school_id
        AND class_id = NEW.class_id
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_student_enrollments_updated_at
AFTER UPDATE ON student_enrollments
FOR EACH ROW
BEGIN
  UPDATE student_enrollments SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- Deterministically preserve the current legacy placement for the one active
-- academic year. Invalid legacy cross-school relationships abort the migration
-- through the validation trigger rather than being silently rewritten.
INSERT INTO student_enrollments (
  school_id,
  student_id,
  academic_year_id,
  class_id,
  section_id,
  status,
  promotion_status
)
SELECT
  student.school_id,
  student.id,
  academic_year.id,
  student.class_id,
  student.section_id,
  'active',
  'pending'
FROM students AS student
INNER JOIN academic_years AS academic_year
  ON academic_year.school_id = student.school_id
 AND academic_year.is_active = 1
WHERE student.class_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM student_enrollments AS existing_enrollment
    WHERE existing_enrollment.school_id = student.school_id
      AND existing_enrollment.student_id = student.id
      AND existing_enrollment.academic_year_id = academic_year.id
  );
