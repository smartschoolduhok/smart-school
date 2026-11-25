-- Per-class student roster order. Rosters (student lists, grade sheets, lesson
-- attendance, homework, study status, academic outcomes) sort by this setting:
--   alphabetical  : Arabic alphabetical order of the full name (default)
--   girls_first   : girls first, then boys, each alphabetical (mixed classes)
--   boys_first    : boys first, then girls, each alphabetical
-- Additive with a default, so code written before it keeps working.
ALTER TABLE classes ADD COLUMN roster_order TEXT NOT NULL DEFAULT 'alphabetical'
  CHECK (roster_order IN ('alphabetical', 'girls_first', 'boys_first'));
