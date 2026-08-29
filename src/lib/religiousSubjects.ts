import { RAW_GRADE_FIELDS } from './gradeScheme.ts';

export const RELIGIOUS_TRACK_VALUES = ['islamic', 'christian', 'other'] as const;
export type ReligiousTrack = typeof RELIGIOUS_TRACK_VALUES[number];

export const RELIGIOUS_TRACK_HEADER_ALIASES = [
  'نوع مادة الديانة',
  'مسار الديانة',
  'religious_track',
  'religious track',
  'religious education track',
] as const;

export const RELIGIOUS_SUBJECT_BULK_ERROR = 'مواد الديانة يجب تعيينها لطلاب محددين، وليس للصف أو الشعبة بالكامل.';
export const RELIGIOUS_SUBJECT_CONFLICT_ERROR = 'لدى الطالب مادة ديانة فعالة أخرى. استخدم إجراء تغيير مادة الديانة.';
export const RELIGIOUS_SUBJECT_HAS_GRADES_CODE = 'RELIGIOUS_SUBJECT_HAS_GRADES';

export type ReligiousTrackValidation =
  | { ok: true; value: ReligiousTrack | null }
  | { ok: false; value: null };

export interface ReligiousSubjectPreparedStatement {
  bind(...values: unknown[]): ReligiousSubjectPreparedStatement;
  first<T = unknown>(): Promise<T | null>;
}

export interface ReligiousSubjectDatabase {
  prepare(query: string): ReligiousSubjectPreparedStatement;
  batch(statements: ReligiousSubjectPreparedStatement[]): Promise<Array<{ meta?: { changes?: number } }>>;
}

export interface ActiveReligiousAssignment {
  assignment_id: number;
  subject_id: number;
  subject_name: string;
  religious_track: ReligiousTrack;
}

export interface ReligiousSubjectCandidate {
  subject_id: number;
  subject_name: string;
  religious_track: ReligiousTrack;
  class_id: number;
  section_id: number | null;
}

export interface StudentReligiousSubjectState {
  current_assignment: ActiveReligiousAssignment | null;
  candidates: ReligiousSubjectCandidate[];
  meta: {
    placement_available: boolean;
    class_id: number | null;
    section_id: number | null;
    message: string | null;
  };
}

export interface ImportedReligiousAssignmentRow {
  student_id: number;
  subject_id: number;
}

export type ReligiousImportPreflightResult =
  | { ok: true; religious_rows: ImportedReligiousAssignmentRow[] }
  | { ok: false; status: 403 | 409; error: string; meta?: Record<string, unknown> };

export interface StudentSubjectDeactivationRecord {
  assignment_id: number;
  school_id: number;
  student_id: number;
  subject_id: number;
  is_active: number;
  religious_track: ReligiousTrack | null;
}

export type StudentSubjectDeactivationResult =
  | { ok: true; affected: number }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string; code?: string; meta?: Record<string, unknown> };

export function validateReligiousTrack(value: unknown): ReligiousTrackValidation {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value === 'string' && RELIGIOUS_TRACK_VALUES.includes(value as ReligiousTrack)) {
    return { ok: true, value: value as ReligiousTrack };
  }
  return { ok: false, value: null };
}

export function normalizeExcelReligiousTrack(value: unknown): ReligiousTrackValidation {
  if (value == null || String(value).trim() === '') return { ok: true, value: null };
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[إأآ]/gu, 'ا')
    .replace(/ى/gu, 'ي');
  if (normalized === 'اسلامية' || normalized === 'islamic') return { ok: true, value: 'islamic' };
  if (normalized === 'مسيحية' || normalized === 'christian') return { ok: true, value: 'christian' };
  if (normalized === 'اخري' || normalized === 'other') return { ok: true, value: 'other' };
  return { ok: false, value: null };
}

export function religiousTrackLabel(value: unknown): string {
  if (value === 'islamic') return 'إسلامية';
  if (value === 'christian') return 'مسيحية';
  if (value === 'other') return 'أخرى';
  return 'ليست مادة ديانة';
}

export function isReligiousTrack(value: unknown): value is ReligiousTrack {
  return RELIGIOUS_TRACK_VALUES.includes(value as ReligiousTrack);
}

export function importedStudentSubjectWillBeActive(value: unknown): boolean {
  if (value == null || value === '') return true;
  const normalized = String(value).trim().toLowerCase();
  return !['0', 'no', 'false', 'لا', 'غير مفعل'].includes(normalized);
}

export function unwrapStudentSubjectImportRow(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return {};
  const wrapper = row as Record<string, unknown>;
  const nested = wrapper.data;
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : wrapper;
}

export async function findActiveReligiousAssignment(
  db: ReligiousSubjectDatabase,
  schoolId: number,
  studentId: number,
  options: { excludeAssignmentId?: number | null; excludeSubjectId?: number | null } = {},
): Promise<ActiveReligiousAssignment | null> {
  const conditions = [
    'assignment.school_id = ?',
    'assignment.student_id = ?',
    'assignment.is_active = 1',
    'subject.religious_track IS NOT NULL',
  ];
  const binds: unknown[] = [schoolId, studentId];
  if (options.excludeAssignmentId != null) {
    conditions.push('assignment.id <> ?');
    binds.push(options.excludeAssignmentId);
  }
  if (options.excludeSubjectId != null) {
    conditions.push('assignment.subject_id <> ?');
    binds.push(options.excludeSubjectId);
  }
  return db.prepare(`
    SELECT assignment.id AS assignment_id, subject.id AS subject_id,
           subject.name AS subject_name, subject.religious_track
    FROM student_subjects assignment
    JOIN subjects subject
      ON subject.id = assignment.subject_id
     AND subject.school_id = assignment.school_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY assignment.id DESC
    LIMIT 1
  `).bind(...binds).first<ActiveReligiousAssignment>();
}

export async function preflightImportedReligiousAssignments(
  db: ReligiousSubjectDatabase,
  schoolId: number,
  rows: unknown[],
): Promise<ReligiousImportPreflightResult> {
  const plannedReligiousSubjects = new Map<number, number>();
  const religiousRows: ImportedReligiousAssignmentRow[] = [];

  for (const row of rows) {
    const data = unwrapStudentSubjectImportRow(row);
    const studentId = Number(data.student_id);
    const subjectId = Number(data.subject_id);
    if (!Number.isInteger(studentId) || studentId <= 0 || !Number.isInteger(subjectId) || subjectId <= 0) continue;
    if (!importedStudentSubjectWillBeActive(data.is_active)) continue;

    const subject = await db.prepare(`
      SELECT school_id, religious_track
      FROM subjects
      WHERE id = ?
    `).bind(subjectId).first<{ school_id: number; religious_track: ReligiousTrack | null }>();
    if (!subject || subject.religious_track == null) continue;
    if (subject.school_id !== schoolId) {
      return { ok: false, status: 403, error: 'غير مسموح: المادة تنتمي إلى مدرسة أخرى' };
    }

    const plannedSubjectId = plannedReligiousSubjects.get(studentId);
    if (plannedSubjectId != null && plannedSubjectId !== subjectId) {
      return {
        ok: false,
        status: 409,
        error: 'تعذر التأكيد: يحتوي الملف أكثر من مادة ديانة فعالة للطالب نفسه',
        meta: { student_id: studentId, subject_ids: [plannedSubjectId, subjectId] },
      };
    }

    const conflict = await findActiveReligiousAssignment(db, schoolId, studentId, { excludeSubjectId: subjectId });
    if (conflict) {
      return {
        ok: false,
        status: 409,
        error: RELIGIOUS_SUBJECT_CONFLICT_ERROR,
        meta: { student_id: studentId, conflicting_assignment_id: conflict.assignment_id },
      };
    }

    plannedReligiousSubjects.set(studentId, subjectId);
    religiousRows.push({ student_id: studentId, subject_id: subjectId });
  }

  return { ok: true, religious_rows: religiousRows };
}

export async function countSubjectReligiousConversionConflicts(
  db: ReligiousSubjectDatabase,
  schoolId: number,
  subjectId: number,
): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(DISTINCT assigned.student_id) AS conflicting_students_count
    FROM student_subjects assigned
    JOIN student_subjects other
      ON other.school_id = assigned.school_id
     AND other.student_id = assigned.student_id
     AND other.is_active = 1
     AND other.id <> assigned.id
    JOIN subjects other_subject
      ON other_subject.id = other.subject_id
     AND other_subject.school_id = other.school_id
    WHERE assigned.school_id = ?
      AND assigned.subject_id = ?
      AND assigned.is_active = 1
      AND other_subject.religious_track IS NOT NULL
  `).bind(schoolId, subjectId).first<{ conflicting_students_count: number }>();
  return Number(row?.conflicting_students_count || 0);
}

const RECORDED_RAW_GRADE_SQL = RAW_GRADE_FIELDS.map((field) => `grade.${field} IS NOT NULL`).join(' OR ');

export async function hasRecordedReligiousSubjectGrades(
  db: ReligiousSubjectDatabase,
  schoolId: number,
  assignmentId: number,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT EXISTS (
      SELECT 1
      FROM grades grade
      WHERE grade.school_id = ?
        AND grade.student_subject_id = ?
        AND (
          ${RECORDED_RAW_GRADE_SQL}
          OR TRIM(COALESCE(grade.notes, '')) <> ''
          OR EXISTS (SELECT 1 FROM grade_change_logs log WHERE log.grade_id = grade.id AND log.school_id = grade.school_id)
        )
    ) AS recorded_grade_data
  `).bind(schoolId, assignmentId).first<{ recorded_grade_data: number }>();
  return Number(row?.recorded_grade_data || 0) === 1;
}

export async function deactivateStudentSubjectAssignments(
  db: ReligiousSubjectDatabase,
  schoolId: number,
  assignmentIds: unknown[],
): Promise<StudentSubjectDeactivationResult> {
  const normalizedIds = [...new Set(assignmentIds.map(Number))];
  if (normalizedIds.length === 0 || normalizedIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    return { ok: false, status: 400, error: 'معرّفات التعيينات غير صالحة' };
  }

  const assignments: StudentSubjectDeactivationRecord[] = [];
  for (const assignmentId of normalizedIds) {
    const assignment = await db.prepare(`
      SELECT assignment.id AS assignment_id, assignment.school_id, assignment.student_id,
             assignment.subject_id, assignment.is_active, subject.religious_track
      FROM student_subjects assignment
      JOIN subjects subject
        ON subject.id = assignment.subject_id
       AND subject.school_id = assignment.school_id
      WHERE assignment.id = ?
    `).bind(assignmentId).first<StudentSubjectDeactivationRecord>();
    if (!assignment) {
      return { ok: false, status: 404, error: 'أحد التعيينات غير موجود', meta: { assignment_id: assignmentId } };
    }
    if (assignment.school_id !== schoolId) {
      return {
        ok: false,
        status: 403,
        error: 'غير مسموح: أحد التعيينات لا ينتمي إلى المدرسة المستهدفة',
        meta: { assignment_id: assignmentId },
      };
    }
    assignments.push(assignment);
  }

  const conflicts: StudentSubjectDeactivationRecord[] = [];
  for (const assignment of assignments) {
    if (assignment.is_active !== 1 || assignment.religious_track == null) continue;
    if (await hasRecordedReligiousSubjectGrades(db, schoolId, assignment.assignment_id)) conflicts.push(assignment);
  }
  if (conflicts.length > 0) {
    const first = conflicts[0];
    return {
      ok: false,
      status: 409,
      error: 'توجد درجات محفوظة لمادة الديانة. استخدم إجراء «مادة الديانة الدراسية» من ملف الطالب لتغييرها أو إزالتها مع الحفاظ على السجل.',
      code: RELIGIOUS_SUBJECT_HAS_GRADES_CODE,
      meta: {
        assignment_id: first.assignment_id,
        student_id: first.student_id,
        subject_id: first.subject_id,
        recorded_grade_data: true,
        conflicting_assignments: conflicts.map((assignment) => ({
          assignment_id: assignment.assignment_id,
          student_id: assignment.student_id,
          subject_id: assignment.subject_id,
        })),
      },
    };
  }

  const activeAssignments = assignments.filter((assignment) => assignment.is_active === 1);
  if (activeAssignments.length > 0) {
    await db.batch(activeAssignments.map((assignment) => db.prepare(`
      UPDATE student_subjects
      SET is_active = 0, removed_at = unixepoch(), updated_at = unixepoch()
      WHERE id = ? AND school_id = ? AND is_active = 1
    `).bind(assignment.assignment_id, schoolId)));
  }
  return { ok: true, affected: activeAssignments.length };
}
