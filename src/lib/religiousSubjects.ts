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
