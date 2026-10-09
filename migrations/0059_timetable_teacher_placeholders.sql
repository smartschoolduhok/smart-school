-- Names reserve one timetable resource without creating employee records.
ALTER TABLE timetable_teaching_loads ADD COLUMN teacher_placeholder TEXT;
CREATE INDEX idx_timetable_teacher_placeholder
ON timetable_teaching_loads(school_id, academic_year_id, teacher_placeholder)
WHERE employee_id IS NULL AND teacher_placeholder IS NOT NULL;

CREATE TRIGGER trg_timetable_placeholder_validate_insert
BEFORE INSERT ON timetable_teaching_loads BEGIN
  SELECT RAISE(ABORT, 'timetable placeholder invalid')
  WHERE NEW.teacher_placeholder IS NOT NULL AND (
    NEW.employee_id IS NOT NULL OR length(NEW.teacher_placeholder) = 0
    OR length(NEW.teacher_placeholder) > 120 OR NEW.teacher_placeholder != trim(NEW.teacher_placeholder,
      char(32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))
    OR instr(NEW.teacher_placeholder, char(0)) > 0
    OR NEW.teacher_placeholder GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*')
  );
  SELECT RAISE(ABORT, 'timetable placeholder parallel teacher')
  WHERE NEW.status = 'active' AND NEW.teacher_placeholder IS NOT NULL AND EXISTS (
    SELECT 1 FROM timetable_teaching_loads peer WHERE peer.school_id = NEW.school_id
      AND peer.academic_year_id = NEW.academic_year_id AND peer.status = 'active'
      AND peer.employee_id IS NULL AND peer.teacher_placeholder = NEW.teacher_placeholder
      AND (peer.id = NEW.parallel_with_load_id OR peer.parallel_with_load_id = NEW.id)
  );
END;
CREATE TRIGGER trg_timetable_placeholder_validate_update
BEFORE UPDATE OF teacher_placeholder, employee_id, school_id, academic_year_id, status, parallel_with_load_id
ON timetable_teaching_loads BEGIN
  SELECT RAISE(ABORT, 'timetable placeholder invalid')
  WHERE NEW.teacher_placeholder IS NOT NULL AND (
    NEW.employee_id IS NOT NULL OR length(NEW.teacher_placeholder) = 0
    OR length(NEW.teacher_placeholder) > 120 OR NEW.teacher_placeholder != trim(NEW.teacher_placeholder,
      char(32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))
    OR instr(NEW.teacher_placeholder, char(0)) > 0
    OR NEW.teacher_placeholder GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*')
  );
  SELECT RAISE(ABORT, 'timetable placeholder parallel teacher')
  WHERE NEW.status = 'active' AND NEW.teacher_placeholder IS NOT NULL AND EXISTS (
    SELECT 1 FROM timetable_teaching_loads peer WHERE peer.school_id = NEW.school_id
      AND peer.academic_year_id = NEW.academic_year_id AND peer.status = 'active'
      AND peer.employee_id IS NULL AND peer.teacher_placeholder = NEW.teacher_placeholder
      AND (peer.id = NEW.parallel_with_load_id OR peer.parallel_with_load_id = NEW.id)
  );
  SELECT RAISE(ABORT, 'timetable placeholder teacher collision')
  WHERE NEW.status = 'active' AND NEW.employee_id IS NULL AND NEW.teacher_placeholder IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM timetable_entries own
      JOIN timetable_entries other ON other.school_id = own.school_id
        AND other.academic_year_id = own.academic_year_id AND other.slot_id = own.slot_id
        AND other.teaching_load_id != own.teaching_load_id
      JOIN timetable_teaching_loads peer ON peer.id = other.teaching_load_id
      WHERE own.teaching_load_id = OLD.id AND own.school_id = NEW.school_id
        AND own.academic_year_id = NEW.academic_year_id
        AND peer.employee_id IS NULL AND peer.teacher_placeholder = NEW.teacher_placeholder
    );
END;
CREATE TRIGGER trg_timetable_placeholder_revision
AFTER UPDATE OF teacher_placeholder ON timetable_teaching_loads
WHEN NEW.teacher_placeholder IS NOT OLD.teacher_placeholder BEGIN
  INSERT INTO timetable_revisions(school_id, academic_year_id, revision, updated_at)
  VALUES(NEW.school_id, NEW.academic_year_id, 1, unixepoch())
  ON CONFLICT(school_id, academic_year_id) DO UPDATE SET revision = revision + 1, updated_at = unixepoch();
END;

CREATE TRIGGER trg_timetable_placeholder_entries_insert
BEFORE INSERT ON timetable_entries
BEGIN
  SELECT RAISE(ABORT, 'timetable placeholder teacher collision')
  WHERE EXISTS (
    SELECT 1 FROM timetable_teaching_loads candidate
    JOIN timetable_teaching_loads peer ON peer.school_id = candidate.school_id
      AND peer.academic_year_id = candidate.academic_year_id
      AND peer.employee_id IS NULL AND peer.teacher_placeholder = candidate.teacher_placeholder
    JOIN timetable_entries entry ON entry.teaching_load_id = peer.id
      AND entry.school_id = NEW.school_id AND entry.academic_year_id = NEW.academic_year_id
      AND entry.slot_id = NEW.slot_id
    WHERE candidate.id = NEW.teaching_load_id AND candidate.employee_id IS NULL
      AND candidate.teacher_placeholder IS NOT NULL
  );
END;

CREATE TRIGGER trg_timetable_placeholder_entries_update
BEFORE UPDATE OF slot_id, teaching_load_id, school_id, academic_year_id ON timetable_entries
BEGIN
  SELECT RAISE(ABORT, 'timetable placeholder teacher collision')
  WHERE EXISTS (
    SELECT 1 FROM timetable_teaching_loads candidate
    JOIN timetable_teaching_loads peer ON peer.school_id = candidate.school_id
      AND peer.academic_year_id = candidate.academic_year_id
      AND peer.employee_id IS NULL AND peer.teacher_placeholder = candidate.teacher_placeholder
    JOIN timetable_entries entry ON entry.teaching_load_id = peer.id
      AND entry.school_id = NEW.school_id AND entry.academic_year_id = NEW.academic_year_id
      AND entry.slot_id = NEW.slot_id
    WHERE candidate.id = NEW.teaching_load_id AND candidate.employee_id IS NULL
      AND candidate.teacher_placeholder IS NOT NULL AND entry.id != OLD.id
  );
END;

