-- Persist school-level Result Card presentation preferences.
-- Issued cards copy the normalized settings into card_data_json so historical
-- rendering remains immutable when the school later changes these preferences.
ALTER TABLE school_settings ADD COLUMN result_card_display_settings_json TEXT;
