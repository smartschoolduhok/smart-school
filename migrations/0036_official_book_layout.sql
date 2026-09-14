-- ============================================================
-- Smart School — Phase 20E.2: structured official-book header
-- ============================================================

-- JSON keeps the bilingual government hierarchy and optional authorized
-- emblem configuration together while issued books retain immutable snapshots.
ALTER TABLE school_settings ADD COLUMN official_book_layout_settings_json TEXT;
