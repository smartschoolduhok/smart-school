-- Phase 20E.3: permit intentional manual teacher overlaps while preserving
-- every other canonical timetable invariant. The application reports both
-- affected lessons as a visible rose conflict; automatic scheduling and the
-- ordinary create/move endpoints continue to reject teacher collisions.

DROP TRIGGER IF EXISTS trg_timetable_entries_validate_insert;
DROP TRIGGER IF EXISTS trg_timetable_entries_validate_update;

CREATE TRIGGER IF NOT EXISTS trg_timetable_entries_validate_insert
BEFORE INSERT ON timetable_entries
BEGIN
  SELECT RAISE(ABORT, 'timetable entry academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'timetable entry tenant scope mismatch')
  WHERE EXISTS (
    SELECT 1 FROM timetable_slots
    WHERE id = NEW.slot_id AND school_id != NEW.school_id
  ) OR EXISTS (
    SELECT 1 FROM timetable_teaching_loads
    WHERE id = NEW.teaching_load_id AND school_id != NEW.school_id
  );

  SELECT RAISE(ABORT, 'timetable entry academic year mismatch')
  WHERE EXISTS (
    SELECT 1 FROM timetable_slots
    WHERE id = NEW.slot_id
      AND school_id = NEW.school_id
      AND academic_year_id != NEW.academic_year_id
  ) OR EXISTS (
    SELECT 1 FROM timetable_teaching_loads
    WHERE id = NEW.teaching_load_id
      AND school_id = NEW.school_id
      AND academic_year_id != NEW.academic_year_id
  );

  SELECT RAISE(ABORT, 'timetable entry day inactive')
  WHERE EXISTS (
    SELECT 1
    FROM timetable_slots slot
    LEFT JOIN timetable_days day
      ON day.school_id = slot.school_id
      AND day.academic_year_id = slot.academic_year_id
      AND day.day_of_week = slot.day_of_week
    WHERE slot.id = NEW.slot_id
      AND slot.school_id = NEW.school_id
      AND slot.academic_year_id = NEW.academic_year_id
      AND (day.id IS NULL OR day.is_active != 1)
  );

  SELECT RAISE(ABORT, 'timetable entry slot inactive')
  WHERE EXISTS (
    SELECT 1 FROM timetable_slots
    WHERE id = NEW.slot_id
      AND school_id = NEW.school_id
      AND academic_year_id = NEW.academic_year_id
      AND is_active != 1
  );

  SELECT RAISE(ABORT, 'timetable entry slot not schedulable')
  WHERE NOT EXISTS (
    SELECT 1
    FROM timetable_slots slot
    JOIN timetable_days day
      ON day.school_id = slot.school_id
      AND day.academic_year_id = slot.academic_year_id
      AND day.day_of_week = slot.day_of_week
    WHERE slot.id = NEW.slot_id
      AND slot.school_id = NEW.school_id
      AND slot.academic_year_id = NEW.academic_year_id
      AND slot.slot_type = 'lesson'
      AND slot.is_active = 1
      AND day.is_active = 1
  );

  SELECT RAISE(ABORT, 'timetable entry teaching load not schedulable')
  WHERE NOT EXISTS (
    SELECT 1
    FROM timetable_teaching_loads load
    JOIN classes class ON class.id = load.class_id
    LEFT JOIN sections section ON section.id = load.section_id
    JOIN subjects subject ON subject.id = load.subject_id
    LEFT JOIN employees employee ON employee.id = load.employee_id
    WHERE load.id = NEW.teaching_load_id
      AND load.school_id = NEW.school_id
      AND load.academic_year_id = NEW.academic_year_id
      AND load.status = 'active'
      AND class.school_id = NEW.school_id
      AND class.status = 'active'
      AND (load.section_id IS NULL OR (
        section.school_id = NEW.school_id
        AND section.class_id = load.class_id
        AND section.status = 'active'
      ))
      AND subject.school_id = NEW.school_id
      AND subject.class_id = load.class_id
      AND subject.status = 'active'
      AND (subject.section_id IS NULL OR subject.section_id = load.section_id)
      AND (load.employee_id IS NULL OR (
        employee.school_id = NEW.school_id
        AND employee.status = 'active'
        AND employee.role = 'teacher'
      ))
  );

  SELECT RAISE(ABORT, 'timetable entry weekly periods exceeded')
  WHERE (
    SELECT COUNT(*)
    FROM timetable_entries entry
    JOIN timetable_slots slot ON slot.id = entry.slot_id
    JOIN timetable_days day
      ON day.school_id = slot.school_id
      AND day.academic_year_id = slot.academic_year_id
      AND day.day_of_week = slot.day_of_week
    WHERE entry.school_id = NEW.school_id
      AND entry.academic_year_id = NEW.academic_year_id
      AND entry.teaching_load_id = NEW.teaching_load_id
      AND slot.slot_type = 'lesson'
      AND slot.is_active = 1
      AND day.is_active = 1
  ) >= (
    SELECT weekly_periods FROM timetable_teaching_loads WHERE id = NEW.teaching_load_id
  );

  SELECT RAISE(ABORT, 'timetable entry group collision')
  WHERE EXISTS (
    SELECT 1
    FROM timetable_entries existing_entry
    JOIN timetable_teaching_loads existing_load ON existing_load.id = existing_entry.teaching_load_id
    JOIN timetable_teaching_loads new_load ON new_load.id = NEW.teaching_load_id
    WHERE existing_entry.slot_id = NEW.slot_id
      AND existing_entry.school_id = NEW.school_id
      AND existing_entry.academic_year_id = NEW.academic_year_id
      AND existing_load.class_id = new_load.class_id
      AND (
        existing_load.section_id IS NULL
        OR new_load.section_id IS NULL
        OR existing_load.section_id = new_load.section_id
      )
  );


  SELECT RAISE(ABORT, 'timetable entry teacher unavailable')
  WHERE EXISTS (
    SELECT 1
    FROM timetable_teaching_loads load
    JOIN timetable_teacher_availability availability
      ON availability.school_id = NEW.school_id
      AND availability.academic_year_id = NEW.academic_year_id
      AND availability.employee_id = load.employee_id
      AND availability.slot_id = NEW.slot_id
    WHERE load.id = NEW.teaching_load_id
      AND availability.status = 'unavailable'
  );

  SELECT RAISE(ABORT, 'timetable entry max periods per day exceeded')
  WHERE EXISTS (
    SELECT 1
    FROM timetable_teaching_loads new_load
    JOIN timetable_slots new_slot ON new_slot.id = NEW.slot_id
    JOIN timetable_teacher_constraints constraints
      ON constraints.school_id = NEW.school_id
      AND constraints.academic_year_id = NEW.academic_year_id
      AND constraints.employee_id = new_load.employee_id
    WHERE new_load.id = NEW.teaching_load_id
      AND constraints.max_periods_per_day IS NOT NULL
      AND 1 + (
        SELECT COUNT(*)
        FROM timetable_entries entry
        JOIN timetable_slots slot ON slot.id = entry.slot_id
        JOIN timetable_days day
          ON day.school_id = slot.school_id
          AND day.academic_year_id = slot.academic_year_id
          AND day.day_of_week = slot.day_of_week
        JOIN timetable_teaching_loads load ON load.id = entry.teaching_load_id
        WHERE entry.school_id = NEW.school_id
          AND entry.academic_year_id = NEW.academic_year_id
          AND load.employee_id = new_load.employee_id
          AND slot.day_of_week = new_slot.day_of_week
          AND slot.slot_type = 'lesson'
          AND slot.is_active = 1
          AND day.is_active = 1
      ) > constraints.max_periods_per_day
  );

  SELECT RAISE(ABORT, 'timetable entry max working days exceeded')
  WHERE EXISTS (
    SELECT 1
    FROM timetable_teaching_loads new_load
    JOIN timetable_slots new_slot ON new_slot.id = NEW.slot_id
    JOIN timetable_teacher_constraints constraints
      ON constraints.school_id = NEW.school_id
      AND constraints.academic_year_id = NEW.academic_year_id
      AND constraints.employee_id = new_load.employee_id
    WHERE new_load.id = NEW.teaching_load_id
      AND constraints.max_working_days IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM timetable_entries entry
        JOIN timetable_slots slot ON slot.id = entry.slot_id
        JOIN timetable_days day
          ON day.school_id = slot.school_id
          AND day.academic_year_id = slot.academic_year_id
          AND day.day_of_week = slot.day_of_week
        JOIN timetable_teaching_loads load ON load.id = entry.teaching_load_id
        WHERE entry.school_id = NEW.school_id
          AND entry.academic_year_id = NEW.academic_year_id
          AND load.employee_id = new_load.employee_id
          AND slot.day_of_week = new_slot.day_of_week
          AND slot.slot_type = 'lesson'
          AND slot.is_active = 1
          AND day.is_active = 1
      )
      AND (
        SELECT COUNT(DISTINCT slot.day_of_week)
        FROM timetable_entries entry
        JOIN timetable_slots slot ON slot.id = entry.slot_id
        JOIN timetable_days day
          ON day.school_id = slot.school_id
          AND day.academic_year_id = slot.academic_year_id
          AND day.day_of_week = slot.day_of_week
        JOIN timetable_teaching_loads load ON load.id = entry.teaching_load_id
        WHERE entry.school_id = NEW.school_id
          AND entry.academic_year_id = NEW.academic_year_id
          AND load.employee_id = new_load.employee_id
          AND slot.slot_type = 'lesson'
          AND slot.is_active = 1
          AND day.is_active = 1
      ) >= constraints.max_working_days
  );

  SELECT RAISE(ABORT, 'timetable entry max consecutive periods exceeded')
  WHERE EXISTS (
    SELECT 1
    FROM timetable_teaching_loads new_load
    JOIN timetable_slots new_slot ON new_slot.id = NEW.slot_id
    JOIN timetable_teacher_constraints constraints
      ON constraints.school_id = NEW.school_id
      AND constraints.academic_year_id = NEW.academic_year_id
      AND constraints.employee_id = new_load.employee_id
    WHERE new_load.id = NEW.teaching_load_id
      AND constraints.max_consecutive_periods IS NOT NULL
      AND (
        WITH ordered_slots AS (
          SELECT slot.id,
                 ROW_NUMBER() OVER (ORDER BY slot.start_time, slot.slot_index, slot.id) AS position,
                 CASE
                   WHEN slot.slot_type = 'lesson' AND (
                     slot.id = NEW.slot_id
                     OR EXISTS (
                       SELECT 1
                       FROM timetable_entries entry
                       JOIN timetable_teaching_loads load ON load.id = entry.teaching_load_id
                       WHERE entry.school_id = NEW.school_id
                         AND entry.academic_year_id = NEW.academic_year_id
                         AND entry.slot_id = slot.id
                         AND load.employee_id = new_load.employee_id
                     )
                   ) THEN 1 ELSE 0
                 END AS scheduled
          FROM timetable_slots slot
          JOIN timetable_days day
            ON day.school_id = slot.school_id
            AND day.academic_year_id = slot.academic_year_id
            AND day.day_of_week = slot.day_of_week
          WHERE slot.school_id = NEW.school_id
            AND slot.academic_year_id = NEW.academic_year_id
            AND slot.day_of_week = new_slot.day_of_week
            AND slot.is_active = 1
            AND day.is_active = 1
        ), grouped_slots AS (
          SELECT scheduled,
                 SUM(CASE WHEN scheduled = 0 THEN 1 ELSE 0 END)
                   OVER (ORDER BY position) AS run_group
          FROM ordered_slots
        )
        SELECT COALESCE(MAX(run_length), 0)
        FROM (
          SELECT run_group, COUNT(*) AS run_length
          FROM grouped_slots
          WHERE scheduled = 1
          GROUP BY run_group
        )
      ) > constraints.max_consecutive_periods
  );
END;
CREATE TRIGGER IF NOT EXISTS trg_timetable_entries_validate_update
BEFORE UPDATE OF school_id, academic_year_id, slot_id, teaching_load_id
ON timetable_entries
BEGIN
  SELECT RAISE(ABORT, 'timetable entry academic year school mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM academic_years
    WHERE id = NEW.academic_year_id AND school_id = NEW.school_id
  );

  SELECT RAISE(ABORT, 'timetable entry tenant scope mismatch')
  WHERE EXISTS (
    SELECT 1 FROM timetable_slots
    WHERE id = NEW.slot_id AND school_id != NEW.school_id
  ) OR EXISTS (
    SELECT 1 FROM timetable_teaching_loads
    WHERE id = NEW.teaching_load_id AND school_id != NEW.school_id
  );

  SELECT RAISE(ABORT, 'timetable entry academic year mismatch')
  WHERE EXISTS (
    SELECT 1 FROM timetable_slots
    WHERE id = NEW.slot_id
      AND school_id = NEW.school_id
      AND academic_year_id != NEW.academic_year_id
  ) OR EXISTS (
    SELECT 1 FROM timetable_teaching_loads
    WHERE id = NEW.teaching_load_id
      AND school_id = NEW.school_id
      AND academic_year_id != NEW.academic_year_id
  );

  SELECT RAISE(ABORT, 'timetable entry day inactive')
  WHERE EXISTS (
    SELECT 1
    FROM timetable_slots slot
    LEFT JOIN timetable_days day
      ON day.school_id = slot.school_id
      AND day.academic_year_id = slot.academic_year_id
      AND day.day_of_week = slot.day_of_week
    WHERE slot.id = NEW.slot_id
      AND slot.school_id = NEW.school_id
      AND slot.academic_year_id = NEW.academic_year_id
      AND (day.id IS NULL OR day.is_active != 1)
  );

  SELECT RAISE(ABORT, 'timetable entry slot inactive')
  WHERE EXISTS (
    SELECT 1 FROM timetable_slots
    WHERE id = NEW.slot_id
      AND school_id = NEW.school_id
      AND academic_year_id = NEW.academic_year_id
      AND is_active != 1
  );

  SELECT RAISE(ABORT, 'timetable entry slot not schedulable')
  WHERE NOT EXISTS (
    SELECT 1
    FROM timetable_slots slot
    JOIN timetable_days day
      ON day.school_id = slot.school_id
      AND day.academic_year_id = slot.academic_year_id
      AND day.day_of_week = slot.day_of_week
    WHERE slot.id = NEW.slot_id
      AND slot.school_id = NEW.school_id
      AND slot.academic_year_id = NEW.academic_year_id
      AND slot.slot_type = 'lesson'
      AND slot.is_active = 1
      AND day.is_active = 1
  );

  SELECT RAISE(ABORT, 'timetable entry teaching load not schedulable')
  WHERE NOT EXISTS (
    SELECT 1
    FROM timetable_teaching_loads load
    JOIN classes class ON class.id = load.class_id
    LEFT JOIN sections section ON section.id = load.section_id
    JOIN subjects subject ON subject.id = load.subject_id
    LEFT JOIN employees employee ON employee.id = load.employee_id
    WHERE load.id = NEW.teaching_load_id
      AND load.school_id = NEW.school_id
      AND load.academic_year_id = NEW.academic_year_id
      AND load.status = 'active'
      AND class.school_id = NEW.school_id
      AND class.status = 'active'
      AND (load.section_id IS NULL OR (
        section.school_id = NEW.school_id
        AND section.class_id = load.class_id
        AND section.status = 'active'
      ))
      AND subject.school_id = NEW.school_id
      AND subject.class_id = load.class_id
      AND subject.status = 'active'
      AND (subject.section_id IS NULL OR subject.section_id = load.section_id)
      AND (load.employee_id IS NULL OR (
        employee.school_id = NEW.school_id
        AND employee.status = 'active'
        AND employee.role = 'teacher'
      ))
  );

  SELECT RAISE(ABORT, 'timetable entry weekly periods exceeded')
  WHERE (
    SELECT COUNT(*)
    FROM timetable_entries entry
    JOIN timetable_slots slot ON slot.id = entry.slot_id
    JOIN timetable_days day
      ON day.school_id = slot.school_id
      AND day.academic_year_id = slot.academic_year_id
      AND day.day_of_week = slot.day_of_week
    WHERE entry.school_id = NEW.school_id
      AND entry.academic_year_id = NEW.academic_year_id
      AND entry.teaching_load_id = NEW.teaching_load_id
      AND entry.id != OLD.id
      AND slot.slot_type = 'lesson'
      AND slot.is_active = 1
      AND day.is_active = 1
  ) >= (
    SELECT weekly_periods FROM timetable_teaching_loads WHERE id = NEW.teaching_load_id
  );

  SELECT RAISE(ABORT, 'timetable entry group collision')
  WHERE EXISTS (
    SELECT 1
    FROM timetable_entries existing_entry
    JOIN timetable_teaching_loads existing_load ON existing_load.id = existing_entry.teaching_load_id
    JOIN timetable_teaching_loads new_load ON new_load.id = NEW.teaching_load_id
    WHERE existing_entry.id != OLD.id
      AND existing_entry.slot_id = NEW.slot_id
      AND existing_entry.school_id = NEW.school_id
      AND existing_entry.academic_year_id = NEW.academic_year_id
      AND existing_load.class_id = new_load.class_id
      AND (
        existing_load.section_id IS NULL
        OR new_load.section_id IS NULL
        OR existing_load.section_id = new_load.section_id
      )
  );


  SELECT RAISE(ABORT, 'timetable entry teacher unavailable')
  WHERE EXISTS (
    SELECT 1
    FROM timetable_teaching_loads load
    JOIN timetable_teacher_availability availability
      ON availability.school_id = NEW.school_id
      AND availability.academic_year_id = NEW.academic_year_id
      AND availability.employee_id = load.employee_id
      AND availability.slot_id = NEW.slot_id
    WHERE load.id = NEW.teaching_load_id
      AND availability.status = 'unavailable'
  );

  SELECT RAISE(ABORT, 'timetable entry max periods per day exceeded')
  WHERE EXISTS (
    SELECT 1
    FROM timetable_teaching_loads new_load
    JOIN timetable_slots new_slot ON new_slot.id = NEW.slot_id
    JOIN timetable_teacher_constraints constraints
      ON constraints.school_id = NEW.school_id
      AND constraints.academic_year_id = NEW.academic_year_id
      AND constraints.employee_id = new_load.employee_id
    WHERE new_load.id = NEW.teaching_load_id
      AND constraints.max_periods_per_day IS NOT NULL
      AND 1 + (
        SELECT COUNT(*)
        FROM timetable_entries entry
        JOIN timetable_slots slot ON slot.id = entry.slot_id
        JOIN timetable_days day
          ON day.school_id = slot.school_id
          AND day.academic_year_id = slot.academic_year_id
          AND day.day_of_week = slot.day_of_week
        JOIN timetable_teaching_loads load ON load.id = entry.teaching_load_id
        WHERE entry.id != OLD.id
          AND entry.school_id = NEW.school_id
          AND entry.academic_year_id = NEW.academic_year_id
          AND load.employee_id = new_load.employee_id
          AND slot.day_of_week = new_slot.day_of_week
          AND slot.slot_type = 'lesson'
          AND slot.is_active = 1
          AND day.is_active = 1
      ) > constraints.max_periods_per_day
  );

  SELECT RAISE(ABORT, 'timetable entry max working days exceeded')
  WHERE EXISTS (
    SELECT 1
    FROM timetable_teaching_loads new_load
    JOIN timetable_slots new_slot ON new_slot.id = NEW.slot_id
    JOIN timetable_teacher_constraints constraints
      ON constraints.school_id = NEW.school_id
      AND constraints.academic_year_id = NEW.academic_year_id
      AND constraints.employee_id = new_load.employee_id
    WHERE new_load.id = NEW.teaching_load_id
      AND constraints.max_working_days IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM timetable_entries entry
        JOIN timetable_slots slot ON slot.id = entry.slot_id
        JOIN timetable_days day
          ON day.school_id = slot.school_id
          AND day.academic_year_id = slot.academic_year_id
          AND day.day_of_week = slot.day_of_week
        JOIN timetable_teaching_loads load ON load.id = entry.teaching_load_id
        WHERE entry.id != OLD.id
          AND entry.school_id = NEW.school_id
          AND entry.academic_year_id = NEW.academic_year_id
          AND load.employee_id = new_load.employee_id
          AND slot.day_of_week = new_slot.day_of_week
          AND slot.slot_type = 'lesson'
          AND slot.is_active = 1
          AND day.is_active = 1
      )
      AND (
        SELECT COUNT(DISTINCT slot.day_of_week)
        FROM timetable_entries entry
        JOIN timetable_slots slot ON slot.id = entry.slot_id
        JOIN timetable_days day
          ON day.school_id = slot.school_id
          AND day.academic_year_id = slot.academic_year_id
          AND day.day_of_week = slot.day_of_week
        JOIN timetable_teaching_loads load ON load.id = entry.teaching_load_id
        WHERE entry.id != OLD.id
          AND entry.school_id = NEW.school_id
          AND entry.academic_year_id = NEW.academic_year_id
          AND load.employee_id = new_load.employee_id
          AND slot.slot_type = 'lesson'
          AND slot.is_active = 1
          AND day.is_active = 1
      ) >= constraints.max_working_days
  );

  SELECT RAISE(ABORT, 'timetable entry max consecutive periods exceeded')
  WHERE EXISTS (
    SELECT 1
    FROM timetable_teaching_loads new_load
    JOIN timetable_slots new_slot ON new_slot.id = NEW.slot_id
    JOIN timetable_teacher_constraints constraints
      ON constraints.school_id = NEW.school_id
      AND constraints.academic_year_id = NEW.academic_year_id
      AND constraints.employee_id = new_load.employee_id
    WHERE new_load.id = NEW.teaching_load_id
      AND constraints.max_consecutive_periods IS NOT NULL
      AND (
        WITH ordered_slots AS (
          SELECT slot.id,
                 ROW_NUMBER() OVER (ORDER BY slot.start_time, slot.slot_index, slot.id) AS position,
                 CASE
                   WHEN slot.slot_type = 'lesson' AND (
                     slot.id = NEW.slot_id
                     OR EXISTS (
                       SELECT 1
                       FROM timetable_entries entry
                       JOIN timetable_teaching_loads load ON load.id = entry.teaching_load_id
                       WHERE entry.school_id = NEW.school_id
                         AND entry.academic_year_id = NEW.academic_year_id
                         AND entry.id != OLD.id
                         AND entry.slot_id = slot.id
                         AND load.employee_id = new_load.employee_id
                     )
                   ) THEN 1 ELSE 0
                 END AS scheduled
          FROM timetable_slots slot
          JOIN timetable_days day
            ON day.school_id = slot.school_id
            AND day.academic_year_id = slot.academic_year_id
            AND day.day_of_week = slot.day_of_week
          WHERE slot.school_id = NEW.school_id
            AND slot.academic_year_id = NEW.academic_year_id
            AND slot.day_of_week = new_slot.day_of_week
            AND slot.is_active = 1
            AND day.is_active = 1
        ), grouped_slots AS (
          SELECT scheduled,
                 SUM(CASE WHEN scheduled = 0 THEN 1 ELSE 0 END)
                   OVER (ORDER BY position) AS run_group
          FROM ordered_slots
        )
        SELECT COALESCE(MAX(run_length), 0)
        FROM (
          SELECT run_group, COUNT(*) AS run_length
          FROM grouped_slots
          WHERE scheduled = 1
          GROUP BY run_group
        )
      ) > constraints.max_consecutive_periods
  );
END;
