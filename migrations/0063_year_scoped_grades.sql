-- Year-scoped subject assignments and grades.
-- Every student_subjects row (and therefore its single grades row) belongs to
-- one academic year. Activating another year archives the old year's active
-- assignments and grades instead of carrying them into the new year, so a
-- repeating student starts the new year with fresh grade rows. Archived rows
-- stay intact for history and are restored if their year is activated again.

ALTER TABLE student_subjects ADD COLUMN academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE RESTRICT;
ALTER TABLE student_subjects ADD COLUMN year_archived_at INTEGER;
ALTER TABLE grades ADD COLUMN year_archived_at INTEGER;

-- All existing assignments belong to each school's currently active year.
-- A school without an active year keeps NULL until one is activated.
UPDATE student_subjects
SET academic_year_id = (
  SELECT year.id FROM academic_years AS year
  WHERE year.school_id = student_subjects.school_id AND year.is_active = 1
);

CREATE INDEX IF NOT EXISTS idx_student_subjects_school_year
ON student_subjects(school_id, academic_year_id, is_active);

-- New assignments are stamped with the active year, whichever route made them.
CREATE TRIGGER trg_student_subjects_year_insert
AFTER INSERT ON student_subjects
FOR EACH ROW
WHEN NEW.academic_year_id IS NULL
BEGIN
  UPDATE student_subjects
  SET academic_year_id = (
    SELECT id FROM academic_years WHERE school_id = NEW.school_id AND is_active = 1
  )
  WHERE id = NEW.id;
END;

-- An assignment from a year that is not active cannot be switched back on;
-- the new year gets its own row (and its own empty grade row) instead.
CREATE TRIGGER trg_student_subjects_year_reactivate
BEFORE UPDATE OF is_active ON student_subjects
FOR EACH ROW
WHEN NEW.is_active = 1 AND OLD.is_active = 0
  AND NEW.academic_year_id IS NOT NULL
  AND NEW.academic_year_id IS NOT (
    SELECT id FROM academic_years WHERE school_id = NEW.school_id AND is_active = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'student_subject_year_closed');
END;

-- Archived grades are read-only until their year is active again.
CREATE TRIGGER trg_grades_year_archived_update
BEFORE UPDATE OF first_month, second_month, third_month, fourth_month,
  first_term_average, second_term_average, mid_year_exam, final_exam, completion_exam,
  annual_effort, final_grade, grade_after_completion, effective_grade, result_status,
  exemption_status, notes, is_active, first_term_grade, second_term_grade ON grades
FOR EACH ROW
WHEN OLD.year_archived_at IS NOT NULL AND NEW.year_archived_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'grade_year_archived');
END;
