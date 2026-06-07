-- ============================================================
-- نظام المدرسة الذكي - Smart School System
-- Phase 12: Official Books, Print Records, and Public Verification
-- Compatible with Cloudflare D1 (SQLite)
-- ============================================================

-- ── Part A: Add dedicated official book settings to school_settings ──
ALTER TABLE school_settings ADD COLUMN official_book_header_text TEXT;
ALTER TABLE school_settings ADD COLUMN official_book_footer_text TEXT;

-- ── Part B: Official Book Templates ──
-- API expects: id, school_id, title, body_text, paper_size, requires_student, requires_employee, status, created_by_user_id, created_at, updated_at
CREATE TABLE IF NOT EXISTS official_book_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body_text TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_official_book_templates_status ON official_book_templates(status);

-- ── Part C: Official Books (generated documents) ──
-- API expects: id, school_id, template_id, document_number, title, body_text, paper_size, student_id, employee_id,
-- school_name_snapshot, principal_name_snapshot, logo_url_snapshot, stamp_url_snapshot, use_logo_snapshot, use_stamp_snapshot,
-- header_text_snapshot, footer_text_snapshot, verification_note_snapshot, date_format_snapshot, use_arabic_indic_digits_snapshot,
-- settings_snapshot_json, verification_token, verification_hash, status, created_by_user_id, created_at, updated_at
CREATE TABLE IF NOT EXISTS official_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  template_id INTEGER,
  document_number TEXT NOT NULL,
  title TEXT NOT NULL,
  body_text TEXT NOT NULL,
  paper_size TEXT NOT NULL DEFAULT 'A4' CHECK (paper_size IN ('A4', 'A5', 'Letter')),

  student_id INTEGER,
  employee_id INTEGER,

  school_name_snapshot TEXT NOT NULL,
  principal_name_snapshot TEXT,
  logo_url_snapshot TEXT,
  stamp_url_snapshot TEXT,
  use_logo_snapshot INTEGER NOT NULL DEFAULT 0,
  use_stamp_snapshot INTEGER NOT NULL DEFAULT 0,
  header_text_snapshot TEXT,
  footer_text_snapshot TEXT,
  verification_note_snapshot TEXT,
  date_format_snapshot TEXT,
  use_arabic_indic_digits_snapshot INTEGER NOT NULL DEFAULT 0,
  settings_snapshot_json TEXT,

  verification_token TEXT,
  verification_hash TEXT,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_by_user_id INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),

  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES official_book_templates(id) ON DELETE SET NULL,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE(school_id, document_number)
);

CREATE INDEX IF NOT EXISTS idx_official_books_school_id ON official_books(school_id);
CREATE INDEX IF NOT EXISTS idx_official_books_template_id ON official_books(template_id);
CREATE INDEX IF NOT EXISTS idx_official_books_status ON official_books(status);
CREATE INDEX IF NOT EXISTS idx_official_books_document_number ON official_books(document_number);
CREATE INDEX IF NOT EXISTS idx_official_books_verification_token ON official_books(verification_token);
CREATE INDEX IF NOT EXISTS idx_official_books_student_id ON official_books(student_id);
CREATE INDEX IF NOT EXISTS idx_official_books_created_at ON official_books(created_at);

-- ── Part D: Print Records ──
-- API expects: id, school_id, document_id, print_type, printed_at, printed_by_user_id, printer_info_json, created_at
CREATE TABLE IF NOT EXISTS print_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  document_id INTEGER NOT NULL,
  print_type TEXT NOT NULL,
  printed_at INTEGER DEFAULT (unixepoch()),
  printed_by_user_id INTEGER,
  printer_info_json TEXT,
  created_at INTEGER DEFAULT (unixepoch()),

  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (printed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_print_records_school_id ON print_records(school_id);
CREATE INDEX IF NOT EXISTS idx_print_records_print_type ON print_records(print_type);
CREATE INDEX IF NOT EXISTS idx_print_records_document_id ON print_records(document_id);
CREATE INDEX IF NOT EXISTS idx_print_records_printed_at ON print_records(printed_at);
CREATE INDEX IF NOT EXISTS idx_print_records_printed_by_user_id ON print_records(printed_by_user_id);
