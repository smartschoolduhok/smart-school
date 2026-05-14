-- ===========================================
-- Phase 6: Result Cards + QR Verification
-- ===========================================

CREATE TABLE IF NOT EXISTS result_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  class_id INTEGER,
  section_id INTEGER,
  academic_year_id INTEGER,
  card_number TEXT NOT NULL,
  verification_token TEXT NOT NULL UNIQUE,
  verification_hash TEXT NOT NULL,
  student_name_snapshot TEXT NOT NULL,
  class_name_snapshot TEXT,
  section_name_snapshot TEXT,
  school_name_snapshot TEXT,
  academic_year_snapshot TEXT,
  general_exemption_status INTEGER DEFAULT 0,
  annual_effort_average INTEGER,
  min_annual_effort INTEGER,
  overall_result_status TEXT,
  card_data_json TEXT NOT NULL,
  generated_by_user_id INTEGER,
  generated_at INTEGER DEFAULT (strftime('%s', 'now')),
  printed_at INTEGER,
  status TEXT DEFAULT 'active',
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_result_cards_school_id ON result_cards(school_id);
CREATE INDEX IF NOT EXISTS idx_result_cards_student_id ON result_cards(student_id);
CREATE INDEX IF NOT EXISTS idx_result_cards_verification_token ON result_cards(verification_token);
CREATE INDEX IF NOT EXISTS idx_result_cards_card_number ON result_cards(card_number);
CREATE INDEX IF NOT EXISTS idx_result_cards_status ON result_cards(status);
