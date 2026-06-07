-- ===========================================
-- Migration 0014: Extend print_records and fee_receipts for print tracking
-- Phase 14A.1 — Print Routes Stabilization
-- ===========================================

-- Add printed_at to fee_receipts for tracking print status
ALTER TABLE fee_receipts ADD COLUMN printed_at INTEGER;

-- Add source_type for polymorphic document tracking
ALTER TABLE print_records ADD COLUMN source_type TEXT;

-- Add source_id for polymorphic source reference
ALTER TABLE print_records ADD COLUMN source_id INTEGER;

-- Add document_number for display/lookup
ALTER TABLE print_records ADD COLUMN document_number TEXT;

-- Add title for print record display
ALTER TABLE print_records ADD COLUMN title TEXT;

-- Add copies_count for print statistics
ALTER TABLE print_records ADD COLUMN copies_count INTEGER DEFAULT 1;
