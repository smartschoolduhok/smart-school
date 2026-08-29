export const EMPTY_STUDENT_PROFILE_VALUE = '—';
export const NO_CURRENT_ENROLLMENT_MESSAGE = 'غير مسجل في السنة الدراسية الحالية';

const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  active: 'نشط',
  completed: 'مكتمل',
  transferred: 'منقول',
  withdrawn: 'منسحب',
  cancelled: 'ملغى',
};

const PROMOTION_STATUS_LABELS: Record<string, string> = {
  pending: 'بانتظار القرار',
  promoted: 'مرفّع',
  repeated: 'إعادة السنة',
  graduated: 'متخرج',
  not_applicable: 'غير مطبق',
};

const STUDENT_STATUS_LABELS: Record<string, string> = {
  active: 'نشط',
  inactive: 'غير نشط',
  archived: 'مؤرشف',
};

const GENDER_LABELS: Record<string, string> = {
  male: 'ذكر',
  female: 'أنثى',
  m: 'ذكر',
  f: 'أنثى',
  ذكر: 'ذكر',
  أنثى: 'أنثى',
};

export function safeStudentProfileValue(value: unknown): string {
  if (value == null) return EMPTY_STUDENT_PROFILE_VALUE;
  const text = String(value).trim();
  return text || EMPTY_STUDENT_PROFILE_VALUE;
}

function mappedLabel(value: unknown, labels: Record<string, string>): string {
  const safeValue = safeStudentProfileValue(value);
  if (safeValue === EMPTY_STUDENT_PROFILE_VALUE) return safeValue;
  return labels[safeValue.toLowerCase()] ?? safeValue;
}

export function enrollmentStatusLabel(value: unknown): string {
  return mappedLabel(value, ENROLLMENT_STATUS_LABELS);
}

export function promotionStatusLabel(value: unknown): string {
  return mappedLabel(value, PROMOTION_STATUS_LABELS);
}

export function studentStatusLabel(value: unknown): string {
  return mappedLabel(value, STUDENT_STATUS_LABELS);
}

export function genderLabel(value: unknown): string {
  return mappedLabel(value, GENDER_LABELS);
}

export function hasActiveYearWithoutEnrollment(student: {
  current_academic_year_id?: number | null;
  current_enrollment_id?: number | null;
}): boolean {
  return student.current_academic_year_id != null && student.current_enrollment_id == null;
}

export type EnrollmentYearBadge = 'السنة الحالية' | 'السنة القادمة' | null;

export function enrollmentYearBadge(
  enrollment: { academic_year_id: number; starts_at: string | null | undefined },
  currentAcademicYearId: number | null | undefined,
  currentAcademicYearStartsAt: string | null | undefined,
): EnrollmentYearBadge {
  if (currentAcademicYearId != null && enrollment.academic_year_id === currentAcademicYearId) {
    return 'السنة الحالية';
  }

  if (!enrollment.starts_at || !currentAcademicYearStartsAt) return null;
  const enrollmentStart = Date.parse(`${enrollment.starts_at}T00:00:00Z`);
  const currentStart = Date.parse(`${currentAcademicYearStartsAt}T00:00:00Z`);
  if (!Number.isFinite(enrollmentStart) || !Number.isFinite(currentStart)) return null;
  return enrollmentStart > currentStart ? 'السنة القادمة' : null;
}

export function formatStudentProfileDate(value: unknown): string {
  const safeValue = safeStudentProfileValue(value);
  if (safeValue === EMPTY_STUDENT_PROFILE_VALUE) return safeValue;
  const date = new Date(safeValue.length === 10 ? `${safeValue}T00:00:00Z` : safeValue);
  if (Number.isNaN(date.getTime())) return safeValue;
  return new Intl.DateTimeFormat('ar-IQ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

export function formatStudentProfileUnixSeconds(value: unknown): string {
  if (value == null || value === '') return EMPTY_STUDENT_PROFILE_VALUE;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return EMPTY_STUDENT_PROFILE_VALUE;
  return new Intl.DateTimeFormat('ar-IQ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(seconds * 1000));
}
