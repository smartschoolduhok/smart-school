-- ============================================================
-- Phase 4: Grades Entry & Academic Calculations
-- Smart School System - Cloudflare D1 (SQLite)
-- ============================================================

-- TABLE: grades
-- Stores monthly marks, term averages, final calculations per student-subject
-- Only one grade row per active student_subject_id allowed.
-- Soft-delete via is_active; never hard-delete to preserve audit trail.
CREATE TABLE IF NOT EXISTS grades (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id                 INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_subject_id        INTEGER NOT NULL UNIQUE REFERENCES student_subjects(id) ON DELETE CASCADE,

  -- Monthly marks (0 .. max_grade, or NULL if not entered yet)
  first_month               REAL,
  second_month              REAL,
  third_month               REAL,
  fourth_month              REAL,

  -- Term averages (auto-calculated, may be NULL if inputs missing)
  first_term_average        REAL,
  second_term_average       REAL,

  -- Exam scores
  mid_year_exam             REAL,
  final_exam                REAL,
  completion_exam           REAL,    -- allowed only for failing students

  -- Derived grades (auto-calculated)
  annual_effort             REAL,
  final_grade               REAL,
  grade_after_completion    REAL,
  effective_grade           REAL,    -- max(final_grade, completion_exam) or final_grade

  -- Status flags (derived from effective_grade vs passing/exemption rules)
  result_status             TEXT,    -- ناجح (passed), مكمل (incomplete), راسب (failed)
  exemption_status          INTEGER DEFAULT 0,  -- 1 = معفى (exempt)

  notes                     TEXT,
  is_active                 INTEGER NOT NULL DEFAULT 1,
  created_at                INTEGER DEFAULT (unixepoch()),
  updated_at                INTEGER DEFAULT (unixepoch()),
  updated_by_user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes on grades
CREATE INDEX IF NOT EXISTS idx_grades_school_id          ON grades(school_id);
CREATE INDEX IF NOT EXISTS idx_grades_student_subject_id ON grades(student_subject_id);
CREATE INDEX IF NOT EXISTS idx_grades_result_status      ON grades(result_status);
CREATE INDEX IF NOT EXISTS idx_grades_is_active          ON grades(is_active);

-- TABLE: grade_change_logs
-- Audit trail: every PUT /api/grades/:id records a row per changed field.
CREATE TABLE IF NOT EXISTS grade_change_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id         INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  grade_id          INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  field_name        TEXT NOT NULL,
  old_value         TEXT,
  new_value         TEXT,
  changed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  change_reason     TEXT,
  created_at        INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_grade_logs_grade_id   ON grade_change_logs(grade_id);
CREATE INDEX IF NOT EXISTS idx_grade_logs_school_id  ON grade_change_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_grade_logs_created_at ON grade_change_logs(created_at);

-- TABLE: grade_settings
-- Per-school passing thresholds, max grades, and formula text (read-only reference).
CREATE TABLE IF NOT EXISTS grade_settings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id           INTEGER NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,

  max_grade           REAL NOT NULL DEFAULT 100,
  passing_grade       REAL NOT NULL DEFAULT 50,
  exemption_grade     REAL NOT NULL DEFAULT 90,   -- above this => معفى (المتفوقون)

  -- Formula descriptions (stored as text for UI display / transparency)
  first_term_formula      TEXT DEFAULT 'first_term_average = round((first_month + second_month) / 2)',
  second_term_formula     TEXT DEFAULT 'second_term_average = round((third_month + fourth_month) / 2)',
  annual_effort_formula   TEXT DEFAULT 'annual_effort = round(avg(first_term_average, mid_year_exam, second_term_average))',
  final_grade_formula     TEXT DEFAULT 'final_grade = round(avg(annual_effort, final_exam))',
  completion_formula      TEXT DEFAULT 'grade_after_completion = max(final_grade, completion_exam)',
  effective_formula       TEXT DEFAULT 'effective_grade = grade_after_completion ?? final_grade',

  created_at          INTEGER DEFAULT (unixepoch()),
  updated_at          INTEGER DEFAULT (unixepoch()),
  updated_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_grade_settings_school_id ON grade_settings(school_id);

-- Trigger: auto-update grades.updated_at on every UPDATE
CREATE TRIGGER IF NOT EXISTS trg_grades_updated_at
AFTER UPDATE ON grades
FOR EACH ROW
BEGIN
  UPDATE grades SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- Trigger: auto-update grade_settings.updated_at on every UPDATE
CREATE TRIGGER IF NOT EXISTS trg_grade_settings_updated_at
AFTER UPDATE ON grade_settings
FOR EACH ROW
BEGIN
  UPDATE grade_settings SET updated_at = unixepoch() WHERE id = NEW.id;
END;
