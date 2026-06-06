-- ============================================================
-- نظام المدرسة الذكي - Smart School System
-- Phase 12: Official Books, Print Records, and PDF Export
-- Compatible with Cloudflare D1 (SQLite)
-- ============================================================

-- ── Part A: Add dedicated official book settings to school_settings ──
ALTER TABLE school_settings ADD COLUMN official_book_header_text TEXT;
ALTER TABLE school_settings ADD COLUMN official_book_footer_text TEXT;

-- ── Part B: Official Book Templates ──
CREATE TABLE IF NOT EXISTS official_book_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  template_type TEXT NOT NULL, -- e.g. 'student_approval', 'student_transfer', 'attendance_continuation', 'no_objection', 'parent_letter', 'general_admin', 'custom'
  title TEXT NOT NULL,
  body_template TEXT NOT NULL,
  header_text TEXT,
  footer_text TEXT,
  paper_size TEXT NOT NULL DEFAULT 'A4' CHECK (paper_size IN ('A4', 'A5', 'Letter')),
  requires_student INTEGER NOT NULL DEFAULT 0,
  requires_employee INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by_user_id INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_official_book_templates_school_id ON official_book_templates(school_id);
CREATE INDEX IF NOT EXISTS idx_official_book_templates_type ON official_book_templates(template_type);
CREATE INDEX IF NOT EXISTS idx_official_book_templates_status ON official_book_templates(status);

-- ── Part C: Official Books (generated documents) ──
CREATE TABLE IF NOT EXISTS official_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  template_id INTEGER,
  document_type TEXT NOT NULL,
  document_number TEXT NOT NULL,
  title TEXT NOT NULL,
  body_text TEXT NOT NULL,
  header_text_snapshot TEXT,
  footer_text_snapshot TEXT,
  paper_size_snapshot TEXT NOT NULL DEFAULT 'A4' CHECK (paper_size_snapshot IN ('A4', 'A5', 'Letter')),

  -- Related entity snapshots
  student_id INTEGER,
  student_name_snapshot TEXT,
  student_number_snapshot TEXT,
  class_name_snapshot TEXT,
  section_name_snapshot TEXT,

  employee_id INTEGER,
  employee_name_snapshot TEXT,
  employee_position_snapshot TEXT,

  -- School info snapshots
  school_name_snapshot TEXT NOT NULL,
  principal_name_snapshot TEXT,
  academic_year_snapshot TEXT,

  -- Settings snapshot
  settings_snapshot_json TEXT,

  -- QR / Verification
  verification_token TEXT,
  verification_hash TEXT,

  -- Metadata
  generated_by_user_id INTEGER NOT NULL,
  generated_at INTEGER DEFAULT (unixepoch()),
  printed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancellation_reason TEXT,
  cancelled_by_user_id INTEGER,
  cancelled_at INTEGER,
  updated_at INTEGER DEFAULT (unixepoch()),

  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES official_book_templates(id) ON DELETE SET NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (generated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (cancelled_by_user_id) REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE(school_id, document_number)
);

CREATE INDEX IF NOT EXISTS idx_official_books_school_id ON official_books(school_id);
CREATE INDEX IF NOT EXISTS idx_official_books_template_id ON official_books(template_id);
CREATE INDEX IF NOT EXISTS idx_official_books_status ON official_books(status);
CREATE INDEX IF NOT EXISTS idx_official_books_document_number ON official_books(document_number);
CREATE INDEX IF NOT EXISTS idx_official_books_verification_token ON official_books(verification_token);
CREATE INDEX IF NOT EXISTS idx_official_books_student_id ON official_books(student_id);
CREATE INDEX IF NOT EXISTS idx_official_books_generated_at ON official_books(generated_at);

-- ── Part D: Print Records (general print tracking) ──
CREATE TABLE IF NOT EXISTS print_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  print_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  document_number TEXT,
  title TEXT NOT NULL,
  printed_by_user_id INTEGER,
  printed_at INTEGER DEFAULT (unixepoch()),
  copies_count INTEGER NOT NULL DEFAULT 1,
  paper_size TEXT CHECK (paper_size IN ('A4', 'A5', 'Letter')),
  notes TEXT,
  created_at INTEGER DEFAULT (unixepoch()),

  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (printed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_print_records_school_id ON print_records(school_id);
CREATE INDEX IF NOT EXISTS idx_print_records_type ON print_records(print_type);
CREATE INDEX IF NOT EXISTS idx_print_records_source ON print_records(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_print_records_printed_at ON print_records(printed_at);
CREATE INDEX IF NOT EXISTS idx_print_records_user_id ON print_records(printed_by_user_id);
