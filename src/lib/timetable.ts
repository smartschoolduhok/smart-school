import { countTimetableSectionPeriods, indexTimetableParallelLoadGroups, parallelTimetableLoadGroup, validateTimetableParallelLoads, type TimetableParallelLoadIssue } from './timetableParallel.ts';

export const TIMETABLE_DAY_NAMES = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

export function timetableYearBelongsToSchool(
  schoolId: number | null,
  academicYearId: number | null,
  years: readonly { id: number; school_id: number }[],
): boolean {
  if (schoolId == null || academicYearId == null) return false;
  return years.some((year) => Number(year.id) === academicYearId && Number(year.school_id) === schoolId);
}

export type TimetableSlotType = 'lesson' | 'break';
export type TimetableLoadStatus = 'active' | 'inactive';
export type TeacherAvailabilityOverrideStatus = 'unavailable' | 'preferred' | 'avoid';
export type TeacherAvailabilityPresentationStatus = 'available' | TeacherAvailabilityOverrideStatus;

export interface TimetableDay {
  id: number;
  school_id: number;
  academic_year_id: number;
  day_of_week: number;
  is_active: 0 | 1;
  order_index: number;
  created_at: number;
  updated_at: number;
}

export interface TimetableSlot {
  id: number;
  school_id: number;
  academic_year_id: number;
  day_of_week: number;
  slot_index: number;
  slot_type: TimetableSlotType;
  lesson_number: number | null;
  label: string;
  start_time: string;
  end_time: string;
  is_active: 0 | 1;
  created_at: number;
  updated_at: number;
}

export interface TimetableTeacherAvailabilityOverride {
  id: number;
  school_id: number;
  academic_year_id: number;
  employee_id: number;
  slot_id: number;
  status: TeacherAvailabilityOverrideStatus;
  created_by_user_id: number | null;
  updated_by_user_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface TimetableTeacherConstraints {
  id: number | null;
  school_id: number;
  academic_year_id: number;
  employee_id: number;
  max_periods_per_day: number | null;
  max_consecutive_periods: number | null;
  max_working_days: number | null;
  prefer_compact_schedule: 0 | 1;
  avoid_first_period: 0 | 1;
  avoid_last_period: 0 | 1;
  created_by_user_id?: number | null;
  updated_by_user_id?: number | null;
  created_at?: number | null;
  updated_at?: number | null;
}

export interface TimetableTeacherCapacityBlocker {
  code: 'teacher_no_available_slots' | 'teacher_load_exceeds_availability';
  message: string;
}

export interface TimetableTeacherDailyCapacity {
  day_of_week: number;
  effective_available_slots: number;
  hard_capacity: number;
}

export interface TimetableTeacherAvailabilitySummary {
  employee_id: number;
  employee_name: string;
  assigned_weekly_periods: number;
  total_active_lesson_slots: number;
  unavailable_active_lesson_slots: number;
  effective_available_slots: number;
  preferred_slots: number;
  avoid_slots: number;
  hard_weekly_capacity: number;
  feasible: boolean;
  blockers: TimetableTeacherCapacityBlocker[];
  daily_capacities: TimetableTeacherDailyCapacity[];
  constraints: TimetableTeacherConstraints;
}

export interface TimetableTeacherAvailabilityCell extends TimetableSlot {
  override_status: TeacherAvailabilityOverrideStatus | null;
  presentation_status: TeacherAvailabilityPresentationStatus | 'break';
  effectively_schedulable: boolean;
}

export interface TimetableTeacherAvailabilityDay extends TimetableDay {
  slots: TimetableTeacherAvailabilityCell[];
}

export interface TimetableTeacherAvailabilityMatrix {
  teacher: {
    id: number;
    full_name: string;
    role: string;
    status: string;
  };
  days: TimetableTeacherAvailabilityDay[];
  overrides: TimetableTeacherAvailabilityOverride[];
  constraints: TimetableTeacherConstraints;
  summary: TimetableTeacherAvailabilitySummary;
}

export interface TimetableTeachingLoad {
  id: number;
  school_id: number;
  academic_year_id: number;
  class_id: number;
  class_name?: string;
  class_stage?: string;
  class_status?: string | null;
  class_school_id?: number | null;
  active_section_count?: number;
  section_id: number | null;
  section_name?: string | null;
  section_status?: string | null;
  section_school_id?: number | null;
  section_class_id?: number | null;
  subject_id: number;
  subject_name?: string;
  subject_status?: string | null;
  subject_school_id?: number | null;
  subject_class_id?: number | null;
  subject_section_id?: number | null;
  employee_id: number | null;
  employee_name?: string | null;
  employee_status?: string | null;
  employee_school_id?: number | null;
  employee_role?: string | null;
  weekly_periods: number;
  parallel_with_load_id?: number | null;
  status: TimetableLoadStatus;
  created_at: number;
  updated_at: number;
}

export interface TimetableEntry {
  id: number;
  school_id: number;
  academic_year_id: number;
  slot_id: number;
  teaching_load_id: number;
  is_locked: 0 | 1;
  created_by_user_id: number | null;
  updated_by_user_id: number | null;
  created_at: number;
  updated_at: number;
}

export type TimetableEntryHardConflictCode =
  | 'slot_not_schedulable'
  | 'inactive_day'
  | 'inactive_slot'
  | 'invalid_teaching_load'
  | 'invalid_parallel_load'
  | 'parallel_lesson_missing'
  | 'weekly_periods_exceeded'
  | 'class_section_collision'
  | 'teacher_collision'
  | 'teacher_unavailable'
  | 'teacher_max_periods_per_day'
  | 'teacher_max_working_days'
  | 'teacher_max_consecutive_periods'
  | 'invalid_tenant_scope'
  | 'invalid_academic_year';

export type TimetableEntryWarningCode =
  | 'preferred_slot'
  | 'avoid_slot'
  | 'outside_preferred_slots'
  | 'non_compact_schedule'
  | 'first_period_preference'
  | 'last_period_preference';

export interface TimetableEntryNotice {
  code: TimetableEntryHardConflictCode | TimetableEntryWarningCode;
  message: string;
}

export function isBlockingTimetableEntryConflict(notice: TimetableEntryNotice): boolean {
  return notice.code !== 'teacher_collision';
}

export function hasBlockingTimetableEntryConflict(notices: TimetableEntryNotice[]): boolean {
  return notices.some(isBlockingTimetableEntryConflict);
}

export interface TimetableGridEntry extends TimetableEntry {
  subject_id: number;
  subject_name: string;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
  employee_id: number | null;
  employee_name: string | null;
  weekly_periods: number;
  load_status: TimetableLoadStatus;
  hard_conflicts: TimetableEntryNotice[];
  warnings: TimetableEntryNotice[];
}

export interface TimetableMasterClass {
  id: number;
  school_id: number;
  name: string;
  stage: string;
  order_index: number;
  status: string;
}

export interface TimetableMasterSection {
  id: number;
  school_id: number;
  class_id: number;
  name: string;
  status: string;
}

export interface TimetableMasterSubject {
  id: number;
  school_id: number;
  class_id: number;
  section_id: number | null;
  name: string;
  status: string;
}

export interface TimetableMasterTeacher {
  id: number;
  school_id: number;
  full_name: string;
  role: string;
  status: string;
}

export interface TimetableMasterInvalidEntry {
  id: number;
  slot_id: number;
  teaching_load_id: number;
  hard_conflicts: TimetableEntryNotice[];
  reason: 'invalid' | 'historical';
}

export interface TimetableMasterGridData {
  school: {
    id: number;
    name: string;
    logo_url: string | null;
  };
  academic_year: {
    id: number;
    name: string;
  };
  days: TimetableDay[];
  slots: TimetableSlot[];
  classes: TimetableMasterClass[];
  sections: TimetableMasterSection[];
  subjects: TimetableMasterSubject[];
  teachers: TimetableMasterTeacher[];
  loads: TimetableTeachingLoad[];
  entries: TimetableGridEntry[];
  invalid_entries: TimetableMasterInvalidEntry[];
  invalid_entry_count: number;
}

export interface TimetableHistoricalGridEntry extends TimetableGridEntry {
  slot: TimetableSlot | null;
  day: TimetableDay | null;
}

export interface TimetableLoadProgress {
  teaching_load_id: number;
  subject_name: string;
  employee_name: string | null;
  required_periods: number;
  scheduled_periods: number;
  remaining_periods: number;
}

export interface TimetableEntryIssue {
  entry_id: number;
  hard_conflicts: TimetableEntryNotice[];
}

export interface TimetableGridData {
  school_id: number;
  academic_year_id: number;
  revision: number;
  class_id: number;
  section_id: number | null;
  days: TimetableDay[];
  slots: TimetableSlot[];
  entries: TimetableGridEntry[];
  historical_entries: TimetableHistoricalGridEntry[];
  loads: Array<TimetableTeachingLoad & {
    total_placements: number;
    scheduled_periods: number;
    invalid_placements: number;
    remaining_periods: number;
  }>;
}

export interface TimetablePlacement {
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
}

export interface TimetableSubjectColor {
  background: string;
  border: string;
  foreground: string;
}

const TIMETABLE_SUBJECT_PALETTE: readonly TimetableSubjectColor[] = [
  { background: '#dbeafe', border: '#2563eb', foreground: '#172554' },
  { background: '#d1fae5', border: '#059669', foreground: '#064e3b' },
  { background: '#fef3c7', border: '#d97706', foreground: '#78350f' },
  { background: '#fce7f3', border: '#db2777', foreground: '#831843' },
  { background: '#ede9fe', border: '#7c3aed', foreground: '#4c1d95' },
  { background: '#cffafe', border: '#0891b2', foreground: '#164e63' },
  { background: '#ffedd5', border: '#ea580c', foreground: '#7c2d12' },
  { background: '#e0e7ff', border: '#4f46e5', foreground: '#312e81' },
  { background: '#ccfbf1', border: '#0d9488', foreground: '#134e4a' },
  { background: '#fae8ff', border: '#c026d3', foreground: '#701a75' },
  { background: '#ecfccb', border: '#65a30d', foreground: '#365314' },
  { background: '#fee2e2', border: '#dc2626', foreground: '#7f1d1d' },
  { background: '#dcfce7', border: '#16a34a', foreground: '#14532d' },
  { background: '#e0f2fe', border: '#0284c7', foreground: '#0c4a6e' },
  { background: '#fef9c3', border: '#ca8a04', foreground: '#713f12' },
  { background: '#ffe4e6', border: '#e11d48', foreground: '#881337' },
] as const;

// Keep common school subjects distinct even when their names hash to the same
// palette bucket. Unknown subjects still receive a deterministic color.
const TIMETABLE_COMMON_SUBJECT_COLORS: Readonly<Record<string, number>> = {
  'اللغة العربية': 0, 'الرياضيات': 1, 'اللغة الانكليزية': 2,
  'التربية الاخلاقية': 3, 'الاسلامية': 4, 'التربية الاسلامية': 4,
  'اللغة الكردية': 5, 'اللغة الفرنسية': 6, 'الحاسوب': 7,
  'الاجتماعيات': 8, 'الفنية': 9, 'التربية الفنية': 9,
  'الرياضة': 10, 'التربية الرياضية': 10, 'جرائم البعث': 11,
  'الاحياء': 12, 'الفيزياء': 13, 'الكيمياء': 14, 'المسيحية': 15,
};

export function timetablePlacementKey(placement: Pick<TimetablePlacement, 'class_id' | 'section_id'>) {
  return `${Number(placement.class_id)}:${placement.section_id == null ? 'none' : Number(placement.section_id)}`;
}

export function buildTimetableMasterPlacements(
  classes: TimetableMasterClass[],
  sections: TimetableMasterSection[],
): TimetablePlacement[] {
  const activeSections = sections.filter((section) => section.status === 'active');
  return [...classes]
    .filter((classRecord) => classRecord.status === 'active')
    .sort((a, b) => Number(a.order_index) - Number(b.order_index) || Number(a.id) - Number(b.id))
    .flatMap((classRecord): TimetablePlacement[] => {
      const classSections = activeSections
        .filter((section) => Number(section.class_id) === Number(classRecord.id))
        .sort((a, b) => Number(a.id) - Number(b.id));
      if (classSections.length === 0) {
        return [{ class_id: Number(classRecord.id), class_name: classRecord.name, section_id: null, section_name: null }];
      }
      return classSections.map((section) => ({
        class_id: Number(classRecord.id),
        class_name: classRecord.name,
        section_id: Number(section.id),
        section_name: section.name,
      }));
    });
}

export function timetableEntryForPlacement(
  entries: TimetableGridEntry[],
  slotId: number,
  placement: Pick<TimetablePlacement, 'class_id' | 'section_id'>,
) {
  const candidates = entries.filter((entry) => (
    Number(entry.slot_id) === Number(slotId)
    && Number(entry.class_id) === Number(placement.class_id)
    && (entry.section_id == null || Number(entry.section_id) === Number(placement.section_id))
  ));
  return candidates.find((entry) => (
    placement.section_id != null && Number(entry.section_id) === Number(placement.section_id)
  )) || candidates.find((entry) => entry.section_id == null) || null;
}

export function timetableSubjectColor(subjectId: number | string): TimetableSubjectColor {
  const value = String(subjectId);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return TIMETABLE_SUBJECT_PALETTE[(hash >>> 0) % TIMETABLE_SUBJECT_PALETTE.length];
}

export function normalizeTimetableSubjectVisualKey(subjectName: string): string {
  return subjectName
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function timetableSubjectVisualKey(schoolId: number | string, subjectName: string): string {
  return `${String(schoolId)}:${normalizeTimetableSubjectVisualKey(subjectName)}`;
}

export function timetableSubjectColorForSubject(
  schoolId: number | string,
  subjectName: string,
): TimetableSubjectColor {
  const key = normalizeTimetableSubjectVisualKey(subjectName);
  const commonColorIndex = TIMETABLE_COMMON_SUBJECT_COLORS[key];
  return commonColorIndex == null
    ? timetableSubjectColor(timetableSubjectVisualKey(schoolId, subjectName))
    : TIMETABLE_SUBJECT_PALETTE[commonColorIndex];
}

export function timetablePrintSlotLabel(slot: Pick<TimetableSlot, 'label' | 'lesson_number'>): string {
  if (slot.lesson_number == null) return slot.label;
  const numberedLesson = `الدرس ${slot.lesson_number}`;
  return slot.label.trim() === numberedLesson ? numberedLesson : `${slot.label} — ${numberedLesson}`;
}

export interface TimetableSubjectOption {
  id: number;
  class_id: number;
  section_id: number | null;
  name: string;
  status: string;
}

export interface TimetableReadinessRow extends TimetablePlacement {
  available_capacity: number;
  required_periods: number;
  scheduled_periods: number;
  remaining_periods: number;
  difference: number;
  status: 'empty_week' | 'over_capacity' | 'exact' | 'unallocated';
  missing_subjects: Array<{ id: number; name: string }>;
  missing_teacher_load_ids: number[];
  invalid_load_ids: number[];
  ready: boolean;
}

export interface TimetableTeacherWorkload {
  employee_id: number;
  employee_name: string;
  total_weekly_periods: number;
  assignment_count: number;
}

export interface TimetableInvalidLoadReason {
  code: 'class_unavailable' | 'class_archived' | 'class_school_mismatch'
    | 'section_required' | 'section_unavailable' | 'section_archived' | 'section_school_mismatch' | 'section_class_mismatch'
    | 'subject_unavailable' | 'subject_archived' | 'subject_school_mismatch' | 'subject_class_mismatch' | 'subject_section_mismatch'
    | 'teacher_unavailable' | 'teacher_archived' | 'teacher_school_mismatch' | 'employee_not_teacher'
    | 'inactive_load_has_entries' | 'invalid_parallel_load';
  message: string;
  action: string;
}

export interface TimetableInvalidLoadDetail {
  teaching_load_id: number;
  subject_id: number;
  subject_name: string;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
  employee_id: number | null;
  employee_name: string | null;
  load_status: string;
  scheduled_entry_count: number;
  reasons: TimetableInvalidLoadReason[];
}

export interface TimetableReadinessSummary {
  weekly_capacity: number;
  teaching_days: number;
  lesson_slots: number;
  break_slots: number;
  total_required_periods: number;
  total_assignments: number;
  active_teachers: number;
  missing_teacher_count: number;
  invalid_reference_count: number;
  invalid_load_details?: TimetableInvalidLoadDetail[];
  archived_load_count?: number;
  archived_load_details?: TimetableInvalidLoadDetail[];
  ready: boolean;
  schedule_ready: boolean;
  placements: TimetableReadinessRow[];
  teacher_workloads: TimetableTeacherWorkload[];
  teacher_availability_summaries: TimetableTeacherAvailabilitySummary[];
  teacher_feasibility_issues: Array<TimetableTeacherCapacityBlocker & {
    employee_id: number;
    employee_name: string;
  }>;
  total_scheduled_periods: number;
  total_unscheduled_periods: number;
  hard_constraint_violation_count: number;
  load_progress: TimetableLoadProgress[];
  entry_issues: TimetableEntryIssue[];
  parallel_issues?: TimetableParallelLoadIssue[];
}

function asPositiveInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : null;
}

function asOptionalPositiveInteger(value: unknown): number | null | undefined {
  if (value == null || value === '') return null;
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function asBooleanInteger(value: unknown): 0 | 1 | null {
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  return null;
}

function defaultTeacherConstraints(
  schoolId: number,
  academicYearId: number,
  employeeId: number,
): TimetableTeacherConstraints {
  return {
    id: null,
    school_id: schoolId,
    academic_year_id: academicYearId,
    employee_id: employeeId,
    max_periods_per_day: null,
    max_consecutive_periods: null,
    max_working_days: null,
    prefer_compact_schedule: 0,
    avoid_first_period: 0,
    avoid_last_period: 0,
  };
}

export function isValidTimetableTime(value: unknown): value is string {
  return typeof value === 'string'
    && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function validateTimetableDayInput(input: Record<string, unknown>) {
  const academicYearId = asPositiveInteger(input.academic_year_id);
  const dayOfWeek = asNonNegativeInteger(input.day_of_week);
  const orderIndex = asNonNegativeInteger(input.order_index ?? dayOfWeek);
  const isActive = Number(input.is_active);
  if (academicYearId == null) return { ok: false as const, error: 'السنة الدراسية مطلوبة' };
  if (dayOfWeek == null || dayOfWeek > 6) return { ok: false as const, error: 'يوم الأسبوع غير صالح' };
  if (orderIndex == null) return { ok: false as const, error: 'ترتيب اليوم غير صالح' };
  if (isActive !== 0 && isActive !== 1) return { ok: false as const, error: 'حالة يوم الدوام غير صالحة' };
  return {
    ok: true as const,
    value: { academicYearId, dayOfWeek, orderIndex, isActive: isActive as 0 | 1 },
  };
}

export function validateTimetableSlotInput(input: Record<string, unknown>) {
  const academicYearId = asPositiveInteger(input.academic_year_id);
  const dayOfWeek = asNonNegativeInteger(input.day_of_week);
  const slotIndex = asPositiveInteger(input.slot_index);
  const slotType = input.slot_type;
  const lessonNumber = input.lesson_number == null || input.lesson_number === ''
    ? null
    : asPositiveInteger(input.lesson_number);
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const startTime = input.start_time;
  const endTime = input.end_time;
  const isActive = input.is_active == null ? 1 : Number(input.is_active);
  if (academicYearId == null) return { ok: false as const, error: 'السنة الدراسية مطلوبة' };
  if (dayOfWeek == null || dayOfWeek > 6) return { ok: false as const, error: 'يوم الأسبوع غير صالح' };
  if (slotIndex == null) return { ok: false as const, error: 'ترتيب الفترة غير صالح' };
  if (slotType !== 'lesson' && slotType !== 'break') return { ok: false as const, error: 'نوع الفترة غير صالح' };
  if (!label) return { ok: false as const, error: 'اسم الفترة مطلوب' };
  if (!isValidTimetableTime(startTime) || !isValidTimetableTime(endTime) || startTime >= endTime) {
    return { ok: false as const, error: 'وقت بداية ونهاية الفترة غير صالح' };
  }
  if (slotType === 'lesson' && lessonNumber == null) {
    return { ok: false as const, error: 'رقم الدرس مطلوب لفترة الدرس' };
  }
  if (slotType === 'break' && lessonNumber != null) {
    return { ok: false as const, error: 'فترة الاستراحة لا تقبل رقم درس' };
  }
  if (isActive !== 0 && isActive !== 1) return { ok: false as const, error: 'حالة الفترة غير صالحة' };
  return {
    ok: true as const,
    value: {
      academicYearId,
      dayOfWeek,
      slotIndex,
      slotType,
      lessonNumber,
      label,
      startTime,
      endTime,
      isActive: isActive as 0 | 1,
    },
  };
}

export function validateTimetableLoadInput(input: Record<string, unknown>) {
  const academicYearId = asPositiveInteger(input.academic_year_id);
  const classId = asPositiveInteger(input.class_id);
  const sectionId = input.section_id == null || input.section_id === '' ? null : asPositiveInteger(input.section_id);
  const subjectId = asPositiveInteger(input.subject_id);
  const employeeId = input.employee_id == null || input.employee_id === '' ? null : asPositiveInteger(input.employee_id);
  const weeklyPeriods = asPositiveInteger(input.weekly_periods);
  const parallelWithLoadId = Object.prototype.hasOwnProperty.call(input, 'parallel_with_load_id')
    ? input.parallel_with_load_id == null || input.parallel_with_load_id === '' ? null : asPositiveInteger(input.parallel_with_load_id)
    : undefined;
  if (academicYearId == null) return { ok: false as const, error: 'السنة الدراسية مطلوبة' };
  if (classId == null) return { ok: false as const, error: 'الصف مطلوب' };
  if (input.section_id != null && input.section_id !== '' && sectionId == null) return { ok: false as const, error: 'الشعبة غير صالحة' };
  if (subjectId == null) return { ok: false as const, error: 'المادة مطلوبة' };
  if (input.employee_id != null && input.employee_id !== '' && employeeId == null) return { ok: false as const, error: 'الموظف غير صالح' };
  if (weeklyPeriods == null) return { ok: false as const, error: 'عدد الدروس الأسبوعية يجب أن يكون عددًا صحيحًا موجبًا' };
  if (input.parallel_with_load_id != null && input.parallel_with_load_id !== '' && parallelWithLoadId == null) return { ok: false as const, error: 'نصاب الدرس المتزامن غير صالح' };
  return { ok: true as const, value: { academicYearId, classId, sectionId, subjectId, employeeId, weeklyPeriods,
    ...(parallelWithLoadId === undefined ? {} : { parallelWithLoadId }) } };
}

export function validateTimetableGridScopeInput(input: Record<string, unknown>) {
  const academicYearId = asPositiveInteger(input.academic_year_id);
  const classId = asPositiveInteger(input.class_id);
  const sectionId = input.section_id == null || input.section_id === ''
    ? null
    : asPositiveInteger(input.section_id);
  if (academicYearId == null) return { ok: false as const, error: 'السنة الدراسية مطلوبة' };
  if (classId == null) return { ok: false as const, error: 'الصف مطلوب' };
  if (input.section_id != null && input.section_id !== '' && sectionId == null) {
    return { ok: false as const, error: 'الشعبة غير صالحة' };
  }
  return { ok: true as const, value: { academicYearId, classId, sectionId } };
}

export function validateTimetableEntryInput(input: Record<string, unknown>, requireTeachingLoad = true) {
  const academicYearId = asPositiveInteger(input.academic_year_id);
  const slotId = asPositiveInteger(input.slot_id);
  const teachingLoadId = asPositiveInteger(input.teaching_load_id);
  if (academicYearId == null) return { ok: false as const, error: 'السنة الدراسية مطلوبة' };
  if (slotId == null) return { ok: false as const, error: 'فترة الجدول مطلوبة' };
  if (requireTeachingLoad && teachingLoadId == null) return { ok: false as const, error: 'نصاب المادة مطلوب' };
  if (!requireTeachingLoad && input.teaching_load_id != null && teachingLoadId == null) {
    return { ok: false as const, error: 'نصاب المادة غير صالح' };
  }
  return { ok: true as const, value: { academicYearId, slotId, teachingLoadId } };
}

export function validateTimetableEntryDropInput(input: Record<string, unknown>) {
  const academicYearId = asPositiveInteger(input.academic_year_id);
  const sourceSlotId = asPositiveInteger(input.source_slot_id);
  const targetSlotId = asPositiveInteger(input.target_slot_id);
  const expectedRevision = asNonNegativeInteger(input.expected_revision);
  const hasTargetEntry = Object.prototype.hasOwnProperty.call(input, 'target_entry_id');
  const targetEntryId = input.target_entry_id == null ? null : asPositiveInteger(input.target_entry_id);
  if (academicYearId == null) return { ok: false as const, error: 'السنة الدراسية مطلوبة' };
  if (sourceSlotId == null || targetSlotId == null) return { ok: false as const, error: 'موقعا الدرس قبل النقل وبعده مطلوبان' };
  if (sourceSlotId === targetSlotId) return { ok: false as const, error: 'اختر فترة أخرى لنقل الدرس' };
  if (expectedRevision == null) return { ok: false as const, error: 'نسخة بيانات الجدول غير صالحة' };
  if (!hasTargetEntry || (input.target_entry_id != null && targetEntryId == null)) {
    return { ok: false as const, error: 'حالة الفترة الهدف غير صالحة' };
  }
  return {
    ok: true as const,
    value: { academicYearId, sourceSlotId, targetSlotId, targetEntryId, expectedRevision },
  };
}

export function timetableLoadsShareGroup(
  left: Pick<TimetableTeachingLoad, 'class_id' | 'section_id'>,
  right: Pick<TimetableTeachingLoad, 'class_id' | 'section_id'>,
): boolean {
  return Number(left.class_id) === Number(right.class_id)
    && (left.section_id == null
      || right.section_id == null
      || Number(left.section_id) === Number(right.section_id));
}

export function projectTimetableEntryDrop(
  entries: TimetableEntry[],
  sourceEntry: TimetableEntry,
  targetSlotId: number,
  targetEntry: TimetableEntry | null,
): TimetableEntry[] {
  return entries.map((entry) => {
    if (Number(entry.id) === Number(sourceEntry.id)) return { ...entry, slot_id: targetSlotId };
    if (targetEntry != null && Number(entry.id) === Number(targetEntry.id)) {
      return { ...entry, slot_id: Number(sourceEntry.slot_id) };
    }
    return entry;
  });
}

export function validateTeacherAvailabilityScopeInput(input: Record<string, unknown>) {
  const academicYearId = asPositiveInteger(input.academic_year_id);
  const employeeId = asPositiveInteger(input.employee_id);
  if (academicYearId == null) return { ok: false as const, error: 'السنة الدراسية مطلوبة' };
  if (employeeId == null) return { ok: false as const, error: 'المدرس مطلوب' };
  return { ok: true as const, value: { academicYearId, employeeId } };
}

export function validateTeacherAvailabilityOverrideInput(input: Record<string, unknown>) {
  const scope = validateTeacherAvailabilityScopeInput(input);
  if (!scope.ok) return scope;
  const slotId = asPositiveInteger(input.slot_id);
  const status = input.status;
  if (slotId == null) return { ok: false as const, error: 'فترة الدرس مطلوبة' };
  if (status !== 'unavailable' && status !== 'preferred' && status !== 'avoid') {
    return { ok: false as const, error: 'حالة توفر المدرس غير صالحة' };
  }
  return {
    ok: true as const,
    value: { ...scope.value, slotId, status },
  };
}

export function validateTeacherAvailabilityDayInput(input: Record<string, unknown>) {
  const scope = validateTeacherAvailabilityScopeInput(input);
  if (!scope.ok) return scope;
  const dayOfWeek = asNonNegativeInteger(input.day_of_week);
  const status = input.status == null || input.status === '' ? null : input.status;
  if (dayOfWeek == null || dayOfWeek > 6) return { ok: false as const, error: 'يوم الأسبوع غير صالح' };
  if (status !== null && status !== 'unavailable' && status !== 'preferred' && status !== 'avoid') {
    return { ok: false as const, error: 'حالة توفر اليوم غير صالحة' };
  }
  return {
    ok: true as const,
    value: { ...scope.value, dayOfWeek, status },
  };
}

export function validateTeacherConstraintsInput(input: Record<string, unknown>) {
  const scope = validateTeacherAvailabilityScopeInput(input);
  if (!scope.ok) return scope;
  const maxPeriodsPerDay = asOptionalPositiveInteger(input.max_periods_per_day);
  const maxConsecutivePeriods = asOptionalPositiveInteger(input.max_consecutive_periods);
  const maxWorkingDays = asOptionalPositiveInteger(input.max_working_days);
  const preferCompactSchedule = asBooleanInteger(input.prefer_compact_schedule ?? 0);
  const avoidFirstPeriod = asBooleanInteger(input.avoid_first_period ?? 0);
  const avoidLastPeriod = asBooleanInteger(input.avoid_last_period ?? 0);
  if (maxPeriodsPerDay === undefined) return { ok: false as const, error: 'الحد الأقصى للدروس يوميًا يجب أن يكون عددًا موجبًا' };
  if (maxConsecutivePeriods === undefined) return { ok: false as const, error: 'الحد الأقصى للدروس المتتالية يجب أن يكون عددًا موجبًا' };
  if (maxWorkingDays === undefined || (maxWorkingDays != null && maxWorkingDays > 7)) {
    return { ok: false as const, error: 'الحد الأقصى لأيام العمل يجب أن يكون بين 1 و7' };
  }
  if (preferCompactSchedule == null || avoidFirstPeriod == null || avoidLastPeriod == null) {
    return { ok: false as const, error: 'تفضيلات المدرس غير صالحة' };
  }
  return {
    ok: true as const,
    value: {
      ...scope.value,
      maxPeriodsPerDay,
      maxConsecutivePeriods,
      maxWorkingDays,
      preferCompactSchedule,
      avoidFirstPeriod,
      avoidLastPeriod,
    },
  };
}

export function calculateWeeklyCapacity(days: TimetableDay[], slots: TimetableSlot[]) {
  const activeDays = new Set(days.filter((day) => Number(day.is_active) === 1).map((day) => day.day_of_week));
  let lessonSlots = 0;
  let breakSlots = 0;
  for (const slot of slots) {
    if (!activeDays.has(slot.day_of_week)) continue;
    if (Number(slot.is_active ?? 1) !== 1) continue;
    if (slot.slot_type === 'lesson') lessonSlots += 1;
    else breakSlots += 1;
  }
  return {
    teachingDays: activeDays.size,
    lessonSlots,
    breakSlots,
    weeklyCapacity: lessonSlots,
  };
}

export function calculateTeacherAvailabilitySummary(input: {
  schoolId: number;
  academicYearId: number;
  employeeId: number;
  employeeName: string;
  assignedWeeklyPeriods: number;
  days: TimetableDay[];
  slots: TimetableSlot[];
  overrides: TimetableTeacherAvailabilityOverride[];
  constraints?: TimetableTeacherConstraints | null;
}): TimetableTeacherAvailabilitySummary {
  const constraints = input.constraints || defaultTeacherConstraints(
    input.schoolId,
    input.academicYearId,
    input.employeeId,
  );
  const activeDayIds = new Set(input.days
    .filter((day) => Number(day.is_active) === 1)
    .map((day) => day.day_of_week));
  const overrideBySlot = new Map(input.overrides
    .filter((override) => override.employee_id === input.employeeId)
    .map((override) => [override.slot_id, override.status]));
  const activeLessonSlots = input.slots.filter((slot) => (
    slot.slot_type === 'lesson'
    && Number(slot.is_active ?? 1) === 1
    && activeDayIds.has(slot.day_of_week)
  ));
  const dailyAvailable = new Map<number, number>();
  let unavailable = 0;
  let preferred = 0;
  let avoid = 0;
  for (const slot of activeLessonSlots) {
    const override = overrideBySlot.get(slot.id);
    if (override === 'unavailable') {
      unavailable += 1;
      continue;
    }
    if (override === 'preferred') preferred += 1;
    if (override === 'avoid') avoid += 1;
    dailyAvailable.set(slot.day_of_week, (dailyAvailable.get(slot.day_of_week) || 0) + 1);
  }
  const dailyCapacities = [...activeDayIds].sort((a, b) => a - b).map((dayOfWeek) => {
    const effectiveAvailableSlots = dailyAvailable.get(dayOfWeek) || 0;
    return {
      day_of_week: dayOfWeek,
      effective_available_slots: effectiveAvailableSlots,
      hard_capacity: constraints.max_periods_per_day == null
        ? effectiveAvailableSlots
        : Math.min(effectiveAvailableSlots, constraints.max_periods_per_day),
    };
  });
  const orderedDailyCapacities = dailyCapacities
    .map((day) => day.hard_capacity)
    .sort((a, b) => b - a);
  const selectedDailyCapacities = constraints.max_working_days == null
    ? orderedDailyCapacities
    : orderedDailyCapacities.slice(0, constraints.max_working_days);
  const hardWeeklyCapacity = selectedDailyCapacities.reduce((sum, value) => sum + value, 0);
  const effectiveAvailableSlots = activeLessonSlots.length - unavailable;
  const blockers: TimetableTeacherCapacityBlocker[] = [];
  if (input.assignedWeeklyPeriods > 0 && effectiveAvailableSlots === 0) {
    blockers.push({
      code: 'teacher_no_available_slots',
      message: `لا يملك المدرس ${input.employeeName} أي درس متاح ضمن الأسبوع النشط.`,
    });
  } else if (input.assignedWeeklyPeriods > hardWeeklyCapacity) {
    blockers.push({
      code: 'teacher_load_exceeds_availability',
      message: `عدد الدروس المسندة إلى المدرس ${input.employeeName}: ${input.assignedWeeklyPeriods}، بينما سعته المتاحة وفق القيود: ${hardWeeklyCapacity} فقط.`,
    });
  }
  return {
    employee_id: input.employeeId,
    employee_name: input.employeeName,
    assigned_weekly_periods: input.assignedWeeklyPeriods,
    total_active_lesson_slots: activeLessonSlots.length,
    unavailable_active_lesson_slots: unavailable,
    effective_available_slots: effectiveAvailableSlots,
    preferred_slots: preferred,
    avoid_slots: avoid,
    hard_weekly_capacity: hardWeeklyCapacity,
    feasible: blockers.length === 0,
    blockers,
    daily_capacities: dailyCapacities,
    constraints,
  };
}

export function buildTeacherAvailabilityMatrix(input: {
  schoolId: number;
  academicYearId: number;
  teacher: TimetableTeacherAvailabilityMatrix['teacher'];
  days: TimetableDay[];
  slots: TimetableSlot[];
  overrides: TimetableTeacherAvailabilityOverride[];
  constraints?: TimetableTeacherConstraints | null;
  assignedWeeklyPeriods: number;
}): TimetableTeacherAvailabilityMatrix {
  const overrideBySlot = new Map(input.overrides.map((override) => [override.slot_id, override.status]));
  const activeDayIds = new Set(input.days.filter((day) => Number(day.is_active) === 1).map((day) => day.day_of_week));
  const days = input.days.map<TimetableTeacherAvailabilityDay>((day) => ({
    ...day,
    slots: input.slots.filter((slot) => slot.day_of_week === day.day_of_week).map((slot) => {
      const overrideStatus = overrideBySlot.get(slot.id) || null;
      const lesson = slot.slot_type === 'lesson';
      return {
        ...slot,
        override_status: overrideStatus,
        presentation_status: lesson ? (overrideStatus || 'available') : 'break',
        effectively_schedulable: lesson
          && activeDayIds.has(slot.day_of_week)
          && Number(slot.is_active ?? 1) === 1
          && overrideStatus !== 'unavailable',
      };
    }),
  }));
  const constraints = input.constraints || defaultTeacherConstraints(input.schoolId, input.academicYearId, input.teacher.id);
  return {
    teacher: input.teacher,
    days,
    overrides: input.overrides,
    constraints,
    summary: calculateTeacherAvailabilitySummary({
      schoolId: input.schoolId,
      academicYearId: input.academicYearId,
      employeeId: input.teacher.id,
      employeeName: input.teacher.full_name,
      assignedWeeklyPeriods: input.assignedWeeklyPeriods,
      days: input.days,
      slots: input.slots,
      overrides: input.overrides,
      constraints,
    }),
  };
}

export function loadHasInvalidAcademicReference(load: TimetableTeachingLoad): boolean {
  return load.class_status !== 'active'
    || load.class_school_id !== load.school_id
    || (load.section_id == null && Number(load.active_section_count || 0) > 0)
    || load.subject_status !== 'active'
    || load.subject_school_id !== load.school_id
    || load.subject_class_id !== load.class_id
    || (load.section_id != null && (
      load.section_status !== 'active'
      || load.section_school_id !== load.school_id
      || load.section_class_id !== load.class_id
      || load.subject_section_id != null && load.subject_section_id !== load.section_id
    ))
    || (load.section_id == null && load.subject_section_id != null);
}

export function loadHasInvalidTeacherReference(load: TimetableTeachingLoad): boolean {
  return load.employee_id != null && (
    load.employee_status !== 'active'
    || load.employee_school_id !== load.school_id
    || load.employee_role !== 'teacher'
  );
}

/** Unsaved assignments to known archived placements remain restorable history.
 * Missing, foreign or structurally mismatched references remain repair blockers.
 */
export function dormantTimetableLoadIds(loads: TimetableTeachingLoad[], entries: Array<Pick<TimetableEntry, 'teaching_load_id'>>, schoolId?: number, academicYearId?: number): Set<number> {
  const scheduled = new Set(entries.map(entry => Number(entry.teaching_load_id)));
  const invalidParallel = new Set(validateTimetableParallelLoads(loads).map(issue => issue.load_id));
  const knownStatus = (status: string | null | undefined) => status === 'active' || status === 'archived';
  return new Set(loads.filter(load => (
    load.status === 'active' && !scheduled.has(Number(load.id)) && !invalidParallel.has(Number(load.id))
    && Number.isSafeInteger(load.school_id) && load.school_id > 0
    && Number.isSafeInteger(load.academic_year_id) && load.academic_year_id > 0
    && (schoolId == null || load.school_id === schoolId) && (academicYearId == null || load.academic_year_id === academicYearId)
    && knownStatus(load.class_status) && load.class_school_id === load.school_id
    && (load.class_status === 'archived' || load.section_id != null && load.section_status === 'archived')
    && (load.section_id == null ? Number(load.active_section_count || 0) === 0 : (
      knownStatus(load.section_status) && load.section_school_id === load.school_id && load.section_class_id === load.class_id
    ))
    && knownStatus(load.subject_status) && load.subject_school_id === load.school_id && load.subject_class_id === load.class_id
    && (load.subject_section_id == null || load.subject_section_id === load.section_id)
    && (load.employee_id == null || (
      knownStatus(load.employee_status) && load.employee_school_id === load.school_id && load.employee_role === 'teacher'
    ))
  )).map(load => Number(load.id)));
}

// Diagnostic explanations mirror the canonical reference predicates above.
// They are generated only for reported invalid loads, outside placement hot loops.
export function timetableLoadReferenceReasons(load: TimetableTeachingLoad): TimetableInvalidLoadReason[] {
  const reasons: TimetableInvalidLoadReason[] = [];
  const add = (code: TimetableInvalidLoadReason['code'], message: string, action: string) => reasons.push({code, message, action});
  if (load.class_status == null) add('class_unavailable', 'الصف غير موجود ضمن المدرسة.', 'اختر صفًا متاحًا في هذه المدرسة للنصاب.');
  else {
    if (load.class_status !== 'active') add('class_archived', 'الصف مؤرشف أو غير فعال.', 'راجع أنصبة الصف المؤرشف وعطّل ما لم يعد مطلوبًا.');
    if (load.class_school_id !== load.school_id) add('class_school_mismatch', 'الصف لا يتبع مدرسة النصاب.', 'صحّح الصف في بيانات النصاب.');
  }
  if (load.section_id == null && Number(load.active_section_count || 0) > 0)
    add('section_required', 'النصاب للصف كاملًا رغم وجود شعب فعالة.', 'حدّد الشعبة المقصودة في بيانات النصاب.');
  if (load.section_id != null) {
    if (load.section_status == null) add('section_unavailable', 'الشعبة غير موجودة ضمن المدرسة.', 'اختر شعبة متاحة تتبع الصف نفسه.');
    else {
      if (load.section_status !== 'active') add('section_archived', 'الشعبة مؤرشفة أو غير فعالة.', 'راجع النصاب المرتبط بالشعبة المؤرشفة وعطّله إن لم يعد مطلوبًا.');
      if (load.section_school_id !== load.school_id) add('section_school_mismatch', 'الشعبة لا تتبع مدرسة النصاب.', 'صحّح الشعبة في بيانات النصاب.');
      if (load.section_class_id !== load.class_id) add('section_class_mismatch', 'الشعبة لا تتبع صف النصاب.', 'اختر شعبة تتبع الصف المحدد.');
    }
  }
  if (load.subject_status == null) add('subject_unavailable', 'المادة غير موجودة ضمن المدرسة.', 'اختر مادة متاحة تتبع الصف والشعبة المحددين.');
  else {
    if (load.subject_status !== 'active') add('subject_archived', 'المادة مؤرشفة أو غير فعالة.', 'راجع المادة في دليل المواد أو عطّل نصابها إن لم يعد مطلوبًا.');
    if (load.subject_school_id !== load.school_id) add('subject_school_mismatch', 'المادة لا تتبع مدرسة النصاب.', 'صحّح المادة في بيانات النصاب.');
    if (load.subject_class_id !== load.class_id) add('subject_class_mismatch', 'المادة لا تتبع صف النصاب.', 'اختر مادة من الصف نفسه.');
    if (load.subject_section_id != null && load.subject_section_id !== load.section_id)
      add('subject_section_mismatch', 'المادة مخصصة لشعبة أخرى.', 'اختر مادة مشتركة أو مادة تخص الشعبة المحددة.');
  }
  if (load.employee_id != null) {
    if (load.employee_status == null) add('teacher_unavailable', 'المدرس المحدد غير موجود ضمن المدرسة.', 'حدّد مدرسًا فعالًا من موظفي المدرسة.');
    else {
      if (load.employee_status !== 'active') add('teacher_archived', 'المدرس المحدد مؤرشف أو غير فعال.', 'أعد إسناد النصاب إلى مدرس فعال.');
      if (load.employee_school_id !== load.school_id) add('teacher_school_mismatch', 'المدرس لا يتبع مدرسة النصاب.', 'حدّد مدرسًا من المدرسة نفسها.');
      if (load.employee_role !== 'teacher') add('employee_not_teacher', 'الموظف المحدد لا يحمل صفة مدرس.', 'اختر موظفًا مسجلًا بصفة مدرس.');
    }
  }
  return reasons;
}

function entryNotice(
  code: TimetableEntryHardConflictCode | TimetableEntryWarningCode,
  message: string,
): TimetableEntryNotice {
  return { code, message };
}

function sortDaySlots(slots: TimetableSlot[]) {
  return [...slots].sort((left, right) => (
    String(left.start_time ?? '').localeCompare(String(right.start_time ?? ''))
    || left.slot_index - right.slot_index
    || left.id - right.id
  ));
}

// Shared occupancy primitives. Both single-entry placement and whole-schedule
// projections use the same active lesson and distinct-day definitions.
export function activeTimetableLessonSlots(days: TimetableDay[], slots: TimetableSlot[]): TimetableSlot[] {
  const activeDayScopes = new Set(days.filter((day) => Number(day.is_active) === 1).map((day) => (
    `${Number(day.school_id)}:${Number(day.academic_year_id)}:${Number(day.day_of_week)}`
  )));
  return slots.filter((slot) => slot.slot_type === 'lesson' && Number(slot.is_active) === 1
    && activeDayScopes.has(`${Number(slot.school_id)}:${Number(slot.academic_year_id)}:${Number(slot.day_of_week)}`));
}

// Callers pass only entries/slots in the relevant teacher and school/year scope.
export function occupiedTimetableDays(entries: TimetableEntry[], slots: TimetableSlot[]): Set<number> {
  const slotById = new Map(slots.map((slot) => [Number(slot.id), slot]));
  const days = new Set<number>();
  for (const entry of entries) {
    const slot = slotById.get(Number(entry.slot_id));
    if (slot) days.add(Number(slot.day_of_week));
  }
  return days;
}

export interface TimetableEntryPlacementInput {
  candidate: { id?: number | null; slot_id: number; teaching_load_id: number };
  days: TimetableDay[];
  slots: TimetableSlot[];
  loads: TimetableTeachingLoad[];
  entries: TimetableEntry[];
  teacherAvailability?: TimetableTeacherAvailabilityOverride[];
  teacherConstraints?: TimetableTeacherConstraints[];
  // Optional evidence from the SAME validator for projected configuration
  // comparisons. Does not alter placement acceptance or response shapes.
  onConstraintMetric?: (code: TimetableEntryHardConflictCode, count: number) => void;
  // Whole schedules must also detect already-occupied excess working days.
  validateWholeSchedule?: boolean;
}

type PlacementConfiguration = Pick<TimetableEntryPlacementInput, 'days' | 'slots' | 'loads' | 'teacherAvailability' | 'teacherConstraints'>;
type PlacementOptions = Pick<TimetableEntryPlacementInput, 'onConstraintMetric' | 'validateWholeSchedule'>;

const placementDayKey = (item: {school_id: number; academic_year_id: number; day_of_week: number}) => (
  `${Number(item.school_id)}:${Number(item.academic_year_id)}:${Number(item.day_of_week)}`
);
const placementTeacherKey = (item: {school_id: number; academic_year_id: number; employee_id: number | null}) => (
  `${Number(item.school_id)}:${Number(item.academic_year_id)}:${Number(item.employee_id)}`
);

function appendPlacementIndex<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function indexPlacementConfiguration(input: PlacementConfiguration) {
  const loadsById = new Map(input.loads.map(load => [Number(load.id), load]));
  const slotsById = new Map(input.slots.map(slot => [Number(slot.id), slot]));
  const daysByScope = new Map(input.days.map(day => [placementDayKey(day), day]));
  const activeLessonSlotIds = new Set(activeTimetableLessonSlots(input.days, input.slots).map(slot => Number(slot.id)));
  const groupsByLoad = indexTimetableParallelLoadGroups(input.loads);
  const linkedLoadIds = new Set<number>();
  for (const load of input.loads) {
    if (load.parallel_with_load_id == null) continue;
    linkedLoadIds.add(load.id);
    if (load.status === 'active') linkedLoadIds.add(load.parallel_with_load_id);
  }
  const validParallelLoadIds = new Set<number>();
  for (const group of groupsByLoad.values()) {
    if (group.length === 2 && group.every(load => !loadHasInvalidAcademicReference(load) && !loadHasInvalidTeacherReference(load))) {
      group.forEach(load => validParallelLoadIds.add(load.id));
    }
  }
  const orderedSlotsByDay = new Map<string, TimetableSlot[]>();
  for (const slot of input.slots) {
    if (Number(slot.is_active) === 1) appendPlacementIndex(orderedSlotsByDay, placementDayKey(slot), slot);
  }
  for (const [key, slots] of orderedSlotsByDay) orderedSlotsByDay.set(key, sortDaySlots(slots));
  const availabilityByTeacherSlot = new Map<string, TimetableTeacherAvailabilityOverride>();
  const preferredTeacherKeys = new Set<string>();
  for (const override of input.teacherAvailability || []) {
    const key = placementTeacherKey(override);
    // Match the single-entry validator's first matching override/constraint.
    const slotKey = `${key}:${Number(override.slot_id)}`;
    if (!availabilityByTeacherSlot.has(slotKey)) availabilityByTeacherSlot.set(slotKey, override);
    if (override.status === 'preferred' && activeLessonSlotIds.has(Number(override.slot_id))) preferredTeacherKeys.add(key);
  }
  const constraintsByTeacher = new Map<string, TimetableTeacherConstraints>();
  for (const constraint of input.teacherConstraints || []) {
    const key = placementTeacherKey(constraint);
    if (!constraintsByTeacher.has(key)) constraintsByTeacher.set(key, constraint);
  }
  return {loadsById, slotsById, daysByScope, activeLessonSlotIds, groupsByLoad, linkedLoadIds, validParallelLoadIds,
    orderedSlotsByDay, availabilityByTeacherSlot, preferredTeacherKeys, constraintsByTeacher};
}

function indexPlacementEntries(entries: TimetableEntry[], config: ReturnType<typeof indexPlacementConfiguration>) {
  const bySlot = new Map<number, TimetableEntry[]>();
  const activeByLoad = new Map<number, TimetableEntry[]>();
  const byTeacher = new Map<number, TimetableEntry[]>();
  const activeByTeacher = new Map<number, TimetableEntry[]>();
  const activeByTeacherDay = new Map<string, TimetableEntry[]>();
  for (const entry of entries) {
    appendPlacementIndex(bySlot, Number(entry.slot_id), entry);
    const active = config.activeLessonSlotIds.has(Number(entry.slot_id));
    if (active) appendPlacementIndex(activeByLoad, Number(entry.teaching_load_id), entry);
    const teacherId = config.loadsById.get(Number(entry.teaching_load_id))?.employee_id;
    if (teacherId == null) continue;
    appendPlacementIndex(byTeacher, Number(teacherId), entry);
    if (!active) continue;
    appendPlacementIndex(activeByTeacher, Number(teacherId), entry);
    const day = config.slotsById.get(Number(entry.slot_id))!.day_of_week;
    appendPlacementIndex(activeByTeacherDay, `${Number(teacherId)}:${Number(day)}`, entry);
  }
  return {bySlot, activeByLoad, byTeacher, activeByTeacher, activeByTeacherDay};
}

/** Reuse static checks across candidate slots. Rebuild the entry index after each
 * schedule mutation; no mutable-array or cross-request caches are retained. */
export function createTimetableEntryPlacementEvaluator(input: PlacementConfiguration) {
  const config = indexPlacementConfiguration(input);
  return (entries: TimetableEntry[]) => {
    const occupancy = indexPlacementEntries(entries, config);
    return (candidate: TimetableEntryPlacementInput['candidate'], options: PlacementOptions = {}) => (
      evaluateIndexedTimetableEntryPlacement({...input, entries, candidate, ...options}, config, occupancy)
    );
  };
}

export function evaluateTimetableEntryPlacement(input: TimetableEntryPlacementInput) {
  return createTimetableEntryPlacementEvaluator(input)(input.entries)(input.candidate, {
    onConstraintMetric: input.onConstraintMetric,
    validateWholeSchedule: input.validateWholeSchedule,
  });
}

function evaluateIndexedTimetableEntryPlacement(
  input: TimetableEntryPlacementInput,
  config: ReturnType<typeof indexPlacementConfiguration>,
  occupancy: ReturnType<typeof indexPlacementEntries>,
): { hard_conflicts: TimetableEntryNotice[]; warnings: TimetableEntryNotice[] } {
  const hardConflicts: TimetableEntryNotice[] = [];
  const warnings: TimetableEntryNotice[] = [];
  const candidateId = input.candidate.id == null ? null : Number(input.candidate.id);
  const slot = config.slotsById.get(Number(input.candidate.slot_id));
  const load = config.loadsById.get(Number(input.candidate.teaching_load_id));
  const day = slot && config.daysByScope.get(placementDayKey(slot));
  if (!slot || !day || slot.slot_type !== 'lesson') {
    hardConflicts.push(entryNotice('slot_not_schedulable', 'الفترة المحددة ليست فترة درس فعالة قابلة للجدولة'));
  } else {
    if (Number(day.is_active) !== 1) {
      hardConflicts.push(entryNotice('inactive_day', 'اليوم المحدد غير فعال ولا يقبل دروسًا جديدة'));
    }
    if (Number(slot.is_active) !== 1) {
      hardConflicts.push(entryNotice('inactive_slot', 'الفترة المحددة غير فعالة ولا تقبل دروسًا جديدة'));
    }
  }
  if (!load || load.status !== 'active' || loadHasInvalidAcademicReference(load) || loadHasInvalidTeacherReference(load)) {
    hardConflicts.push(entryNotice('invalid_teaching_load', 'نصاب المادة غير فعال أو يحتوي على مرجع غير صالح'));
  }
  if (!slot || !load) return { hard_conflicts: hardConflicts, warnings };
  const parallelGroup = config.groupsByLoad.get(load.id)!;
  const hasParallelLink = config.linkedLoadIds.has(load.id);
  const validParallelGroup = config.validParallelLoadIds.has(load.id);
  if (hasParallelLink && !validParallelGroup) {
    hardConflicts.push(entryNotice('invalid_parallel_load', 'ربط الدروس المتزامنة غير صالح أو يشير إلى نصاب غير صالح'));
  }
  if (Number(slot.school_id) !== Number(load.school_id)) {
    hardConflicts.push(entryNotice('invalid_tenant_scope', 'الفترة ونصاب المادة لا ينتميان إلى المدرسة نفسها'));
  }
  if (Number(slot.academic_year_id) !== Number(load.academic_year_id)) {
    hardConflicts.push(entryNotice('invalid_academic_year', 'الفترة ونصاب المادة لا ينتميان إلى السنة الدراسية نفسها'));
  }

  const excludingCandidate = (entries: TimetableEntry[] = []) => candidateId == null ? entries : entries.filter(entry => Number(entry.id) !== candidateId);
  const scheduledForLoad = excludingCandidate(occupancy.activeByLoad.get(Number(load.id))).length;
  input.onConstraintMetric?.('weekly_periods_exceeded', scheduledForLoad + 1);
  if (scheduledForLoad >= Number(load.weekly_periods)) {
    hardConflicts.push(entryNotice('weekly_periods_exceeded', 'اكتمل عدد الدروس الأسبوعية المطلوبة لهذا النصاب'));
  }

  const loadById = config.loadsById;
  const sameSlotEntries = excludingCandidate(occupancy.bySlot.get(Number(slot.id)));
  const groupCollision = sameSlotEntries.some((entry) => {
    const existingLoad = loadById.get(Number(entry.teaching_load_id));
    return existingLoad != null && timetableLoadsShareGroup(existingLoad, load)
      && !(validParallelGroup && existingLoad.id !== load.id && parallelGroup.some(member => member.id === existingLoad.id));
  });
  if (groupCollision) {
    hardConflicts.push(entryNotice('class_section_collision', 'يوجد درس آخر للصف أو الشعبة في هذه الفترة'));
  }
  if (input.validateWholeSchedule && validParallelGroup) {
    const partner = parallelGroup.find(member => member.id !== load.id)!;
    if (!sameSlotEntries.some(entry => entry.teaching_load_id === partner.id)) {
      hardConflicts.push(entryNotice('parallel_lesson_missing', 'يجب أن يكون الدرسان المرتبطان في الفترة نفسها'));
    }
  }

  if (load.employee_id != null) {
    const teacherEntries = excludingCandidate(occupancy.byTeacher.get(Number(load.employee_id)));
    if (teacherEntries.some((entry) => Number(entry.slot_id) === Number(slot.id))) {
      hardConflicts.push(entryNotice('teacher_collision', 'المدرس مرتبط بدرس آخر في الفترة نفسها'));
    }

    const teacherKey = placementTeacherKey(load);
    const availability = config.availabilityByTeacherSlot.get(`${teacherKey}:${Number(slot.id)}`);
    if (availability?.status === 'unavailable') {
      hardConflicts.push(entryNotice('teacher_unavailable', 'المدرس غير متاح في هذه الفترة'));
    }

    const constraints = config.constraintsByTeacher.get(teacherKey);
    const teacherEntriesForDay = excludingCandidate(occupancy.activeByTeacherDay.get(`${Number(load.employee_id)}:${Number(slot.day_of_week)}`));
    input.onConstraintMetric?.('teacher_max_periods_per_day', teacherEntriesForDay.length + 1);
    if (constraints?.max_periods_per_day != null
      && teacherEntriesForDay.length + 1 > Number(constraints.max_periods_per_day)) {
      hardConflicts.push(entryNotice('teacher_max_periods_per_day', 'تجاوز المدرس الحد الأقصى للدروس اليومية'));
    }

    if (constraints?.max_working_days != null || input.onConstraintMetric) {
      const teacherWorkingDays = new Set(excludingCandidate(occupancy.activeByTeacher.get(Number(load.employee_id)))
        .map(entry => Number(config.slotsById.get(Number(entry.slot_id))!.day_of_week)));
      const addsWorkingDay = !teacherWorkingDays.has(Number(slot.day_of_week));
      input.onConstraintMetric?.('teacher_max_working_days', teacherWorkingDays.size + Number(addsWorkingDay));
      if (constraints?.max_working_days != null
        && (input.validateWholeSchedule || addsWorkingDay)
        && teacherWorkingDays.size + Number(addsWorkingDay) > Number(constraints.max_working_days)) {
        hardConflicts.push(entryNotice('teacher_max_working_days', 'تجاوز المدرس الحد الأقصى لأيام العمل الأسبوعية'));
      }
    }

    const orderedSlots = config.orderedSlotsByDay.get(placementDayKey(slot)) || [];
    if (constraints?.max_consecutive_periods != null || input.onConstraintMetric) {
      const scheduledSlotIds = new Set(teacherEntriesForDay.map((entry) => Number(entry.slot_id)));
      scheduledSlotIds.add(Number(slot.id));
      let currentRun = 0;
      let maximumRun = 0;
      for (const orderedSlot of orderedSlots) {
        if (orderedSlot.slot_type === 'lesson' && scheduledSlotIds.has(Number(orderedSlot.id))) {
          currentRun += 1;
          maximumRun = Math.max(maximumRun, currentRun);
        } else {
          currentRun = 0;
        }
      }
      if (constraints?.max_consecutive_periods != null
        && maximumRun > Number(constraints.max_consecutive_periods)) {
        hardConflicts.push(entryNotice('teacher_max_consecutive_periods', 'تجاوز المدرس الحد الأقصى للدروس المتتالية'));
      }
      input.onConstraintMetric?.('teacher_max_consecutive_periods', maximumRun);
    }

    if (availability?.status === 'avoid') {
      warnings.push(entryNotice('avoid_slot', 'المدرس يفضل تجنب هذه الفترة'));
    }
    if (availability?.status === 'preferred') {
      warnings.push(entryNotice('preferred_slot', 'هذا الوقت مفضل للمدرس'));
    }
    if (config.preferredTeacherKeys.has(teacherKey) && availability?.status !== 'preferred') {
      warnings.push(entryNotice('outside_preferred_slots', 'هذه الفترة ليست ضمن الفترات المفضلة للمدرس'));
    }
    const lessonSlots = orderedSlots.filter((item) => item.slot_type === 'lesson');
    if (constraints?.avoid_first_period === 1 && Number(lessonSlots[0]?.id) === Number(slot.id)) {
      warnings.push(entryNotice('first_period_preference', 'يفضل المدرس تجنب الدرس الأول'));
    }
    if (constraints?.avoid_last_period === 1 && Number(lessonSlots[lessonSlots.length - 1]?.id) === Number(slot.id)) {
      warnings.push(entryNotice('last_period_preference', 'يفضل المدرس تجنب الدرس الأخير'));
    }
    if (constraints?.prefer_compact_schedule === 1 && teacherEntriesForDay.length > 0) {
      const candidatePosition = orderedSlots.findIndex((item) => Number(item.id) === Number(slot.id));
      const compact = teacherEntriesForDay.some((entry) => {
        const existingPosition = orderedSlots.findIndex((item) => Number(item.id) === Number(entry.slot_id));
        return existingPosition >= 0 && Math.abs(existingPosition - candidatePosition) === 1;
      });
      if (!compact) warnings.push(entryNotice('non_compact_schedule', 'هذا الدرس لا تحقق تفضيل تجميع دروس المدرس'));
    }
  }

  return { hard_conflicts: hardConflicts, warnings };
}

export function buildTimetableReadiness(input: {
  schoolId?: number;
  academicYearId?: number;
  days: TimetableDay[];
  slots: TimetableSlot[];
  placements: TimetablePlacement[];
  subjects: TimetableSubjectOption[];
  loads: TimetableTeachingLoad[];
  entries?: TimetableEntry[];
  teacherAvailability?: TimetableTeacherAvailabilityOverride[];
  teacherConstraints?: TimetableTeacherConstraints[];
}): TimetableReadinessSummary {
  const capacity = calculateWeeklyCapacity(input.days, input.slots);
  const entries = input.entries || [];
  const placedLoadIds = new Set(entries.map((entry) => Number(entry.teaching_load_id)));
  const dormantLoadIds = dormantTimetableLoadIds(input.loads, entries, input.schoolId, input.academicYearId);
  const activeLoads = input.loads.filter((load) => load.status === 'active' && !dormantLoadIds.has(Number(load.id)));
  const loadWithinScope = (load: TimetableTeachingLoad) => (
    (input.schoolId == null || load.school_id === input.schoolId)
    && (input.academicYearId == null || load.academic_year_id === input.academicYearId)
  );
  const subjectPlacementKey = (load: TimetableTeachingLoad) => (
    `${load.school_id}:${load.academic_year_id}:${load.class_id}:${load.section_id ?? 'none'}:${load.subject_id}`
  );
  const activeSubjectPlacements = new Set(activeLoads.map(subjectPlacementKey));
  // Inactive matrix records explicitly exclude a subject for this placement.
  // A replacement active record (including an invalid one) keeps its demand
  // and diagnostics; an inactive record with saved lessons still needs repair.
  const excludedLoads = input.loads.filter((load) => (
    load.status === 'inactive' && loadWithinScope(load)
    && !loadHasInvalidAcademicReference(load)
    && !placedLoadIds.has(Number(load.id))
    && !activeSubjectPlacements.has(subjectPlacementKey(load))
  ));
  // An inactive load normally leaves current demand. If it still owns a saved
  // placement, retain that demand until the historical placement is repaired
  // or deleted instead of silently making required periods disappear.
  const placedInactiveLoads = input.loads.filter((load) => (
    load.status !== 'active' && placedLoadIds.has(Number(load.id))
  ));
  const demandLoads = [...activeLoads, ...placedInactiveLoads];
  const inactivePlacedLoadIds = new Set(placedInactiveLoads.map((load) => Number(load.id)));
  const invalidAcademicLoadIds = new Set(demandLoads.filter(loadHasInvalidAcademicReference).map((load) => Number(load.id)));
  const invalidTeacherLoadIds = new Set(demandLoads.filter(loadHasInvalidTeacherReference).map((load) => Number(load.id)));
  const parallelIssues = validateTimetableParallelLoads(input.loads);
  const invalidParallelLoadIds = new Set(parallelIssues.map(issue => issue.load_id));
  for (const load of activeLoads) {
    const group = parallelTimetableLoadGroup(load, input.loads);
    if (group.length === 2 && group.some(member => invalidAcademicLoadIds.has(member.id) || invalidTeacherLoadIds.has(member.id))) {
      for (const member of group) {
        if (invalidParallelLoadIds.has(member.id)) continue;
        invalidParallelLoadIds.add(member.id);
        parallelIssues.push({code: 'invalid_parallel_load', reason: 'invalid_reference', load_id: member.id,
          parallel_with_load_id: member.parallel_with_load_id ?? null, message: 'أحد نصابي الدرسين المتزامنين يحتوي على مرجع أكاديمي أو مدرس غير صالح.'});
      }
    }
  }
  const invalidLoadIds = new Set([...invalidAcademicLoadIds, ...invalidTeacherLoadIds, ...inactivePlacedLoadIds, ...invalidParallelLoadIds]);
  const loadDetails = (selected: Set<number>): TimetableInvalidLoadDetail[] => input.loads.filter(load => selected.has(Number(load.id))).map(load => {
    const reasons = timetableLoadReferenceReasons(load);
    if (inactivePlacedLoadIds.has(Number(load.id))) reasons.push({code: 'inactive_load_has_entries',
      message: 'النصاب معطل وما زالت له دروس محفوظة في الجدول الحالي.', action: 'راجع الدروس المحفوظة وأزلها أو أعد تفعيل النصاب المقصود.'});
    if (invalidParallelLoadIds.has(Number(load.id))) reasons.push({code: 'invalid_parallel_load',
      message: parallelIssues.find(issue => issue.load_id === load.id)?.message || 'ربط الدرس المتزامن غير صالح.',
      action: 'راجع ربط المادتين وتوافق الشعبة والعدد الأسبوعي والمدرسين.'});
    return {teaching_load_id: Number(load.id), subject_id: Number(load.subject_id), subject_name: load.subject_name || 'مادة غير معروفة',
      class_id: Number(load.class_id), class_name: load.class_name || 'صف غير معروف', section_id: load.section_id,
      section_name: load.section_name || null, employee_id: load.employee_id, employee_name: load.employee_name || null,
      load_status: load.status, scheduled_entry_count: entries.filter(entry => Number(entry.teaching_load_id) === Number(load.id)).length, reasons};
  });
  const invalidLoadDetails = loadDetails(invalidLoadIds);
  const archivedLoadDetails = loadDetails(dormantLoadIds);
  const academicallyValidLoads = demandLoads.filter((load) => !invalidAcademicLoadIds.has(Number(load.id)));
  const missingTeacherLoads = activeLoads.filter((load) => (
    !invalidAcademicLoadIds.has(Number(load.id)) && load.employee_id == null
  ));
  const teacherMap = new Map<number, TimetableTeacherWorkload>();
  for (const load of academicallyValidLoads) {
    if (load.status !== 'active' || load.employee_id == null || invalidTeacherLoadIds.has(Number(load.id))) continue;
    const current = teacherMap.get(load.employee_id) || {
      employee_id: load.employee_id,
      employee_name: load.employee_name || 'موظف غير معروف',
      total_weekly_periods: 0,
      assignment_count: 0,
    };
    current.total_weekly_periods += Number(load.weekly_periods);
    current.assignment_count += 1;
    teacherMap.set(load.employee_id, current);
  }

  const entryIssues: TimetableEntryIssue[] = [];
  const validEntryIds = new Set<number>();
  const evaluateEntry = entries.length ? createTimetableEntryPlacementEvaluator({
    days: input.days, slots: input.slots, loads: input.loads,
    teacherAvailability: input.teacherAvailability, teacherConstraints: input.teacherConstraints,
  })(entries) : null;
  for (const entry of entries) {
    const evaluation = evaluateEntry!({
        id: entry.id,
        slot_id: entry.slot_id,
        teaching_load_id: entry.teaching_load_id,
    }, {validateWholeSchedule: true});
    if (evaluation.hard_conflicts.length === 0) validEntryIds.add(Number(entry.id));
    else entryIssues.push({ entry_id: Number(entry.id), hard_conflicts: evaluation.hard_conflicts });
  }
  const loadProgress = academicallyValidLoads.map<TimetableLoadProgress>((load) => {
    const scheduledPeriods = entries.filter((entry) => (
      Number(entry.teaching_load_id) === Number(load.id) && validEntryIds.has(Number(entry.id))
    )).length;
    return {
      teaching_load_id: Number(load.id),
      subject_name: load.subject_name || 'مادة غير معروفة',
      employee_name: load.employee_name || null,
      required_periods: Number(load.weekly_periods),
      scheduled_periods: scheduledPeriods,
      remaining_periods: Math.max(0, Number(load.weekly_periods) - scheduledPeriods),
    };
  });
  const progressByLoadId = new Map(loadProgress.map((item) => [item.teaching_load_id, item]));
  // Keep per-subject progress and teacher demand separate; section occupancy
  // counts one period only when both valid partners occupy it together.
  const sectionDemand = (loads: TimetableTeachingLoad[]) => countTimetableSectionPeriods(loads)
    + loads.filter(load => load.status !== 'active').reduce((sum, load) => sum + Number(load.weekly_periods), 0);
  const sectionScheduled = (loads: TimetableTeachingLoad[]) => {
    const seen = new Set<number>(); let total = 0;
    for (const load of loads) {
      if (seen.has(load.id)) continue;
      const group = parallelTimetableLoadGroup(load, loads);
      group.forEach(member => seen.add(member.id));
      total += Math.min(...group.map(member => progressByLoadId.get(member.id)?.scheduled_periods ?? 0));
    }
    return total;
  };

  const placements = input.placements.map<TimetableReadinessRow>((placement) => {
    const placementLoads = academicallyValidLoads.filter((load) => (
      load.class_id === placement.class_id && load.section_id === placement.section_id
    ));
    const applicableSubjects = input.subjects.filter((subject) => (
      subject.status === 'active'
      && subject.class_id === placement.class_id
      && (subject.section_id == null || subject.section_id === placement.section_id)
    ));
    const loadedSubjects = new Set(placementLoads.map((load) => load.subject_id));
    const excludedSubjects = new Set(excludedLoads.filter((load) => (
      load.class_id === placement.class_id && load.section_id === placement.section_id
    )).map((load) => load.subject_id));
    const missingSubjects = applicableSubjects
      .filter((subject) => !loadedSubjects.has(subject.id) && !excludedSubjects.has(subject.id))
      .map(({ id, name }) => ({ id, name }));
    const requiredPeriods = sectionDemand(placementLoads);
    const scheduledPeriods = sectionScheduled(placementLoads);
    const remainingPeriods = Math.max(0, requiredPeriods - scheduledPeriods);
    const difference = capacity.weeklyCapacity - requiredPeriods;
    const status = capacity.weeklyCapacity === 0
      ? 'empty_week'
      : difference < 0
        ? 'over_capacity'
        : difference === 0 ? 'exact' : 'unallocated';
    const placementMissingTeachers = placementLoads.filter((load) => (
      load.status === 'active' && load.employee_id == null
    )).map((load) => load.id);
    const placementInvalid = demandLoads.filter((load) => (
      invalidLoadIds.has(Number(load.id))
      && load.class_id === placement.class_id
      && load.section_id === placement.section_id
    )).map((load) => load.id);
    return {
      ...placement,
      available_capacity: capacity.weeklyCapacity,
      required_periods: requiredPeriods,
      scheduled_periods: scheduledPeriods,
      remaining_periods: remainingPeriods,
      difference,
      status,
      missing_subjects: missingSubjects,
      missing_teacher_load_ids: placementMissingTeachers,
      invalid_load_ids: placementInvalid,
      ready: capacity.weeklyCapacity > 0
        && difference >= 0
        && missingSubjects.length === 0
        && placementMissingTeachers.length === 0
        && placementInvalid.length === 0,
    };
  });

  const teacherWorkloads = [...teacherMap.values()].sort((a, b) => (
    b.total_weekly_periods - a.total_weekly_periods || a.employee_name.localeCompare(b.employee_name, 'ar')
  ));
  const teacherAvailabilitySummaries = teacherWorkloads.map((teacher) => calculateTeacherAvailabilitySummary({
    schoolId: academicallyValidLoads.find((load) => load.employee_id === teacher.employee_id)?.school_id || 0,
    academicYearId: academicallyValidLoads.find((load) => load.employee_id === teacher.employee_id)?.academic_year_id || 0,
    employeeId: teacher.employee_id,
    employeeName: teacher.employee_name,
    assignedWeeklyPeriods: teacher.total_weekly_periods,
    days: input.days,
    slots: input.slots,
    overrides: input.teacherAvailability || [],
    constraints: input.teacherConstraints?.find((constraint) => constraint.employee_id === teacher.employee_id),
  }));
  const teacherFeasibilityIssues = teacherAvailabilitySummaries.flatMap((summary) => (
    summary.blockers.map((blocker) => ({
      ...blocker,
      employee_id: summary.employee_id,
      employee_name: summary.employee_name,
    }))
  ));
  const totalScheduledPeriods = sectionScheduled(academicallyValidLoads);
  const totalUnscheduledPeriods = Math.max(0, sectionDemand(academicallyValidLoads) - totalScheduledPeriods);
  const foundationReady = placements.length > 0
    && capacity.weeklyCapacity > 0
    && invalidLoadIds.size === 0
    && teacherFeasibilityIssues.length === 0
    && entryIssues.length === 0
    && placements.every((placement) => placement.ready);
  return {
    weekly_capacity: capacity.weeklyCapacity,
    teaching_days: capacity.teachingDays,
    lesson_slots: capacity.lessonSlots,
    break_slots: capacity.breakSlots,
    total_required_periods: sectionDemand(academicallyValidLoads),
    total_assignments: demandLoads.length,
    active_teachers: teacherWorkloads.length,
    missing_teacher_count: missingTeacherLoads.length,
    invalid_reference_count: invalidLoadIds.size,
    invalid_load_details: invalidLoadDetails,
    archived_load_count: dormantLoadIds.size,
    archived_load_details: archivedLoadDetails,
    ready: foundationReady,
    schedule_ready: foundationReady && totalUnscheduledPeriods === 0,
    placements,
    teacher_workloads: teacherWorkloads,
    teacher_availability_summaries: teacherAvailabilitySummaries,
    teacher_feasibility_issues: teacherFeasibilityIssues,
    total_scheduled_periods: totalScheduledPeriods,
    total_unscheduled_periods: totalUnscheduledPeriods,
    hard_constraint_violation_count: entryIssues.length,
    load_progress: loadProgress,
    entry_issues: entryIssues,
    parallel_issues: parallelIssues,
  };
}

export function isTimetableConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timetable |UNIQUE constraint failed|CHECK constraint failed/i.test(message);
}
