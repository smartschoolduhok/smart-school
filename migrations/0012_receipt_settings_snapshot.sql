-- Phase 11.1: Add settings_snapshot_json to fee_receipts for snapshot immutability
ALTER TABLE fee_receipts ADD COLUMN settings_snapshot_json TEXT;
