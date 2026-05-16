-- ===========================================
-- Migration 0007: Student Fees & Financial Receipts
-- Phase 7 — Fees, Payments, and Receipts with QR Verification
-- ===========================================

-- Student Fees table: fee records assigned to students
CREATE TABLE IF NOT EXISTS student_fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  academic_year_id INTEGER,
  fee_type TEXT NOT NULL DEFAULT 'رسوم دراسية',
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EGP',
  due_date INTEGER,
  paid_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL
);

-- Fee Payments table: individual payments against fees
CREATE TABLE IF NOT EXISTS fee_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  student_fee_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_date INTEGER NOT NULL,
  receipt_number TEXT,
  notes TEXT,
  created_by_user_id INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (student_fee_id) REFERENCES student_fees(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Fee Receipts table: official receipt snapshots with QR verification
CREATE TABLE IF NOT EXISTS fee_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  receipt_number TEXT NOT NULL,
  total_amount REAL NOT NULL,
  payment_ids_json TEXT NOT NULL,
  payments_snapshot_json TEXT,
  student_name_snapshot TEXT,
  class_name_snapshot TEXT,
  section_name_snapshot TEXT,
  school_name_snapshot TEXT,
  academic_year_snapshot TEXT,
  verification_token TEXT NOT NULL,
  verification_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_user_id INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_student_fees_school_id ON student_fees(school_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_student_id ON student_fees(student_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_status ON student_fees(status);
CREATE INDEX IF NOT EXISTS idx_student_fees_academic_year ON student_fees(academic_year_id);

CREATE INDEX IF NOT EXISTS idx_fee_payments_school_id ON fee_payments(school_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_student_fee_id ON fee_payments(student_fee_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_student_id ON fee_payments(student_id);
CREATE INDEX IF NOT EXISTS idx_fee_payments_receipt_number ON fee_payments(receipt_number);

CREATE INDEX IF NOT EXISTS idx_fee_receipts_school_id ON fee_receipts(school_id);
CREATE INDEX IF NOT EXISTS idx_fee_receipts_student_id ON fee_receipts(student_id);
CREATE INDEX IF NOT EXISTS idx_fee_receipts_receipt_number ON fee_receipts(receipt_number);
CREATE INDEX IF NOT EXISTS idx_fee_receipts_verification_token ON fee_receipts(verification_token);
CREATE INDEX IF NOT EXISTS idx_fee_receipts_status ON fee_receipts(status);
