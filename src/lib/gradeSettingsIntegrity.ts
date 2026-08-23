import { RAW_GRADE_FIELDS } from './gradeScheme.ts';

const rawGradeValueSelects = RAW_GRADE_FIELDS
  .map(field => `SELECT id AS grade_id, ${field} AS value FROM target_grades`)
  .join('\n  UNION ALL\n  ');

// Includes inactive rows and disabled/hidden raw fields because those values can
// become authoritative again after a later scheme or lifecycle change.
export const RAW_GRADE_MAX_CONFLICT_SQL = `
WITH target_grades AS (
  SELECT id, ${RAW_GRADE_FIELDS.join(', ')}
  FROM grades
  WHERE school_id = ?
),
raw_values AS (
  ${rawGradeValueSelects}
)
SELECT
  COUNT(DISTINCT grade_id) AS conflicting_grade_rows,
  MAX(value) AS highest_raw_grade
FROM raw_values
WHERE value > ?
`;

export interface RawGradeMaxConflict {
  conflicting_grade_rows: number;
  highest_raw_grade: number | null;
}

export function shouldCheckRawGradeMaxConflict(
  currentMaxGrade: number,
  proposedMaxGrade: number,
): boolean {
  return Number.isFinite(currentMaxGrade) &&
    Number.isFinite(proposedMaxGrade) &&
    proposedMaxGrade < currentMaxGrade;
}
