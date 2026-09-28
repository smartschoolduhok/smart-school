-- Keep scheduled lessons attached to their period while allowing safe bell-time edits.
-- Scope, day, order and lesson/break identity still cannot change with entries.
DROP TRIGGER IF EXISTS trg_timetable_slots_preserve_entries;

CREATE TRIGGER trg_timetable_slots_preserve_entries
BEFORE UPDATE OF school_id, academic_year_id, day_of_week, slot_index,
  slot_type, lesson_number, start_time, end_time
ON timetable_slots
WHEN EXISTS (
  SELECT 1 FROM timetable_entries
  WHERE school_id = OLD.school_id
    AND academic_year_id = OLD.academic_year_id
    AND slot_id = OLD.id
)
AND (
  NEW.school_id != OLD.school_id
  OR NEW.academic_year_id != OLD.academic_year_id
  OR NEW.day_of_week != OLD.day_of_week
  OR NEW.slot_index != OLD.slot_index
  OR NEW.slot_type != 'lesson'
  OR NEW.lesson_number != OLD.lesson_number
)
BEGIN
  SELECT RAISE(ABORT, 'timetable slot has scheduled entries');
END;
