-- ===========================================
-- Migration 0008: Add Discount Fields to Student Fees
-- Phase 7 QA Fix — Discount calculations support
-- ===========================================

-- Add discount columns to student_fees
ALTER TABLE student_fees ADD COLUMN discount_type TEXT DEFAULT 'none';
ALTER TABLE student_fees ADD COLUMN discount_value REAL DEFAULT 0;
ALTER TABLE student_fees ADD COLUMN discount_amount REAL DEFAULT 0;
ALTER TABLE student_fees ADD COLUMN net_fee REAL DEFAULT 0;

-- Update existing rows: set net_fee = amount where net_fee is 0 or null
UPDATE student_fees SET net_fee = amount WHERE net_fee = 0 OR net_fee IS NULL;
UPDATE student_fees SET discount_type = 'none' WHERE discount_type IS NULL;

-- Add index for discount queries
CREATE INDEX IF NOT EXISTS idx_student_fees_net_fee ON student_fees(net_fee);
