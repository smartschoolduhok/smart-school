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
  created_at: number;
  updated_at: number;
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
  employee_type?: string | null;
  weekly_periods: number;
  status: TimetableLoadStatus;
  created_at: number;
  updated_at: number;
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
  placements: TimetableReadinessRow[];
  teacher_workloads: TimetableTeacherWorkload[];
}

function asPositiveInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : null;
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

export function calculateWeeklyCapacity(days: TimetableDay[], slots: TimetableSlot[]) {
  const activeDays = new Set(days.filter((day) => Number(day.is_active) === 1).map((day) => day.day_of_week));
  let lessonSlots = 0;
  let breakSlots = 0;
  for (const slot of slots) {
    if (!activeDays.has(slot.day_of_week)) continue;
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

function loadHasInvalidReference(load: TimetableTeachingLoad): boolean {
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
    || (load.section_id == null && load.subject_section_id != null)
    || (load.employee_id != null && (load.employee_status !== 'active' || load.employee_school_id !== load.school_id));
}

export function buildTimetableReadiness(input: {
  days: TimetableDay[];
  slots: TimetableSlot[];
  placements: TimetablePlacement[];
  subjects: TimetableSubjectOption[];
  loads: TimetableTeachingLoad[];
}): TimetableReadinessSummary {
  const capacity = calculateWeeklyCapacity(input.days, input.slots);
  const activeLoads = input.loads.filter((load) => load.status === 'active');
  const invalidLoadIds = new Set(activeLoads.filter(loadHasInvalidReference).map((load) => load.id));
  const validLoads = activeLoads.filter((load) => !invalidLoadIds.has(load.id));
  const missingTeacherLoads = validLoads.filter((load) => load.employee_id == null);
  const teacherMap = new Map<number, TimetableTeacherWorkload>();
  for (const load of validLoads) {
    if (load.employee_id == null) continue;
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

  const placements = input.placements.map<TimetableReadinessRow>((placement) => {
    const placementLoads = validLoads.filter((load) => (
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
  return {
    weekly_capacity: capacity.weeklyCapacity,
    teaching_days: capacity.teachingDays,
    lesson_slots: capacity.lessonSlots,
    break_slots: capacity.breakSlots,
    total_required_periods: validLoads.reduce((sum, load) => sum + Number(load.weekly_periods), 0),
    total_assignments: activeLoads.length,
    active_teachers: teacherWorkloads.length,
    missing_teacher_count: missingTeacherLoads.length,
    invalid_reference_count: invalidLoadIds.size,
    ready: placements.length > 0
      && capacity.weeklyCapacity > 0
      && invalidLoadIds.size === 0
      && placements.every((placement) => placement.ready),
    placements,
    teacher_workloads: teacherWorkloads,
  };
}

export function isTimetableConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timetable |UNIQUE constraint failed|CHECK constraint failed/i.test(message);
}
