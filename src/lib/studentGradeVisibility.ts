export const STUDENT_GRADES_HIDDEN = 'درجات هذا الطالب مخفية لهذه السنة الدراسية. يبقى الطالب في القوائم والتوزيع.';

/** SQL expressions here are application-owned identifiers, never request input.
 * Live grade rows have no year column and use the school's active year. Saved
 * reports use their own year so changing this year does not hide another year.
 */
export function studentGradesVisibleSql(school: string, student: string, year?: string): string {
  const activeYear = `(SELECT visibility_year.id FROM academic_years visibility_year WHERE visibility_year.school_id=${school} AND visibility_year.is_active=1 ORDER BY visibility_year.id DESC LIMIT 1)`;
  return `NOT EXISTS (SELECT 1 FROM student_study_status grade_visibility WHERE grade_visibility.school_id=${school} AND grade_visibility.student_id=${student} AND grade_visibility.academic_year_id=${year ? `COALESCE(${year},${activeYear})` : activeYear} AND grade_visibility.grades_visible=0)`;
}

/** Legacy saved cards without a year must not expose a hidden year's snapshot. */
export function savedStudentGradesVisibleSql(school: string, student: string, year: string): string {
  return `NOT EXISTS (SELECT 1 FROM student_study_status saved_grade_visibility WHERE saved_grade_visibility.school_id=${school} AND saved_grade_visibility.student_id=${student} AND (${year} IS NULL OR saved_grade_visibility.academic_year_id=${year}) AND saved_grade_visibility.grades_visible=0)`;
}

export async function savedStudentGradesAreVisible(db: D1Database, schoolId: number, studentId: number, academicYearId: number | null): Promise<boolean> {
  const row = await db.prepare(`WITH visibility_scope AS (SELECT ? AS school_id, ? AS student_id, ? AS year_id) SELECT ${savedStudentGradesVisibleSql('v.school_id', 'v.student_id', 'v.year_id')} AS visible FROM visibility_scope v`).bind(schoolId, studentId, academicYearId ?? null).first<{visible:number}>();
  return Number(row?.visible) === 1;
}

export async function studentGradesAreVisible(db: D1Database, schoolId: number, studentId: number, academicYearId?: number | null): Promise<boolean> {
  const row = await db.prepare(`WITH visibility_scope AS (SELECT ? AS school_id, ? AS student_id, ? AS year_id) SELECT ${studentGradesVisibleSql('v.school_id', 'v.student_id', 'v.year_id')} AS visible FROM visibility_scope v`).bind(schoolId, studentId, academicYearId ?? null).first<{visible: number}>();
  return Number(row?.visible) === 1;
}

export const gradeProgressNotificationAccessSql = `(COALESCE(notification.reference_type,'') <> 'grade_progress' OR EXISTS (SELECT 1 FROM grade_progress_reports progress_visibility WHERE progress_visibility.school_id=notification.school_id AND progress_visibility.report_key=notification.reference_key AND ${studentGradesVisibleSql('progress_visibility.school_id','progress_visibility.student_id','progress_visibility.academic_year_id')}))`;

export async function hiddenGradeStudentIds(db: D1Database, schoolId: number, academicYearId?: number | null): Promise<Set<number>> {
  const rows = await db.prepare(`SELECT student_id FROM student_study_status WHERE school_id=? AND academic_year_id=COALESCE(?,(SELECT id FROM academic_years WHERE school_id=? AND is_active=1 ORDER BY id DESC LIMIT 1)) AND grades_visible=0`).bind(schoolId, academicYearId ?? null, schoolId).all<{student_id: number}>();
  return new Set((rows.results || []).map(row => Number(row.student_id)));
}

/** Put both statements in the same batch around writes to prevent a hide/save race. */
export function studentGradeVisibilityWriteGuard(db: D1Database, schoolId: number, studentIds: number[], academicYearId?: number | null) {
  const token = crypto.randomUUID();
  return {
    before: db.prepare(`INSERT INTO workflow_write_guards(token,valid) SELECT ?,CASE WHEN NOT EXISTS (SELECT 1 FROM json_each(?) students WHERE NOT (${studentGradesVisibleSql('scope.school_id', 'CAST(students.value AS INTEGER)', 'scope.year_id')})) THEN 1 ELSE 0 END FROM (SELECT ? AS school_id, ? AS year_id) scope`).bind(token, JSON.stringify([...new Set(studentIds)]), schoolId, academicYearId ?? null),
    after: db.prepare('DELETE FROM workflow_write_guards WHERE token=?').bind(token),
  };
}

export function redactHiddenGradeImportJob<T extends Record<string, any>>(job: T, hidden: Set<number>): T {
  if (job.import_type !== 'grades' || !job.summary_json || !hidden.size) return job;
  const clean = (value: any): any => {
    if (Array.isArray(value)) return value.map(clean).filter(item => item !== undefined);
    if (!value || typeof value !== 'object') return value;
    if (value.student_id != null && hidden.has(Number(value.student_id))) return undefined;
    // Aggregate diagnostics can reveal a hidden grade in a one-student sheet.
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['zero_patterns','discovered_markers'].includes(key)).map(([key, item]) => [key, clean(item)]).filter(([, item]) => item !== undefined));
  };
  try { return {...job, summary_json: JSON.stringify(clean(JSON.parse(job.summary_json)))}; }
  catch { return {...job, summary_json: null}; }
}

export async function redactHiddenGradeImportJobs<T extends Record<string, any>>(db: D1Database, jobs: T[]): Promise<T[]> {
  const scopes = new Map<string, Set<number>>();
  const result: T[] = [];
  for (const job of jobs) {
    if (job.import_type !== 'grades') { result.push(job); continue; }
    let year: number | null = null;
    try {
      const parsed = JSON.parse(job.summary_json || '{}');
      if (parsed.visibility_scope_version === 1 && Number.isSafeInteger(parsed.academic_year_id) && parsed.academic_year_id > 0) year = parsed.academic_year_id;
    } catch { /* Legacy jobs have no reliable year, so protect all hidden years. */ }
    const key = `${job.school_id}:${year ?? 'legacy'}`;
    if (!scopes.has(key)) {
      const rows = await db.prepare(`SELECT DISTINCT student_id FROM student_study_status WHERE school_id=? AND grades_visible=0 ${year == null ? '' : 'AND academic_year_id=?'}`).bind(job.school_id, ...(year == null ? [] : [year])).all<{student_id:number}>();
      scopes.set(key, new Set((rows.results || []).map(row => Number(row.student_id))));
    }
    result.push(redactHiddenGradeImportJob(job, scopes.get(key)!));
  }
  return result;
}
