import {
  calculateTeacherAvailabilitySummary,
  evaluateTimetableEntryPlacement,
  loadHasInvalidAcademicReference,
  loadHasInvalidTeacherReference,
  type TimetableDay,
  type TimetableEntry,
  type TimetableEntryNotice,
  type TimetablePlacement,
  type TimetableSlot,
  type TimetableTeacherAvailabilityOverride,
  type TimetableTeacherConstraints,
  type TimetableTeachingLoad,
} from './timetable.ts';

export type TimetableSolverStatus = 'complete' | 'partial' | 'impossible';

export type TimetableSolverReasonCode =
  | 'no_class_capacity'
  | 'teacher_unavailable'
  | 'teacher_daily_limit'
  | 'teacher_working_days_limit'
  | 'teacher_consecutive_limit'
  | 'teacher_collision'
  | 'insufficient_slot_domain'
  | 'search_budget_exhausted'
  | 'invalid_teaching_load';

export interface TimetableSolverFeasibilityBlocker {
  code:
    | 'no_active_days'
    | 'no_active_lesson_slots'
    | 'invalid_teaching_load'
    | 'class_capacity_exceeded'
    | 'teacher_capacity_exceeded';
  message: string;
  class_id?: number;
  section_id?: number | null;
  employee_id?: number;
  teaching_load_id?: number;
}

export interface TimetableSolverReadiness {
  total_required_periods: number;
  total_schedulable_capacity: number;
  missing_teacher_count: number;
  invalid_load_count: number;
  overloaded_class_sections: Array<{
    class_id: number;
    class_name: string;
    section_id: number | null;
    section_name: string | null;
    required_periods: number;
    available_capacity: number;
  }>;
  overloaded_teachers: Array<{
    employee_id: number;
    employee_name: string;
    required_periods: number;
    available_capacity: number;
  }>;
  hard_feasibility_blockers: TimetableSolverFeasibilityBlocker[];
}

export interface TimetableSolverPenaltyBreakdown {
  avoid_slots: number;
  outside_preferred_slots: number;
  teacher_gaps: number;
  first_period_preferences: number;
  last_period_preferences: number;
  subject_clustering: number;
  consecutive_same_subject: number;
  class_daily_imbalance: number;
}

export interface TimetableSolverScoring {
  model: 'comparative-v1';
  total_penalty: number;
  maximum_reference_penalty: number;
  penalties: TimetableSolverPenaltyBreakdown;
  preferred_slots_used: number;
  note: string;
}

export interface TimetableSolverProposalEntry {
  proposal_id: string;
  slot_id: number;
  teaching_load_id: number;
  subject_id: number;
  subject_name: string;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
  employee_id: number | null;
  employee_name: string | null;
  day_of_week: number;
  lesson_number: number | null;
  start_time: string;
  end_time: string;
  soft_warnings: TimetableEntryNotice[];
  score_contribution: number;
}

export interface TimetableSolverUnscheduledDemand {
  teaching_load_id: number;
  subject_id: number;
  subject_name: string;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string | null;
  employee_id: number | null;
  employee_name: string | null;
  remaining_count: number;
  reason_codes: TimetableSolverReasonCode[];
  reasons: string[];
}

export interface TimetableSolverStatistics {
  attempts: number;
  backtracks: number;
  local_improvement_attempts: number;
  elapsed_ms: number;
  time_budget_ms: number;
  attempt_budget: number;
  backtrack_budget: number;
  stopped_by_limit: boolean;
  current_valid_entry_count: number;
  existing_invalid_entry_count: number;
  active_day_count: number;
  active_lesson_slot_count: number;
}

export interface TimetableSolverPreview {
  status: TimetableSolverStatus;
  quality_score: number;
  required_periods: number;
  scheduled_periods: number;
  unscheduled_periods: number;
  entries: TimetableSolverProposalEntry[];
  unscheduled: TimetableSolverUnscheduledDemand[];
  warnings: string[];
  scoring: TimetableSolverScoring;
  statistics: TimetableSolverStatistics;
  readiness: TimetableSolverReadiness;
  days: TimetableDay[];
  slots: TimetableSlot[];
  placements: TimetablePlacement[];
}

export interface TimetableSolverLimits {
  time_budget_ms: number;
  max_attempts: number;
  max_backtracks: number;
  max_local_improvement_attempts: number;
}

export interface TimetableSolverInput {
  schoolId: number;
  academicYearId: number;
  days: TimetableDay[];
  slots: TimetableSlot[];
  placements: TimetablePlacement[];
  loads: TimetableTeachingLoad[];
  currentEntries?: TimetableEntry[];
  teacherAvailability?: TimetableTeacherAvailabilityOverride[];
  teacherConstraints?: TimetableTeacherConstraints[];
  limits?: Partial<TimetableSolverLimits>;
}

const DEFAULT_LIMITS: TimetableSolverLimits = {
  time_budget_ms: 2_000,
  max_attempts: 60_000,
  max_backtracks: 5_000,
  max_local_improvement_attempts: 250,
};

const REASON_MESSAGES: Record<TimetableSolverReasonCode, string> = {
  no_class_capacity: 'لا توجد سعة متبقية للصف أو الشعبة ضمن الفترات الصالحة.',
  teacher_unavailable: 'لا توجد فترات متاحة للمدرس ضمن القيود الحالية.',
  teacher_daily_limit: 'الحد الأقصى اليومي لحصص المدرس يمنع توزيع الحصص المتبقية.',
  teacher_working_days_limit: 'الحد الأقصى لأيام عمل المدرس يمنع توزيع الحصص المتبقية.',
  teacher_consecutive_limit: 'حد الحصص المتتالية للمدرس يمنع توزيع الحصص المتبقية.',
  teacher_collision: 'المدرس مرتبط بحصص أخرى في الفترات المتبقية.',
  insufficient_slot_domain: 'لا توجد مجموعة فترات كافية تحقق جميع القيود الصلبة.',
  search_budget_exhausted: 'توقّف البحث عند ميزانيته الخوارزمية قبل إثبات سبب رياضي نهائي لهذه الحصص.',
  invalid_teaching_load: 'نصاب المادة غير فعال أو يحتوي على مرجع أكاديمي أو مدرّس غير صالح.',
};

const REASON_ORDER: TimetableSolverReasonCode[] = [
  'invalid_teaching_load',
  'no_class_capacity',
  'teacher_unavailable',
  'teacher_daily_limit',
  'teacher_working_days_limit',
  'teacher_consecutive_limit',
  'teacher_collision',
  'search_budget_exhausted',
  'insufficient_slot_domain',
];

export class TimetableSolverSafetyLimitError extends Error {
  constructor() {
    super('Timetable solver exceeded its emergency wall-clock safety limit');
    this.name = 'TimetableSolverSafetyLimitError';
  }
}

type InternalEntry = TimetableEntry;

interface RankedCandidate {
  slot: TimetableSlot;
  warnings: TimetableEntryNotice[];
  penalty: number;
}

function sameNullableId(left: number | null | undefined, right: number | null | undefined): boolean {
  return left == null ? right == null : right != null && Number(left) === Number(right);
}

function activeTimetableDays(days: TimetableDay[]): TimetableDay[] {
  return [...days]
    .filter((day) => Number(day.is_active) === 1)
    .sort((left, right) => left.order_index - right.order_index || left.day_of_week - right.day_of_week || left.id - right.id);
}

function schedulableTimetableSlots(days: TimetableDay[], slots: TimetableSlot[]): TimetableSlot[] {
  const dayNumbers = new Set(activeTimetableDays(days).map((day) => Number(day.day_of_week)));
  return [...slots]
    .filter((slot) => (
      Number(slot.is_active) === 1
      && slot.slot_type === 'lesson'
      && dayNumbers.has(Number(slot.day_of_week))
    ))
    .sort((left, right) => (
      left.day_of_week - right.day_of_week
      || left.start_time.localeCompare(right.start_time)
      || left.slot_index - right.slot_index
      || left.id - right.id
    ));
}

function loadIsValid(load: TimetableTeachingLoad, schoolId?: number, academicYearId?: number): boolean {
  return load.status === 'active'
    && (schoolId == null || Number(load.school_id) === Number(schoolId))
    && (academicYearId == null || Number(load.academic_year_id) === Number(academicYearId))
    && !loadHasInvalidAcademicReference(load)
    && !loadHasInvalidTeacherReference(load);
}

function loadMatchesPlacement(load: TimetableTeachingLoad, placement: TimetablePlacement): boolean {
  return Number(load.class_id) === Number(placement.class_id)
    && (load.section_id == null || sameNullableId(load.section_id, placement.section_id));
}

function loadLabel(load: TimetableTeachingLoad): string {
  return `${load.class_name || 'صف غير معروف'}${load.section_name ? ` / ${load.section_name}` : ''}`;
}

interface TeacherHardCapacity {
  capacity: number;
  limitingReasons: TimetableSolverReasonCode[];
}

function calculateTeacherHardCapacity(input: {
  employeeId: number;
  activeDays: TimetableDay[];
  scopedSlots: TimetableSlot[];
  availability: TimetableTeacherAvailabilityOverride[];
  constraints?: TimetableTeacherConstraints;
}): TeacherHardCapacity {
  const unavailableSlotIds = new Set(input.availability
    .filter((item) => Number(item.employee_id) === input.employeeId && item.status === 'unavailable')
    .map((item) => Number(item.slot_id)));
  const activeDayNumbers = new Set(input.activeDays.map((day) => Number(day.day_of_week)));
  const activeSlotsByDay = new Map<number, TimetableSlot[]>();
  for (const slot of input.scopedSlots) {
    if (Number(slot.is_active) !== 1 || !activeDayNumbers.has(Number(slot.day_of_week))) continue;
    const current = activeSlotsByDay.get(Number(slot.day_of_week)) || [];
    current.push(slot);
    activeSlotsByDay.set(Number(slot.day_of_week), current);
  }

  let anyAvailableLesson = false;
  let consecutiveLimited = false;
  let dailyLimited = false;
  const dailyCapacities: number[] = [];
  for (const day of input.activeDays) {
    const orderedSlots = [...(activeSlotsByDay.get(Number(day.day_of_week)) || [])]
      .sort((left, right) => left.start_time.localeCompare(right.start_time) || left.slot_index - right.slot_index || left.id - right.id);
    const availableLessonCount = orderedSlots.filter((slot) => (
      slot.slot_type === 'lesson' && !unavailableSlotIds.has(Number(slot.id))
    )).length;
    if (availableLessonCount > 0) anyAvailableLesson = true;

    let capacityBeforeDailyLimit = availableLessonCount;
    const maximumConsecutive = input.constraints?.max_consecutive_periods;
    if (maximumConsecutive != null) {
      const runLimit = Number(maximumConsecutive);
      let states = new Map<number, number>([[0, 0]]);
      for (const slot of orderedSlots) {
        const next = new Map<number, number>();
        const selectable = slot.slot_type === 'lesson' && !unavailableSlotIds.has(Number(slot.id));
        for (const [run, selected] of states) {
          next.set(0, Math.max(next.get(0) ?? -1, selected));
          if (selectable && run < runLimit) {
            next.set(run + 1, Math.max(next.get(run + 1) ?? -1, selected + 1));
          }
        }
        states = next;
      }
      capacityBeforeDailyLimit = Math.max(0, ...states.values());
      if (capacityBeforeDailyLimit < availableLessonCount) consecutiveLimited = true;
    }

    const maximumDaily = input.constraints?.max_periods_per_day;
    const dailyCapacity = maximumDaily == null
      ? capacityBeforeDailyLimit
      : Math.min(capacityBeforeDailyLimit, Number(maximumDaily));
    if (dailyCapacity < capacityBeforeDailyLimit) dailyLimited = true;
    dailyCapacities.push(dailyCapacity);
  }

  dailyCapacities.sort((left, right) => right - left);
  const maximumWorkingDays = input.constraints?.max_working_days;
  const selectedDailyCapacities = maximumWorkingDays == null
    ? dailyCapacities
    : dailyCapacities.slice(0, Number(maximumWorkingDays));
  const workingDaysLimited = selectedDailyCapacities.length < dailyCapacities.length
    && dailyCapacities.slice(selectedDailyCapacities.length).some((capacity) => capacity > 0);
  const limitingReasons: TimetableSolverReasonCode[] = [];
  if (!anyAvailableLesson) limitingReasons.push('teacher_unavailable');
  if (dailyLimited) limitingReasons.push('teacher_daily_limit');
  if (workingDaysLimited) limitingReasons.push('teacher_working_days_limit');
  if (consecutiveLimited) limitingReasons.push('teacher_consecutive_limit');
  return {
    capacity: selectedDailyCapacities.reduce((sum, capacity) => sum + capacity, 0),
    limitingReasons,
  };
}

function buildSolverReadiness(
  input: TimetableSolverInput,
  activeDays: TimetableDay[],
  scheduleSlots: TimetableSlot[],
  activeLoads: TimetableTeachingLoad[],
  validLoads: TimetableTeachingLoad[],
  availability: TimetableTeacherAvailabilityOverride[],
  constraints: TimetableTeacherConstraints[],
  safetyCheck?: () => void,
): TimetableSolverReadiness {
  const invalidLoads = activeLoads.filter((load) => !loadIsValid(load, input.schoolId, input.academicYearId));
  const blockers: TimetableSolverFeasibilityBlocker[] = [];
  if (activeDays.length === 0) {
    blockers.push({ code: 'no_active_days', message: 'لا توجد أيام دوام فعالة يمكن بناء الجدول عليها.' });
  }
  if (scheduleSlots.length === 0) {
    blockers.push({ code: 'no_active_lesson_slots', message: 'لا توجد حصص فعالة قابلة للجدولة.' });
  }
  for (const load of invalidLoads) {
    safetyCheck?.();
    blockers.push({
      code: 'invalid_teaching_load',
      teaching_load_id: Number(load.id),
      message: `${load.subject_name || 'مادة غير معروفة'} — ${loadLabel(load)}: النصاب يحتوي على مرجع غير صالح.`,
    });
  }

  const overloadedClassSections = input.placements.flatMap((placement) => {
    safetyCheck?.();
    const requiredPeriods = validLoads
      .filter((load) => loadMatchesPlacement(load, placement))
      .reduce((sum, load) => sum + Number(load.weekly_periods), 0);
    if (requiredPeriods <= scheduleSlots.length) return [];
    const item = {
      class_id: Number(placement.class_id),
      class_name: placement.class_name,
      section_id: placement.section_id == null ? null : Number(placement.section_id),
      section_name: placement.section_name,
      required_periods: requiredPeriods,
      available_capacity: scheduleSlots.length,
    };
    blockers.push({
      code: 'class_capacity_exceeded',
      class_id: item.class_id,
      section_id: item.section_id,
      message: `${item.class_name}${item.section_name ? ` / ${item.section_name}` : ''} يحتاج ${requiredPeriods} حصة بينما السعة المتاحة ${scheduleSlots.length}.`,
    });
    return [item];
  });

  const teacherLoads = new Map<number, TimetableTeachingLoad[]>();
  for (const load of validLoads) {
    safetyCheck?.();
    if (load.employee_id == null) continue;
    const current = teacherLoads.get(Number(load.employee_id)) || [];
    current.push(load);
    teacherLoads.set(Number(load.employee_id), current);
  }
  const overloadedTeachers = [...teacherLoads.entries()].flatMap(([employeeId, loads]) => {
    safetyCheck?.();
    const requiredPeriods = loads.reduce((sum, load) => sum + Number(load.weekly_periods), 0);
    const representative = loads[0];
    const summary = calculateTeacherAvailabilitySummary({
      schoolId: input.schoolId,
      academicYearId: input.academicYearId,
      employeeId,
      employeeName: representative.employee_name || 'مدرس غير معروف',
      assignedWeeklyPeriods: requiredPeriods,
      days: input.days,
      slots: input.slots,
      overrides: availability,
      constraints: constraints.find((item) => Number(item.employee_id) === employeeId),
    });
    const exactCapacity = calculateTeacherHardCapacity({
      employeeId,
      activeDays,
      scopedSlots: input.slots.filter((slot) => (
        Number(slot.school_id) === input.schoolId && Number(slot.academic_year_id) === input.academicYearId
      )),
      availability,
      constraints: constraints.find((item) => Number(item.employee_id) === employeeId),
    });
    const availableCapacity = Math.min(summary.hard_weekly_capacity, exactCapacity.capacity);
    if (requiredPeriods <= availableCapacity) return [];
    const item = {
      employee_id: employeeId,
      employee_name: representative.employee_name || 'مدرس غير معروف',
      required_periods: requiredPeriods,
      available_capacity: availableCapacity,
    };
    blockers.push({
      code: 'teacher_capacity_exceeded',
      employee_id: employeeId,
      message: `المدرس ${item.employee_name} لديه ${requiredPeriods} حصة مطلوبة ولكن قيوده تسمح بـ${item.available_capacity} فقط.`,
    });
    return [item];
  });

  return {
    total_required_periods: activeLoads.reduce((sum, load) => sum + Number(load.weekly_periods), 0),
    total_schedulable_capacity: input.placements.length * scheduleSlots.length,
    missing_teacher_count: validLoads.filter((load) => load.employee_id == null).length,
    invalid_load_count: invalidLoads.length,
    overloaded_class_sections: overloadedClassSections,
    overloaded_teachers: overloadedTeachers,
    hard_feasibility_blockers: blockers,
  };
}

function warningPenalty(warnings: TimetableEntryNotice[]): number {
  return warnings.reduce((sum, warning) => {
    if (warning.code === 'preferred_slot') return sum - 5;
    if (warning.code === 'avoid_slot') return sum + 10;
    if (warning.code === 'outside_preferred_slots') return sum + 4;
    if (warning.code === 'first_period_preference' || warning.code === 'last_period_preference') return sum + 3;
    if (warning.code === 'non_compact_schedule') return sum + 3;
    return sum;
  }, 0);
}

function candidatePenalty(
  load: TimetableTeachingLoad,
  slot: TimetableSlot,
  entries: InternalEntry[],
  loadsById: Map<number, TimetableTeachingLoad>,
  slotsById: Map<number, TimetableSlot>,
  warnings: TimetableEntryNotice[],
): number {
  const sameDayEntries = entries.filter((entry) => Number(slotsById.get(Number(entry.slot_id))?.day_of_week) === Number(slot.day_of_week));
  const sameLoadDayCount = sameDayEntries.filter((entry) => Number(entry.teaching_load_id) === Number(load.id)).length;
  const samePlacementDayCount = sameDayEntries.filter((entry) => {
    const otherLoad = loadsById.get(Number(entry.teaching_load_id));
    return otherLoad != null
      && Number(otherLoad.class_id) === Number(load.class_id)
      && sameNullableId(otherLoad.section_id, load.section_id);
  }).length;
  let penalty = warningPenalty(warnings) + sameLoadDayCount * 7 + samePlacementDayCount;

  const orderedDaySlots = [...slotsById.values()]
    .filter((item) => Number(item.day_of_week) === Number(slot.day_of_week) && item.slot_type === 'lesson' && Number(item.is_active) === 1)
    .sort((left, right) => left.start_time.localeCompare(right.start_time) || left.slot_index - right.slot_index || left.id - right.id);
  const candidatePosition = orderedDaySlots.findIndex((item) => Number(item.id) === Number(slot.id));
  const sameLoadPositions = sameDayEntries
    .filter((entry) => Number(entry.teaching_load_id) === Number(load.id))
    .map((entry) => orderedDaySlots.findIndex((item) => Number(item.id) === Number(entry.slot_id)))
    .filter((position) => position >= 0);
  if (sameLoadPositions.some((position) => Math.abs(position - candidatePosition) === 1)) penalty += 5;
  return penalty;
}

function emptyPenaltyBreakdown(): TimetableSolverPenaltyBreakdown {
  return {
    avoid_slots: 0,
    outside_preferred_slots: 0,
    teacher_gaps: 0,
    first_period_preferences: 0,
    last_period_preferences: 0,
    subject_clustering: 0,
    consecutive_same_subject: 0,
    class_daily_imbalance: 0,
  };
}

function scoreProposal(input: {
  entries: InternalEntry[];
  loads: TimetableTeachingLoad[];
  slots: TimetableSlot[];
  days: TimetableDay[];
  availability: TimetableTeacherAvailabilityOverride[];
  constraints: TimetableTeacherConstraints[];
}, safetyCheck?: () => void): { qualityScore: number; scoring: TimetableSolverScoring } {
  const penalties = emptyPenaltyBreakdown();
  const loadsById = new Map(input.loads.map((load) => [Number(load.id), load]));
  const slotsById = new Map(input.slots.map((slot) => [Number(slot.id), slot]));
  const availabilityByTeacherSlot = new Map(input.availability.map((item) => [`${Number(item.employee_id)}:${Number(item.slot_id)}`, item.status]));
  const constraintsByTeacher = new Map(input.constraints.map((item) => [Number(item.employee_id), item]));
  const activeDays = activeTimetableDays(input.days);
  const activeDayNumbers = activeDays.map((day) => Number(day.day_of_week));
  let preferredSlotsUsed = 0;

  for (const entry of input.entries) {
    safetyCheck?.();
    const load = loadsById.get(Number(entry.teaching_load_id));
    const slot = slotsById.get(Number(entry.slot_id));
    if (!load || !slot || load.employee_id == null) continue;
    const status = availabilityByTeacherSlot.get(`${Number(load.employee_id)}:${Number(slot.id)}`);
    const preferredExists = input.availability.some((item) => (
      Number(item.employee_id) === Number(load.employee_id) && item.status === 'preferred'
    ));
    if (status === 'avoid') penalties.avoid_slots += 5;
    if (status === 'preferred') preferredSlotsUsed += 1;
    else if (preferredExists) penalties.outside_preferred_slots += 2;
    const daySlots = input.slots
      .filter((item) => Number(item.day_of_week) === Number(slot.day_of_week) && item.slot_type === 'lesson' && Number(item.is_active) === 1)
      .sort((left, right) => left.start_time.localeCompare(right.start_time) || left.slot_index - right.slot_index || left.id - right.id);
    const constraint = constraintsByTeacher.get(Number(load.employee_id));
    if (constraint?.avoid_first_period === 1 && Number(daySlots[0]?.id) === Number(slot.id)) penalties.first_period_preferences += 2;
    if (constraint?.avoid_last_period === 1 && Number(daySlots[daySlots.length - 1]?.id) === Number(slot.id)) penalties.last_period_preferences += 2;
  }

  const entriesByLoad = new Map<number, InternalEntry[]>();
  for (const entry of input.entries) {
    const current = entriesByLoad.get(Number(entry.teaching_load_id)) || [];
    current.push(entry);
    entriesByLoad.set(Number(entry.teaching_load_id), current);
  }
  for (const loadEntries of entriesByLoad.values()) {
    safetyCheck?.();
    const byDay = new Map<number, TimetableSlot[]>();
    for (const entry of loadEntries) {
      const slot = slotsById.get(Number(entry.slot_id));
      if (!slot) continue;
      const current = byDay.get(Number(slot.day_of_week)) || [];
      current.push(slot);
      byDay.set(Number(slot.day_of_week), current);
    }
    for (const slots of byDay.values()) {
      if (slots.length > 1) penalties.subject_clustering += (slots.length - 1) * 3;
      const ordered = slots.sort((left, right) => left.start_time.localeCompare(right.start_time) || left.slot_index - right.slot_index);
      for (let index = 1; index < ordered.length; index += 1) {
        if (Math.abs(ordered[index].slot_index - ordered[index - 1].slot_index) === 1) penalties.consecutive_same_subject += 2;
      }
    }
  }

  const teacherIds = new Set(input.loads.filter((load) => load.employee_id != null).map((load) => Number(load.employee_id)));
  for (const teacherId of teacherIds) {
    safetyCheck?.();
    const teacherEntries = input.entries.filter((entry) => Number(loadsById.get(Number(entry.teaching_load_id))?.employee_id) === teacherId);
    for (const dayOfWeek of activeDayNumbers) {
      const daySlots = input.slots
        .filter((slot) => Number(slot.day_of_week) === dayOfWeek && slot.slot_type === 'lesson' && Number(slot.is_active) === 1)
        .sort((left, right) => left.start_time.localeCompare(right.start_time) || left.slot_index - right.slot_index || left.id - right.id);
      const occupied = teacherEntries
        .map((entry) => daySlots.findIndex((slot) => Number(slot.id) === Number(entry.slot_id)))
        .filter((position) => position >= 0)
        .sort((left, right) => left - right);
      if (occupied.length < 2) continue;
      const occupiedSet = new Set(occupied);
      let gaps = 0;
      for (let position = occupied[0]; position <= occupied[occupied.length - 1]; position += 1) {
        if (!occupiedSet.has(position)) gaps += 1;
      }
      const compactWeight = constraintsByTeacher.get(teacherId)?.prefer_compact_schedule === 1 ? 3 : 1;
      penalties.teacher_gaps += gaps * compactWeight;
    }
  }

  const placements = new Set(input.loads.map((load) => `${Number(load.class_id)}:${load.section_id == null ? 'none' : Number(load.section_id)}`));
  for (const placement of placements) {
    safetyCheck?.();
    const dailyCounts = activeDayNumbers.map((dayOfWeek) => input.entries.filter((entry) => {
      const load = loadsById.get(Number(entry.teaching_load_id));
      const slot = slotsById.get(Number(entry.slot_id));
      return load != null && slot != null
        && `${Number(load.class_id)}:${load.section_id == null ? 'none' : Number(load.section_id)}` === placement
        && Number(slot.day_of_week) === dayOfWeek;
    }).length);
    if (dailyCounts.length > 0) penalties.class_daily_imbalance += Math.max(...dailyCounts) - Math.min(...dailyCounts);
  }

  const totalPenalty = Object.values(penalties).reduce((sum, value) => sum + value, 0);
  const maximumReferencePenalty = Math.max(1, input.entries.length * 12);
  const qualityScore = Math.max(0, Math.min(100, Math.round(100 - (totalPenalty / maximumReferencePenalty) * 100)));
  return {
    qualityScore,
    scoring: {
      model: 'comparative-v1',
      total_penalty: totalPenalty,
      maximum_reference_penalty: maximumReferencePenalty,
      penalties,
      preferred_slots_used: preferredSlotsUsed,
      note: 'درجة مقارنة لتحسين الاقتراح وليست تقييمًا رياضيًا مطلقًا.',
    },
  };
}

function hardConflictReason(code: TimetableEntryNotice['code']): TimetableSolverReasonCode | null {
  if (code === 'class_section_collision' || code === 'weekly_periods_exceeded') return 'no_class_capacity';
  if (code === 'teacher_unavailable') return 'teacher_unavailable';
  if (code === 'teacher_max_periods_per_day') return 'teacher_daily_limit';
  if (code === 'teacher_max_working_days') return 'teacher_working_days_limit';
  if (code === 'teacher_max_consecutive_periods') return 'teacher_consecutive_limit';
  if (code === 'teacher_collision') return 'teacher_collision';
  if (code === 'invalid_teaching_load' || code === 'invalid_tenant_scope' || code === 'invalid_academic_year') return 'invalid_teaching_load';
  return null;
}

export function validateTimetableSolverProposal(
  input: TimetableSolverInput,
  entries: TimetableEntry[],
  safetyCheck?: () => void,
): TimetableEntryNotice[] {
  const violations: TimetableEntryNotice[] = [];
  for (const entry of entries) {
    safetyCheck?.();
    const evaluation = evaluateTimetableEntryPlacement({
      candidate: { id: entry.id, slot_id: entry.slot_id, teaching_load_id: entry.teaching_load_id },
      days: input.days,
      slots: input.slots,
      loads: input.loads,
      entries,
      teacherAvailability: input.teacherAvailability,
      teacherConstraints: input.teacherConstraints,
    });
    violations.push(...evaluation.hard_conflicts);
  }
  const validLoadIds = new Set(input.loads
    .filter((load) => loadIsValid(load, input.schoolId, input.academicYearId))
    .map((load) => Number(load.id)));
  for (const load of input.loads.filter((item) => item.status === 'active')) {
    safetyCheck?.();
    const count = entries.filter((entry) => Number(entry.teaching_load_id) === Number(load.id)).length;
    if (!validLoadIds.has(Number(load.id)) && count > 0) {
      violations.push({ code: 'invalid_teaching_load', message: 'الاقتراح يحتوي على نصاب غير صالح' });
    }
    if (count > Number(load.weekly_periods)) {
      violations.push({ code: 'weekly_periods_exceeded', message: 'الاقتراح تجاوز عدد الحصص الأسبوعية المطلوبة' });
    }
  }
  return violations;
}

export function solveTimetable(input: TimetableSolverInput): TimetableSolverPreview {
  const startedAt = Date.now();
  const limits: TimetableSolverLimits = { ...DEFAULT_LIMITS, ...input.limits };
  let safetyCheckCounter = 0;
  const ensureWithinWallClockSafetyLimit = (force = false) => {
    safetyCheckCounter += 1;
    if (!force && safetyCheckCounter % 64 !== 0) return;
    if (Date.now() - startedAt >= limits.time_budget_ms) throw new TimetableSolverSafetyLimitError();
  };
  const scopedDays = input.days.filter((day) => (
    Number(day.school_id) === input.schoolId && Number(day.academic_year_id) === input.academicYearId
  ));
  const scopedSlots = input.slots.filter((slot) => (
    Number(slot.school_id) === input.schoolId && Number(slot.academic_year_id) === input.academicYearId
  ));
  const activeDays = activeTimetableDays(scopedDays);
  const scheduleSlots = schedulableTimetableSlots(scopedDays, scopedSlots);
  const activeLoads = input.loads.filter((load) => load.status === 'active');
  const validLoads = activeLoads.filter((load) => loadIsValid(load, input.schoolId, input.academicYearId));
  const scheduleSlotIds = new Set(scheduleSlots.map((slot) => Number(slot.id)));
  const availability = (input.teacherAvailability || []).filter((item) => (
    Number(item.school_id) === input.schoolId
    && Number(item.academic_year_id) === input.academicYearId
    && scheduleSlotIds.has(Number(item.slot_id))
  ));
  const constraints = (input.teacherConstraints || []).filter((item) => (
    Number(item.school_id) === input.schoolId && Number(item.academic_year_id) === input.academicYearId
  ));
  const readiness = buildSolverReadiness(input, activeDays, scheduleSlots, activeLoads, validLoads, availability, constraints, ensureWithinWallClockSafetyLimit);
  const loadsById = new Map(input.loads.map((load) => [Number(load.id), load]));
  const slotsById = new Map(scopedSlots.map((slot) => [Number(slot.id), slot]));
  const constraintsByTeacher = new Map(constraints.map((item) => [Number(item.employee_id), item]));
  const availabilityByTeacherSlot = new Map(availability.map((item) => [`${Number(item.employee_id)}:${Number(item.slot_id)}`, item.status]));
  let attempts = 0;
  let backtracks = 0;
  let localImprovementAttempts = 0;
  let stoppedByLimit = false;
  let nextTemporaryId = -1;

  const deterministicBudgetExpired = () => {
    const expired = attempts >= limits.max_attempts || backtracks >= limits.max_backtracks;
    if (expired) stoppedByLimit = true;
    return expired;
  };

  const baseDomainSize = (load: TimetableTeachingLoad) => scheduleSlots.filter((slot) => (
    load.employee_id == null
    || availabilityByTeacherSlot.get(`${Number(load.employee_id)}:${Number(slot.id)}`) !== 'unavailable'
  )).length;
  const orderedLoads = [...validLoads].sort((left, right) => {
    const domainDifference = baseDomainSize(left) - baseDomainSize(right);
    if (domainDifference !== 0) return domainDifference;
    const leftConstraintCount = left.employee_id == null ? 0 : Object.values(constraintsByTeacher.get(Number(left.employee_id)) || {})
      .filter((value) => value != null && value !== 0).length;
    const rightConstraintCount = right.employee_id == null ? 0 : Object.values(constraintsByTeacher.get(Number(right.employee_id)) || {})
      .filter((value) => value != null && value !== 0).length;
    return rightConstraintCount - leftConstraintCount
      || Number(right.weekly_periods) - Number(left.weekly_periods)
      || Number(left.class_id) - Number(right.class_id)
      || Number(left.section_id || 0) - Number(right.section_id || 0)
      || Number(left.subject_id) - Number(right.subject_id)
      || Number(left.id) - Number(right.id);
  });
  const demandUnits = orderedLoads.flatMap((load) => Array.from(
    { length: Number(load.weekly_periods) },
    (_, occurrence) => ({ load, occurrence }),
  ));

  function rankCandidates(load: TimetableTeachingLoad, entries: InternalEntry[], attemptCeiling = limits.max_attempts): RankedCandidate[] {
    const ranked: RankedCandidate[] = [];
    for (const slot of scheduleSlots) {
      ensureWithinWallClockSafetyLimit();
      if (attempts >= attemptCeiling || deterministicBudgetExpired()) {
        stoppedByLimit = true;
        break;
      }
      attempts += 1;
      const evaluation = evaluateTimetableEntryPlacement({
        candidate: { slot_id: Number(slot.id), teaching_load_id: Number(load.id) },
        days: input.days,
        slots: input.slots,
        loads: input.loads,
        entries,
        teacherAvailability: availability,
        teacherConstraints: constraints,
      });
      if (evaluation.hard_conflicts.length > 0) continue;
      ranked.push({
        slot,
        warnings: evaluation.warnings,
        penalty: candidatePenalty(load, slot, entries, loadsById, slotsById, evaluation.warnings),
      });
    }
    return ranked.sort((left, right) => (
      left.penalty - right.penalty
      || left.slot.day_of_week - right.slot.day_of_week
      || left.slot.start_time.localeCompare(right.slot.start_time)
      || left.slot.slot_index - right.slot.slot_index
      || left.slot.id - right.slot.id
    ));
  }

  function makeEntry(load: TimetableTeachingLoad, slot: TimetableSlot): InternalEntry {
    return {
      id: nextTemporaryId--,
      school_id: input.schoolId,
      academic_year_id: input.academicYearId,
      slot_id: Number(slot.id),
      teaching_load_id: Number(load.id),
      created_by_user_id: null,
      updated_by_user_id: null,
      created_at: 0,
      updated_at: 0,
    };
  }

  function greedyFill(seed: InternalEntry[]): InternalEntry[] {
    const entries = [...seed];
    const scheduledByLoad = new Map<number, number>();
    for (const entry of entries) scheduledByLoad.set(
      Number(entry.teaching_load_id),
      (scheduledByLoad.get(Number(entry.teaching_load_id)) || 0) + 1,
    );
    for (const load of orderedLoads) {
      let remaining = Number(load.weekly_periods) - (scheduledByLoad.get(Number(load.id)) || 0);
      while (remaining > 0 && !deterministicBudgetExpired()) {
        ensureWithinWallClockSafetyLimit();
        const candidate = rankCandidates(load, entries)[0];
        if (!candidate) break;
        entries.push(makeEntry(load, candidate.slot));
        remaining -= 1;
      }
    }
    return entries;
  }

  let bestEntries = greedyFill([]);
  const workingEntries: InternalEntry[] = [];
  function searchForMoreCoverage(position: number): boolean {
    ensureWithinWallClockSafetyLimit();
    if (workingEntries.length > bestEntries.length) bestEntries = [...workingEntries];
    if (bestEntries.length === demandUnits.length) return true;
    if (position >= demandUnits.length || deterministicBudgetExpired()) return false;
    const remainingDemand = demandUnits.length - position;
    if (workingEntries.length + remainingDemand <= bestEntries.length) return false;

    const { load } = demandUnits[position];
    const candidates = rankCandidates(load, workingEntries);
    for (const candidate of candidates) {
      if (deterministicBudgetExpired()) return false;
      workingEntries.push(makeEntry(load, candidate.slot));
      if (searchForMoreCoverage(position + 1)) return true;
      workingEntries.pop();
      backtracks += 1;
      if (deterministicBudgetExpired()) return false;
    }
    return searchForMoreCoverage(position + 1);
  }

  if (bestEntries.length < demandUnits.length && !deterministicBudgetExpired()) searchForMoreCoverage(0);
  let proposalEntries = [...bestEntries];

  if (!deterministicBudgetExpired() && proposalEntries.length > 1) {
    let currentPenalty = scoreProposal({ entries: proposalEntries, loads: validLoads, slots: scopedSlots, days: scopedDays, availability, constraints }, ensureWithinWallClockSafetyLimit).scoring.total_penalty;
    for (const original of [...proposalEntries].sort((left, right) => Number(left.id) - Number(right.id))) {
      ensureWithinWallClockSafetyLimit();
      if (localImprovementAttempts >= limits.max_local_improvement_attempts || deterministicBudgetExpired()) break;
      const load = loadsById.get(Number(original.teaching_load_id));
      if (!load) continue;
      const withoutOriginal = proposalEntries.filter((entry) => Number(entry.id) !== Number(original.id));
      const alternatives = rankCandidates(load, withoutOriginal).filter((candidate) => Number(candidate.slot.id) !== Number(original.slot_id));
      for (const candidate of alternatives.slice(0, 8)) {
        localImprovementAttempts += 1;
        const replacement = { ...original, slot_id: Number(candidate.slot.id) };
        const candidateEntries = [...withoutOriginal, replacement];
        const candidatePenaltyValue = scoreProposal({ entries: candidateEntries, loads: validLoads, slots: scopedSlots, days: scopedDays, availability, constraints }, ensureWithinWallClockSafetyLimit).scoring.total_penalty;
        if (candidatePenaltyValue < currentPenalty) {
          proposalEntries = candidateEntries;
          currentPenalty = candidatePenaltyValue;
          break;
        }
        if (localImprovementAttempts >= limits.max_local_improvement_attempts) break;
      }
    }
  }

  ensureWithinWallClockSafetyLimit(true);
  const finalViolations = validateTimetableSolverProposal(input, proposalEntries, ensureWithinWallClockSafetyLimit);
  if (finalViolations.length > 0) {
    throw new Error(`Timetable solver final validation failed: ${finalViolations.map((item) => item.code).join(', ')}`);
  }

  const scheduledByLoad = new Map<number, number>();
  for (const entry of proposalEntries) scheduledByLoad.set(
    Number(entry.teaching_load_id),
    (scheduledByLoad.get(Number(entry.teaching_load_id)) || 0) + 1,
  );
  const invalidLoadIds = new Set(activeLoads
    .filter((load) => !loadIsValid(load, input.schoolId, input.academicYearId))
    .map((load) => Number(load.id)));
  const overloadedPlacementKeys = new Set(readiness.overloaded_class_sections.map((item) => `${item.class_id}:${item.section_id ?? 'none'}`));
  const overloadedTeacherIds = new Set(readiness.overloaded_teachers.map((item) => Number(item.employee_id)));

  const unscheduled = activeLoads.flatMap((load): TimetableSolverUnscheduledDemand[] => {
    ensureWithinWallClockSafetyLimit();
    const scheduled = scheduledByLoad.get(Number(load.id)) || 0;
    const remaining = Math.max(0, Number(load.weekly_periods) - scheduled);
    if (remaining === 0) return [];
    const reasonCodes = new Set<TimetableSolverReasonCode>();
    if (invalidLoadIds.has(Number(load.id))) {
      reasonCodes.add('invalid_teaching_load');
    } else {
      const placementKey = `${Number(load.class_id)}:${load.section_id == null ? 'none' : Number(load.section_id)}`;
      const conflictSets: Array<Set<TimetableSolverReasonCode>> = [];
      let hasValidCandidate = false;
      for (const slot of scheduleSlots) {
        ensureWithinWallClockSafetyLimit();
        const evaluation = evaluateTimetableEntryPlacement({
          candidate: { slot_id: Number(slot.id), teaching_load_id: Number(load.id) },
          days: input.days,
          slots: input.slots,
          loads: input.loads,
          entries: proposalEntries,
          teacherAvailability: availability,
          teacherConstraints: constraints,
        });
        if (evaluation.hard_conflicts.length === 0) {
          hasValidCandidate = true;
          continue;
        }
        conflictSets.push(new Set(evaluation.hard_conflicts
          .map((conflict) => hardConflictReason(conflict.code))
          .filter((reason): reason is TimetableSolverReasonCode => reason != null)));
      }

      if (hasValidCandidate) {
        reasonCodes.add(stoppedByLimit ? 'search_budget_exhausted' : 'insufficient_slot_domain');
      } else {
        for (const code of REASON_ORDER) {
          if (conflictSets.length > 0 && conflictSets.every((set) => set.has(code))) reasonCodes.add(code);
        }
      }
      if (overloadedPlacementKeys.has(placementKey)) reasonCodes.add('no_class_capacity');
      if (load.employee_id != null && overloadedTeacherIds.has(Number(load.employee_id))) {
        const teacherCapacity = calculateTeacherHardCapacity({
          employeeId: Number(load.employee_id),
          activeDays,
          scopedSlots,
          availability,
          constraints: constraintsByTeacher.get(Number(load.employee_id)),
        });
        for (const reason of teacherCapacity.limitingReasons) reasonCodes.add(reason);
      }
      reasonCodes.delete('invalid_teaching_load');
      if (reasonCodes.size === 0) reasonCodes.add('insufficient_slot_domain');
    }
    const codes = REASON_ORDER.filter((code) => reasonCodes.has(code));
    return [{
      teaching_load_id: Number(load.id),
      subject_id: Number(load.subject_id),
      subject_name: load.subject_name || 'مادة غير معروفة',
      class_id: Number(load.class_id),
      class_name: load.class_name || 'صف غير معروف',
      section_id: load.section_id == null ? null : Number(load.section_id),
      section_name: load.section_name || null,
      employee_id: load.employee_id == null ? null : Number(load.employee_id),
      employee_name: load.employee_name || null,
      remaining_count: remaining,
      reason_codes: codes,
      reasons: codes.map((code) => REASON_MESSAGES[code]),
    }];
  });

  const currentEntries = input.currentEntries || [];
  let currentValidEntryCount = 0;
  for (const entry of currentEntries) {
    ensureWithinWallClockSafetyLimit();
    const evaluation = evaluateTimetableEntryPlacement({
      candidate: { id: entry.id, slot_id: entry.slot_id, teaching_load_id: entry.teaching_load_id },
      days: input.days,
      slots: input.slots,
      loads: input.loads,
      entries: currentEntries,
      teacherAvailability: availability,
      teacherConstraints: constraints,
    });
    if (evaluation.hard_conflicts.length === 0) currentValidEntryCount += 1;
  }

  const orderedProposal = [...proposalEntries].sort((left, right) => {
    const leftSlot = slotsById.get(Number(left.slot_id));
    const rightSlot = slotsById.get(Number(right.slot_id));
    const leftLoad = loadsById.get(Number(left.teaching_load_id));
    const rightLoad = loadsById.get(Number(right.teaching_load_id));
    return Number(leftSlot?.day_of_week || 0) - Number(rightSlot?.day_of_week || 0)
      || String(leftSlot?.start_time || '').localeCompare(String(rightSlot?.start_time || ''))
      || Number(leftLoad?.class_id || 0) - Number(rightLoad?.class_id || 0)
      || Number(leftLoad?.section_id || 0) - Number(rightLoad?.section_id || 0)
      || Number(leftLoad?.subject_id || 0) - Number(rightLoad?.subject_id || 0)
      || Number(left.teaching_load_id) - Number(right.teaching_load_id);
  });
  const score = scoreProposal({ entries: orderedProposal, loads: validLoads, slots: scopedSlots, days: scopedDays, availability, constraints }, ensureWithinWallClockSafetyLimit);
  const proposal = orderedProposal.map<TimetableSolverProposalEntry>((entry, index) => {
    ensureWithinWallClockSafetyLimit();
    const load = loadsById.get(Number(entry.teaching_load_id))!;
    const slot = slotsById.get(Number(entry.slot_id))!;
    const evaluation = evaluateTimetableEntryPlacement({
      candidate: { id: entry.id, slot_id: entry.slot_id, teaching_load_id: entry.teaching_load_id },
      days: input.days,
      slots: input.slots,
      loads: input.loads,
      entries: orderedProposal,
      teacherAvailability: availability,
      teacherConstraints: constraints,
    });
    return {
      proposal_id: `proposal-${String(index + 1).padStart(4, '0')}`,
      slot_id: Number(slot.id),
      teaching_load_id: Number(load.id),
      subject_id: Number(load.subject_id),
      subject_name: load.subject_name || 'مادة غير معروفة',
      class_id: Number(load.class_id),
      class_name: load.class_name || 'صف غير معروف',
      section_id: load.section_id == null ? null : Number(load.section_id),
      section_name: load.section_name || null,
      employee_id: load.employee_id == null ? null : Number(load.employee_id),
      employee_name: load.employee_name || null,
      day_of_week: Number(slot.day_of_week),
      lesson_number: slot.lesson_number == null ? null : Number(slot.lesson_number),
      start_time: slot.start_time,
      end_time: slot.end_time,
      soft_warnings: evaluation.warnings,
      score_contribution: Math.max(0, 10 - warningPenalty(evaluation.warnings)),
    };
  });
  const scheduledPeriods = proposal.length;
  const requiredPeriods = readiness.total_required_periods;
  const coverageRatio = requiredPeriods === 0 ? 1 : scheduledPeriods / requiredPeriods;
  const comparativeQualityScore = Math.round(score.qualityScore * coverageRatio);
  const status: TimetableSolverStatus = readiness.hard_feasibility_blockers.length > 0
    ? 'impossible'
    : scheduledPeriods === requiredPeriods
      ? 'complete'
      : 'partial';
  const warnings = [
    'هذا اقتراح جديد ولن يغيّر الجدول الحالي حتى يتم اعتماده.',
    ...(readiness.missing_teacher_count > 0 ? [`توجد ${readiness.missing_teacher_count} أنصبة بلا مدرس، وقد جرى تمثيلها بوضوح في الاقتراح.`] : []),
    ...(stoppedByLimit ? ['توقف البحث عند حد الأمان المحدد؛ راجع الحصص غير المجدولة أو أعد ضبط القيود.'] : []),
    ...readiness.hard_feasibility_blockers.map((blocker) => blocker.message),
  ];

  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs >= limits.time_budget_ms) throw new TimetableSolverSafetyLimitError();

  return {
    status,
    quality_score: comparativeQualityScore,
    required_periods: requiredPeriods,
    scheduled_periods: scheduledPeriods,
    unscheduled_periods: Math.max(0, requiredPeriods - scheduledPeriods),
    entries: proposal,
    unscheduled,
    warnings,
    scoring: {
      ...score.scoring,
      note: 'درجة مقارنة تشمل تغطية الطلب وجودة التوزيع، وليست تقييمًا رياضيًا مطلقًا.',
    },
    statistics: {
      attempts,
      backtracks,
      local_improvement_attempts: localImprovementAttempts,
      elapsed_ms: elapsedMs,
      time_budget_ms: limits.time_budget_ms,
      attempt_budget: limits.max_attempts,
      backtrack_budget: limits.max_backtracks,
      stopped_by_limit: stoppedByLimit,
      current_valid_entry_count: currentValidEntryCount,
      existing_invalid_entry_count: currentEntries.length - currentValidEntryCount,
      active_day_count: activeDays.length,
      active_lesson_slot_count: scheduleSlots.length,
    },
    readiness,
    days: activeDays,
    slots: scopedSlots.filter((slot) => (
      Number(slot.is_active) === 1 && activeDays.some((day) => Number(day.day_of_week) === Number(slot.day_of_week))
    )),
    placements: input.placements,
  };
}
