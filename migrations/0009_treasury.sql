-- ==========================================
-- Migration 0009: Treasury, Income & Expenses
-- Phase 8 Part 1 — الخزنة والواردات والمصروفات
-- ==========================================

-- 1. Treasury Accounts (cached balance per school)
CREATE TABLE IF NOT EXISTS treasury_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL UNIQUE,
  current_balance INTEGER NOT NULL DEFAULT 0,
  last_closing_balance INTEGER NOT NULL DEFAULT 0,
  last_closing_date INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- 2. Treasury Transactions (ledger — source of truth)
CREATE TABLE IF NOT EXISTS treasury_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  transaction_type TEXT NOT NULL CHECK(transaction_type IN ('income','expense')),
  category TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL DEFAULT 'IQD',
  description TEXT,
  source_type TEXT,
  source_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  cancelled_at INTEGER,
  cancelled_by INTEGER,
  cancel_reason TEXT,
  created_by INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(school_id, source_type, source_id) ON CONFLICT ABORT
);

CREATE INDEX IF NOT EXISTS idx_treasury_tx_school ON treasury_transactions(school_id);
CREATE INDEX IF NOT EXISTS idx_treasury_tx_type ON treasury_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_treasury_tx_status ON treasury_transactions(status);
CREATE INDEX IF NOT EXISTS idx_treasury_tx_created ON treasury_transactions(created_at);

-- 3. Treasury Daily Closings
CREATE TABLE IF NOT EXISTS treasury_closings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL,
  closing_date TEXT NOT NULL,
  opening_balance INTEGER NOT NULL,
  total_income INTEGER NOT NULL DEFAULT 0,
  total_expense INTEGER NOT NULL DEFAULT 0,
  closing_balance INTEGER NOT NULL,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'closed' CHECK(status IN ('closed')),
  notes TEXT,
  closed_by INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(school_id, closing_date) ON CONFLICT ABORT
);

CREATE INDEX IF NOT EXISTS idx_treasury_closing_school ON treasury_closings(school_id);
CREATE INDEX IF NOT EXISTS idx_treasury_closing_date ON treasury_closings(closing_date);

-- 4. Treasury Categories (minimal MVP)
CREATE TABLE IF NOT EXISTS treasury_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER,
  type TEXT NOT NULL CHECK(type IN ('income','expense')),
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Insert minimal system categories (idempotent)
INSERT OR IGNORE INTO treasury_categories (school_id, type, name, name_ar, is_system) VALUES
  (NULL, 'income', 'tuition_fee', 'قسط دراسي', 1),
  (NULL, 'income', 'other_income', 'واردات أخرى', 1),
  (NULL, 'expense', 'rent', 'إيجار', 1),
  (NULL, 'expense', 'bills', 'فواتير', 1),
  (NULL, 'expense', 'maintenance', 'صيانة', 1),
  (NULL, 'expense', 'supplies', 'مشتريات', 1),
  (NULL, 'expense', 'salary', 'راتب', 1),
  (NULL, 'expense', 'other_expense', 'مصروفات أخرى', 1);
