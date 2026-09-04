import {
  evaluateTimetableEntryPlacement,
  loadHasInvalidAcademicReference,
  loadHasInvalidTeacherReference,
  type TimetableDay,
  type TimetableEntry,
  type TimetableEntryNotice,
  type TimetableSlot,
  type TimetableTeacherAvailabilityOverride,
  type TimetableTeacherConstraints,
  type TimetableTeachingLoad,
} from './timetable.ts';
import type { TimetableSolverPreview } from './timetableSolver.ts';

export const STALE_TIMETABLE_PROPOSAL_CODE = 'stale_timetable_proposal';
export const STALE_TIMETABLE_PROPOSAL_MESSAGE = 'تغيرت بيانات الجدول بعد إنشاء المقترح. أنشئ المعاينة من جديد.';

export interface TimetableProposalPlacement {
  slot_id: number;
  teaching_load_id: number;
  is_locked: 0 | 1;
}

export interface TimetableComparisonDetail {
  teaching_load_id: number;
  kind: 'unchanged' | 'moved' | 'added' | 'removed';
  from_slot_id: number | null;
  to_slot_id: number | null;
  locked: boolean;
}

export interface TimetableComparison {
  unchanged: number;
  moved: number;
  added: number;
  removed: number;
  locked_preserved: number;
  details: TimetableComparisonDetail[];
}

export interface TimetableScheduleValidationBlocker {
  code: string;
  message: string;
  slot_id?: number;
  teaching_load_id?: number;
}

export interface TimetableScheduleValidation {
  complete: boolean;
  required_periods: number;
  scheduled_periods: number;
  blockers: TimetableScheduleValidationBlocker[];
}

export interface TimetableSolverProposalWithIntegrity extends TimetableSolverPreview {
  timetable_revision: number;
  proposal_digest: string;
}

export interface TimetableAdoptionPreview {
  can_apply: boolean;
  comparison: TimetableComparison;
  current_entry_count: number;
  proposed_entry_count: number;
  locked_count: number;
  current_invalid_entry_count: number;
  revision: number;
  proposal_digest: string;
  warnings: string[];
  blockers: TimetableScheduleValidationBlocker[];
}

export interface TimetableScheduleVersion {
  id: number;
  school_id: number;
  academic_year_id: number;
  source: 'automatic_adoption' | 'manual_restore';
  previous_revision: number;
  created_by_user_id: number | null;
  created_by_name: string | null;
  restored_from_version_id: number | null;
  old_entry_count: number;
  new_entry_count: number;
  locked_entry_count: number;
  proposal_digest: string;
  created_at: number;
}

export interface TimetableScheduleVersionEntry extends TimetableProposalPlacement {
  id: number;
  version_id: number;
  original_entry_id: number | null;
  school_id: number;
  academic_year_id: number;
  created_at: number;
}

export interface TimetableScheduleVersionDetails extends TimetableScheduleVersion {
  entries: TimetableScheduleVersionEntry[];
}

export interface TimetableRestorePreview extends TimetableAdoptionPreview {
  version: TimetableScheduleVersion;
  restorable_entry_count: number;
  invalid_historical_entry_count: number;
}

export interface TimetableValidationContext {
  schoolId: number;
  academicYearId: number;
  days: TimetableDay[];
  slots: TimetableSlot[];
  loads: TimetableTeachingLoad[];
  availability: TimetableTeacherAvailabilityOverride[];
  constraints: TimetableTeacherConstraints[];
}

function numericPlacement(entry: Pick<TimetableProposalPlacement, 'slot_id' | 'teaching_load_id' | 'is_locked'>): TimetableProposalPlacement {
  return {
    slot_id: Number(entry.slot_id),
    teaching_load_id: Number(entry.teaching_load_id),
    is_locked: Number(entry.is_locked) === 1 ? 1 : 0,
  };
}

export function canonicalTimetableProposalEntries(
  entries: Array<Pick<TimetableProposalPlacement, 'slot_id' | 'teaching_load_id' | 'is_locked'>>,
): TimetableProposalPlacement[] {
  return entries.map(numericPlacement).sort((left, right) => (
    left.teaching_load_id - right.teaching_load_id
    || left.slot_id - right.slot_id
    || left.is_locked - right.is_locked
  ));
}

export function timetableProposalDigestSource(input: {
  schoolId: number;
  academicYearId: number;
  revision: number;
  entries: TimetableProposalPlacement[];
}): string {
  return JSON.stringify({
    school_id: Number(input.schoolId),
    academic_year_id: Number(input.academicYearId),
    revision: Number(input.revision),
    entries: canonicalTimetableProposalEntries(input.entries),
  });
}

export async function computeTimetableProposalDigest(input: {
  schoolId: number;
  academicYearId: number;
  revision: number;
  entries: TimetableProposalPlacement[];
}): Promise<string> {
  const bytes = new TextEncoder().encode(timetableProposalDigestSource(input));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

function groupedSlots(entries: Array<Pick<TimetableProposalPlacement, 'slot_id' | 'teaching_load_id' | 'is_locked'>>) {
  const result = new Map<number, TimetableProposalPlacement[]>();
  for (const entry of canonicalTimetableProposalEntries(entries)) {
    const current = result.get(entry.teaching_load_id) || [];
    current.push(entry);
    result.set(entry.teaching_load_id, current);
  }
  return result;
}

export function compareTimetableSchedules(
  currentEntries: Array<Pick<TimetableProposalPlacement, 'slot_id' | 'teaching_load_id' | 'is_locked'>>,
  proposedEntries: TimetableProposalPlacement[],
): TimetableComparison {
  const currentByLoad = groupedSlots(currentEntries);
  const proposedByLoad = groupedSlots(proposedEntries);
  const loadIds = [...new Set([...currentByLoad.keys(), ...proposedByLoad.keys()])].sort((a, b) => a - b);
  const details: TimetableComparisonDetail[] = [];
  let lockedPreserved = 0;

  for (const teachingLoadId of loadIds) {
    const oldEntries = [...(currentByLoad.get(teachingLoadId) || [])];
    const newEntries = [...(proposedByLoad.get(teachingLoadId) || [])];
    const unmatchedOld: TimetableProposalPlacement[] = [];
    const unmatchedNew = [...newEntries];
    for (const oldEntry of oldEntries) {
      const exactIndex = unmatchedNew.findIndex((entry) => entry.slot_id === oldEntry.slot_id);
      if (exactIndex < 0) {
        unmatchedOld.push(oldEntry);
        continue;
      }
      const [exact] = unmatchedNew.splice(exactIndex, 1);
      const lockPreserved = oldEntry.is_locked === 1 && exact.is_locked === 1;
      if (lockPreserved) lockedPreserved += 1;
      details.push({
        teaching_load_id: teachingLoadId,
        kind: 'unchanged',
        from_slot_id: oldEntry.slot_id,
        to_slot_id: exact.slot_id,
        locked: lockPreserved,
      });
    }
    while (unmatchedOld.length > 0 && unmatchedNew.length > 0) {
      const oldEntry = unmatchedOld.shift()!;
      const newEntry = unmatchedNew.shift()!;
      details.push({
        teaching_load_id: teachingLoadId,
        kind: 'moved',
        from_slot_id: oldEntry.slot_id,
        to_slot_id: newEntry.slot_id,
        locked: oldEntry.is_locked === 1 && newEntry.is_locked === 1,
      });
    }
    for (const oldEntry of unmatchedOld) {
      details.push({
        teaching_load_id: teachingLoadId,
        kind: 'removed',
        from_slot_id: oldEntry.slot_id,
        to_slot_id: null,
        locked: oldEntry.is_locked === 1,
      });
    }
    for (const newEntry of unmatchedNew) {
      details.push({
        teaching_load_id: teachingLoadId,
        kind: 'added',
        from_slot_id: null,
        to_slot_id: newEntry.slot_id,
        locked: newEntry.is_locked === 1,
      });
    }
  }

  return {
    unchanged: details.filter((item) => item.kind === 'unchanged').length,
    moved: details.filter((item) => item.kind === 'moved').length,
    added: details.filter((item) => item.kind === 'added').length,
    removed: details.filter((item) => item.kind === 'removed').length,
    locked_preserved: lockedPreserved,
    details,
  };
}

function blockerFromNotice(
  notice: TimetableEntryNotice,
  entry: TimetableProposalPlacement,
): TimetableScheduleValidationBlocker {
  return {
    code: notice.code,
    message: notice.message,
    slot_id: entry.slot_id,
    teaching_load_id: entry.teaching_load_id,
  };
}

function loadIsValid(load: TimetableTeachingLoad, context: TimetableValidationContext): boolean {
  return load.status === 'active'
    && Number(load.school_id) === context.schoolId
    && Number(load.academic_year_id) === context.academicYearId
    && !loadHasInvalidAcademicReference(load)
    && !loadHasInvalidTeacherReference(load);
}

export function validateCompleteTimetableSchedule(
  context: TimetableValidationContext,
  proposedEntries: TimetableProposalPlacement[],
): TimetableScheduleValidation {
  const entries = canonicalTimetableProposalEntries(proposedEntries);
  const blockers: TimetableScheduleValidationBlocker[] = [];
  const uniquePairs = new Set<string>();
  const loadsById = new Map(context.loads.map((load) => [Number(load.id), load]));
  const internalEntries: TimetableEntry[] = entries.map((entry, index) => ({
    id: -(index + 1),
    school_id: context.schoolId,
    academic_year_id: context.academicYearId,
    slot_id: entry.slot_id,
    teaching_load_id: entry.teaching_load_id,
    is_locked: entry.is_locked,
    created_by_user_id: null,
    updated_by_user_id: null,
    created_at: 0,
    updated_at: 0,
  }));

  for (const entry of entries) {
    const pair = `${entry.slot_id}:${entry.teaching_load_id}`;
    if (uniquePairs.has(pair)) {
      blockers.push({ code: 'duplicate_proposal_entry', message: 'يحتوي المقترح على حصة مكررة', ...entry });
      continue;
    }
    uniquePairs.add(pair);
    const load = loadsById.get(entry.teaching_load_id);
    if (!load || !loadIsValid(load, context)) {
      blockers.push({ code: 'invalid_teaching_load', message: 'يحتوي المقترح على نصاب غير صالح', ...entry });
      continue;
    }
    const internal = internalEntries.find((item) => (
      item.slot_id === entry.slot_id && item.teaching_load_id === entry.teaching_load_id
    ))!;
    const evaluation = evaluateTimetableEntryPlacement({
      candidate: internal,
      days: context.days,
      slots: context.slots,
      loads: context.loads,
      entries: internalEntries,
      teacherAvailability: context.availability,
      teacherConstraints: context.constraints,
    });
    blockers.push(...evaluation.hard_conflicts.map((notice) => blockerFromNotice(notice, entry)));
  }

  const activeLoads = context.loads.filter((load) => load.status === 'active');
  for (const load of activeLoads) {
    const count = entries.filter((entry) => entry.teaching_load_id === Number(load.id)).length;
    if (!loadIsValid(load, context)) {
      blockers.push({
        code: 'invalid_teaching_load',
        message: 'يوجد نصاب فعال غير صالح ولا يمكن اعتماد جدول رسمي قبل إصلاحه',
        teaching_load_id: Number(load.id),
      });
    } else if (count !== Number(load.weekly_periods)) {
      blockers.push({
        code: 'incomplete_weekly_demand',
        message: 'لا يغطي المقترح العدد الأسبوعي المطلوب لكل الأنصبة',
        teaching_load_id: Number(load.id),
      });
    }
  }

  const requiredPeriods = activeLoads
    .filter((load) => loadIsValid(load, context))
    .reduce((sum, load) => sum + Number(load.weekly_periods), 0);
  return {
    complete: blockers.length === 0 && entries.length === requiredPeriods,
    required_periods: requiredPeriods,
    scheduled_periods: entries.length,
    blockers,
  };
}
