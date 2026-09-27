import {
  buildTimetableMasterPlacements,
  timetablePlacementKey,
  type TimetableGridEntry,
  type TimetableMasterGridData,
  type TimetablePlacement,
} from './timetable.ts';

export type TimetablePrintGrouping = 'combined' | 'stage' | 'class' | 'placement';
export type TimetablePrintMode = 'master' | 'placement' | 'teacher';
export interface TimetablePrintSelection {
  mode: TimetablePrintMode;
  grouping: TimetablePrintGrouping;
  stage: string;
  classId: number | null;
  placementKey: string;
  teacherId: number | null;
}
export interface TimetablePrintSheet {
  key: string;
  title: string;
  kind: TimetablePrintMode;
  placements: TimetablePlacement[];
  teacherId?: number;
}

export function timetablePlacementLabel(placement: TimetablePlacement): string {
  return placement.section_name ? `${placement.class_name} / ${placement.section_name}` : placement.class_name;
}

export function filterTimetablePrintPlacements(data: TimetableMasterGridData, stage: string, classId: number | null) {
  const classes = data.classes.filter((item) => Number(item.school_id) === Number(data.school.id)
    && (!stage || item.stage === stage) && (classId == null || Number(item.id) === classId));
  const sections = data.sections.filter((item) => Number(item.school_id) === Number(data.school.id));
  return buildTimetableMasterPlacements(classes, sections);
}

export function timetablePrintSheetEntries(entries: TimetableGridEntry[], sheet: TimetablePrintSheet) {
  if (sheet.kind === 'teacher') return entries.filter((entry) => Number(entry.employee_id) === sheet.teacherId);
  return entries.filter((entry) => sheet.placements.some((placement) => Number(entry.class_id) === placement.class_id
    && (entry.section_id == null || Number(entry.section_id) === placement.section_id)));
}

export function buildTimetablePrintSheets(data: TimetableMasterGridData, selection: TimetablePrintSelection): TimetablePrintSheet[] {
  if (selection.mode === 'teacher') {
    const teacher = data.teachers.find((item) => Number(item.id) === selection.teacherId && Number(item.school_id) === Number(data.school.id));
    return teacher ? [{key: `teacher:${teacher.id}`, title: `جدول المدرس: ${teacher.full_name}`, kind: 'teacher', placements: [], teacherId: teacher.id}] : [];
  }
  const placements = filterTimetablePrintPlacements(data, selection.stage, selection.classId);
  const placementSheet = (placement: TimetablePlacement): TimetablePrintSheet => ({
    key: `placement:${timetablePlacementKey(placement)}`, title: `جدول ${timetablePlacementLabel(placement)}`, kind: 'placement', placements: [placement],
  });
  if (selection.mode === 'placement') {
    const placement = placements.find((item) => timetablePlacementKey(item) === selection.placementKey);
    return placement ? [placementSheet(placement)] : [];
  }
  if (placements.length === 0) return [];
  if (selection.grouping === 'placement') return placements.map(placementSheet);
  if (selection.grouping === 'combined') return [{key: 'combined', title: selection.classId != null
    ? `جدول ${placements[0].class_name} — جميع الشعب`
    : selection.stage ? `جدول المرحلة ${selection.stage}` : 'الجدول الدراسي الأسبوعي', kind: 'master', placements}];
  const classes = new Map(data.classes.map((item) => [Number(item.id), item]));
  const groups = new Map<string, TimetablePrintSheet>();
  for (const placement of placements) {
    const stage = classes.get(placement.class_id)?.stage || 'غير محددة';
    const key = selection.grouping === 'stage' ? `stage:${stage}` : `class:${placement.class_id}`;
    if (!groups.has(key)) groups.set(key, {key, title: selection.grouping === 'stage'
      ? `جدول المرحلة ${stage}` : `جدول ${placement.class_name} — جميع الشعب`, kind: 'master', placements: []});
    groups.get(key)!.placements.push(placement);
  }
  return [...groups.values()];
}

// Period positions belong to each day. A missing position is not an unscheduled
// lesson; keeping that distinction makes weeks with different lengths readable.
export function buildTimetablePrintWeek(data: Pick<TimetableMasterGridData, 'days' | 'slots'>) {
  const days = data.days.filter((day) => Number(day.is_active) === 1)
    .slice().sort((a, b) => a.order_index - b.order_index || a.day_of_week - b.day_of_week);
  const activeDays = new Set(days.map((day) => Number(day.day_of_week)));
  const slots = data.slots.filter((slot) => Number(slot.is_active) === 1 && activeDays.has(Number(slot.day_of_week)));
  const indices = [...new Set(slots.map((slot) => Number(slot.slot_index)))].sort((a, b) => a - b);
  return {days, rows: indices.map((index) => ({index, slots: days.map((day) => slots.find((slot) => Number(slot.day_of_week) === Number(day.day_of_week)
    && Number(slot.slot_index) === index) || null)}))};
}
