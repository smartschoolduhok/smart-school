-- Phase 17B.2: religious-subject metadata and assignment integrity.
-- Student religion remains personal metadata; student_subjects remains the academic source of truth.
ALTER TABLE subjects
ADD COLUMN religious_track TEXT NULL
CHECK (religious_track IS NULL OR religious_track IN ('islamic', 'christian', 'other'));

CREATE INDEX IF NOT EXISTS idx_subjects_school_class_religious_track
ON subjects (school_id, class_id, religious_track);

CREATE TRIGGER IF NOT EXISTS trg_student_subjects_one_religious_insert
BEFORE INSERT ON student_subjects
FOR EACH ROW
WHEN NEW.is_active = 1
  AND EXISTS (
    SELECT 1 FROM subjects candidate
    WHERE candidate.id = NEW.subject_id
      AND candidate.school_id = NEW.school_id
      AND candidate.religious_track IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'student already has an active religious subject')
  WHERE EXISTS (
    SELECT 1
    FROM student_subjects existing
    JOIN subjects existing_subject
      ON existing_subject.id = existing.subject_id
     AND existing_subject.school_id = existing.school_id
    WHERE existing.school_id = NEW.school_id
      AND existing.student_id = NEW.student_id
      AND existing.is_active = 1
      AND existing.subject_id <> NEW.subject_id
      AND existing_subject.religious_track IS NOT NULL
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_student_subjects_one_religious_update
BEFORE UPDATE OF school_id, student_id, subject_id, is_active ON student_subjects
FOR EACH ROW
WHEN NEW.is_active = 1
  AND EXISTS (
    SELECT 1 FROM subjects candidate
    WHERE candidate.id = NEW.subject_id
      AND candidate.school_id = NEW.school_id
      AND candidate.religious_track IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'student already has an active religious subject')
  WHERE EXISTS (
    SELECT 1
    FROM student_subjects existing
    JOIN subjects existing_subject
      ON existing_subject.id = existing.subject_id
     AND existing_subject.school_id = existing.school_id
    WHERE existing.school_id = NEW.school_id
      AND existing.student_id = NEW.student_id
      AND existing.id <> OLD.id
      AND existing.is_active = 1
      AND existing.subject_id <> NEW.subject_id
      AND existing_subject.religious_track IS NOT NULL
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_subjects_religious_track_assignment_conflict
BEFORE UPDATE OF religious_track ON subjects
FOR EACH ROW
WHEN NEW.religious_track IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'religious subject conversion conflicts with active assignments')
  WHERE EXISTS (
    SELECT 1
    FROM student_subjects assigned
    JOIN student_subjects other
      ON other.school_id = assigned.school_id
     AND other.student_id = assigned.student_id
     AND other.is_active = 1
     AND other.id <> assigned.id
    JOIN subjects other_subject
      ON other_subject.id = other.subject_id
     AND other_subject.school_id = other.school_id
    WHERE assigned.school_id = OLD.school_id
      AND assigned.subject_id = OLD.id
      AND assigned.is_active = 1
      AND other_subject.religious_track IS NOT NULL
  );
END;
