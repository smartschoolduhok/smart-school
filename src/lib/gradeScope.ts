export interface TeacherGradeScopeAssignment {
  class_id: number | string | null;
  class_name?: string | null;
  section_id: number | string | null;
  section_name?: string | null;
  subject_id: number | string | null;
  subject_name?: string | null;
}

export interface GradeScopeOption {
  id: number;
  name: string;
}

function positiveInteger(value: number | string | null | undefined): number | null {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function uniqueOptions(
  assignments: TeacherGradeScopeAssignment[],
  idField: 'class_id' | 'section_id' | 'subject_id',
  nameField: 'class_name' | 'section_name' | 'subject_name',
): GradeScopeOption[] {
  const options = new Map<number, GradeScopeOption>();
  for (const assignment of assignments) {
    const id = positiveInteger(assignment[idField]);
    const name = String(assignment[nameField] ?? '').trim();
    if (id != null && name && !options.has(id)) options.set(id, { id, name });
  }
  return [...options.values()];
}

export function teacherGradeClassOptions(assignments: TeacherGradeScopeAssignment[]): GradeScopeOption[] {
  return uniqueOptions(assignments, 'class_id', 'class_name');
}

export function teacherGradeSectionOptions(
  assignments: TeacherGradeScopeAssignment[],
  classId: number | string | null | undefined,
): GradeScopeOption[] {
  const selectedClassId = positiveInteger(classId);
  if (selectedClassId == null) return [];
  return uniqueOptions(
    assignments.filter((assignment) => positiveInteger(assignment.class_id) === selectedClassId),
    'section_id',
    'section_name',
  );
}

export function teacherGradeSubjectOptions(
  assignments: TeacherGradeScopeAssignment[],
  classId: number | string | null | undefined,
  sectionId: number | string | null | undefined,
): GradeScopeOption[] {
  const selectedClassId = positiveInteger(classId);
  const selectedSectionId = positiveInteger(sectionId);
  if (selectedClassId == null || selectedSectionId == null) return [];
  return uniqueOptions(
    assignments.filter((assignment) => (
      positiveInteger(assignment.class_id) === selectedClassId
      && positiveInteger(assignment.section_id) === selectedSectionId
    )),
    'subject_id',
    'subject_name',
  );
}
