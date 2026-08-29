-- Phase 17B.1: optional personal religion metadata for students.
-- Academic subject participation remains defined exclusively by student_subjects.
ALTER TABLE students
ADD COLUMN religion TEXT NULL
CHECK (religion IS NULL OR religion IN ('muslim', 'christian', 'other'));
