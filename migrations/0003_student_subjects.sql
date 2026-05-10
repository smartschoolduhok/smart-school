-- ============================================================
-- نظام المدرسة الذكي - Smart School System
-- Phase 3: Student Subject Assignment
-- Tables: student_subjects
-- Compatible with Cloudflare D1 (SQLite)
-- ============================================================

-- TABLE: student_subjects
-- Links students to their assigned subjects
-- Active assignments are used by the grades module later
CREATE TABLE IF NOT EXISTS student_subjects (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id           INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id          INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id          INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id            INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  section_id          INTEGER REFERENCES sections(id) ON DELETE CASCADE,
  is_active           INTEGER NOT NULL DEFAULT 1,  -- 1 = active, 0 = inactive (soft-delete)
  assigned_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  assigned_at         INTEGER DEFAULT (unixepoch()),
  removed_at          INTEGER,                     -- set when is_active becomes 0
  notes               TEXT,
  created_at          INTEGER DEFAULT (unixepoch()),
  updated_at          INTEGER DEFAULT (unixepoch())
);

-- PARTIAL unique index: only active assignments must be unique per student+subject
-- This allows multiple inactive (soft-deleted) records without conflict.
-- A student can have a subject deactivated and later reassigned multiple times.
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_subjects_unique_active
ON student_subjects (school_id, student_id, subject_id)
WHERE is_active = 1;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_student_subjects_school_id   ON student_subjects(school_id);
CREATE INDEX IF NOT EXISTS idx_student_subjects_student_id  ON student_subjects(student_id);
CREATE INDEX IF NOT EXISTS idx_student_subjects_subject_id  ON student_subjects(subject_id);
CREATE INDEX IF NOT EXISTS idx_student_subjects_class_id    ON student_subjects(class_id);
CREATE INDEX IF NOT EXISTS idx_student_subjects_section_id  ON student_subjects(section_id);
CREATE INDEX IF NOT EXISTS idx_student_subjects_is_active   ON student_subjects(is_active);
CREATE INDEX IF NOT EXISTS idx_student_subjects_assigned_at ON student_subjects(assigned_at);
