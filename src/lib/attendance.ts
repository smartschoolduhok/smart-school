import { businessDate } from './businessTime.ts';

export const ATTENDANCE_STATUSES = [
  'present',
  'absent',
  'excused',
  'late',
  'left_early',
  'school_activity',
] as const;

export type AttendanceStatus = typeof ATTENDANCE_STATUSES[number];
export type AttendanceNoteVisibility = 'staff' | 'parent';
export type AttendanceSessionStatus = 'draft' | 'confirmed';

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'حاضر',
  absent: 'غائب',
  excused: 'غائب بعذر',
  late: 'متأخر',
  left_early: 'خرج مبكرًا',
  school_activity: 'نشاط مدرسي',
};

export interface AttendanceRecordInput {
  student_id: number;
  status: AttendanceStatus;
  late_minutes: number;
  note: string | null;
  note_visibility: AttendanceNoteVisibility;
}

export interface AttendanceSaveRequest {
  school_id: number;
  session_date: string;
  expected_revision: number;
  action: 'draft' | 'confirm';
  change_reason: string | null;
  records: AttendanceRecordInput[];
}

export interface AttendanceLessonSummary {
  timetable_entry_id: number;
  academic_year_id: number;
  academic_year_name: string;
  session_date: string;
  day_of_week: number;
  lesson_number: number | null;
  start_time: string;
  end_time: string;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
  subject_id: number;
  subject_name: string;
  teacher_employee_id: number | null;
  teacher_name: string | null;
  session_id: number | null;
  session_status: AttendanceSessionStatus | null;
  revision: number;
  roster_count: number;
  recorded_count: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  excused_count: number;
  left_early_count: number;
  activity_count: number;
};

export interface AttendanceStudentRecord extends AttendanceRecordInput {
  id: number | null;
  student_name: string;
  student_number: string;
  revision: number;
}

export interface AttendanceLessonDetail {
  lesson: AttendanceLessonSummary;
  records: AttendanceStudentRecord[];
  permissions: {
    can_edit_draft: boolean;
    can_correct_confirmed: boolean;
  };
}

export interface ParentAttendanceRecord {
  id: number;
  student_id: number;
  student_name: string;
  student_number: string;
  session_date: string;
  status: AttendanceStatus;
  status_label: string;
  late_minutes: number;
  note: string | null;
  subject_name: string;
  class_name: string;
  section_name: string | null;
  teacher_name: string | null;
  lesson_number: number | null;
  start_time: string;
  end_time: string;
  confirmed_at: number;
}

export interface ParentAttendanceFeed {
  range: { from: string; to: string };
  students: Array<{ id: number; full_name: string; student_number: string }>;
  records: ParentAttendanceRecord[];
}

export class AttendanceError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 500;

  constructor(
    code: string,
    status: 400 | 403 | 404 | 409 | 500 = 400,
    message?: string,
  ) {
    super(message || attendanceErrorMessage(code));
    this.code = code;
    this.status = status;
  }
}

export function requireAttendance(
  condition: unknown,
  code: string,
  status: 400 | 403 | 404 | 409 | 500 = 400,
  message?: string,
): asserts condition {
  if (!condition) throw new AttendanceError(code, status, message);
}

export function parseAttendanceDate(value: unknown): string {
  requireAttendance(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'invalid_attendance_date');
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  requireAttendance(
    parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() + 1 === month
      && parsed.getUTCDate() === day,
    'invalid_attendance_date',
  );
  return value;
}

export function attendanceDayOfWeek(value: string): number {
  return new Date(`${parseAttendanceDate(value)}T00:00:00.000Z`).getUTCDay();
}

export function defaultAttendanceDate(): string {
  return businessDate();
}

function positiveInteger(value: unknown, code: string): number {
  const parsed = Number(value);
  requireAttendance(Number.isInteger(parsed) && parsed > 0, code);
  return parsed;
}

function nonNegativeInteger(value: unknown, code: string): number {
  const parsed = Number(value);
  requireAttendance(Number.isInteger(parsed) && parsed >= 0, code);
  return parsed;
}

function optionalText(value: unknown, maximum: number, code: string): string | null {
  if (value == null || value === '') return null;
  requireAttendance(typeof value === 'string', code);
  const normalized = value.trim();
  if (!normalized) return null;
  requireAttendance(normalized.length <= maximum, code);
  return normalized;
}

export function parseAttendanceSaveRequest(value: unknown): AttendanceSaveRequest {
  requireAttendance(value && typeof value === 'object' && !Array.isArray(value), 'invalid_attendance_request');
  const raw = value as Record<string, unknown>;
  const allowed = new Set(['school_id', 'session_date', 'expected_revision', 'action', 'change_reason', 'records']);
  requireAttendance(Object.keys(raw).every((key) => allowed.has(key)), 'invalid_attendance_request');
  const schoolId = positiveInteger(raw.school_id, 'invalid_attendance_school');
  const sessionDate = parseAttendanceDate(raw.session_date);
  const expectedRevision = nonNegativeInteger(raw.expected_revision, 'invalid_attendance_revision');
  requireAttendance(raw.action === 'draft' || raw.action === 'confirm', 'invalid_attendance_action');
  const changeReason = optionalText(raw.change_reason, 500, 'invalid_attendance_change_reason');
  requireAttendance(Array.isArray(raw.records) && raw.records.length <= 200, 'invalid_attendance_records');

  const seen = new Set<number>();
  const records = raw.records.map((value): AttendanceRecordInput => {
    requireAttendance(value && typeof value === 'object' && !Array.isArray(value), 'invalid_attendance_record');
    const record = value as Record<string, unknown>;
    const recordAllowed = new Set(['student_id', 'status', 'late_minutes', 'note', 'note_visibility']);
    requireAttendance(Object.keys(record).every((key) => recordAllowed.has(key)), 'invalid_attendance_record');
    const studentId = positiveInteger(record.student_id, 'invalid_attendance_student');
    requireAttendance(!seen.has(studentId), 'duplicate_attendance_student');
    seen.add(studentId);
    requireAttendance(
      typeof record.status === 'string' && ATTENDANCE_STATUSES.includes(record.status as AttendanceStatus),
      'invalid_attendance_status',
    );
    const status = record.status as AttendanceStatus;
    const lateMinutes = nonNegativeInteger(record.late_minutes ?? 0, 'invalid_late_minutes');
    requireAttendance(lateMinutes <= 240, 'invalid_late_minutes');
    requireAttendance(
      (status === 'late' && lateMinutes > 0) || (status !== 'late' && lateMinutes === 0),
      'invalid_late_minutes',
    );
    requireAttendance(record.note_visibility === 'staff' || record.note_visibility === 'parent', 'invalid_note_visibility');
    return {
      student_id: studentId,
      status,
      late_minutes: lateMinutes,
      note: optionalText(record.note, 1000, 'invalid_attendance_note'),
      note_visibility: record.note_visibility,
    };
  });

  return {
    school_id: schoolId,
    session_date: sessionDate,
    expected_revision: expectedRevision,
    action: raw.action,
    change_reason: changeReason,
    records,
  };
}

export function validateAttendanceRange(fromValue: unknown, toValue: unknown): { from: string; to: string } {
  const to = toValue == null || toValue === '' ? businessDate() : parseAttendanceDate(toValue);
  const defaultFromDate = new Date(`${to}T00:00:00.000Z`);
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 30);
  const from = fromValue == null || fromValue === ''
    ? defaultFromDate.toISOString().slice(0, 10)
    : parseAttendanceDate(fromValue);
  requireAttendance(from <= to, 'invalid_attendance_range');
  const rangeDays = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  requireAttendance(rangeDays <= 366, 'attendance_range_too_large');
  return { from, to };
}

const ERROR_MESSAGES: Record<string, string> = {
  attendance_forbidden: 'غير مسموح: لا تملك صلاحية الوصول إلى الحضور',
  attendance_target_required: 'يجب تحديد مدرسة فعالة',
  invalid_attendance_request: 'بيانات الحضور غير صالحة أو تحتوي حقولًا غير معروفة',
  invalid_attendance_school: 'المدرسة المحددة غير صالحة',
  invalid_attendance_date: 'تاريخ الحصة غير صالح',
  future_attendance_date: 'لا يمكن تسجيل حضور بتاريخ مستقبلي',
  invalid_attendance_range: 'نطاق التاريخ غير صالح',
  attendance_range_too_large: 'نطاق العرض يجب ألا يتجاوز سنة واحدة',
  invalid_attendance_revision: 'نسخة سجل الحضور غير صالحة',
  invalid_attendance_action: 'إجراء الحضور غير صالح',
  invalid_attendance_change_reason: 'سبب التصحيح غير صالح',
  invalid_attendance_records: 'قائمة حضور الطلاب غير صالحة',
  invalid_attendance_record: 'أحد سجلات الحضور غير صالح',
  invalid_attendance_student: 'أحد الطلاب المحددين غير صالح',
  duplicate_attendance_student: 'تكرر الطالب أكثر من مرة في سجل الحصة',
  invalid_attendance_status: 'حالة الحضور غير صالحة',
  invalid_late_minutes: 'دقائق التأخير مطلوبة للطالب المتأخر فقط ويجب ألا تتجاوز 240 دقيقة',
  invalid_note_visibility: 'خصوصية الملاحظة غير صالحة',
  invalid_attendance_note: 'ملاحظة الحضور غير صالحة أو طويلة جدًا',
  attendance_lesson_not_found: 'الحصة غير موجودة في الجدول الرسمي',
  attendance_lesson_wrong_day: 'التاريخ المحدد لا يوافق يوم هذه الحصة في الجدول',
  attendance_lesson_outside_year: 'التاريخ خارج حدود السنة الدراسية',
  attendance_teacher_unlinked: 'حساب المدرس غير مرتبط بسجل موظف فعال',
  attendance_lesson_forbidden: 'هذه الحصة غير مرتبطة بنصاب المدرس',
  attendance_roster_changed: 'قائمة الطلاب تغيرت؛ أعد تحميل الحصة قبل الحفظ',
  attendance_empty_roster: 'لا يوجد طلاب فعالون في هذه الحصة',
  attendance_already_confirmed: 'تم اعتماد الحصة ولا يمكن للمدرس تعديلها',
  attendance_correction_reason_required: 'سبب التصحيح مطلوب عند تعديل حضور معتمد',
  attendance_write_stale: 'تغير سجل الحضور؛ أعد تحميل الحصة قبل الحفظ',
  attendance_parent_only: 'هذا المسار مخصص لولي الأمر',
  attendance_failed: 'تعذر تنفيذ عملية الحضور',
};

export function attendanceDatabaseError(error: unknown): AttendanceError {
  if (error instanceof AttendanceError) return error;
  const detail = String((error as { message?: unknown })?.message || error || '');
  if (/CHECK constraint failed: valid = 1|UNIQUE constraint failed: lesson_attendance_write_guards/i.test(detail)) {
    return new AttendanceError('attendance_write_stale', 409, ERROR_MESSAGES.attendance_write_stale);
  }
  if (/attendance timetable scope invalid/i.test(detail)) {
    return new AttendanceError('attendance_lesson_not_found', 409, ERROR_MESSAGES.attendance_lesson_not_found);
  }
  if (/attendance (actor|student) invalid|attendance record session mismatch/i.test(detail)) {
    return new AttendanceError('attendance_write_stale', 409, ERROR_MESSAGES.attendance_write_stale);
  }
  return new AttendanceError('attendance_failed', 500, ERROR_MESSAGES.attendance_failed);
}

export function attendanceErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.attendance_failed;
}
