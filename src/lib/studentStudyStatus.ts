import { boundedText, ensure, positiveId } from './schoolWorkflow.ts';
import { baghdadDate, validDate } from './admissionDates.ts';

export type StudyStatus = 'regular' | 'hosted' | 'affiliated';
export const STUDY_STATUS_LABELS: Record<StudyStatus, string> = {
  regular: 'منتظم', hosted: 'استضافة', affiliated: 'انتساب',
};
export interface StudentAgeExceptionInput {
  reference: string; document_date: string; authority: string; reason: string; class_id: number;
}
export interface StudentAgeException extends StudentAgeExceptionInput {
  birth_date: string; gender: 'male' | 'female'; verified_by_user_id: number; verified_at: number;
}
export interface StudentStudyStatus {
  student_id: number; academic_year_id: number; study_status: StudyStatus; grades_visible: boolean;
  age_exception: StudentAgeException | null; revision: number; updated_at: number | null;
}
export interface StudentStudyStatusWrite {
  school_id?: number; academic_year_id: number; revision: number; study_status: StudyStatus;
  grades_visible: boolean; age_exception: StudentAgeExceptionInput | StudentAgeException | null;
  change_reason: string; confirm_age_exception_verified?: boolean;
}
export interface StudentStudyRosterRow {
  student_id: number; student_number: string; full_name: string; class_id: number; class_name: string;
  section_id: number | null; section_name: string | null; study_status: StudyStatus; grades_visible: boolean;
}
export interface StudentStudyStatusList {
  rows: StudentStudyStatus[]; roster: StudentStudyRosterRow[];
  school: { id: number; name: string }; academic_year: { id: number; name: string; is_active: number };
}
export type StudentStudyRosterResponse = StudentStudyStatusList;
export function defaultStudentStudyStatus(studentId: number, academicYearId: number): StudentStudyStatus {
  return { student_id: studentId, academic_year_id: academicYearId, study_status: 'regular', grades_visible: true,
    age_exception: null, revision: 0, updated_at: null };
}
export function parseStudentAgeExceptionInput(value: unknown, today = baghdadDate()): StudentAgeExceptionInput | null {
  if (value === null) return null;
  ensure(value && typeof value === 'object' && !Array.isArray(value), 'invalid_age_exception', 'بيانات استثناء العمر غير صالحة');
  const raw = value as Record<string, unknown>;
  ensure(Object.keys(raw).every(key => ['reference','document_date','authority','reason','class_id','birth_date','gender','verified_by_user_id','verified_at'].includes(key)), 'invalid_age_exception', 'حقول استثناء العمر غير صالحة');
  const documentDate = validDate(raw.document_date);
  ensure(documentDate <= today, 'invalid_age_exception', 'تاريخ كتاب الاستثناء لا يمكن أن يكون في المستقبل');
  return { reference: boundedText(raw.reference, 250), document_date: documentDate,
    authority: boundedText(raw.authority, 200), reason: boundedText(raw.reason, 1000), class_id: positiveId(raw.class_id) };
}
export function ageExceptionEvidence(exception: StudentAgeExceptionInput): StudentAgeExceptionInput {
  return { reference: exception.reference, document_date: exception.document_date, authority: exception.authority,
    reason: exception.reason, class_id: exception.class_id };
}
/** Callers load this evidence only from the requested school's student/year record. */
export function isAgeExceptionApplicable(exception: StudentAgeException | null | undefined,
  context: { class_id?: number | null; birth_date: string | null; gender?: string | null; today?: string }): boolean {
  return !!exception && Number.isSafeInteger(exception.verified_by_user_id) && exception.verified_by_user_id > 0
    && Number.isSafeInteger(exception.verified_at) && exception.verified_at > 0
    && exception.class_id === context.class_id && exception.birth_date === context.birth_date
    && exception.gender === context.gender && !!exception.reference?.trim() && !!exception.authority?.trim()
    && !!exception.reason?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(exception.document_date)
    && exception.document_date <= (context.today ?? baghdadDate());
}
