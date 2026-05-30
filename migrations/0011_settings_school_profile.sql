-- ============================================================
-- نظام المدرسة الذكي - Smart School System
-- Phase 11: Settings Module — School Profile & Display Preferences
-- Compatible with Cloudflare D1 (SQLite)
-- ============================================================

-- ── Part A: Extend schools table with profile fields ──
-- All columns nullable for safe migration of existing data

ALTER TABLE schools ADD COLUMN name_en TEXT;
ALTER TABLE schools ADD COLUMN province TEXT;
ALTER TABLE schools ADD COLUMN address TEXT;
ALTER TABLE schools ADD COLUMN phone TEXT;
ALTER TABLE schools ADD COLUMN email TEXT;
ALTER TABLE schools ADD COLUMN website TEXT;
ALTER TABLE schools ADD COLUMN principal_name TEXT;
ALTER TABLE schools ADD COLUMN official_stamp_url TEXT;

-- ── Part B: Create school_settings table ──
-- Stores configurable display/printing/localization preferences per school

CREATE TABLE IF NOT EXISTS school_settings (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id                 INTEGER NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,

  -- Document / Print settings
  result_card_header_text   TEXT,
  result_card_footer_text   TEXT,
  receipt_footer_text       TEXT,
  verification_note_text    TEXT,
  use_school_logo_on_docs   INTEGER DEFAULT 1 CHECK (use_school_logo_on_docs IN (0, 1)),
  use_school_stamp_on_docs  INTEGER DEFAULT 0 CHECK (use_school_stamp_on_docs IN (0, 1)),
  default_print_size        TEXT DEFAULT 'A4' CHECK (default_print_size IN ('A4', 'A5', 'Letter')),
  default_receipt_size      TEXT DEFAULT 'A5' CHECK (default_receipt_size IN ('A5', 'A4')),

  -- Localization settings
  use_arabic_indic_digits   INTEGER DEFAULT 1 CHECK (use_arabic_indic_digits IN (0, 1)),
  currency_label            TEXT DEFAULT 'د.ع',
  date_format               TEXT DEFAULT 'dd/MM/yyyy',

  created_at                INTEGER DEFAULT (unixepoch()),
  updated_at                INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_school_settings_school_id ON school_settings(school_id);

-- ── Part C: Seed default settings for existing schools ──
-- Every existing school gets a default settings row

INSERT OR IGNORE INTO school_settings (
  school_id,
  use_school_logo_on_docs,
  use_school_stamp_on_docs,
  default_print_size,
  default_receipt_size,
  use_arabic_indic_digits,
  currency_label,
  date_format
)
SELECT
  id,
  1, 0, 'A4', 'A5', 1, 'د.ع', 'dd/MM/yyyy'
FROM schools;
