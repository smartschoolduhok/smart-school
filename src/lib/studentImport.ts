import { normalizeHeader } from './excelImport.ts';

export interface StudentImportPlacementRecord {
  id: number;
  school_id: number;
  name: string;
  status: string;
  class_id?: number | null;
}

export type StudentImportPlacementValidation =
  | {
      ok: true;
      classRecord: StudentImportPlacementRecord | null;
      sectionRecord: StudentImportPlacementRecord | null;
    }
  | { ok: false; status: 400 | 403; error: string };

export function validateStudentImportPlacement(
  schoolId: number,
  classId: number | null,
  sectionId: number | null,
  classRecord: StudentImportPlacementRecord | null,
  sectionRecord: StudentImportPlacementRecord | null,
): StudentImportPlacementValidation {
  if (sectionId != null && classId == null) {
    return { ok: false, status: 400, error: 'يجب تحديد الصف عند تحديد الشعبة' };
  }
  if (classId != null) {
    if (!classRecord) return { ok: false, status: 400, error: 'الصف المحدد غير موجود' };
    if (classRecord.school_id !== schoolId) {
      return { ok: false, status: 403, error: 'الصف المحدد ينتمي إلى مدرسة أخرى' };
    }
    if (classRecord.status !== 'active') {
      return { ok: false, status: 400, error: 'الصف المحدد غير فعال' };
    }
  }
  if (sectionId != null) {
    if (!sectionRecord) return { ok: false, status: 400, error: 'الشعبة المحددة غير موجودة' };
    if (sectionRecord.school_id !== schoolId) {
      return { ok: false, status: 403, error: 'الشعبة المحددة تنتمي إلى مدرسة أخرى' };
    }
    if (sectionRecord.status !== 'active') {
      return { ok: false, status: 400, error: 'الشعبة المحددة غير فعالة' };
    }
    if (sectionRecord.class_id !== classId) {
      return { ok: false, status: 400, error: 'الشعبة المحددة لا تتبع الصف المحدد' };
    }
  }
  return { ok: true, classRecord, sectionRecord };
}

export function normalizeStudentIdentity(value: unknown): string {
  return normalizeHeader(value).replace(/\s+/g, ' ');
}

export function studentIdentityKey(
  fullName: unknown,
  classId: number | null,
  sectionId: number | null,
): string {
  return `${normalizeStudentIdentity(fullName)}|${classId ?? 0}|${sectionId ?? 0}`;
}

export async function buildGeneratedStudentNumber(
  schoolId: number,
  fullName: unknown,
  classId: number | null,
  sectionId: number | null,
): Promise<string> {
  const identity = `${schoolId}|${studentIdentityKey(fullName, classId, sectionId)}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  const suffix = Array.from(new Uint8Array(digest).slice(0, 12), byte => (
    byte.toString(16).padStart(2, '0')
  )).join('').toUpperCase();
  return `AUTO-${suffix}`;
}

export interface ExistingStudentIdentity {
  id: number;
  student_number: string;
  full_name: string;
  class_id: number | null;
  section_id: number | null;
  [key: string]: unknown;
}

export type StudentDuplicateMatch<T extends ExistingStudentIdentity> =
  | { kind: 'none' }
  | { kind: 'match'; student: T; matchedBy: 'student_number' | 'identity' }
  | { kind: 'ambiguous'; students: T[] };

export type StudentImportDuplicateMode = 'skip_existing' | 'update_existing' | 'error_on_existing';

export function syncStudentImportState<T extends ExistingStudentIdentity>(
  students: T[],
  studentMap: Map<string, T>,
  persistedStudent: T,
): void {
  const existingIndex = students.findIndex(student => student.id === persistedStudent.id);
  if (existingIndex >= 0) students[existingIndex] = persistedStudent;
  else students.push(persistedStudent);

  for (const [studentNumber, student] of studentMap) {
    if (student.id === persistedStudent.id && studentNumber !== persistedStudent.student_number) {
      studentMap.delete(studentNumber);
    }
  }
  studentMap.set(persistedStudent.student_number, persistedStudent);
}

export function studentDuplicateAction(
  mode: StudentImportDuplicateMode,
  hasDuplicate: boolean,
): 'insert' | 'skip' | 'update' | 'error' {
  if (!hasDuplicate) return 'insert';
  if (mode === 'skip_existing') return 'skip';
  if (mode === 'update_existing') return 'update';
  return 'error';
}

export function findStudentDuplicate<T extends ExistingStudentIdentity>(
  input: {
    studentNumber: string | null;
    fullName: string;
    classId: number | null;
    sectionId: number | null;
  },
  students: T[],
): StudentDuplicateMatch<T> {
  if (input.studentNumber) {
    const byNumber = students.find(student => student.student_number === input.studentNumber);
    return byNumber ? { kind: 'match', student: byNumber, matchedBy: 'student_number' } : { kind: 'none' };
  }

  const identity = studentIdentityKey(input.fullName, input.classId, input.sectionId);
  const matches = students.filter(student => (
    studentIdentityKey(student.full_name, student.class_id, student.section_id) === identity
  ));
  if (matches.length === 1) return { kind: 'match', student: matches[0], matchedBy: 'identity' };
  if (matches.length > 1) return { kind: 'ambiguous', students: matches };
  return { kind: 'none' };
}
