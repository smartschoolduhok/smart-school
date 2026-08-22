-- Flexible per-school grade input scheme.
-- Existing schools retain the legacy monthly/exam behavior through defaults.
ALTER TABLE grades ADD COLUMN first_term_grade REAL;
ALTER TABLE grades ADD COLUMN second_term_grade REAL;

ALTER TABLE grade_settings ADD COLUMN first_term_input_mode TEXT NOT NULL DEFAULT 'monthly'
  CHECK (first_term_input_mode IN ('monthly', 'direct', 'disabled'));
ALTER TABLE grade_settings ADD COLUMN second_term_input_mode TEXT NOT NULL DEFAULT 'monthly'
  CHECK (second_term_input_mode IN ('monthly', 'direct', 'disabled'));
ALTER TABLE grade_settings ADD COLUMN mid_year_exam_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (mid_year_exam_enabled IN (0, 1));
ALTER TABLE grade_settings ADD COLUMN final_exam_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (final_exam_enabled IN (0, 1));
ALTER TABLE grade_settings ADD COLUMN completion_exam_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (completion_exam_enabled IN (0, 1));
