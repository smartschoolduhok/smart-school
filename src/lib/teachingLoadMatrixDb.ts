import type { TimetableTeachingLoad } from './timetable.ts';
import {
  type MatrixContext, type MatrixScope, type MatrixPlan,
  STALE_MATRIX_CODE, STALE_MATRIX_MESSAGE, summarizeMatrix,
} from './teachingLoadMatrix.ts';

export class MatrixError extends Error {
  code: string;
  status: 400 | 404 | 409;
  constructor(code: string, message: string, status: 400 | 404 | 409 = 400) { super(message); this.code = code; this.status = status; }
}
export const staleMatrixError = () => new MatrixError(STALE_MATRIX_CODE, STALE_MATRIX_MESSAGE, 409);

// One read-only batch provides a consistent revision + data snapshot. The
// private school/year schedule is needed for cross-class teacher conflicts;
// only this class's rows are returned to the client.
export async function loadTeachingLoadMatrix(db: D1Database, schoolId: number, yearId: number, classId: number): Promise<MatrixContext> {
  const scoped = (sql: string, ...args: (number | string)[]) => db.prepare(sql).bind(...args);
  const results = await db.batch([
    scoped('SELECT id FROM academic_years WHERE school_id = ? AND id = ?', schoolId, yearId),
    scoped('SELECT id, school_id, name, status, order_index FROM classes WHERE school_id = ? AND id = ?', schoolId, classId),
    scoped("SELECT id, school_id, class_id, name, status FROM sections WHERE school_id = ? AND class_id = ? AND status = 'active' ORDER BY id", schoolId, classId),
    scoped("SELECT id, school_id, class_id, section_id, name, status, order_index FROM subjects WHERE school_id = ? AND class_id = ? AND status = 'active' ORDER BY order_index, id", schoolId, classId),
    scoped("SELECT id, school_id, full_name, status, role FROM employees WHERE school_id = ? AND status = 'active' AND role = 'teacher' ORDER BY full_name, id", schoolId),
    scoped(`SELECT load.*, employee.full_name AS employee_name,
      employee.status AS employee_status, employee.role AS employee_role, employee.school_id AS employee_school_id,
      class.status AS class_status, class.school_id AS class_school_id,
      section.status AS section_status, section.school_id AS section_school_id, section.class_id AS section_class_id,
      subject.status AS subject_status, subject.school_id AS subject_school_id,
      subject.class_id AS subject_class_id, subject.section_id AS subject_section_id
      FROM timetable_teaching_loads load
      LEFT JOIN employees employee ON employee.id = load.employee_id AND employee.school_id = load.school_id
      LEFT JOIN classes class ON class.id = load.class_id AND class.school_id = load.school_id
      LEFT JOIN sections section ON section.id = load.section_id AND section.school_id = load.school_id
      LEFT JOIN subjects subject ON subject.id = load.subject_id AND subject.school_id = load.school_id
      WHERE load.school_id = ? AND load.academic_year_id = ? ORDER BY load.id`, schoolId, yearId),
    scoped('SELECT * FROM timetable_days WHERE school_id = ? AND academic_year_id = ? ORDER BY order_index, id', schoolId, yearId),
    scoped('SELECT * FROM timetable_slots WHERE school_id = ? AND academic_year_id = ? ORDER BY day_of_week, start_time, slot_index, id', schoolId, yearId),
    scoped('SELECT * FROM timetable_entries WHERE school_id = ? AND academic_year_id = ? ORDER BY id', schoolId, yearId),
    scoped('SELECT * FROM timetable_teacher_availability WHERE school_id = ? AND academic_year_id = ? ORDER BY id', schoolId, yearId),
    scoped('SELECT * FROM timetable_teacher_constraints WHERE school_id = ? AND academic_year_id = ? ORDER BY id', schoolId, yearId),
    scoped('SELECT revision FROM timetable_revisions WHERE school_id = ? AND academic_year_id = ?', schoolId, yearId),
  ]);
  const rows = <T>(i: number) => (results[i].results ?? []) as T[];
  if (!rows(0).length || !rows(1).length) throw new MatrixError('missing_or_not_in_scope', 'السنة أو الصف غير متاح ضمن المدرسة المحددة.', 404);
  const classRecord = rows<MatrixContext['class']>(1)[0];
  if (classRecord.status !== 'active') throw new MatrixError('inactive_class', 'الصف المحدد غير فعال.');
  return { class: classRecord, academic_year_id: yearId,
    sections: rows(2), subjects: rows(3), teachers: rows(4), loads: rows(5),
    days: rows(6), slots: rows(7), entries: rows(8), availability: rows(9), constraints: rows(10),
    timetable_revision: rows<{ revision: number }>(11)[0]?.revision ?? 0 };
}

export function publicTeachingLoadMatrix(context: MatrixContext) {
  const loads = context.loads.filter(l => l.class_id === context.class.id && l.status === 'active');
  return { class: context.class, sections: context.sections, subjects: context.subjects,
    teachers: context.teachers, loads, timetable_revision: context.timetable_revision,
    summary: summarizeMatrix(context.class.id, context.sections, context.subjects, loads) };
}

export async function loadMatrixCopySource(db: D1Database, schoolId: number, sourceYearId: number, classId: number) {
  const results = await db.batch([
    db.prepare('SELECT id FROM academic_years WHERE school_id = ? AND id = ?').bind(schoolId, sourceYearId),
    db.prepare(`SELECT * FROM timetable_teaching_loads
      WHERE school_id = ? AND academic_year_id = ? AND class_id = ? AND status = 'active'
      ORDER BY subject_id, section_id, id`).bind(schoolId, sourceYearId, classId),
  ]);
  if (!results[0].results?.length) throw new MatrixError('missing_or_not_in_scope', 'السنة المصدر غير متاحة ضمن المدرسة المحددة.', 404);
  return results[1].results as unknown as TimetableTeachingLoad[];
}

export function buildMatrixApplyStatements(db: D1Database, scope: Required<MatrixScope>, plan: MatrixPlan, userId: number) {
  if (!plan.can_apply) throw new MatrixError('blocked_teaching_load_matrix', 'توجد تعارضات تمنع حفظ مصفوفة النصاب.', 409);
  const token = crypto.randomUUID();
  const statements = [db.prepare(`INSERT INTO timetable_revision_assertions
    (token, school_id, academic_year_id, expected_revision) VALUES (?, ?, ?, ?)`)
    .bind(token, scope.school_id, scope.academic_year_id, plan.revision)];
  const updates = plan.items.filter(i => i.action === 'update');
  const creates = plan.items.filter(i => i.action === 'create');
  const deactivations = plan.items.filter(i => i.action === 'deactivate');
  // Bind validated numeric/null data, never interpolate it into SQL. Each
  // non-empty group is ONE statement regardless of cell count (maximum 500).
  const group = (sql: string, values: unknown[]) => db.prepare(sql).bind(
    JSON.stringify(values), scope.school_id, scope.academic_year_id, scope.class_id, userId);
  // Clear ONLY changing, previously assigned teachers, inside this same batch.
  // This permits coupled swaps without weakening any DB trigger.
  const changingTeachers = updates.filter(i => i.old_employee_id != null && i.old_employee_id !== i.new_employee_id);
  if (changingTeachers.length) {
    statements.push(group(`UPDATE timetable_teaching_loads SET employee_id = NULL,
      updated_by_user_id = ?5, updated_at = unixepoch()
      WHERE school_id = ?2 AND academic_year_id = ?3 AND class_id = ?4 AND status = 'active'
        AND id IN (SELECT value FROM json_each(?1))`, changingTeachers.map(i => i.existing_load_id)));
  }
  if (creates.length) {
    // Historical inactive rows are preserved; match the individual-create API.
    statements.push(group(`INSERT INTO timetable_teaching_loads
      (school_id, academic_year_id, class_id, section_id, subject_id, employee_id, weekly_periods,
       status, created_by_user_id, updated_by_user_id)
      SELECT ?2, ?3, ?4, json_extract(value, '$.section_id'), json_extract(value, '$.subject_id'),
        json_extract(value, '$.employee_id'), json_extract(value, '$.weekly_periods'), 'active', ?5, ?5
      FROM json_each(?1) ORDER BY CAST(key AS INTEGER)`, creates.map(i => ({ section_id: i.section_id,
        subject_id: i.subject_id, employee_id: i.new_employee_id, weekly_periods: i.new_weekly_periods }))));
  }
  if (updates.length) {
    statements.push(group(`UPDATE timetable_teaching_loads
      SET employee_id = json_extract(change.value, '$.employee_id'),
          weekly_periods = json_extract(change.value, '$.weekly_periods'),
          updated_by_user_id = ?5, updated_at = unixepoch()
      FROM json_each(?1) AS change
      WHERE timetable_teaching_loads.id = json_extract(change.value, '$.id')
        AND school_id = ?2 AND academic_year_id = ?3 AND class_id = ?4 AND status = 'active'`,
      updates.map(i => ({ id: i.existing_load_id, employee_id: i.new_employee_id, weekly_periods: i.new_weekly_periods }))));
  }
  if (deactivations.length) {
    statements.push(group(`UPDATE timetable_teaching_loads
      SET status = 'inactive', updated_by_user_id = ?5, updated_at = unixepoch()
      WHERE school_id = ?2 AND academic_year_id = ?3 AND class_id = ?4 AND status = 'active'
        AND id IN (SELECT value FROM json_each(?1))`, deactivations.map(i => i.existing_load_id)));
  }
  // Even a confirmed all-unchanged apply consumes its revision. Capture the
  // response revision in this batch, never through a post-commit plan reread.
  statements.push(db.prepare(`INSERT INTO timetable_revisions (school_id, academic_year_id, revision)
    VALUES (?, ?, 1) ON CONFLICT(school_id, academic_year_id) DO UPDATE SET revision = revision + 1, updated_at = unixepoch()`)
    .bind(scope.school_id, scope.academic_year_id));
  statements.push(db.prepare('DELETE FROM timetable_revision_assertions WHERE token = ?').bind(token));
  statements.push(db.prepare('SELECT revision FROM timetable_revisions WHERE school_id = ? AND academic_year_id = ?')
    .bind(scope.school_id, scope.academic_year_id));
  return statements;
}

export function matrixDatabaseError(error: unknown): MatrixError | null {
  if (error instanceof MatrixError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/stale_timetable_proposal/.test(message)) return staleMatrixError();
  const failures: Array<[RegExp, string, string]> = [
    [/teacher collision/, 'teacher_collision', 'المدرس مرتبط بحصة أخرى في الفترة نفسها.'],
    [/teacher unavailable/, 'teacher_unavailable', 'المدرس غير متاح في إحدى الحصص المجدولة.'],
    [/max periods per day/, 'teacher_max_periods_per_day', 'تجاوز المدرس الحد الأقصى للحصص اليومية.'],
    [/max working days/, 'teacher_max_working_days', 'تجاوز المدرس الحد الأقصى لأيام العمل.'],
    [/max consecutive periods/, 'teacher_max_consecutive_periods', 'تجاوز المدرس الحد الأقصى للحصص المتتالية.'],
    [/weekly periods below scheduled/, 'weekly_periods_below_scheduled', 'عدد الحصص أقل من عدد الحصص المجدولة.'],
    [/timetable load has scheduled entries/, 'load_has_scheduled_entries', 'توجد حصص مجدولة تمنع تغيير مراجع هذا النصاب.'],
    [/timetable|constraint failed/i, 'invalid_matrix_reference', 'تغيرت بيانات النصاب أو مراجعه؛ أعد تحميل المصفوفة.'],
  ];
  const failure = failures.find(([pattern]) => pattern.test(message));
  return failure ? new MatrixError(failure[1], failure[2], 409) : null;
}
