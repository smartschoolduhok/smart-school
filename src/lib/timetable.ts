export const TIMETABLE_DAY_NAMES = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

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

export interface TimetableGridEntry extends TimetableEntry {
  subject_name: string;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
  employee_id: number | null;
  employee_name: string | null;
  weekly_periods: number;
  load_status: TimetableLoadStatus;
  warnings: TimetableEntryNotice[];
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
  class_id: number;
  section_id: number | null;
  days: TimetableDay[];
  slots: TimetableSlot[];
  entries: TimetableGridEntry[];
  loads: Array<TimetableTeachingLoad & {
    scheduled_periods: number;
    remaining_periods: number;
  }>;
}

export interface TimetablePlacement {
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
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
    return { ok: false as const, error: 'رقم الحصة مطلوب لفترة الدرس' };
  }
  if (slotType === 'break' && lessonNumber != null) {
    return { ok: false as const, error: 'فترة الاستراحة لا تقبل رقم حصة' };
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
  if (academicYearId == null) return { ok: false as const, error: 'السنة الدراسية مطلوبة' };
  if (classId == null) return { ok: false as const, error: 'الصف مطلوب' };
  if (input.section_id != null && input.section_id !== '' && sectionId == null) return { ok: false as const, error: 'الشعبة غير صالحة' };
  if (subjectId == null) return { ok: false as const, error: 'المادة مطلوبة' };
  if (input.employee_id != null && input.employee_id !== '' && employeeId == null) return { ok: false as const, error: 'الموظف غير صالح' };
  if (weeklyPeriods == null) return { ok: false as const, error: 'عدد الحصص الأسبوعية يجب أن يكون عددًا صحيحًا موجبًا' };
  return { ok: true as const, value: { academicYearId, classId, sectionId, subjectId, employeeId, weeklyPeriods } };
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
  if (maxPeriodsPerDay === undefined) return { ok: false as const, error: 'الحد الأقصى للحصص يوميًا يجب أن يكون عددًا موجبًا' };
  if (maxConsecutivePeriods === undefined) return { ok: false as const, error: 'الحد الأقصى للحصص المتتالية يجب أن يكون عددًا موجبًا' };
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
      message: `لا يملك المدرس ${input.employeeName} أي حصة متاحة ضمن الأسبوع النشط.`,
    });
  } else if (input.assignedWeeklyPeriods > hardWeeklyCapacity) {
    blockers.push({
      code: 'teacher_load_exceeds_availability',
      message: `نصاب المدرس ${input.employeeName} هو ${input.assignedWeeklyPeriods} حصة، بينما سعته المتاحة وفق القيود هي ${hardWeeklyCapacity} حصة فقط.`,
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

function entryNotice(
  code: TimetableEntryHardConflictCode | TimetableEntryWarningCode,
  message: string,
): TimetableEntryNotice {
  return { code, message };
}

function sortDaySlots(slots: TimetableSlot[]) {
  return [...slots].sort((left, right) => (
    left.start_time.localeCompare(right.start_time)
    || left.slot_index - right.slot_index
    || left.id - right.id
  ));
}

export function evaluateTimetableEntryPlacement(input: {
  candidate: { id?: number | null; slot_id: number; teaching_load_id: number };
  days: TimetableDay[];
  slots: TimetableSlot[];
  loads: TimetableTeachingLoad[];
  entries: TimetableEntry[];
  teacherAvailability?: TimetableTeacherAvailabilityOverride[];
  teacherConstraints?: TimetableTeacherConstraints[];
}): { hard_conflicts: TimetableEntryNotice[]; warnings: TimetableEntryNotice[] } {
  const hardConflicts: TimetableEntryNotice[] = [];
  const warnings: TimetableEntryNotice[] = [];
  const candidateId = input.candidate.id == null ? null : Number(input.candidate.id);
  const slot = input.slots.find((item) => Number(item.id) === Number(input.candidate.slot_id));
  const load = input.loads.find((item) => Number(item.id) === Number(input.candidate.teaching_load_id));
  const day = slot && input.days.find((item) => (
    Number(item.school_id) === Number(slot.school_id)
    && Number(item.academic_year_id) === Number(slot.academic_year_id)
    && Number(item.day_of_week) === Number(slot.day_of_week)
  ));
  if (!slot || !day || slot.slot_type !== 'lesson') {
    hardConflicts.push(entryNotice('slot_not_schedulable', 'الفترة المحددة ليست حصة فعالة قابلة للجدولة'));
  } else {
    if (Number(day.is_active) !== 1) {
      hardConflicts.push(entryNotice('inactive_day', 'اليوم المحدد غير فعال ولا يقبل حصصًا جديدة'));
    }
    if (Number(slot.is_active) !== 1) {
      hardConflicts.push(entryNotice('inactive_slot', 'الفترة المحددة غير فعالة ولا تقبل حصصًا جديدة'));
    }
  }
  if (!load || load.status !== 'active' || loadHasInvalidAcademicReference(load) || loadHasInvalidTeacherReference(load)) {
    hardConflicts.push(entryNotice('invalid_teaching_load', 'نصاب المادة غير فعال أو يحتوي على مرجع غير صالح'));
  }
  if (!slot || !load) return { hard_conflicts: hardConflicts, warnings };
  if (Number(slot.school_id) !== Number(load.school_id)) {
    hardConflicts.push(entryNotice('invalid_tenant_scope', 'الفترة ونصاب المادة لا ينتميان إلى المدرسة نفسها'));
  }
  if (Number(slot.academic_year_id) !== Number(load.academic_year_id)) {
    hardConflicts.push(entryNotice('invalid_academic_year', 'الفترة ونصاب المادة لا ينتميان إلى السنة الدراسية نفسها'));
  }

  const otherEntries = input.entries.filter((entry) => candidateId == null || Number(entry.id) !== candidateId);
  const activeDayNumbers = new Set(input.days.filter((item) => Number(item.is_active) === 1).map((item) => Number(item.day_of_week)));
  const activeLessonSlotIds = new Set(input.slots.filter((item) => (
    item.slot_type === 'lesson'
    && Number(item.is_active) === 1
    && activeDayNumbers.has(Number(item.day_of_week))
  )).map((item) => Number(item.id)));
  const activeEntries = otherEntries.filter((entry) => activeLessonSlotIds.has(Number(entry.slot_id)));
  const scheduledForLoad = activeEntries.filter((entry) => (
    Number(entry.teaching_load_id) === Number(load.id)
  )).length;
  if (scheduledForLoad >= Number(load.weekly_periods)) {
    hardConflicts.push(entryNotice('weekly_periods_exceeded', 'اكتمل عدد الحصص الأسبوعية المطلوبة لهذا النصاب'));
  }

  const loadById = new Map(input.loads.map((item) => [Number(item.id), item]));
  const sameSlotEntries = otherEntries.filter((entry) => Number(entry.slot_id) === Number(slot.id));
  const groupCollision = sameSlotEntries.some((entry) => {
    const existingLoad = loadById.get(Number(entry.teaching_load_id));
    return existingLoad != null
      && Number(existingLoad.class_id) === Number(load.class_id)
      && (existingLoad.section_id == null
        || load.section_id == null
        || Number(existingLoad.section_id) === Number(load.section_id));
  });
  if (groupCollision) {
    hardConflicts.push(entryNotice('class_section_collision', 'توجد حصة أخرى للصف أو الشعبة في هذه الفترة'));
  }

  if (load.employee_id != null) {
    const teacherEntries = otherEntries.filter((entry) => {
      const existingLoad = loadById.get(Number(entry.teaching_load_id));
      return existingLoad?.employee_id != null
        && Number(existingLoad.employee_id) === Number(load.employee_id);
    });
    if (teacherEntries.some((entry) => Number(entry.slot_id) === Number(slot.id))) {
      hardConflicts.push(entryNotice('teacher_collision', 'المدرس مرتبط بحصة أخرى في الفترة نفسها'));
    }

    const availability = input.teacherAvailability?.find((override) => (
      Number(override.employee_id) === Number(load.employee_id)
      && Number(override.slot_id) === Number(slot.id)
    ));
    if (availability?.status === 'unavailable') {
      hardConflicts.push(entryNotice('teacher_unavailable', 'المدرس غير متاح في هذه الفترة'));
    }

    const constraints = input.teacherConstraints?.find((item) => (
      Number(item.employee_id) === Number(load.employee_id)
    ));
    const activeTeacherEntries = teacherEntries.filter((entry) => activeLessonSlotIds.has(Number(entry.slot_id)));
    const teacherEntriesForDay = activeTeacherEntries.filter((entry) => {
      const entrySlot = input.slots.find((item) => Number(item.id) === Number(entry.slot_id));
      return entrySlot != null && Number(entrySlot.day_of_week) === Number(slot.day_of_week);
    });
    if (constraints?.max_periods_per_day != null
      && teacherEntriesForDay.length + 1 > Number(constraints.max_periods_per_day)) {
      hardConflicts.push(entryNotice('teacher_max_periods_per_day', 'تجاوز المدرس الحد الأقصى للحصص اليومية'));
    }

    const teacherWorkingDays = new Set<number>();
    for (const entry of activeTeacherEntries) {
      const entrySlot = input.slots.find((item) => Number(item.id) === Number(entry.slot_id));
      if (entrySlot) teacherWorkingDays.add(Number(entrySlot.day_of_week));
    }
    const addsWorkingDay = !teacherWorkingDays.has(Number(slot.day_of_week));
    if (constraints?.max_working_days != null
      && addsWorkingDay
      && teacherWorkingDays.size >= Number(constraints.max_working_days)) {
      hardConflicts.push(entryNotice('teacher_max_working_days', 'تجاوز المدرس الحد الأقصى لأيام العمل الأسبوعية'));
    }

    const orderedSlots = sortDaySlots(input.slots.filter((item) => (
      Number(item.day_of_week) === Number(slot.day_of_week)
      && Number(item.school_id) === Number(slot.school_id)
      && Number(item.academic_year_id) === Number(slot.academic_year_id)
      && Number(item.is_active) === 1
    )));
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
      hardConflicts.push(entryNotice('teacher_max_consecutive_periods', 'تجاوز المدرس الحد الأقصى للحصص المتتالية'));
    }

    if (availability?.status === 'avoid') {
      warnings.push(entryNotice('avoid_slot', 'المدرس يفضل تجنب هذه الفترة'));
    }
    if (availability?.status === 'preferred') {
      warnings.push(entryNotice('preferred_slot', 'هذا الوقت مفضل للمدرس'));
    }
    const preferredOverrides = (input.teacherAvailability || []).filter((override) => (
      Number(override.employee_id) === Number(load.employee_id) && override.status === 'preferred'
    ));
    if (preferredOverrides.length > 0 && availability?.status !== 'preferred') {
      warnings.push(entryNotice('outside_preferred_slots', 'هذه الفترة ليست ضمن الفترات المفضلة للمدرس'));
    }
    const lessonSlots = orderedSlots.filter((item) => item.slot_type === 'lesson');
    if (constraints?.avoid_first_period === 1 && Number(lessonSlots[0]?.id) === Number(slot.id)) {
      warnings.push(entryNotice('first_period_preference', 'يفضل المدرس تجنب الحصة الأولى'));
    }
    if (constraints?.avoid_last_period === 1 && Number(lessonSlots[lessonSlots.length - 1]?.id) === Number(slot.id)) {
      warnings.push(entryNotice('last_period_preference', 'يفضل المدرس تجنب الحصة الأخيرة'));
    }
    if (constraints?.prefer_compact_schedule === 1 && teacherEntriesForDay.length > 0) {
      const candidatePosition = orderedSlots.findIndex((item) => Number(item.id) === Number(slot.id));
      const compact = teacherEntriesForDay.some((entry) => {
        const existingPosition = orderedSlots.findIndex((item) => Number(item.id) === Number(entry.slot_id));
        return existingPosition >= 0 && Math.abs(existingPosition - candidatePosition) === 1;
      });
      if (!compact) warnings.push(entryNotice('non_compact_schedule', 'هذه الحصة لا تحقق تفضيل تجميع حصص المدرس'));
    }
  }

  return { hard_conflicts: hardConflicts, warnings };
}

export function buildTimetableReadiness(input: {
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
  const activeLoads = input.loads.filter((load) => load.status === 'active');
  const invalidAcademicLoadIds = new Set(activeLoads.filter(loadHasInvalidAcademicReference).map((load) => load.id));
  const invalidTeacherLoadIds = new Set(activeLoads.filter(loadHasInvalidTeacherReference).map((load) => load.id));
  const invalidLoadIds = new Set([...invalidAcademicLoadIds, ...invalidTeacherLoadIds]);
  const academicallyValidLoads = activeLoads.filter((load) => !invalidAcademicLoadIds.has(load.id));
  const missingTeacherLoads = academicallyValidLoads.filter((load) => load.employee_id == null);
  const teacherMap = new Map<number, TimetableTeacherWorkload>();
  for (const load of academicallyValidLoads) {
    if (load.employee_id == null || invalidTeacherLoadIds.has(load.id)) continue;
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

  const entries = input.entries || [];
  const entryIssues: TimetableEntryIssue[] = [];
  const validEntryIds = new Set<number>();
  for (const entry of entries) {
    const evaluation = evaluateTimetableEntryPlacement({
      candidate: {
        id: entry.id,
        slot_id: entry.slot_id,
        teaching_load_id: entry.teaching_load_id,
      },
      days: input.days,
      slots: input.slots,
      loads: input.loads,
      entries,
      teacherAvailability: input.teacherAvailability,
      teacherConstraints: input.teacherConstraints,
    });
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
    const missingSubjects = applicableSubjects
      .filter((subject) => !loadedSubjects.has(subject.id))
      .map(({ id, name }) => ({ id, name }));
    const requiredPeriods = placementLoads.reduce((sum, load) => sum + Number(load.weekly_periods), 0);
    const scheduledPeriods = placementLoads.reduce((sum, load) => (
      sum + (progressByLoadId.get(Number(load.id))?.scheduled_periods || 0)
    ), 0);
    const remainingPeriods = placementLoads.reduce((sum, load) => (
      sum + (progressByLoadId.get(Number(load.id))?.remaining_periods || 0)
    ), 0);
    const difference = capacity.weeklyCapacity - requiredPeriods;
    const status = capacity.weeklyCapacity === 0
      ? 'empty_week'
      : difference < 0
        ? 'over_capacity'
        : difference === 0 ? 'exact' : 'unallocated';
    const placementMissingTeachers = placementLoads.filter((load) => load.employee_id == null).map((load) => load.id);
    const placementInvalid = activeLoads.filter((load) => (
      invalidLoadIds.has(load.id)
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
  const totalScheduledPeriods = loadProgress.reduce((sum, item) => sum + item.scheduled_periods, 0);
  const totalUnscheduledPeriods = loadProgress.reduce((sum, item) => sum + item.remaining_periods, 0);
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
    total_required_periods: academicallyValidLoads.reduce((sum, load) => sum + Number(load.weekly_periods), 0),
    total_assignments: activeLoads.length,
    active_teachers: teacherWorkloads.length,
    missing_teacher_count: missingTeacherLoads.length,
    invalid_reference_count: invalidLoadIds.size,
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
  };
}

export function isTimetableConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timetable |UNIQUE constraint failed|CHECK constraint failed/i.test(message);
}
