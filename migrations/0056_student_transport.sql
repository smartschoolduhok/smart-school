-- Residence and direction-specific transport. Existing students remain unspecified.
CREATE TABLE residential_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  name_key TEXT NOT NULL CHECK(length(name_key) > 0),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(school_id, name_key)
);

CREATE TABLE transport_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  name_key TEXT NOT NULL CHECK(length(name_key) > 0),
  driver_name TEXT,
  driver_phone TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(school_id, name_key)
);

ALTER TABLE students ADD COLUMN residential_area_id INTEGER REFERENCES residential_areas(id);
ALTER TABLE students ADD COLUMN pickup_landmark TEXT;
ALTER TABLE students ADD COLUMN guardian_phone_secondary TEXT;
ALTER TABLE students ADD COLUMN transport_to_school TEXT NOT NULL DEFAULT 'unspecified'
  CHECK(transport_to_school IN ('school', 'private', 'family', 'other', 'unspecified'));
ALTER TABLE students ADD COLUMN transport_from_school TEXT NOT NULL DEFAULT 'unspecified'
  CHECK(transport_from_school IN ('school', 'private', 'family', 'other', 'unspecified'));
ALTER TABLE students ADD COLUMN transport_to_school_line_id INTEGER REFERENCES transport_lines(id);
ALTER TABLE students ADD COLUMN transport_from_school_line_id INTEGER REFERENCES transport_lines(id);
ALTER TABLE students ADD COLUMN private_driver_name TEXT;
ALTER TABLE students ADD COLUMN private_driver_phone TEXT;

CREATE INDEX idx_students_residential_area ON students(school_id, residential_area_id);
CREATE INDEX idx_students_transport_to ON students(school_id, transport_to_school_line_id);
CREATE INDEX idx_students_transport_from ON students(school_id, transport_from_school_line_id);

CREATE TRIGGER students_transport_insert_guard BEFORE INSERT ON students
BEGIN
  SELECT CASE WHEN NEW.residential_area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM residential_areas WHERE id = NEW.residential_area_id AND school_id = NEW.school_id
  ) THEN RAISE(ABORT, 'transport_area_school_mismatch') END;
  SELECT CASE WHEN NEW.transport_to_school_line_id IS NOT NULL AND (
    NEW.transport_to_school <> 'school' OR NOT EXISTS (
      SELECT 1 FROM transport_lines WHERE id = NEW.transport_to_school_line_id AND school_id = NEW.school_id
    )
  ) THEN RAISE(ABORT, 'transport_to_line_school_mismatch') END;
  SELECT CASE WHEN NEW.transport_from_school_line_id IS NOT NULL AND (
    NEW.transport_from_school <> 'school' OR NOT EXISTS (
      SELECT 1 FROM transport_lines WHERE id = NEW.transport_from_school_line_id AND school_id = NEW.school_id
    )
  ) THEN RAISE(ABORT, 'transport_from_line_school_mismatch') END;
END;

CREATE TRIGGER students_transport_update_guard
BEFORE UPDATE OF school_id, residential_area_id, transport_to_school, transport_from_school,
  transport_to_school_line_id, transport_from_school_line_id ON students
BEGIN
  SELECT CASE WHEN NEW.residential_area_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM residential_areas WHERE id = NEW.residential_area_id AND school_id = NEW.school_id
  ) THEN RAISE(ABORT, 'transport_area_school_mismatch') END;
  SELECT CASE WHEN NEW.transport_to_school_line_id IS NOT NULL AND (
    NEW.transport_to_school <> 'school' OR NOT EXISTS (
      SELECT 1 FROM transport_lines WHERE id = NEW.transport_to_school_line_id AND school_id = NEW.school_id
    )
  ) THEN RAISE(ABORT, 'transport_to_line_school_mismatch') END;
  SELECT CASE WHEN NEW.transport_from_school_line_id IS NOT NULL AND (
    NEW.transport_from_school <> 'school' OR NOT EXISTS (
      SELECT 1 FROM transport_lines WHERE id = NEW.transport_from_school_line_id AND school_id = NEW.school_id
    )
  ) THEN RAISE(ABORT, 'transport_from_line_school_mismatch') END;
END;

CREATE TRIGGER residential_areas_school_immutable BEFORE UPDATE OF school_id ON residential_areas
WHEN NEW.school_id <> OLD.school_id
BEGIN SELECT RAISE(ABORT, 'transport_school_immutable'); END;

CREATE TRIGGER transport_lines_school_immutable BEFORE UPDATE OF school_id ON transport_lines
WHEN NEW.school_id <> OLD.school_id
BEGIN SELECT RAISE(ABORT, 'transport_school_immutable'); END;
