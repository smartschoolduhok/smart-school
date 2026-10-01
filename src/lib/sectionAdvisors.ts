import type { TeacherWorkloadSummary } from './teacherWorkloadSummary';
import { loadHasInvalidAcademicReference, loadHasInvalidTeacherReference, type TimetableDay, type TimetableEntry, type TimetableMasterTeacher, type TimetableSlot, type TimetableTeachingLoad } from './timetable.ts';

export interface SectionAdvisorAssignment {
  employee_id: number | null;
  employee_name: string | null;
  attendance_confirmed: boolean;
  notes: string;
  version: number;
}

export interface SectionAdvisorCandidate {
  employee_id: number;
  employee_name: string;
  subjects: string[];
  section_weekly_periods: number;
  total_weekly_periods: number;
  scheduled_days: number[];
}

export interface SectionAdvisorPlacement {
  class_id: number;
  class_name: string;
  stage_name: string;
  section_id: number | null;
  section_name: string | null;
  assignment: SectionAdvisorAssignment | null;
  candidates: SectionAdvisorCandidate[];
}

export interface SectionAdvisorsResponse extends Pick<TeacherWorkloadSummary, 'school' | 'academic_year' | 'document_settings'> {
  school_days: number[];
  placements: SectionAdvisorPlacement[];
}

export interface SectionAdvisorSaveRequest {
  school_id: number;
  academic_year_id: number;
  class_id: number;
  section_id: number | null;
  employee_id: number | null;
  attendance_confirmed: boolean;
  notes: string;
  expected_version: number;
}

export interface SectionAdvisorSaveResponse {
  school_id: number;
  academic_year_id: number;
  class_id: number;
  section_id: number | null;
  assignment: SectionAdvisorAssignment;
}

export interface SectionAdvisorClass { id: number; school_id: number; name: string; stage: string; order_index: number; status: string }
export interface SectionAdvisorSection { id: number; school_id: number; class_id: number; name: string; status: string }
export interface StoredSectionAdvisor {
  school_id: number; academic_year_id: number; class_id: number; section_id: number | null;
  employee_id: number | null; employee_name: string | null; attendance_confirmed: number; notes: string; version: number;
}

export function sectionAdvisorAssignment(row: StoredSectionAdvisor): SectionAdvisorAssignment {
  return { employee_id: row.employee_id, employee_name: row.employee_name, attendance_confirmed: row.attendance_confirmed === 1, notes: row.notes, version: row.version };
}

export function parseSectionAdvisorSaveRequest(value: unknown): SectionAdvisorSaveRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const fields = ['school_id', 'academic_year_id', 'class_id', 'section_id', 'employee_id', 'attendance_confirmed', 'notes', 'expected_version'];
  if (Object.keys(row).some(key => !fields.includes(key)) || fields.some(key => !Object.prototype.hasOwnProperty.call(row, key))) return null;
  const id = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
  if (!id(row.school_id) || !id(row.academic_year_id) || !id(row.class_id)
    || !(row.section_id === null || id(row.section_id)) || !(row.employee_id === null || id(row.employee_id))
    || typeof row.attendance_confirmed !== 'boolean' || typeof row.notes !== 'string' || row.notes.length > 1000
    || typeof row.expected_version !== 'number' || !Number.isSafeInteger(row.expected_version) || row.expected_version < 0) return null;
  return {
    school_id: row.school_id, academic_year_id: row.academic_year_id, class_id: row.class_id,
    section_id: row.section_id, employee_id: row.employee_id,
    attendance_confirmed: row.employee_id !== null && row.attendance_confirmed,
    notes: row.employee_id === null ? '' : row.notes.trim(), expected_version: row.expected_version,
  };
}

export function buildSectionAdvisorPlacements(input: {
  schoolId: number; academicYearId: number; classes: readonly SectionAdvisorClass[]; sections: readonly SectionAdvisorSection[];
  teachers: readonly TimetableMasterTeacher[]; assignments: readonly StoredSectionAdvisor[];
  days: readonly TimetableDay[]; slots: readonly TimetableSlot[]; loads: readonly TimetableTeachingLoad[]; entries: readonly TimetableEntry[];
}): Pick<SectionAdvisorsResponse, 'school_days' | 'placements'> {
  const inScope = (row: { school_id: number; academic_year_id: number }) => row.school_id === input.schoolId && row.academic_year_id === input.academicYearId;
  const key = (classId: number, sectionId: number | null) => `${classId}:${sectionId ?? 'none'}`;
  const days = input.days.filter(day => inScope(day) && day.is_active === 1).sort((a, b) => a.order_index - b.order_index || a.day_of_week - b.day_of_week);
  const schoolDays = [...new Set(days.map(day => day.day_of_week))];
  const activeDays = new Set(schoolDays);
  const slots = new Map(input.slots.filter(slot => inScope(slot) && slot.is_active === 1 && slot.slot_type === 'lesson' && activeDays.has(slot.day_of_week)).map(slot => [slot.id, slot]));
  const teachers = new Map(input.teachers.filter(t => t.school_id === input.schoolId && t.status === 'active' && t.role === 'teacher').map(t => [t.id, t]));
  const loads = new Map(input.loads.filter(load => inScope(load) && load.status === 'active' && load.employee_id !== null && teachers.has(load.employee_id)
    && !loadHasInvalidAcademicReference(load) && !loadHasInvalidTeacherReference(load)).map(load => [load.id, load]));
  const assignments = new Map(input.assignments.filter(inScope).map(row => [key(row.class_id, row.section_id), row]));
  const placements: SectionAdvisorPlacement[] = [];
  for (const cls of input.classes.filter(c => c.school_id === input.schoolId && c.status === 'active').sort((a, b) => a.order_index - b.order_index || a.id - b.id)) {
    const sections = input.sections.filter(s => s.school_id === input.schoolId && s.class_id === cls.id && s.status === 'active').sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.id - b.id);
    for (const section of sections.length ? sections : [null]) {
      const stored = assignments.get(key(cls.id, section?.id ?? null));
      placements.push({ class_id: cls.id, class_name: cls.name, stage_name: cls.stage, section_id: section?.id ?? null, section_name: section?.name ?? null,
        assignment: stored ? sectionAdvisorAssignment(stored) : null, candidates: [] });
    }
  }
  const placementMap = new Map(placements.map(placement => [key(placement.class_id, placement.section_id), placement]));
  const totals = new Map<number, { count: number; days: Set<number> }>();
  const candidates = new Map<string, Map<number, { candidate: SectionAdvisorCandidate; subjects: Set<string> }>>();
  const counted = new Set<number>();
  for (const entry of input.entries) {
    if (!inScope(entry) || counted.has(entry.id)) continue;
    const slot = slots.get(entry.slot_id), load = loads.get(entry.teaching_load_id);
    if (!slot || !load || load.employee_id === null) continue;
    const placementKey = key(load.class_id, load.section_id), placement = placementMap.get(placementKey);
    if (!placement) continue;
    counted.add(entry.id);
    const total = totals.get(load.employee_id) ?? { count: 0, days: new Set<number>() };
    total.count++; total.days.add(slot.day_of_week); totals.set(load.employee_id, total);
    const group = candidates.get(placementKey) ?? new Map();
    const existing = group.get(load.employee_id) ?? { candidate: { employee_id: load.employee_id, employee_name: teachers.get(load.employee_id)!.full_name,
      subjects: [], section_weekly_periods: 0, total_weekly_periods: 0, scheduled_days: [] }, subjects: new Set<string>() };
    existing.candidate.section_weekly_periods++;
    if (load.subject_name) existing.subjects.add(load.subject_name);
    group.set(load.employee_id, existing); candidates.set(placementKey, group);
  }
  for (const placement of placements) {
    placement.candidates = [...(candidates.get(key(placement.class_id, placement.section_id))?.values() ?? [])].map(({ candidate, subjects }) => ({ ...candidate,
      subjects: [...subjects].sort((a, b) => a.localeCompare(b, 'ar')), total_weekly_periods: totals.get(candidate.employee_id)!.count,
      scheduled_days: schoolDays.filter(day => totals.get(candidate.employee_id)!.days.has(day)),
    })).sort((a, b) => a.employee_name.localeCompare(b.employee_name, 'ar') || a.employee_id - b.employee_id);
  }
  return { school_days: schoolDays, placements };
}
