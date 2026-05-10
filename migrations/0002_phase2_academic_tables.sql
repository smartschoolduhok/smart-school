-- ============================================================
-- نظام المدرسة الذكي - Smart School System
-- Phase 2: Academic Data Foundation
-- Tables: classes, sections, students, subjects
-- Compatible with Cloudflare D1 (SQLite)
-- ============================================================

-- TABLE: classes
-- Represents grade levels (e.g., الصف الأول, الصف الثاني)
CREATE TABLE IF NOT EXISTS classes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  stage         TEXT NOT NULL, -- روضة, ابتدائي, متوسط, إعدادي, ثانوي
  order_index   INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'active',
  created_at    INTEGER DEFAULT (unixepoch()),
  updated_at    INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_classes_school_id ON classes(school_id);
CREATE INDEX IF NOT EXISTS idx_classes_status ON classes(status);

-- TABLE: sections
-- Represents class divisions (e.g., شعبة أ, شعبة ب)
CREATE TABLE IF NOT EXISTS sections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  capacity      INTEGER DEFAULT 30,
  status        TEXT DEFAULT 'active',
  created_at    INTEGER DEFAULT (unixepoch()),
  updated_at    INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_sections_school_id ON sections(school_id);
CREATE INDEX IF NOT EXISTS idx_sections_class_id ON sections(class_id);
CREATE INDEX IF NOT EXISTS idx_sections_status ON sections(status);

-- TABLE: students
-- Student records per school
CREATE TABLE IF NOT EXISTS students (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id       INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_number  TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  father_name     TEXT,
  mother_name     TEXT,
  gender          TEXT NOT NULL, -- ذكر, أنثى
  birth_date      TEXT,
  phone           TEXT,
  guardian_name   TEXT,
  guardian_phone  TEXT,
  address         TEXT,
  class_id        INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  section_id      INTEGER REFERENCES sections(id) ON DELETE SET NULL,
  status          TEXT DEFAULT 'active',
  photo_url       TEXT,
  notes           TEXT,
  created_at      INTEGER DEFAULT (unixepoch()),
  updated_at      INTEGER DEFAULT (unixepoch()),
  UNIQUE(school_id, student_number)
);

CREATE INDEX IF NOT EXISTS idx_students_school_id ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_students_class_id ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_students_section_id ON students(section_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_students_student_number ON students(student_number);

-- TABLE: subjects
-- Subjects linked to classes and optionally sections
CREATE TABLE IF NOT EXISTS subjects (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id               INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id                INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  section_id              INTEGER REFERENCES sections(id) ON DELETE SET NULL,
  name                    TEXT NOT NULL,
  subject_type            TEXT DEFAULT 'أساسية', -- أساسية, اختيارية
  counts_in_average       INTEGER DEFAULT 1, -- 1 = yes, 0 = no
  appears_in_report_card  INTEGER DEFAULT 1, -- 1 = yes, 0 = no
  passing_grade           REAL DEFAULT 50,
  exemption_grade         REAL DEFAULT 25,
  order_index             INTEGER DEFAULT 0,
  status                  TEXT DEFAULT 'active',
  created_at              INTEGER DEFAULT (unixepoch()),
  updated_at              INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_subjects_school_id ON subjects(school_id);
CREATE INDEX IF NOT EXISTS idx_subjects_class_id ON subjects(class_id);
CREATE INDEX IF NOT EXISTS idx_subjects_section_id ON subjects(section_id);
CREATE INDEX IF NOT EXISTS idx_subjects_status ON subjects(status);

-- ============================================================
-- Seed Data for Phase 2 (linked to existing schools)
-- ============================================================

-- Seed: classes for school_id = 1 (مدرسة النخبة الأهلية)
