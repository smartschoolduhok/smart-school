import { TIMETABLE_DAY_NAMES, loadHasInvalidAcademicReference, loadHasInvalidTeacherReference, type TimetableDay,
  type TimetableEntryNotice, type TimetableSlot, type TimetableTeacherAvailabilityOverride, type TimetableTeachingLoad } from './timetable.ts';
import { normalizeTimetableSubjectName } from './timetablePedagogy.ts';

type Entry = { slot_id: number; teaching_load_id: number };
type Lesson = { day: number; position: number; school: number; year: number };
export type TimetableDailySubjectNotice = TimetableEntryNotice & {
  teaching_load_id: number;
  slot_id: number;
  day_of_week: number;
};

const logicalIdentity = (load: TimetableTeachingLoad) =>
  `${load.school_id}:${load.academic_year_id}:${load.class_id}:${load.section_id ?? 'none'}:${normalizeTimetableSubjectName(load.subject_name || '') || `subject-${load.subject_id}`}`;

/** A lower bound only: demand beyond distinct available days cannot fit without doubles. */
export function minimumTimetableSubjectDoubles(input: {
  loads: readonly TimetableTeachingLoad[];
  days: readonly TimetableDay[];
  slots: readonly TimetableSlot[];
  teacherAvailability?: readonly TimetableTeacherAvailabilityOverride[];
  dailySubjectLoadIds?: readonly number[];
}): number {
  const eligible = input.dailySubjectLoadIds == null ? null : new Set(input.loads
    .filter(load => input.dailySubjectLoadIds!.includes(load.id)).map(logicalIdentity));
  const activeDays = new Set(input.days.filter(day => Number(day.is_active) === 1)
    .map(day => `${day.school_id}:${day.academic_year_id}:${day.day_of_week}`));
  const availableSlots = input.slots.filter(slot => Number(slot.is_active) === 1 && slot.slot_type === 'lesson'
    && activeDays.has(`${slot.school_id}:${slot.academic_year_id}:${slot.day_of_week}`));
  const unavailable = new Set((input.teacherAvailability || []).filter(item => item.status === 'unavailable')
    .map(item => `${item.school_id}:${item.academic_year_id}:${item.employee_id}:${item.slot_id}`));
  const groups = new Map<string, {quota: number; days: Set<number>}>();
  for (const load of input.loads) {
    if (load.status !== 'active' || load.weekly_periods <= 0
      || loadHasInvalidAcademicReference(load) || loadHasInvalidTeacherReference(load)) continue;
    const identity = logicalIdentity(load);
    if (eligible && !eligible.has(identity)) continue;
    let group = groups.get(identity);
    if (!group) { group = {quota: 0, days: new Set()}; groups.set(identity, group); }
    group.quota += Number(load.weekly_periods);
    for (const slot of availableSlots) {
      if (slot.school_id !== load.school_id || slot.academic_year_id !== load.academic_year_id) continue;
      if (load.employee_id != null && unavailable.has(`${load.school_id}:${load.academic_year_id}:${load.employee_id}:${slot.id}`)) continue;
      group.days.add(slot.day_of_week);
    }
  }
  let minimum = 0;
  for (const group of groups.values()) minimum += Math.max(0, group.quota - group.days.size);
  return minimum;
}

/** Generation policy only. A second daily lesson is an adjacent, last-resort pair. */
export function createTimetableDailySubjectPolicy(
  loads: readonly TimetableTeachingLoad[],
  slots: readonly TimetableSlot[],
  eligibleLoadIds?: readonly number[],
) {
  const loadById = new Map(loads.map(load => [load.id, load]));
  // Candidate ranking calls this policy hundreds of thousands of times; intern
  // logical identities once so the inner loop compares numbers, not long names.
  const identities = new Map<string, number>();
  const identityByLoad = new Map<number, number>();
  for (const load of loads) {
    const key = logicalIdentity(load);
    let identity = identities.get(key);
    if (identity == null) { identity = identities.size; identities.set(key, identity); }
    identityByLoad.set(load.id, identity);
  }
  const eligibleIdentities = eligibleLoadIds == null ? null : new Set(eligibleLoadIds
    .map(id => identityByLoad.get(id)).filter((key): key is number => key != null));
  const days = new Map<string, TimetableSlot[]>();
  for (const slot of slots) {
    if (Number(slot.is_active) !== 1 || slot.slot_type !== 'lesson') continue;
    const key = `${slot.school_id}:${slot.academic_year_id}:${slot.day_of_week}`;
    const day = days.get(key);
    if (day) day.push(slot); else days.set(key, [slot]);
  }
  const lessonBySlot = new Map<number, Lesson>();
  for (const day of days.values()) {
    day.sort((a, b) => String(a.start_time ?? '').localeCompare(String(b.start_time ?? '')) || a.slot_index - b.slot_index || a.id - b.id);
    day.forEach((slot, position) => lessonBySlot.set(slot.id, {
      day: slot.day_of_week, position, school: slot.school_id, year: slot.academic_year_id,
    }));
  }

  function describe(loadId: number, slotId: number) {
    const identity = identityByLoad.get(loadId);
    if (identity == null || eligibleIdentities != null && !eligibleIdentities.has(identity)) return null;
    const load = loadById.get(loadId)!, lesson = lessonBySlot.get(slotId);
    // Invalid references belong to the existing placement validator.
    if (!lesson || load.school_id !== lesson.school || load.academic_year_id !== lesson.year) return null;
    return { identity, lesson, load };
  }

  function canPlace(loadId: number, slotId: number, entries: readonly Entry[], allowDouble: boolean): boolean {
    const candidate = describe(loadId, slotId);
    if (!candidate) return true;
    let previousPosition: number | undefined;
    for (const entry of entries) {
      if (identityByLoad.get(entry.teaching_load_id) !== candidate.identity) continue;
      const lesson = lessonBySlot.get(entry.slot_id);
      if (!lesson || lesson.school !== candidate.lesson.school || lesson.year !== candidate.lesson.year || lesson.day !== candidate.lesson.day) continue;
      if (!allowDouble || previousPosition != null) return false;
      previousPosition = lesson.position;
    }
    return previousPosition == null || Math.abs(candidate.lesson.position - previousPosition) === 1;
  }

  function collect(entries: readonly Entry[]) {
    const groups = new Map<string, { load: TimetableTeachingLoad; day: number; entries: Array<{entry: Entry; position: number}> }>();
    for (const entry of entries) {
      const data = describe(entry.teaching_load_id, entry.slot_id);
      if (!data) continue;
      const key = `${data.identity}:${data.lesson.day}`;
      let group = groups.get(key);
      if (!group) {
        group = { load: data.load, day: data.lesson.day, entries: [] };
        groups.set(key, group);
      }
      group.entries.push({entry, position: data.lesson.position});
    }
    return groups;
  }

  function validate(entries: readonly Entry[], allowDouble = true): TimetableDailySubjectNotice[] {
    const notices: TimetableDailySubjectNotice[] = [];
    for (const group of collect(entries).values()) {
      if (group.entries.length < 2) continue;
      if (allowDouble && group.entries.length === 2 && Math.abs(group.entries[0].position - group.entries[1].position) === 1) continue;
      const {load, day} = group;
      const placement = `${load.class_name || 'الصف'}${load.section_id == null ? '' : ` / ${load.section_name || 'الشعبة'}`}`;
      const reason = !allowDouble
        ? 'يجب توزيع المادة بواقع درس واحد يوميًا قبل اللجوء إلى درسين متتاليين عند الضرورة.'
        : group.entries.length > 2
          ? 'الحد الأقصى درسان متتاليان عند الضرورة؛ لا يُسمح بثلاثة دروس أو أكثر للمادة في اليوم نفسه.'
          : 'لا يُسمح بتكرار المادة في درسين منفصلين؛ يجب أن يكون الدرسان متتاليين، ويُسمح بذلك عند الضرورة فقط.';
      notices.push({
        code: 'subject_daily_repetition',
        teaching_load_id: load.id,
        slot_id: group.entries[1].entry.slot_id,
        day_of_week: day,
        message: `${load.subject_name || 'المادة'} / ${placement} يوم ${TIMETABLE_DAY_NAMES[day] || day}: ${reason}`,
      });
    }
    return notices;
  }

  function countDoubles(entries: readonly Entry[]): number {
    let count = 0;
    for (const group of collect(entries).values()) if (group.entries.length > 1) count += 1;
    return count;
  }

  return {canPlace, validate, countDoubles};
}
