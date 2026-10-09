/** These records are report supplements, never scheduling demand. */
export interface TeacherWorkloadExtra {
  id: number;
  school_id: number;
  academic_year_id: number;
  employee_id: number;
  subject_name: string;
  weekly_periods: number;
  version: number;
  created_by_user_id: number | null;
  updated_by_user_id: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface TeacherWorkloadExtraWrite {
  school_id: number;
  academic_year_id: number;
  employee_id: number;
  subject_name: string;
  weekly_periods: number;
  expected_version: number;
}

export function parseTeacherWorkloadExtraWrite(value: unknown): TeacherWorkloadExtraWrite | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['school_id', 'academic_year_id', 'employee_id', 'subject_name', 'weekly_periods', 'expected_version'].includes(k))) return null;
  if (['school_id', 'academic_year_id', 'employee_id', 'weekly_periods'].some(k => typeof v[k] !== 'number' || !Number.isSafeInteger(v[k]) || (v[k] as number) <= 0)) return null;
  if ((v.weekly_periods as number) > 60 || typeof v.expected_version !== 'number' || !Number.isSafeInteger(v.expected_version) || v.expected_version < 0) return null;
  if (typeof v.subject_name !== 'string' || /[\u0000-\u001f\u007f]/.test(v.subject_name)) return null;
  const subject = v.subject_name.trim().replace(/\s+/g, ' ');
  if (!subject || subject.length > 120) return null;
  return { school_id: v.school_id as number, academic_year_id: v.academic_year_id as number, employee_id: v.employee_id as number,
    subject_name: subject, weekly_periods: v.weekly_periods as number, expected_version: v.expected_version };
}
