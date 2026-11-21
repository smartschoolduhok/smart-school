// Subject assignments (student_subjects) and their grades belong to one
// academic year (migration 0063). These helpers keep every write path on the
// active year and archive/restore whole years when the active year changes.

type Bindable<S> = { bind(...values: unknown[]): S };

export const YEAR_CLOSED_ERROR = 'هذا التعيين يعود لسنة دراسية غير مفعّلة، ولا يمكن إعادة تفعيله. عيّن المادة من جديد للسنة الحالية.';
export const GRADE_YEAR_ARCHIVED_ERROR = 'هذه الدرجات تعود لسنة دراسية مؤرشفة ولا يمكن تعديلها. فعّل تلك السنة أولًا إذا كان التعديل ضروريًا.';

/** SQL condition: the assignment alias belongs to its school's active year (or predates year tagging). */
export function currentYearAssignmentSql(alias: string): string {
  return `(${alias}.academic_year_id IS NULL OR ${alias}.academic_year_id = (SELECT active_year.id FROM academic_years AS active_year WHERE active_year.school_id = ${alias}.school_id AND active_year.is_active = 1))`;
}

/** True when the database predates migration 0063 (or lacks the grade tables). */
export function isMissingYearScopeSchema(error: unknown): boolean {
  return /no such (column|table): (\w+\.)?(academic_year_id|year_archived_at|student_subjects|grades)\b/i.test(String((error as Error)?.message ?? error));
}

/** Statements to run before the activation flips academic_years.is_active. */
export function beforeYearActivationStatements<S extends Bindable<S>>(db: { prepare(sql: string): S }, schoolId: number): S[] {
  // Untagged rows were made while the outgoing year (if any) was active.
  return [db.prepare(`
    UPDATE student_subjects
    SET academic_year_id = (SELECT id FROM academic_years WHERE school_id = ? AND is_active = 1)
    WHERE school_id = ? AND academic_year_id IS NULL
  `).bind(schoolId, schoolId)];
}

/** Statements to run after the activation, in the same batch. */
export function afterYearActivationStatements<S extends Bindable<S>>(db: { prepare(sql: string): S }, schoolId: number, yearId: number): S[] {
  return [
    // Rows still untagged had no previous year: they belong to the first active year.
    db.prepare(`UPDATE student_subjects SET academic_year_id = ? WHERE school_id = ? AND academic_year_id IS NULL`).bind(yearId, schoolId),
    // Archive other years: grades first (while their assignment is still active), then assignments.
    db.prepare(`
      UPDATE grades SET is_active = 0, year_archived_at = unixepoch()
      WHERE school_id = ? AND is_active = 1 AND year_archived_at IS NULL
        AND student_subject_id IN (
          SELECT id FROM student_subjects
          WHERE school_id = ? AND is_active = 1 AND academic_year_id <> ?
        )
    `).bind(schoolId, schoolId, yearId),
    db.prepare(`
      UPDATE student_subjects SET is_active = 0, removed_at = unixepoch(), year_archived_at = unixepoch(), updated_at = unixepoch()
      WHERE school_id = ? AND is_active = 1 AND academic_year_id <> ?
    `).bind(schoolId, yearId),
    // Restore the activated year's archive, assignments first so the grade guard sees an active year.
    db.prepare(`
      UPDATE student_subjects SET is_active = 1, removed_at = NULL, year_archived_at = NULL, updated_at = unixepoch()
      WHERE school_id = ? AND academic_year_id = ? AND year_archived_at IS NOT NULL
    `).bind(schoolId, yearId),
    db.prepare(`
      UPDATE grades SET is_active = 1, year_archived_at = NULL
      WHERE school_id = ? AND year_archived_at IS NOT NULL
        AND student_subject_id IN (SELECT id FROM student_subjects WHERE school_id = ? AND academic_year_id = ?)
    `).bind(schoolId, schoolId, yearId),
  ];
}
