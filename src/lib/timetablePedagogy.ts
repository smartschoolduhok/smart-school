import type { TimetableSlot, TimetableTeachingLoad } from './timetable.ts';

export type TimetableSubjectEffort = 'light' | 'heavy' | 'neutral';
export interface TimetablePedagogyMetrics {
  early_light_lessons: number;
  heavy_run_excess: number;
  consecutive_section_pairs: number;
  possible_section_pairs: number;
  late_science_lessons: number;
  repeated_first_subjects: number;
}
export interface TimetablePedagogyScore {
  penalties: {early_light_subjects: number; consecutive_heavy_subjects: number; missed_section_continuity: number; late_science_subjects: number; repeated_first_subjects: number};
  metrics: TimetablePedagogyMetrics;
}
type Entry = {slot_id: number; teaching_load_id: number};
type SectionLesson = {position: number; section: number};

// Keep the same teacher moving between sections ahead of minor timetable
// preferences. Availability, fixed lessons and other hard limits still win.
const sectionContinuityWeight = 48;

function countSectionPairs(lessons: readonly SectionLesson[]): number {
  const ordered = [...lessons].sort((a, b) => a.position - b.position);
  let pairs = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].position === ordered[index - 1].position + 1 && ordered[index].section !== ordered[index - 1].section) {
      pairs += 1;
      index += 1; // Each lesson belongs to at most one section pair.
    }
  }
  return pairs;
}

export function normalizeTimetableSubjectName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ک/g, 'ك').replace(/ی/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

// These are timetable preferences requested by the school, not an official
// assessment of subject difficulty. Unknown subject names remain neutral.
const lightNames = new Set([
  'اخلاق', 'الاخلاق', 'اخلاقية', 'الاخلاقية', 'التربية الاخلاقية',
  'فنية', 'الفنية', 'فن', 'الفن', 'فنون', 'الفنون', 'التربية الفنية', 'رسم', 'الرسم',
  'رياضة', 'الرياضة', 'رياضية', 'الرياضية', 'التربية الرياضية', 'التربية البدنية',
  'كردي', 'كردية', 'الكردية', 'كوردية', 'الكوردية', 'اللغة الكردية', 'اللغة الكوردية',
  'فرنسي', 'فرنسية', 'الفرنسية', 'اللغة الفرنسية',
  'حاسوب', 'الحاسوب', 'حاسبات', 'الحاسبات', 'الحاسوب وتقنية المعلومات', 'علوم الحاسوب',
  'ethics', 'art', 'arts', 'physical education', 'sport', 'sports', 'kurdish', 'french', 'computing', 'computer science',
]);
const heavyNames = new Set([
  'رياضيات', 'الرياضيات', 'عربي', 'عربية', 'العربية', 'اللغة العربية',
  'انكليزي', 'انكليزية', 'الانكليزية', 'اللغة الانكليزية', 'انجليزي', 'انجليزية', 'الانجليزية', 'اللغة الانجليزية',
  'علوم', 'العلوم', 'فيزياء', 'الفيزياء', 'كيمياء', 'الكيمياء', 'احياء', 'الاحياء',
  'mathematics', 'math', 'maths', 'arabic', 'english', 'science', 'physics', 'chemistry', 'biology',
]);

export function classifyTimetableSubject(name: string | null | undefined): TimetableSubjectEffort {
  const normalized = normalizeTimetableSubjectName(name || '');
  if (lightNames.has(normalized)) return 'light';
  if (heavyNames.has(normalized)) return 'heavy';
  return 'neutral';
}

const earlyScienceNames = new Set(['رياضيات', 'الرياضيات', 'فيزياء', 'الفيزياء', 'كيمياء', 'الكيمياء', 'math', 'maths', 'mathematics', 'physics', 'chemistry']);

/** Scheduling priority only; this never sets graduation or report-card policy. */
export function isTimetableTerminalClass(load: Pick<TimetableTeachingLoad, 'class_name' | 'class_stage'>): boolean {
  const label = normalizeTimetableSubjectName(`${load.class_name || ''} ${load.class_stage || ''}`)
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const third = /(?:^| )(?:الثالث|ثالث|3)(?: |$)/.test(label);
  const sixth = /(?:^| )(?:السادس|سادس|6)(?: |$)/.test(label);
  return third && /متوسط|ثانوي/.test(label)
    || sixth && /ابتدائي|اعدادي|ثانوي|علمي|ادبي/.test(label);
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key);
  if (values) values.push(value); else map.set(key, [value]);
}

export function createTimetablePedagogyScorer(loads: TimetableTeachingLoad[], slots: TimetableSlot[]) {
  const loadById = new Map(loads.map(load => [load.id, load]));
  const effortByLoad = new Map(loads.map(load => [load.id, classifyTimetableSubject(load.subject_name)]));
  const identityByLoad = new Map(loads.map(load => [load.id, normalizeTimetableSubjectName(load.subject_name || '') || `subject-${load.subject_id}`]));
  const slotById = new Map(slots.map(slot => [slot.id, slot]));
  const daySlots = new Map<string, TimetableSlot[]>();
  const scopeDay = (slot: TimetableSlot) => `${slot.school_id}:${slot.academic_year_id}:${slot.day_of_week}`;
  const positionBySlot = new Map<number, number>();
  const lessonPositionBySlot = new Map<number, number>();
  for (const slot of slots) if (Number(slot.is_active) === 1) append(daySlots, scopeDay(slot), slot);
  for (const day of daySlots.values()) {
    day.sort((a, b) => String(a.start_time ?? '').localeCompare(String(b.start_time ?? '')) || a.slot_index - b.slot_index || a.id - b.id);
    let lesson = 0;
    day.forEach((slot, position) => {
      positionBySlot.set(slot.id, position);
      if (slot.slot_type === 'lesson') lessonPositionBySlot.set(slot.id, lesson++);
    });
  }
  const placementKey = (load: TimetableTeachingLoad) => `${load.school_id}:${load.academic_year_id}:${load.class_id}:${load.section_id ?? 'none'}`;
  const continuityKey = (load: TimetableTeachingLoad) => `${load.school_id}:${load.academic_year_id}:${load.class_id}:${load.employee_id}:${identityByLoad.get(load.id)}`;
  const earlyPenalty = (loadId: number, slotId: number) => effortByLoad.get(loadId) !== 'light' ? 0
    : lessonPositionBySlot.get(slotId) === 0 ? 40 : lessonPositionBySlot.get(slotId) === 1 ? 20 : 0;
  const scienceLatePenalty = (load: TimetableTeachingLoad, slotId: number) => earlyScienceNames.has(identityByLoad.get(load.id)!)
    ? Math.max(0, (lessonPositionBySlot.get(slotId) ?? 0) - 1) * (isTimetableTerminalClass(load) ? 10 : 6) : 0;

  function score(entries: readonly Entry[]): TimetablePedagogyScore {
    const penalties = {early_light_subjects: 0, consecutive_heavy_subjects: 0, missed_section_continuity: 0, late_science_subjects: 0, repeated_first_subjects: 0};
    const metrics = {early_light_lessons: 0, heavy_run_excess: 0, consecutive_section_pairs: 0, possible_section_pairs: 0, late_science_lessons: 0, repeated_first_subjects: 0};
    const firstSubjectDays = new Map<string, Set<number>>();
    const placementDays = new Map<string, Map<number, {heavy: boolean; early: number}>>();
    const continuity = new Map<string, {sectionCounts: Map<number, number>; days: Map<string, SectionLesson[]>}>();
    for (const entry of entries) {
      const load = loadById.get(entry.teaching_load_id), slot = slotById.get(entry.slot_id);
      if (!load || !slot || slot.slot_type !== 'lesson' || !positionBySlot.has(slot.id)) continue;
      const scienceLate = scienceLatePenalty(load, slot.id);
      penalties.late_science_subjects += scienceLate;
      if (scienceLate > 0) metrics.late_science_lessons += 1;
      if (lessonPositionBySlot.get(slot.id) === 0) {
        const firstKey = `${placementKey(load)}:${identityByLoad.get(load.id)}`;
        const days = firstSubjectDays.get(firstKey) || new Set<number>();
        days.add(slot.day_of_week); firstSubjectDays.set(firstKey, days);
      }
      const dayKey = `${placementKey(load)}:${slot.day_of_week}`;
      const day = placementDays.get(dayKey) || new Map();
      const position = positionBySlot.get(slot.id)!;
      const current = day.get(position) || {heavy: false, early: 0};
      current.heavy ||= effortByLoad.get(load.id) === 'heavy';
      current.early = Math.max(current.early, earlyPenalty(load.id, slot.id));
      day.set(position, current); placementDays.set(dayKey, day);
      if (load.employee_id == null || load.section_id == null) continue;
      const key = continuityKey(load);
      const group = continuity.get(key) || {sectionCounts: new Map(), days: new Map()};
      group.sectionCounts.set(load.section_id, (group.sectionCounts.get(load.section_id) || 0) + 1);
      append(group.days, scopeDay(slot), {position: lessonPositionBySlot.get(slot.id)!, section: load.section_id});
      continuity.set(key, group);
    }
    for (const day of placementDays.values()) {
      let run = 0, previous = -2;
      for (const [position, lesson] of [...day].sort((a, b) => a[0] - b[0])) {
        if (lesson.early > 0) { penalties.early_light_subjects += lesson.early; metrics.early_light_lessons += 1; }
        run = lesson.heavy ? (position === previous + 1 ? run + 1 : 1) : 0;
        if (run > 2) metrics.heavy_run_excess += 1;
        previous = position;
      }
    }
    for (const group of continuity.values()) {
      if (group.sectionCounts.size < 2) continue;
      const counts = [...group.sectionCounts.values()];
      const total = counts.reduce((sum, value) => sum + value, 0);
      metrics.possible_section_pairs += Math.min(Math.floor(total / 2), total - Math.max(...counts));
      for (const day of group.days.values()) {
        metrics.consecutive_section_pairs += countSectionPairs(day);
      }
    }
    for (const days of firstSubjectDays.values()) {
      metrics.repeated_first_subjects += Math.max(0, days.size - 1);
      penalties.repeated_first_subjects += days.size * (days.size - 1) / 2 * 14;
    }
    penalties.consecutive_heavy_subjects = metrics.heavy_run_excess * 12;
    penalties.missed_section_continuity = Math.max(0, metrics.possible_section_pairs - metrics.consecutive_section_pairs) * sectionContinuityWeight;
    return {penalties, metrics};
  }

  function candidatePenalty(load: TimetableTeachingLoad, slot: TimetableSlot, entries: readonly Entry[]): number {
    let penalty = earlyPenalty(load.id, slot.id) + scienceLatePenalty(load, slot.id);
    const position = positionBySlot.get(slot.id);
    const lessonPosition = lessonPositionBySlot.get(slot.id);
    if (position == null || lessonPosition == null) return penalty;
    const heavyPositions = new Set<number>();
    const sameFirstDays = new Set<number>();
    const sectionLessons: SectionLesson[] = [];
    for (const entry of entries) {
      const other = loadById.get(entry.teaching_load_id), otherSlot = slotById.get(entry.slot_id);
      if (!other || !otherSlot) continue;
      if (lessonPosition === 0 && lessonPositionBySlot.get(otherSlot.id) === 0 && otherSlot.day_of_week !== slot.day_of_week
        && placementKey(other) === placementKey(load) && identityByLoad.get(other.id) === identityByLoad.get(load.id)) sameFirstDays.add(otherSlot.day_of_week);
      if (scopeDay(otherSlot) !== scopeDay(slot)) continue;
      if (placementKey(other) === placementKey(load) && effortByLoad.get(other.id) === 'heavy') heavyPositions.add(positionBySlot.get(otherSlot.id)!);
      const otherLessonPosition = lessonPositionBySlot.get(otherSlot.id);
      if (load.employee_id != null && load.section_id != null && other.section_id != null && otherLessonPosition != null
        && continuityKey(other) === continuityKey(load)) sectionLessons.push({position: otherLessonPosition, section: other.section_id});
    }
    if (effortByLoad.get(load.id) === 'heavy') {
      let before = 0, after = 0;
      while (heavyPositions.has(position - before - 1)) before += 1;
      while (heavyPositions.has(position + after + 1)) after += 1;
      penalty += Math.max(0, before + after - 1) * 12;
    }
    if (load.section_id != null && sectionLessons.length > 0) {
      // Reward a new pair only. Merely extending an already paired lesson must
      // not make repeating the subject within its own section look better.
      const newPairs = countSectionPairs([...sectionLessons, {position: lessonPosition, section: load.section_id}]) - countSectionPairs(sectionLessons);
      penalty -= newPairs * sectionContinuityWeight;
    }
    penalty += sameFirstDays.size * 14;
    return penalty;
  }
  return {score, candidatePenalty};
}
