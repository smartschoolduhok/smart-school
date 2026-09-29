import {
  calculateTeacherAvailabilitySummary,
  createTimetableEntryPlacementEvaluator,
  dormantTimetableLoadIds,
  evaluateTimetableEntryPlacement,
  loadHasInvalidAcademicReference,
  loadHasInvalidTeacherReference,
  timetableLoadsShareGroup,
  type TimetableDay,
  type TimetableEntry,
  type TimetableEntryNotice,
  type TimetablePlacement,
  type TimetableSlot,
  type TimetableTeacherAvailabilityOverride,
  type TimetableTeacherConstraints,
  type TimetableTeachingLoad,
} from './timetable.ts';
import { countTimetableSectionPeriods, countTimetableScheduledSectionPeriods, indexTimetableParallelLoadGroups, parallelTimetableLoadGroup, validateTimetableParallelLoads } from './timetableParallel.ts';
import { createTimetablePedagogyScorer, type TimetablePedagogyMetrics } from './timetablePedagogy.ts';

export type TimetableSolverStatus = 'complete' | 'partial' | 'impossible' | 'fixed_conflict';

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
  early_light_subjects?: number;
  consecutive_heavy_subjects?: number;
  missed_section_continuity?: number;
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
  model: 'comparative-v1' | 'comparative-v2';
  total_penalty: number;
  maximum_reference_penalty: number;
  penalties: TimetableSolverPenaltyBreakdown;
  preferred_slots_used: number;
  pedagogy?: TimetablePedagogyMetrics;
  note: string;
}

export interface TimetableSolverProposalEntry {
  proposal_id: string;
  slot_id: number;
  teaching_load_id: number;
  parallel_with_load_id?: number | null;
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
  is_locked: 0 | 1;
  is_preserved?: boolean;
}

export type TimetableFixedEntryConflictCode =
  | 'fixed_duplicate'
  | 'fixed_invalid_scope'
  | 'fixed_invalid_load'
  | 'fixed_inactive_slot'
  | 'fixed_class_collision'
  | 'fixed_teacher_collision'
  | 'fixed_teacher_unavailable'
  | 'fixed_daily_limit'
  | 'fixed_working_days_limit'
  | 'fixed_consecutive_limit'
  | 'fixed_weekly_limit';

export interface TimetableFixedEntryConflict {
  code: TimetableFixedEntryConflictCode;
  message: string;
  slot_id: number;
  teaching_load_id: number;
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
  fixed_conflicts: TimetableFixedEntryConflict[];
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
  fixedEntries?: Array<{ slot_id: number; teaching_load_id: number; is_locked?: 0 | 1 }>;
  limits?: Partial<TimetableSolverLimits>;
}

const DEFAULT_LIMITS: TimetableSolverLimits = {
  time_budget_ms: 2_000,
  max_attempts: 60_000,
  max_backtracks: 5_000,
  max_local_improvement_attempts: 1_200,
};

const REASON_MESSAGES: Record<TimetableSolverReasonCode, string> = {
  no_class_capacity: 'لا توجد سعة متبقية للصف أو الشعبة ضمن الفترات الصالحة.',
  teacher_unavailable: 'لا توجد فترات متاحة للمدرس ضمن القيود الحالية.',
  teacher_daily_limit: 'الحد الأقصى اليومي لدروس المدرس يمنع توزيع الدروس المتبقية.',
  teacher_working_days_limit: 'الحد الأقصى لأيام عمل المدرس يمنع توزيع الدروس المتبقية.',
  teacher_consecutive_limit: 'حد الدروس المتتالية للمدرس يمنع توزيع الدروس المتبقية.',
  teacher_collision: 'المدرس مرتبط بدروس أخرى في الفترات المتبقية.',
  insufficient_slot_domain: 'لا توجد مجموعة فترات كافية تحقق جميع القيود الصلبة.',
  search_budget_exhausted: 'توقّف البحث عند ميزانيته الخوارزمية قبل إثبات سبب رياضي نهائي لهذه الدروس.',
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

function fixedConflictCode(code: TimetableEntryNotice['code']): TimetableFixedEntryConflictCode {
  if (code === 'inactive_day' || code === 'inactive_slot' || code === 'slot_not_schedulable') return 'fixed_inactive_slot';
  if (code === 'class_section_collision') return 'fixed_class_collision';
  if (code === 'teacher_collision') return 'fixed_teacher_collision';
  if (code === 'teacher_unavailable') return 'fixed_teacher_unavailable';
  if (code === 'teacher_max_periods_per_day') return 'fixed_daily_limit';
  if (code === 'teacher_max_working_days') return 'fixed_working_days_limit';
  if (code === 'teacher_max_consecutive_periods') return 'fixed_consecutive_limit';
  if (code === 'weekly_periods_exceeded') return 'fixed_weekly_limit';
  if (code === 'invalid_tenant_scope' || code === 'invalid_academic_year') return 'fixed_invalid_scope';
  return 'fixed_invalid_load';
}

function validateFixedEntries(input: TimetableSolverInput): {
  entries: InternalEntry[];
  conflicts: TimetableFixedEntryConflict[];
} {
  const fixed = [...(input.fixedEntries || [])];
  // A fixed member anchors its complete pair. Preserve each supplied lock;
  // an inferred counterpart is fixed in position without inventing a user lock.
  for (const entry of input.fixedEntries || []) {
    const load = input.loads.find(item => item.id === entry.teaching_load_id);
    if (!load) continue;
    for (const partner of parallelTimetableLoadGroup(load, input.loads)) {
      if (fixed.some(item => item.slot_id === entry.slot_id && item.teaching_load_id === partner.id)) continue;
      fixed.push({slot_id: entry.slot_id, teaching_load_id: partner.id, is_locked: 0});
    }
  }
  const seen = new Set<string>();
  const conflicts: TimetableFixedEntryConflict[] = [];
  const entries: InternalEntry[] = fixed.map((entry, index) => ({
    id: -(1_000_000 + index),
    school_id: input.schoolId,
    academic_year_id: input.academicYearId,
    slot_id: Number(entry.slot_id),
    teaching_load_id: Number(entry.teaching_load_id),
    is_locked: entry.is_locked ?? 1,
    created_by_user_id: null,
    updated_by_user_id: null,
    created_at: 0,
    updated_at: 0,
  }));
  for (const entry of entries) {
    const pair = `${entry.slot_id}:${entry.teaching_load_id}`;
    if (seen.has(pair)) {
      conflicts.push({
        code: 'fixed_duplicate',
        message: 'الدرس المثبت مكرر في الطلب.',
        slot_id: entry.slot_id,
        teaching_load_id: entry.teaching_load_id,
      });
      continue;
    }
    seen.add(pair);
    const evaluation = evaluateTimetableEntryPlacement({
      validateWholeSchedule: true,
      candidate: entry,
      days: input.days,
      slots: input.slots,
      loads: input.loads,
      entries,
      teacherAvailability: input.teacherAvailability,
      teacherConstraints: input.teacherConstraints,
    });
    for (const notice of evaluation.hard_conflicts) {
      conflicts.push({
        code: fixedConflictCode(notice.code),
        message: notice.message,
        slot_id: entry.slot_id,
        teaching_load_id: entry.teaching_load_id,
      });
    }
  }
  return { entries, conflicts };
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

function invalidParallelLoadIds(loads: TimetableTeachingLoad[], schoolId?: number, academicYearId?: number): Set<number> {
  const invalid = new Set(validateTimetableParallelLoads(loads).map(issue => issue.load_id));
  for (const load of loads) {
    const group = parallelTimetableLoadGroup(load, loads);
    if (group.length === 2 && group.some(member => !loadIsValid(member, schoolId, academicYearId))) {
      group.forEach(member => invalid.add(member.id));
    }
  }
  return invalid;
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
  const parallelInvalid = invalidParallelLoadIds(input.loads, input.schoolId, input.academicYearId);
  const invalidLoads = activeLoads.filter((load) => !loadIsValid(load, input.schoolId, input.academicYearId) || parallelInvalid.has(load.id));
  const blockers: TimetableSolverFeasibilityBlocker[] = [];
  if (activeDays.length === 0) {
    blockers.push({ code: 'no_active_days', message: 'لا توجد أيام دوام فعالة يمكن بناء الجدول عليها.' });
  }
  if (scheduleSlots.length === 0) {
    blockers.push({ code: 'no_active_lesson_slots', message: 'لا توجد دروس فعالة قابلة للجدولة.' });
  }
  for (const load of invalidLoads) {
    safetyCheck?.();
    blockers.push({
      code: 'invalid_teaching_load',
      teaching_load_id: Number(load.id),
      message: `${load.subject_name || 'مادة غير معروفة'} — ${loadLabel(load)}: ${parallelInvalid.has(load.id) ? 'ربط الدروس المتزامنة غير صالح.' : 'النصاب يحتوي على مرجع غير صالح.'}`,
    });
  }

  const overloadedClassSections = input.placements.flatMap((placement) => {
    safetyCheck?.();
    const requiredPeriods = countTimetableSectionPeriods(validLoads.filter((load) => loadMatchesPlacement(load, placement)));
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
      message: `عدد الدروس المطلوبة لـ${item.class_name}${item.section_name ? ` / ${item.section_name}` : ''}: ${requiredPeriods}، بينما السعة المتاحة: ${scheduleSlots.length}.`,
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
      message: `عدد الدروس المطلوبة للمدرس ${item.employee_name}: ${requiredPeriods}، لكن قيوده تسمح بـ${item.available_capacity} فقط.`,
    });
    return [item];
  });

  return {
    total_required_periods: countTimetableSectionPeriods(activeLoads),
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
  const samePlacementDayCount = new Set(sameDayEntries.filter((entry) => {
    const otherLoad = loadsById.get(Number(entry.teaching_load_id));
    return otherLoad != null
      && Number(otherLoad.class_id) === Number(load.class_id)
      && sameNullableId(otherLoad.section_id, load.section_id);
  }).map(entry => entry.slot_id)).size;
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
    early_light_subjects: 0,
    consecutive_heavy_subjects: 0,
    missed_section_continuity: 0,
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
  pedagogyScorer?: ReturnType<typeof createTimetablePedagogyScorer>;
}, safetyCheck?: () => void): { qualityScore: number; scoring: TimetableSolverScoring } {
  const penalties = emptyPenaltyBreakdown();
  const loadsById = new Map(input.loads.map((load) => [Number(load.id), load]));
  const slotsById = new Map(input.slots.map((slot) => [Number(slot.id), slot]));
  const availabilityByTeacherSlot = new Map(input.availability.map((item) => [`${Number(item.employee_id)}:${Number(item.slot_id)}`, item.status]));
  const constraintsByTeacher = new Map(input.constraints.map((item) => [Number(item.employee_id), item]));
  const activeDays = activeTimetableDays(input.days);
  const activeDayNumbers = activeDays.map((day) => Number(day.day_of_week));
  const preferredTeacherIds = new Set(input.availability
    .filter((item) => item.status === 'preferred')
    .map((item) => Number(item.employee_id)));
  const lessonSlotsByDay = new Map<number, TimetableSlot[]>();
  for (const slot of input.slots) {
    if (slot.slot_type !== 'lesson' || Number(slot.is_active) !== 1) continue;
    const day = Number(slot.day_of_week);
    const daySlots = lessonSlotsByDay.get(day) || [];
    daySlots.push(slot);
    lessonSlotsByDay.set(day, daySlots);
  }
  const slotPositionsByDay = new Map<number, Map<number, number>>();
  for (const [day, daySlots] of lessonSlotsByDay) {
    daySlots.sort((left, right) => left.start_time.localeCompare(right.start_time) || left.slot_index - right.slot_index || left.id - right.id);
    slotPositionsByDay.set(day, new Map(daySlots.map((slot, index) => [Number(slot.id), index])));
  }
  const entriesByTeacher = new Map<number, InternalEntry[]>();
  const placementDayCounts = new Map<string, Map<number, number>>();
  const occupiedPlacementSlots = new Set<string>();
  for (const entry of input.entries) {
    const load = loadsById.get(Number(entry.teaching_load_id));
    const slot = slotsById.get(Number(entry.slot_id));
    if (!load || !slot) continue;
    if (load.employee_id != null) {
      const teacherId = Number(load.employee_id);
      const teacherEntries = entriesByTeacher.get(teacherId) || [];
      teacherEntries.push(entry);
      entriesByTeacher.set(teacherId, teacherEntries);
    }
    const placement = `${Number(load.class_id)}:${load.section_id == null ? 'none' : Number(load.section_id)}`;
    const placementSlot = `${placement}:${slot.id}`;
    if (occupiedPlacementSlots.has(placementSlot)) continue;
    occupiedPlacementSlots.add(placementSlot);
    const counts = placementDayCounts.get(placement) || new Map<number, number>();
    const day = Number(slot.day_of_week);
    counts.set(day, (counts.get(day) || 0) + 1);
    placementDayCounts.set(placement, counts);
  }
  let preferredSlotsUsed = 0;

  for (const entry of input.entries) {
    safetyCheck?.();
    const load = loadsById.get(Number(entry.teaching_load_id));
    const slot = slotsById.get(Number(entry.slot_id));
    if (!load || !slot || load.employee_id == null) continue;
    const status = availabilityByTeacherSlot.get(`${Number(load.employee_id)}:${Number(slot.id)}`);
    if (status === 'avoid') penalties.avoid_slots += 5;
    if (status === 'preferred') preferredSlotsUsed += 1;
    else if (preferredTeacherIds.has(Number(load.employee_id))) penalties.outside_preferred_slots += 2;
    const daySlots = lessonSlotsByDay.get(Number(slot.day_of_week)) || [];
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
    const teacherEntries = entriesByTeacher.get(teacherId) || [];
    for (const dayOfWeek of activeDayNumbers) {
      const slotPositions = slotPositionsByDay.get(dayOfWeek) || new Map<number, number>();
      const occupied = teacherEntries
        .map((entry) => slotPositions.get(Number(entry.slot_id)))
        .filter((position): position is number => position != null)
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
    const counts = placementDayCounts.get(placement);
    const dailyCounts = activeDayNumbers.map((dayOfWeek) => counts?.get(dayOfWeek) || 0);
    if (dailyCounts.length > 0) penalties.class_daily_imbalance += Math.max(...dailyCounts) - Math.min(...dailyCounts);
  }

  const pedagogy = (input.pedagogyScorer || createTimetablePedagogyScorer(input.loads, input.slots)).score(input.entries);
  Object.assign(penalties, pedagogy.penalties);
  const totalPenalty = Object.values(penalties).reduce((sum, value) => sum + value, 0);
  const maximumReferencePenalty = Math.max(1, input.entries.length * 12);
  const qualityScore = Math.max(0, Math.min(100, Math.round(100 - (totalPenalty / maximumReferencePenalty) * 100)));
  return {
    qualityScore,
    scoring: {
      model: 'comparative-v2',
      total_penalty: totalPenalty,
      maximum_reference_penalty: maximumReferencePenalty,
      penalties,
      preferred_slots_used: preferredSlotsUsed,
      pedagogy: pedagogy.metrics,
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
  if (code === 'invalid_teaching_load' || code === 'invalid_parallel_load' || code === 'invalid_tenant_scope' || code === 'invalid_academic_year') return 'invalid_teaching_load';
  return null;
}

export function validateTimetableSolverProposal(
  input: TimetableSolverInput,
  entries: TimetableEntry[],
  safetyCheck?: () => void,
): TimetableEntryNotice[] {
  const violations: TimetableEntryNotice[] = [];
  const evaluate = createTimetableEntryPlacementEvaluator(input)(entries);
  for (const entry of entries) {
    safetyCheck?.();
    const evaluation = evaluate(
      { id: entry.id, slot_id: entry.slot_id, teaching_load_id: entry.teaching_load_id },
      { validateWholeSchedule: true },
    );
    violations.push(...evaluation.hard_conflicts);
  }
  const parallelInvalid = invalidParallelLoadIds(input.loads, input.schoolId, input.academicYearId);
  const validLoadIds = new Set(input.loads
    .filter((load) => loadIsValid(load, input.schoolId, input.academicYearId) && !parallelInvalid.has(load.id))
    .map((load) => Number(load.id)));
  for (const load of input.loads.filter((item) => item.status === 'active')) {
    safetyCheck?.();
    const count = entries.filter((entry) => Number(entry.teaching_load_id) === Number(load.id)).length;
    if (!validLoadIds.has(Number(load.id)) && count > 0) {
      violations.push({ code: 'invalid_teaching_load', message: 'الاقتراح يحتوي على نصاب غير صالح' });
    }
    if (count > Number(load.weekly_periods)) {
      violations.push({ code: 'weekly_periods_exceeded', message: 'الاقتراح تجاوز عدد الدروس الأسبوعية المطلوبة' });
    }
  }
  return violations;
}

export function solveTimetable(input: TimetableSolverInput): TimetableSolverPreview {
  const startedAt = Date.now();
  const dormantLoads = dormantTimetableLoadIds(input.loads, input.currentEntries || [], input.schoolId, input.academicYearId);
  const fixedLoadIds = new Set((input.fixedEntries || []).map(entry => entry.teaching_load_id));
  if (dormantLoads.size > 0) input = {...input, loads: input.loads.filter(load => !dormantLoads.has(load.id) || fixedLoadIds.has(load.id))};
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
  const parallelInvalid = invalidParallelLoadIds(input.loads, input.schoolId, input.academicYearId);
  const validLoads = activeLoads.filter((load) => loadIsValid(load, input.schoolId, input.academicYearId) && !parallelInvalid.has(load.id));
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
  const fixedValidation = validateFixedEntries({
    ...input,
    days: scopedDays,
    slots: scopedSlots,
    teacherAvailability: availability,
    teacherConstraints: constraints,
  });
  const fixedEntries = fixedValidation.entries;
  const fixedEntryKeys = new Set(fixedEntries.map((entry) => `${entry.slot_id}:${entry.teaching_load_id}`));
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

  const preparePlacementEvaluator = createTimetableEntryPlacementEvaluator({
    ...input, teacherAvailability: availability, teacherConstraints: constraints,
  });
  const groupsByLoad = indexTimetableParallelLoadGroups(validLoads);
  const pedagogyScorer = createTimetablePedagogyScorer(validLoads, scopedSlots);
  const groupFor = (load: TimetableTeachingLoad) => groupsByLoad.get(load.id) ?? [load];
  const baseDomainSize = (load: TimetableTeachingLoad) => scheduleSlots.filter((slot) => groupFor(load).every(member => (
    member.employee_id == null
    || availabilityByTeacherSlot.get(`${Number(member.employee_id)}:${Number(slot.id)}`) !== 'unavailable'
  ))).length;
  const orderedLoads = validLoads.filter(load => groupFor(load)[0].id === load.id).sort((left, right) => {
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
  const fixedCountByLoad = new Map<number, number>();
  for (const entry of fixedEntries) fixedCountByLoad.set(
    Number(entry.teaching_load_id),
    (fixedCountByLoad.get(Number(entry.teaching_load_id)) || 0) + 1,
  );
  const individualSearchCapacity = (load: TimetableTeachingLoad): number => {
    const availableSlots = scheduleSlots.filter((slot) => (
      load.employee_id == null
      || availabilityByTeacherSlot.get(`${Number(load.employee_id)}:${Number(slot.id)}`) !== 'unavailable'
    ));
    if (load.employee_id == null) return availableSlots.length;
    const constraint = constraintsByTeacher.get(Number(load.employee_id));
    if (!constraint?.max_periods_per_day && !constraint?.max_working_days) return availableSlots.length;
    const capacityByDay = activeDays.map((day) => {
      const count = availableSlots.filter((slot) => Number(slot.day_of_week) === Number(day.day_of_week)).length;
      return constraint.max_periods_per_day == null ? count : Math.min(count, Number(constraint.max_periods_per_day));
    }).sort((left, right) => right - left);
    const workingDays = constraint.max_working_days == null
      ? capacityByDay.length
      : Math.min(capacityByDay.length, Number(constraint.max_working_days));
    return capacityByDay.slice(0, workingDays).reduce((sum, count) => sum + count, 0);
  };
  const demandUnits = orderedLoads.flatMap((load) => Array.from(
    { length: Math.min(
      Math.max(0, Number(load.weekly_periods) - (fixedCountByLoad.get(Number(load.id)) || 0)),
      Math.max(0, Math.min(...groupFor(load).map(individualSearchCapacity)) - (fixedCountByLoad.get(Number(load.id)) || 0)),
    ) },
    (_, occurrence) => ({ load, occurrence }),
  ));
  const coverage = (entries: InternalEntry[]) => entries.reduce((sum, entry) => (
    sum + 1 / (groupsByLoad.get(entry.teaching_load_id)?.length ?? 1)
  ), 0);
  const desiredCoverage = coverage(fixedEntries) + demandUnits.length;

  function rankCandidates(load: TimetableTeachingLoad, entries: InternalEntry[], attemptCeiling = limits.max_attempts): RankedCandidate[] {
    const ranked: RankedCandidate[] = [];
    const evaluate = preparePlacementEvaluator(entries);
    for (const slot of scheduleSlots) {
      ensureWithinWallClockSafetyLimit();
      if (attempts >= attemptCeiling || deterministicBudgetExpired()) {
        stoppedByLimit = true;
        break;
      }
      attempts += 1;
      const evaluations = groupFor(load).map(member => ({member, evaluation: evaluate({
        slot_id: Number(slot.id), teaching_load_id: Number(member.id),
      })}));
      if (evaluations.some(item => item.evaluation.hard_conflicts.length > 0)) continue;
      ranked.push({
        slot,
        warnings: evaluations.flatMap(item => item.evaluation.warnings),
        penalty: evaluations.reduce((sum, item) => sum + candidatePenalty(item.member, slot, entries, loadsById, slotsById, item.evaluation.warnings)
          + pedagogyScorer.candidatePenalty(item.member, slot, entries), 0),
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
      is_locked: 0,
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
        entries.push(...groupFor(load).map(member => makeEntry(member, candidate.slot)));
        remaining -= 1;
      }
    }
    return entries;
  }

  if (fixedValidation.conflicts.length > 0) {
    const penalties = emptyPenaltyBreakdown();
    const unscheduled = activeLoads.map((load) => ({
      teaching_load_id: Number(load.id),
      subject_id: Number(load.subject_id),
      subject_name: load.subject_name || 'مادة غير معروفة',
      class_id: Number(load.class_id),
      class_name: load.class_name || 'صف غير معروف',
      section_id: load.section_id == null ? null : Number(load.section_id),
      section_name: load.section_name || null,
      employee_id: load.employee_id == null ? null : Number(load.employee_id),
      employee_name: load.employee_name || null,
      remaining_count: Number(load.weekly_periods),
      reason_codes: ['insufficient_slot_domain'] as TimetableSolverReasonCode[],
      reasons: ['الدروس المثبتة تمنع إنشاء جدول صالح.'],
    }));
    return {
      status: 'fixed_conflict',
      quality_score: 0,
      required_periods: readiness.total_required_periods,
      scheduled_periods: 0,
      unscheduled_periods: readiness.total_required_periods,
      entries: [],
      unscheduled,
      warnings: ['الدروس المثبتة تمنع إنشاء جدول صالح.'],
      scoring: {
        model: 'comparative-v1',
        total_penalty: 0,
        maximum_reference_penalty: 1,
        penalties,
        preferred_slots_used: 0,
        note: 'تعذر تقييم الجودة قبل إصلاح تعارضات الدروس المثبتة.',
      },
      statistics: {
        attempts: 0,
        backtracks: 0,
        local_improvement_attempts: 0,
        elapsed_ms: Date.now() - startedAt,
        time_budget_ms: limits.time_budget_ms,
        attempt_budget: limits.max_attempts,
        backtrack_budget: limits.max_backtracks,
        stopped_by_limit: false,
        current_valid_entry_count: 0,
        existing_invalid_entry_count: input.currentEntries?.length || 0,
        active_day_count: activeDays.length,
        active_lesson_slot_count: scheduleSlots.length,
      },
      readiness,
      days: activeDays,
      slots: scopedSlots.filter((slot) => Number(slot.is_active) === 1),
      placements: input.placements,
      fixed_conflicts: fixedValidation.conflicts,
    };
  }

  let bestEntries = greedyFill(fixedEntries);
  // Repair greedy dead ends by moving a small number of blocking lessons. All
  // partners move together and every replacement uses the normal validator.
  // The deterministic attempt ceiling also bounds this on runtimes whose clock
  // does not advance during synchronous computation.
  const repairAttemptCeiling = Math.floor(limits.max_attempts * 0.7);
  function repairMissingLesson(load: TimetableTeachingLoad, entries: InternalEntry[], depth: number, ancestors: Set<number>): InternalEntry[] | null {
    if (attempts >= repairAttemptCeiling || deterministicBudgetExpired() || ancestors.has(load.id)) return null;
    const group = groupFor(load);
    const teachers = new Set(group.flatMap(member => member.employee_id == null ? [] : [member.employee_id]));
    const nextAncestors = new Set([...ancestors, ...group.map(member => member.id)]);
    const candidates = scheduleSlots.map(slot => {
      const blockers = entries.filter(entry => {
        if (entry.slot_id !== slot.id) return false;
        const existing = loadsById.get(entry.teaching_load_id);
        return existing && (timetableLoadsShareGroup(existing, load)
          || (existing.employee_id != null && teachers.has(existing.employee_id)));
      });
      const blockerGroups = new Map<number, TimetableTeachingLoad>();
      for (const blocker of blockers) {
        const representative = groupFor(loadsById.get(blocker.teaching_load_id)!)[0];
        blockerGroups.set(representative.id, representative);
      }
      return {slot, blockerGroups};
    }).sort((left, right) => left.blockerGroups.size - right.blockerGroups.size || left.slot.id - right.slot.id);
    for (const {slot, blockerGroups} of candidates) {
      ensureWithinWallClockSafetyLimit();
      if (attempts >= repairAttemptCeiling || deterministicBudgetExpired()) return null;
      if (blockerGroups.size > 2 || (depth === 0 && blockerGroups.size > 0)
        || [...blockerGroups.keys()].some(id => nextAncestors.has(id))) continue;
      const removedLoadIds = new Set([...blockerGroups.values()].flatMap(blocker => groupFor(blocker).map(member => member.id)));
      const removed = entries.filter(entry => entry.slot_id === slot.id && removedLoadIds.has(entry.teaching_load_id));
      if (removed.some(entry => fixedEntryKeys.has(`${entry.slot_id}:${entry.teaching_load_id}`))) continue;
      const removedIds = new Set(removed.map(entry => entry.id));
      let repaired = entries.filter(entry => !removedIds.has(entry.id));
      const evaluate = preparePlacementEvaluator(repaired);
      attempts += 1;
      if (group.some(member => evaluate({slot_id: slot.id, teaching_load_id: member.id}).hard_conflicts.length > 0)) continue;
      repaired.push(...group.map(member => makeEntry(member, slot)));
      let complete = true;
      for (const blocker of blockerGroups.values()) {
        const relocated = repairMissingLesson(blocker, repaired, depth - 1, nextAncestors);
        if (!relocated) { complete = false; break; }
        repaired = relocated;
      }
      if (complete) return repaired;
    }
    return null;
  }
  if (coverage(bestEntries) < desiredCoverage) {
    for (const load of orderedLoads) {
      let missing = Number(load.weekly_periods) - bestEntries.filter(entry => entry.teaching_load_id === load.id).length;
      while (missing > 0 && attempts < repairAttemptCeiling && !deterministicBudgetExpired()) {
        const repaired = repairMissingLesson(load, bestEntries, 3, new Set());
        if (!repaired) break;
        bestEntries = repaired;
        missing -= 1;
      }
    }
  }
  const savedEntries = input.currentEntries || [];
  if (savedEntries.length > 0 && coverage(savedEntries) >= coverage(bestEntries)
    && [...fixedEntryKeys].every(key => savedEntries.some(entry => `${entry.slot_id}:${entry.teaching_load_id}` === key))
    && validateTimetableSolverProposal(input, savedEntries, ensureWithinWallClockSafetyLimit).length === 0) {
    const savedScore = scoreProposal({entries: savedEntries, loads: validLoads, slots: scopedSlots, days: scopedDays,
      availability, constraints, pedagogyScorer}, ensureWithinWallClockSafetyLimit).scoring;
    const generatedScore = scoreProposal({entries: bestEntries, loads: validLoads, slots: scopedSlots, days: scopedDays,
      availability, constraints, pedagogyScorer}, ensureWithinWallClockSafetyLimit).scoring;
    if (coverage(savedEntries) > coverage(bestEntries)
      || (savedScore.penalties.early_light_subjects || 0) < (generatedScore.penalties.early_light_subjects || 0)
      || (savedScore.penalties.early_light_subjects || 0) === (generatedScore.penalties.early_light_subjects || 0)
        && savedScore.total_penalty < generatedScore.total_penalty) bestEntries = [...savedEntries];
  }
  const workingEntries: InternalEntry[] = [...fixedEntries];
  function searchForMoreCoverage(position: number): boolean {
    ensureWithinWallClockSafetyLimit();
    if (coverage(workingEntries) > coverage(bestEntries)) bestEntries = [...workingEntries];
    if (coverage(bestEntries) === desiredCoverage) return true;
    if (position >= demandUnits.length || deterministicBudgetExpired()) return false;
    const remainingDemand = demandUnits.length - position;
    if (coverage(workingEntries) + remainingDemand <= coverage(bestEntries)) return false;

    const { load } = demandUnits[position];
    const candidates = rankCandidates(load, workingEntries);
    for (const candidate of candidates) {
      if (deterministicBudgetExpired()) return false;
      const additions = groupFor(load).map(member => makeEntry(member, candidate.slot));
      workingEntries.push(...additions);
      if (searchForMoreCoverage(position + 1)) return true;
      workingEntries.splice(workingEntries.length - additions.length, additions.length);
      backtracks += 1;
      if (deterministicBudgetExpired()) return false;
    }
    return searchForMoreCoverage(position + 1);
  }

  if (coverage(bestEntries) < desiredCoverage && !deterministicBudgetExpired()) searchForMoreCoverage(0);
  let proposalEntries = [...bestEntries];

  const scoreEntries = (entries: InternalEntry[]) => scoreProposal({entries, loads: validLoads, slots: scopedSlots,
    days: scopedDays, availability, constraints, pedagogyScorer}, ensureWithinWallClockSafetyLimit);
  const betterScore = (candidate: TimetableSolverScoring, current: TimetableSolverScoring) => (
    (candidate.penalties.early_light_subjects || 0) < (current.penalties.early_light_subjects || 0)
    || (candidate.penalties.early_light_subjects || 0) === (current.penalties.early_light_subjects || 0)
      && candidate.total_penalty < current.total_penalty
  );
  // Leave time for validation/formatting, even when the browser is slower than
  // the test machine. The count limit remains authoritative with a frozen clock.
  const improvementDeadline = startedAt + Math.max(0, limits.time_budget_ms - Math.max(100, limits.time_budget_ms * 0.35));
  const canImprove = () => localImprovementAttempts < limits.max_local_improvement_attempts
    && attempts < limits.max_attempts && Date.now() < improvementDeadline;
  let currentScore = scoreEntries(proposalEntries).scoring;
  const groupEntries = (entry: InternalEntry) => {
    const load = loadsById.get(entry.teaching_load_id)!;
    const groupIds = new Set(groupFor(load).map(member => member.id));
    return proposalEntries.filter(item => item.slot_id === entry.slot_id && groupIds.has(item.teaching_load_id));
  };
  const isFixedGroup = (entries: InternalEntry[]) => entries.some(entry => fixedEntryKeys.has(`${entry.slot_id}:${entry.teaching_load_id}`));

  // Full sections have no free slot for single-entry moves. Swap two complete
  // teaching groups within a section so demand and section coverage never fall.
  for (let pass = 0; pass < 3 && canImprove(); pass += 1) {
    let improved = false;
    const representatives = proposalEntries.filter(entry => groupFor(loadsById.get(entry.teaching_load_id)!)[0].id === entry.teaching_load_id);
    const priority = new Map(representatives.map(entry => [entry.id,
      pedagogyScorer.candidatePenalty(loadsById.get(entry.teaching_load_id)!, slotsById.get(entry.slot_id)!, proposalEntries.filter(item => item.id !== entry.id))]));
    representatives.sort((a, b) => priority.get(b.id)! - priority.get(a.id)! || a.teaching_load_id - b.teaching_load_id || a.id - b.id);
    for (const original of representatives) {
      if (!canImprove()) break;
      const left = proposalEntries.find(entry => entry.id === original.id)!;
      const leftLoad = loadsById.get(left.teaching_load_id)!;
      const leftGroup = groupEntries(left);
      if (isFixedGroup(leftGroup)) continue;
      const targets = representatives.filter(target => {
        const targetLoad = loadsById.get(target.teaching_load_id)!;
        return targetLoad.class_id === leftLoad.class_id && sameNullableId(targetLoad.section_id, leftLoad.section_id)
          && target.teaching_load_id !== left.teaching_load_id;
      });
      for (const target of targets) {
        if (!canImprove()) break;
        const right = proposalEntries.find(entry => entry.id === target.id)!;
        if (right.slot_id === left.slot_id) continue;
        const rightGroup = groupEntries(right);
        if (isFixedGroup(rightGroup)) continue;
        localImprovementAttempts += 1;
        const movedIds = new Set([...leftGroup, ...rightGroup].map(entry => entry.id));
        const moved = [...leftGroup.map(entry => ({...entry, slot_id: right.slot_id})),
          ...rightGroup.map(entry => ({...entry, slot_id: left.slot_id}))];
        const candidateEntries = [...proposalEntries.filter(entry => !movedIds.has(entry.id)), ...moved];
        const evaluate = preparePlacementEvaluator(candidateEntries);
        if (moved.some(entry => evaluate(entry, {validateWholeSchedule: true}).hard_conflicts.length > 0)) continue;
        const candidateScore = scoreEntries(candidateEntries).scoring;
        if (!betterScore(candidateScore, currentScore)) continue;
        proposalEntries = candidateEntries;
        currentScore = candidateScore;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }

  if (canImprove() && proposalEntries.length > 1) {
    for (const original of [...proposalEntries].sort((left, right) => Number(left.id) - Number(right.id))) {
      if (!canImprove()) break;
      if (fixedEntryKeys.has(`${original.slot_id}:${original.teaching_load_id}`)) continue;
      const load = loadsById.get(Number(original.teaching_load_id));
      if (!load) continue;
      const group = groupFor(load);
      if (group[0].id !== load.id) continue;
      const originalGroup = proposalEntries.filter(entry => entry.slot_id === original.slot_id && group.some(member => member.id === entry.teaching_load_id));
      if (originalGroup.some(entry => fixedEntryKeys.has(`${entry.slot_id}:${entry.teaching_load_id}`))) continue;
      const originalIds = new Set(originalGroup.map(entry => entry.id));
      const withoutOriginal = proposalEntries.filter((entry) => !originalIds.has(entry.id));
      const alternatives = rankCandidates(load, withoutOriginal).filter((candidate) => Number(candidate.slot.id) !== Number(original.slot_id));
      for (const candidate of alternatives.slice(0, 8)) {
        localImprovementAttempts += 1;
        const replacements = originalGroup.map(entry => ({...entry, slot_id: Number(candidate.slot.id)}));
        const candidateEntries = [...withoutOriginal, ...replacements];
        const candidateScore = scoreEntries(candidateEntries).scoring;
        if (betterScore(candidateScore, currentScore)) {
          proposalEntries = candidateEntries;
          currentScore = candidateScore;
          break;
        }
        if (!canImprove()) break;
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
    .filter((load) => !loadIsValid(load, input.schoolId, input.academicYearId) || parallelInvalid.has(load.id))
    .map((load) => Number(load.id)));
  const overloadedPlacementKeys = new Set(readiness.overloaded_class_sections.map((item) => `${item.class_id}:${item.section_id ?? 'none'}`));
  const overloadedTeacherIds = new Set(readiness.overloaded_teachers.map((item) => Number(item.employee_id)));

  const evaluateProposal = preparePlacementEvaluator(proposalEntries);
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
        const evaluations = groupFor(load).map(member => evaluateProposal({
          slot_id: Number(slot.id), teaching_load_id: Number(member.id),
        }));
        const hardConflicts = evaluations.flatMap(item => item.hard_conflicts);
        if (hardConflicts.length === 0) {
          hasValidCandidate = true;
          continue;
        }
        conflictSets.push(new Set(hardConflicts
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
  const evaluateCurrent = preparePlacementEvaluator(currentEntries);
  let currentValidEntryCount = 0;
  for (const entry of currentEntries) {
    ensureWithinWallClockSafetyLimit();
    const evaluation = evaluateCurrent(
      { id: entry.id, slot_id: entry.slot_id, teaching_load_id: entry.teaching_load_id },
      { validateWholeSchedule: true },
    );
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
  const score = scoreEntries(orderedProposal);
  const proposal = orderedProposal.map<TimetableSolverProposalEntry>((entry, index) => {
    ensureWithinWallClockSafetyLimit();
    const load = loadsById.get(Number(entry.teaching_load_id))!;
    const slot = slotsById.get(Number(entry.slot_id))!;
    const evaluation = evaluateProposal({ id: entry.id, slot_id: entry.slot_id, teaching_load_id: entry.teaching_load_id });
    return {
      proposal_id: `proposal-${String(index + 1).padStart(4, '0')}`,
      slot_id: Number(slot.id),
      teaching_load_id: Number(load.id),
      parallel_with_load_id: load.parallel_with_load_id ?? null,
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
      is_locked: fixedEntries.find(fixed => fixed.slot_id === entry.slot_id && fixed.teaching_load_id === entry.teaching_load_id)?.is_locked ?? 0,
    };
  });
  const scheduledPeriods = countTimetableScheduledSectionPeriods(proposal, validLoads);
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
    ...(stoppedByLimit ? ['توقف البحث عند حد الأمان المحدد؛ راجع الدروس غير المجدولة أو أعد ضبط القيود.'] : []),
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
    fixed_conflicts: [],
  };
}
