-- Preserve the newest (highest id) active year per school before enforcing the invariant.
UPDATE academic_years
SET is_active = 0
WHERE is_active = 1
  AND id <> (
    SELECT MAX(active_year.id)
    FROM academic_years AS active_year
    WHERE active_year.school_id = academic_years.school_id
      AND active_year.is_active = 1
  );

-- At most one active academic year may exist for a school.
CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_years_one_active_per_school
ON academic_years(school_id)
WHERE is_active = 1;

-- Preserve legacy duplicate names, but reject new same-school duplicates deterministically.
CREATE TRIGGER IF NOT EXISTS trg_academic_years_unique_name_insert
BEFORE INSERT ON academic_years
WHEN EXISTS (
  SELECT 1
  FROM academic_years
  WHERE school_id = NEW.school_id
    AND lower(trim(name)) = lower(trim(NEW.name))
)
BEGIN
  SELECT RAISE(ABORT, 'duplicate academic year name');
END;

CREATE TRIGGER IF NOT EXISTS trg_academic_years_unique_name_update
BEFORE UPDATE OF name ON academic_years
WHEN EXISTS (
  SELECT 1
  FROM academic_years
  WHERE school_id = NEW.school_id
    AND id <> OLD.id
    AND lower(trim(name)) = lower(trim(NEW.name))
)
BEGIN
  SELECT RAISE(ABORT, 'duplicate academic year name');
END;
