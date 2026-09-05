-- Phase 19B: safe teacher reassignment without changing saved placements.
-- No row backfill: replace only the absolute teacher-change prohibition.
DROP TRIGGER trg_timetable_loads_preserve_entries;

CREATE TRIGGER trg_timetable_loads_preserve_entries
BEFORE UPDATE OF school_id, academic_year_id, class_id, section_id, subject_id
ON timetable_teaching_loads
WHEN EXISTS (
  SELECT 1 FROM timetable_entries
  WHERE school_id = OLD.school_id AND academic_year_id = OLD.academic_year_id
    AND teaching_load_id = OLD.id
) AND (
  NEW.school_id != OLD.school_id OR NEW.academic_year_id != OLD.academic_year_id
  OR NEW.class_id != OLD.class_id OR NEW.section_id IS NOT OLD.section_id
  OR NEW.subject_id != OLD.subject_id
)
BEGIN
  SELECT RAISE(ABORT, 'timetable load has scheduled entries');
END;

-- AFTER sees the resulting assignment exactly once, including all lessons on
-- this load and the destination teacher's other loads across this school/year.
-- ABORT rolls back the UPDATE, its audit fields and revision trigger effects.
-- NULL unassignment and same-teacher edits require no reassignment validation.
CREATE TRIGGER trg_timetable_loads_validate_teacher_reassignment
AFTER UPDATE OF employee_id ON timetable_teaching_loads
WHEN NEW.employee_id IS NOT OLD.employee_id AND NEW.employee_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'timetable reassignment invalid teacher')
  WHERE NOT EXISTS (
    SELECT 1 FROM employees WHERE id = NEW.employee_id AND school_id = NEW.school_id
      AND status = 'active' AND role = 'teacher'
  );

  SELECT RAISE(ABORT, 'timetable reassignment teacher collision')
  WHERE EXISTS (
    WITH teacher_entries AS (
      SELECT entry.id, entry.slot_id, slot.day_of_week, slot.slot_type,
             slot.is_active AS slot_active, day.is_active AS day_active
      FROM timetable_teaching_loads load
      JOIN timetable_entries entry
        ON entry.teaching_load_id = load.id AND entry.school_id = load.school_id
        AND entry.academic_year_id = load.academic_year_id
      JOIN timetable_slots slot ON slot.id = entry.slot_id
        AND slot.school_id = entry.school_id AND slot.academic_year_id = entry.academic_year_id
      JOIN timetable_days day ON day.school_id = slot.school_id
        AND day.academic_year_id = slot.academic_year_id AND day.day_of_week = slot.day_of_week
      WHERE load.school_id = NEW.school_id AND load.academic_year_id = NEW.academic_year_id
        AND load.employee_id = NEW.employee_id
    ), active_entries AS (
      SELECT * FROM teacher_entries
      WHERE slot_type = 'lesson' AND slot_active = 1 AND day_active = 1
    )
    SELECT 1 FROM teacher_entries GROUP BY slot_id HAVING COUNT(*) > 1
  );

  SELECT RAISE(ABORT, 'timetable reassignment teacher unavailable')
  WHERE EXISTS (
    WITH teacher_entries AS (
      SELECT entry.id, entry.slot_id, slot.day_of_week, slot.slot_type,
             slot.is_active AS slot_active, day.is_active AS day_active
      FROM timetable_teaching_loads load
      JOIN timetable_entries entry
        ON entry.teaching_load_id = load.id AND entry.school_id = load.school_id
        AND entry.academic_year_id = load.academic_year_id
      JOIN timetable_slots slot ON slot.id = entry.slot_id
        AND slot.school_id = entry.school_id AND slot.academic_year_id = entry.academic_year_id
      JOIN timetable_days day ON day.school_id = slot.school_id
        AND day.academic_year_id = slot.academic_year_id AND day.day_of_week = slot.day_of_week
      WHERE load.school_id = NEW.school_id AND load.academic_year_id = NEW.academic_year_id
        AND load.employee_id = NEW.employee_id
    ), active_entries AS (
      SELECT * FROM teacher_entries
      WHERE slot_type = 'lesson' AND slot_active = 1 AND day_active = 1
    )
    SELECT 1 FROM teacher_entries entry
    JOIN timetable_teacher_availability availability
      ON availability.school_id = NEW.school_id AND availability.academic_year_id = NEW.academic_year_id
      AND availability.employee_id = NEW.employee_id AND availability.slot_id = entry.slot_id
    WHERE availability.status = 'unavailable'
  );

  SELECT RAISE(ABORT, 'timetable reassignment max periods per day exceeded')
  WHERE EXISTS (
    WITH teacher_entries AS (
      SELECT entry.id, entry.slot_id, slot.day_of_week, slot.slot_type,
             slot.is_active AS slot_active, day.is_active AS day_active
      FROM timetable_teaching_loads load
      JOIN timetable_entries entry
        ON entry.teaching_load_id = load.id AND entry.school_id = load.school_id
        AND entry.academic_year_id = load.academic_year_id
      JOIN timetable_slots slot ON slot.id = entry.slot_id
        AND slot.school_id = entry.school_id AND slot.academic_year_id = entry.academic_year_id
      JOIN timetable_days day ON day.school_id = slot.school_id
        AND day.academic_year_id = slot.academic_year_id AND day.day_of_week = slot.day_of_week
      WHERE load.school_id = NEW.school_id AND load.academic_year_id = NEW.academic_year_id
        AND load.employee_id = NEW.employee_id
    ), active_entries AS (
      SELECT * FROM teacher_entries
      WHERE slot_type = 'lesson' AND slot_active = 1 AND day_active = 1
    )
    SELECT 1 FROM active_entries
    GROUP BY day_of_week HAVING COUNT(*) > (
      SELECT max_periods_per_day FROM timetable_teacher_constraints
      WHERE school_id = NEW.school_id AND academic_year_id = NEW.academic_year_id AND employee_id = NEW.employee_id
    )
  );

  SELECT RAISE(ABORT, 'timetable reassignment max working days exceeded')
  WHERE (
    WITH teacher_entries AS (
      SELECT entry.id, entry.slot_id, slot.day_of_week, slot.slot_type,
             slot.is_active AS slot_active, day.is_active AS day_active
      FROM timetable_teaching_loads load
      JOIN timetable_entries entry
        ON entry.teaching_load_id = load.id AND entry.school_id = load.school_id
        AND entry.academic_year_id = load.academic_year_id
      JOIN timetable_slots slot ON slot.id = entry.slot_id
        AND slot.school_id = entry.school_id AND slot.academic_year_id = entry.academic_year_id
      JOIN timetable_days day ON day.school_id = slot.school_id
        AND day.academic_year_id = slot.academic_year_id AND day.day_of_week = slot.day_of_week
      WHERE load.school_id = NEW.school_id AND load.academic_year_id = NEW.academic_year_id
        AND load.employee_id = NEW.employee_id
    ), active_entries AS (
      SELECT * FROM teacher_entries
      WHERE slot_type = 'lesson' AND slot_active = 1 AND day_active = 1
    )
    SELECT COUNT(DISTINCT day_of_week) FROM active_entries
  ) > (
    SELECT max_working_days FROM timetable_teacher_constraints
    WHERE school_id = NEW.school_id AND academic_year_id = NEW.academic_year_id AND employee_id = NEW.employee_id
  );

  SELECT RAISE(ABORT, 'timetable reassignment max consecutive periods exceeded')
  WHERE EXISTS (
    WITH teacher_entries AS (
      SELECT entry.id, entry.slot_id, slot.day_of_week, slot.slot_type,
             slot.is_active AS slot_active, day.is_active AS day_active
      FROM timetable_teaching_loads load
      JOIN timetable_entries entry
        ON entry.teaching_load_id = load.id AND entry.school_id = load.school_id
        AND entry.academic_year_id = load.academic_year_id
      JOIN timetable_slots slot ON slot.id = entry.slot_id
        AND slot.school_id = entry.school_id AND slot.academic_year_id = entry.academic_year_id
      JOIN timetable_days day ON day.school_id = slot.school_id
        AND day.academic_year_id = slot.academic_year_id AND day.day_of_week = slot.day_of_week
      WHERE load.school_id = NEW.school_id AND load.academic_year_id = NEW.academic_year_id
        AND load.employee_id = NEW.employee_id
    ), active_entries AS (
      SELECT * FROM teacher_entries
      WHERE slot_type = 'lesson' AND slot_active = 1 AND day_active = 1
    ), ordered_slots AS (
      SELECT slot.day_of_week,
        ROW_NUMBER() OVER (
          PARTITION BY slot.day_of_week ORDER BY slot.start_time, slot.slot_index, slot.id
        ) AS position,
        CASE WHEN slot.slot_type = 'lesson' AND EXISTS (
          SELECT 1 FROM active_entries entry WHERE entry.slot_id = slot.id
        ) THEN 1 ELSE 0 END AS occupied
      FROM timetable_slots slot
      JOIN timetable_days day ON day.school_id = slot.school_id
        AND day.academic_year_id = slot.academic_year_id AND day.day_of_week = slot.day_of_week
      WHERE slot.school_id = NEW.school_id AND slot.academic_year_id = NEW.academic_year_id
        AND slot.is_active = 1 AND day.is_active = 1
    ), runs AS (
      SELECT day_of_week, occupied,
        position - ROW_NUMBER() OVER (PARTITION BY day_of_week, occupied ORDER BY position) AS run
      FROM ordered_slots
    )
    SELECT 1 FROM runs WHERE occupied = 1 GROUP BY day_of_week, run HAVING COUNT(*) > (
      SELECT max_consecutive_periods FROM timetable_teacher_constraints
      WHERE school_id = NEW.school_id AND academic_year_id = NEW.academic_year_id AND employee_id = NEW.employee_id
    )
  );
END;
