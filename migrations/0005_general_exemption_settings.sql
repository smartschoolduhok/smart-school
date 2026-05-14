-- ============================================================
-- Migration: Add general exemption settings to grade_settings
-- Phase 5 Fix — Smart School System
-- ============================================================

-- SQLite-safe approach: check if column exists before adding
-- Add general_exemption_average_grade (default 85)
-- Add general_exemption_min_subject_grade (default 75)

-- Use pragma to check columns, but for simplicity in SQLite migrations
-- we use a CREATE TABLE IF NOT EXISTS approach for the whole table if needed,
-- or just attempt the alter and catch errors.
-- For wrangler D1 local SQLite, we do direct ALTER without IF NOT EXISTS.

ALTER TABLE grade_settings ADD COLUMN general_exemption_average_grade REAL NOT NULL DEFAULT 85;
ALTER TABLE grade_settings ADD COLUMN general_exemption_min_subject_grade REAL NOT NULL DEFAULT 75;

-- Update existing rows that have NULL values (if any) to defaults
UPDATE grade_settings SET general_exemption_average_grade = 85 WHERE general_exemption_average_grade IS NULL;
UPDATE grade_settings SET general_exemption_min_subject_grade = 75 WHERE general_exemption_min_subject_grade IS NULL;
