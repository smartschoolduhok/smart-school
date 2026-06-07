-- ===========================================
-- Migration 0014: Excel Import/Export Foundation + Core Data
-- Phase 13A: import_jobs table + employee schema additions
-- ===========================================

-- Add missing employee columns safely (if they don't already exist)
-- These are needed for employee import/export support in Phase 13A

-- gender TEXT nullable
ALTER TABLE employees ADD COLUMN gender TEXT CHECK(gender IN ('male', 'female', 'other') OR gender IS NULL);

-- address TEXT nullable
ALTER TABLE employees ADD COLUMN address TEXT;

-- employee_type TEXT DEFAULT 'other' (distinct from role which is used for system access)
-- Valid types: teacher, administrator, accountant, registrar, principal, worker, driver, other
ALTER TABLE employees ADD COLUMN employee_type TEXT DEFAULT 'other' CHECK(employee_type IN ('teacher', 'administrator', 'accountant', 'registrar', 'principal', 'worker', 'driver', 'other'));

-- salary_type TEXT DEFAULT 'monthly'
ALTER TABLE employees ADD COLUMN salary_type TEXT DEFAULT 'monthly' CHECK(salary_type IN ('monthly', 'hourly', 'daily', 'weekly', 'contract', 'other'));

-- ===========================================
-- import_jobs table: tracks all import operations
-- ===========================================
CREATE TABLE IF NOT EXISTS import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  import_type TEXT NOT NULL,
  file_name TEXT,
  mode TEXT DEFAULT 'skip_existing' CHECK(mode IN ('skip_existing', 'update_existing', 'error_on_existing')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'preview_ready', 'completed', 'failed', 'cancelled')),
  total_rows INTEGER DEFAULT 0,
  valid_rows INTEGER DEFAULT 0,
  error_rows INTEGER DEFAULT 0,
  imported_rows INTEGER DEFAULT 0,
  skipped_rows INTEGER DEFAULT 0,
  updated_rows INTEGER DEFAULT 0,
  summary_json TEXT,
  created_by_user_id INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  completed_at INTEGER,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
);

-- Index for fast lookup by school and status
CREATE INDEX IF NOT EXISTS idx_import_jobs_school_id ON import_jobs(school_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at ON import_jobs(created_at);
