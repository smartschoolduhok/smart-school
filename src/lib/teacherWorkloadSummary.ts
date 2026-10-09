import type { TeacherWorkloadExtra } from './teacherWorkloadExtras.ts';
import {
  loadHasInvalidAcademicReference,
  loadHasInvalidTeacherReference,
  type TimetableDay,
  type TimetableEntry,
  type TimetableMasterTeacher,
  type TimetableSlot,
  type TimetableTeachingLoad,
} from './timetable.ts';

export interface TeacherWorkloadDetail {
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
  subject_id: number;
  subject_name: string;
  weekly_periods: number;
}

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
  teachers: Array<{ employee_id: number | null; teacher_key?: string; teacher_placeholder?: string | null; employee_name: string;
    /** Legacy scheduled total. */ weekly_periods: number; scheduled_weekly_periods?: number; extra_weekly_periods?: number;
    report_weekly_periods?: number; extras?: TeacherWorkloadExtra[]; breakdown: TeacherWorkloadDetail[] }>;
  total_scheduled_weekly_periods?: number;
  total_extra_weekly_periods?: number;
  total_report_weekly_periods?: number;
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
  extras?: readonly TeacherWorkloadExtra[];
}

/** Count saved lessons, not requested teaching-load periods or section occupancy.
 * Availability/constraint changes do not erase a teacher's saved assignments.
 */
export function aggregateTeacherWorkloadSummary(input: TeacherWorkloadSummaryInput): Pick<TeacherWorkloadSummary, 'teachers' | 'total_weekly_periods' | 'total_scheduled_weekly_periods' | 'total_extra_weekly_periods' | 'total_report_weekly_periods'> {
  const inScope = (row: { school_id: number; academic_year_id: number }) => (
    row.school_id === input.schoolId && row.academic_year_id === input.academicYearId
  );
  const teachers = new Map<string, TeacherWorkloadSummary['teachers'][number]>();
  const breakdowns = new Map<string, Map<string, TeacherWorkloadDetail>>();
  for (const teacher of input.teachers) {
    if (teacher.school_id !== input.schoolId || teacher.status !== 'active' || teacher.role !== 'teacher') continue;
    teachers.set(`employee:${teacher.id}`, { teacher_key: `employee:${teacher.id}`, employee_id: teacher.id, employee_name: teacher.full_name, weekly_periods: 0, breakdown: [] });
    breakdowns.set(`employee:${teacher.id}`, new Map());
  }
  const resourceKey = (load: TimetableTeachingLoad) => load.employee_id == null ? `placeholder:${load.teacher_placeholder?.trim()}` : `employee:${load.employee_id}`;
  for (const load of input.loads) {
    if (!inScope(load) || load.status !== 'active' || load.employee_id != null || !load.teacher_placeholder?.trim()
      || loadHasInvalidAcademicReference(load) || loadHasInvalidTeacherReference(load)) continue;
    const key = resourceKey(load);
    if (!teachers.has(key)) {
      teachers.set(key, { employee_id: null, teacher_key: key, teacher_placeholder: load.teacher_placeholder.trim(),
        employee_name: load.teacher_placeholder.trim(), weekly_periods: 0, breakdown: [] });
      breakdowns.set(key, new Map());
    }
  }
  const activeDays = new Set(input.days.filter(day => inScope(day) && day.is_active === 1).map(day => day.day_of_week));
  const activeLessonSlots = new Set(input.slots.filter(slot => (
    inScope(slot) && slot.is_active === 1 && slot.slot_type === 'lesson' && activeDays.has(slot.day_of_week)
  )).map(slot => slot.id));
  const loads = new Map(input.loads.filter(load => (
    inScope(load) && load.status === 'active' && teachers.has(resourceKey(load))
    && !loadHasInvalidAcademicReference(load) && !loadHasInvalidTeacherReference(load)
  )).map(load => [load.id, load]));
  const counted = new Set<number>();
  for (const entry of input.entries) {
    if (!inScope(entry) || counted.has(entry.id) || !activeLessonSlots.has(entry.slot_id)) continue;
    const load = loads.get(entry.teaching_load_id);
    if (!load) continue;
    const teacher = teachers.get(resourceKey(load))!;
    teacher.weekly_periods += 1;
    const details = breakdowns.get(resourceKey(load))!;
    const key = JSON.stringify([load.class_id, load.section_id, load.subject_id]);
    const detail = details.get(key) || {
      class_id: load.class_id,
      class_name: load.class_name || 'غير مسجل',
      section_id: load.section_id,
      section_name: load.section_id == null ? null : load.section_name || 'غير مسجل',
      subject_id: load.subject_id,
      subject_name: load.subject_name || 'غير مسجل',
      weekly_periods: 0,
    };
    detail.weekly_periods += 1;
    details.set(key, detail);
    counted.add(entry.id);
  }
  for (const teacher of teachers.values()) {
    teacher.breakdown = [...breakdowns.get(teacher.teacher_key!)!.values()].sort((left, right) => (
      left.class_name.localeCompare(right.class_name, 'ar') || left.class_id - right.class_id
      || (left.section_name || '').localeCompare(right.section_name || '', 'ar') || (left.section_id || 0) - (right.section_id || 0)
      || left.subject_name.localeCompare(right.subject_name, 'ar') || left.subject_id - right.subject_id
    ));
  }
  const extraIds = new Set<number>();
  for (const extra of input.extras || []) {
    const teacher = teachers.get(`employee:${extra.employee_id}`);
    if (!inScope(extra) || extra.deleted_at != null || !teacher || extraIds.has(extra.id)
      || !Number.isSafeInteger(extra.weekly_periods) || extra.weekly_periods <= 0 || extra.weekly_periods > 60) continue;
    (teacher.extras ??= []).push(extra);
    extraIds.add(extra.id);
  }
  for (const teacher of teachers.values()) {
    teacher.scheduled_weekly_periods = teacher.weekly_periods;
    teacher.extras ??= [];
    teacher.extra_weekly_periods = teacher.extras.reduce((sum, row) => sum + row.weekly_periods, 0);
    teacher.report_weekly_periods = teacher.weekly_periods + teacher.extra_weekly_periods;
  }
  const rows = [...teachers.values()].sort((left, right) => (
    left.employee_name.localeCompare(right.employee_name, 'ar') || (left.employee_id != null && right.employee_id != null ? left.employee_id - right.employee_id : (left.teacher_key || '').localeCompare(right.teacher_key || ''))
  ));
  const scheduled = rows.reduce((total, teacher) => total + teacher.weekly_periods, 0);
  const extras = rows.reduce((total, teacher) => total + (teacher.extra_weekly_periods || 0), 0);
  return { teachers: rows, total_weekly_periods: scheduled, total_scheduled_weekly_periods: scheduled,
    total_extra_weekly_periods: extras, total_report_weekly_periods: scheduled + extras };
}
