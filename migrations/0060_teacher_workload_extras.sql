-- Report-only workload: deliberately unrelated to timetable loads or entries.
CREATE TABLE teacher_workload_extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  subject_name TEXT NOT NULL CHECK(length(trim(subject_name)) BETWEEN 1 AND 120 AND subject_name=trim(subject_name)),
  weekly_periods INTEGER NOT NULL CHECK(typeof(weekly_periods)='integer' AND weekly_periods BETWEEN 1 AND 60),
  version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(version)='integer' AND version>0),
  created_by_user_id INTEGER REFERENCES users(id),
  updated_by_user_id INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER
);
CREATE UNIQUE INDEX idx_workload_extra_subject ON teacher_workload_extras(school_id,academic_year_id,employee_id,subject_name) WHERE deleted_at IS NULL;
CREATE INDEX idx_workload_extra_scope ON teacher_workload_extras(school_id,academic_year_id,deleted_at);
-- Tenant references are permanent; active-teacher eligibility is checked atomically by the API
-- so a historical record remains restorable after its employee is archived.
CREATE TRIGGER trg_workload_extra_insert BEFORE INSERT ON teacher_workload_extras BEGIN
  SELECT RAISE(ABORT,'workload_extra_invalid_scope') WHERE NOT EXISTS (
    SELECT 1 FROM academic_years y JOIN employees e ON e.school_id=y.school_id
    WHERE y.id=NEW.academic_year_id AND y.school_id=NEW.school_id AND e.id=NEW.employee_id);
END;
CREATE TRIGGER trg_workload_extra_update BEFORE UPDATE ON teacher_workload_extras BEGIN
  SELECT RAISE(ABORT,'workload_extra_immutable_identity') WHERE NEW.id!=OLD.id OR NEW.school_id!=OLD.school_id
    OR NEW.academic_year_id!=OLD.academic_year_id OR NEW.employee_id!=OLD.employee_id
    OR NEW.created_at!=OLD.created_at OR NEW.created_by_user_id IS NOT OLD.created_by_user_id;
  SELECT RAISE(ABORT,'workload_extra_invalid_version') WHERE NEW.version!=OLD.version+1 OR OLD.deleted_at IS NOT NULL;
  SELECT RAISE(ABORT,'workload_extra_invalid_scope') WHERE NOT EXISTS (
    SELECT 1 FROM academic_years y JOIN employees e ON e.school_id=y.school_id
    WHERE y.id=NEW.academic_year_id AND y.school_id=NEW.school_id AND e.id=NEW.employee_id);
END;
