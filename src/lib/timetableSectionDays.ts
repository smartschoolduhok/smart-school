import type { TimetableSlot, TimetableTeachingLoad } from './timetable.ts';
import { loadHasInvalidAcademicReference, loadHasInvalidTeacherReference } from './timetable.ts';
import { normalizeTimetableSubjectName } from './timetablePedagogy.ts';
import { timetableTeacherResourceKey } from './timetableTeacherResource.ts';

type Placement = { slot_id: number; teaching_load_id: number };
export type TimetableSectionDayGroup = { loads: TimetableTeachingLoad[]; sections: Map<number, TimetableTeachingLoad[]> };

/** Subject rows can be cloned per section, so use the same identity as teacher continuity. */
export function timetableSectionDayGroups(loads: TimetableTeachingLoad[], eligibleLoadIds?: number[]): TimetableSectionDayGroup[] {
  const groups = new Map<string, TimetableTeachingLoad[]>();
  for (const load of loads) {
    if (load.status !== 'active' || load.weekly_periods <= 0 || timetableTeacherResourceKey(load) == null || load.section_id == null) continue;
    if (loadHasInvalidAcademicReference(load) || loadHasInvalidTeacherReference(load)) continue;
    const subject = normalizeTimetableSubjectName(load.subject_name || '') || `subject-${load.subject_id}`;
    const key = `${timetableTeacherResourceKey(load)}:${load.class_id}:${subject}`;
    const members = groups.get(key) || [];
    members.push(load);
    groups.set(key, members);
  }
  return [...groups.values()].flatMap(members => {
    if (eligibleLoadIds && !members.some(load => eligibleLoadIds.includes(load.id))) return [];
    const sections = new Map<number, TimetableTeachingLoad[]>();
    for (const load of members) sections.set(load.section_id!, [...(sections.get(load.section_id!) || []), load]);
    return sections.size > 1 ? [{ loads: members, sections }] : [];
  });
}

/** Pair the common weekly demand by day; surplus lessons stay on shared days. */
export function missingTimetableSectionDays(groups: TimetableSectionDayGroup[], slots: Map<number, TimetableSlot>, entries: Placement[]) {
  const daysByLoad = new Map<number, Map<number, number>>();
  for (const entry of entries) {
    const day = slots.get(entry.slot_id)?.day_of_week;
    if (day == null) continue;
    const days = daysByLoad.get(entry.teaching_load_id) || new Map<number, number>();
    days.set(day, (days.get(day) || 0) + 1);
    daysByLoad.set(entry.teaching_load_id, days);
  }
  return groups.flatMap(group => {
    const bySection = [...group.sections.values()].map(loads => {
      const days = new Map<number, number>();
      for (const load of loads) for (const [day, count] of daysByLoad.get(load.id) || []) days.set(day, (days.get(day) || 0) + count);
      return {loads, days, quota: loads.reduce((sum, load) => sum + Number(load.weekly_periods), 0)};
    });
    const allDays = [...new Set(bySection.flatMap(section => [...section.days.keys()]))].sort((a, b) => a - b);
    const commonQuota = Math.min(...bySection.map(section => section.quota));
    const matchedByDay = new Map(allDays.map(day => [day, Math.min(...bySection.map(section => section.days.get(day) || 0))]));
    const matchedTotal = [...matchedByDay.values()].reduce((sum, count) => sum + count, 0);
    return allDays.flatMap(day => {
      const minimum = matchedByDay.get(day)!;
      // Equal quotas allow no unmatched lessons. A larger quota allows exactly
      // its surplus, without inventing demand for the smaller section.
      const needsPair = bySection.some(section => (section.days.get(day) || 0) > minimum
        && [...section.days.values()].reduce((sum, count) => sum + count, 0) - matchedTotal > section.quota - commonQuota);
      const required = Math.max(1, minimum + (needsPair ? 1 : 0));
      return bySection.filter(section => (section.days.get(day) || 0) < required)
        .map(section => ({group, day, loads: section.loads}));
    });
  });
}

export function validateTimetableSectionDays(loads: TimetableTeachingLoad[], slots: TimetableSlot[], entries: Placement[], eligibleLoadIds?: number[]) {
  return missingTimetableSectionDays(timetableSectionDayGroups(loads, eligibleLoadIds), new Map(slots.map(slot => [slot.id, slot])), entries)
    .map(({ day, loads: [load] }) => ({
      code: 'section_day_link' as const,
      teaching_load_id: load.id,
      message: `ربط الشعب في اليوم نفسه: دروس ${load.subject_name || 'المادة'} / ${load.class_name || 'الصف'} / ${load.section_name || 'الشعبة'} / ${load.employee_name || 'المدرس'} تحتاج إلى مطابقة الدروس المشتركة يوم ${['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][day] || day}. راجع توفر المدرس والدروس المثبتة أو عطّل خيار الربط.`,
    }));
}
