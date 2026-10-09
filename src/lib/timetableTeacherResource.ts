/** Named vacancies are timetable resources, never employee records or employee IDs. */
export interface TimetableTeacherResource {
  school_id: number;
  academic_year_id: number;
  employee_id: number | null;
  teacher_placeholder?: string | null;
}

export function normalizeTimetableTeacherPlaceholder(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error('اسم المدرس المؤقت غير صالح');
  const name = value.trim();
  if (!name) return null;
  if (name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('اسم المدرس المؤقت غير صالح');
  return name;
}

export function timetableTeacherResourceKey(load: TimetableTeacherResource): string | null {
  if (load.employee_id != null) return `${load.school_id}:${load.academic_year_id}:employee:${load.employee_id}`;
  let name: string | null;
  try { name = normalizeTimetableTeacherPlaceholder(load.teacher_placeholder); } catch { return null; }
  return name == null ? null : `${load.school_id}:${load.academic_year_id}:placeholder:${name}`;
}

export function timetableTeacherName(load: {employee_id?: number | null; employee_name?: string | null; teacher_placeholder?: string | null}): string | null {
  return load.employee_id != null ? load.employee_name || null
    : normalizeTimetableTeacherPlaceholder(load.teacher_placeholder) || load.employee_name || null;
}
