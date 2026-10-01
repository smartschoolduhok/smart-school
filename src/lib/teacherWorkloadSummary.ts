import {
  loadHasInvalidAcademicReference,
  loadHasInvalidTeacherReference,
  type TimetableDay,
  type TimetableEntry,
  type TimetableMasterTeacher,
  type TimetableSlot,
  type TimetableTeachingLoad,
} from './timetable.ts';

export interface TeacherWorkloadSummary {
  school: {
    id: number;
    name: string;
    name_en?: string | null;
    province?: string | null;
    logo_url: string | null;
    principal_name: string | null;
  };
  academic_year: { id: number; name: string };
  document_settings: {
    official_book_layout: unknown;
    use_arabic_indic_digits: boolean;
    header_text: string;
    footer_text: string;
  };
  teachers: Array<{ employee_id: number; employee_name: string; weekly_periods: number }>;
  total_weekly_periods: number;
}

interface TeacherWorkloadSummaryInput {
  schoolId: number;
  academicYearId: number;
  teachers: readonly TimetableMasterTeacher[];
  days: readonly TimetableDay[];
  slots: readonly TimetableSlot[];
  loads: readonly TimetableTeachingLoad[];
  entries: readonly TimetableEntry[];
}

/** Count saved lessons, not requested teaching-load periods or section occupancy.
 * Availability/constraint changes do not erase a teacher's saved assignments.
 */
export function aggregateTeacherWorkloadSummary(input: TeacherWorkloadSummaryInput): Pick<TeacherWorkloadSummary, 'teachers' | 'total_weekly_periods'> {
  const inScope = (row: { school_id: number; academic_year_id: number }) => (
    row.school_id === input.schoolId && row.academic_year_id === input.academicYearId
  );
  const teachers = new Map<number, TeacherWorkloadSummary['teachers'][number]>();
  for (const teacher of input.teachers) {
    if (teacher.school_id !== input.schoolId || teacher.status !== 'active' || teacher.role !== 'teacher') continue;
    teachers.set(teacher.id, { employee_id: teacher.id, employee_name: teacher.full_name, weekly_periods: 0 });
  }
  const activeDays = new Set(input.days.filter(day => inScope(day) && day.is_active === 1).map(day => day.day_of_week));
  const activeLessonSlots = new Set(input.slots.filter(slot => (
    inScope(slot) && slot.is_active === 1 && slot.slot_type === 'lesson' && activeDays.has(slot.day_of_week)
  )).map(slot => slot.id));
  const loads = new Map(input.loads.filter(load => (
    inScope(load) && load.status === 'active' && load.employee_id != null && teachers.has(load.employee_id)
    && !loadHasInvalidAcademicReference(load) && !loadHasInvalidTeacherReference(load)
  )).map(load => [load.id, load]));
  const counted = new Set<number>();
  for (const entry of input.entries) {
    if (!inScope(entry) || counted.has(entry.id) || !activeLessonSlots.has(entry.slot_id)) continue;
    const load = loads.get(entry.teaching_load_id);
    if (load?.employee_id == null) continue;
    const teacher = teachers.get(load.employee_id)!;
    teacher.weekly_periods += 1;
    counted.add(entry.id);
  }
  const rows = [...teachers.values()].sort((left, right) => (
    left.employee_name.localeCompare(right.employee_name, 'ar') || left.employee_id - right.employee_id
  ));
  return { teachers: rows, total_weekly_periods: rows.reduce((total, teacher) => total + teacher.weekly_periods, 0) };
}
