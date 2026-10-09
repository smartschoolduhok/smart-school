import type { TimetableTeachingLoad } from './timetable.ts';
import { timetableTeacherResourceKey } from './timetableTeacherResource.ts';

/** Explicit timetable pairing. It never derives groups from a subject name or a student's religion. */
export type TimetableParallelLoad = Pick<TimetableTeachingLoad,
  'id' | 'school_id' | 'academic_year_id' | 'class_id' | 'section_id' | 'subject_id'
  | 'employee_id' | 'teacher_placeholder' | 'weekly_periods' | 'status' | 'parallel_with_load_id'>;

export interface TimetableParallelLoadIssue {
  code: 'invalid_parallel_load';
  reason: 'missing_primary' | 'inactive_primary' | 'invalid_reference' | 'self_link'
    | 'scope_mismatch' | 'periods_mismatch' | 'same_subject' | 'same_teacher' | 'chain' | 'multiple_companions';
  load_id: number;
  parallel_with_load_id: number | null;
  message: string;
}

const linkedId = (load: TimetableParallelLoad) => load.parallel_with_load_id == null ? null : Number(load.parallel_with_load_id);
const sameScope = (a: TimetableParallelLoad, b: TimetableParallelLoad) => (
  a.school_id === b.school_id && a.academic_year_id === b.academic_year_id
  && a.class_id === b.class_id && a.section_id === b.section_id
);

function pairReason(companion: TimetableParallelLoad, primary: TimetableParallelLoad | undefined): TimetableParallelLoadIssue['reason'] | null {
  const id = linkedId(companion);
  if (id == null || !Number.isSafeInteger(id) || id <= 0) return 'invalid_reference';
  if (id === companion.id) return 'self_link';
  if (!primary) return 'missing_primary';
  if (primary.status !== 'active') return 'inactive_primary';
  if (linkedId(primary) != null) return 'chain';
  if (!sameScope(companion, primary)) return 'scope_mismatch';
  if (companion.weekly_periods !== primary.weekly_periods) return 'periods_mismatch';
  if (companion.subject_id === primary.subject_id) return 'same_subject';
  const teacher = timetableTeacherResourceKey(companion);
  if (teacher != null && teacher === timetableTeacherResourceKey(primary)) return 'same_teacher';
  return null;
}

/** Pair-local check; use parallelTimetableLoadGroup when the complete load collection is available. */
export function areParallelTimetableLoads(a: TimetableParallelLoad, b: TimetableParallelLoad): boolean {
  if (a.status !== 'active' || b.status !== 'active' || a.id === b.id) return false;
  if (linkedId(a) === b.id) return pairReason(a, b) == null;
  if (linkedId(b) === a.id) return pairReason(b, a) == null;
  return false;
}

export function validateTimetableParallelLoads(loads: readonly TimetableParallelLoad[]): TimetableParallelLoadIssue[] {
  const byId = new Map(loads.map(load => [load.id, load]));
  const companions = new Map<number, TimetableParallelLoad[]>();
  for (const load of loads) {
    if (load.status !== 'active' || linkedId(load) == null) continue;
    const group = companions.get(linkedId(load)!) ?? [];
    group.push(load); companions.set(linkedId(load)!, group);
  }
  const issues = new Map<number, TimetableParallelLoadIssue>();
  const add = (load: TimetableParallelLoad | undefined, reason: TimetableParallelLoadIssue['reason']) => {
    if (!load || load.status !== 'active' || issues.has(load.id)) return;
    issues.set(load.id, { code: 'invalid_parallel_load', reason, load_id: load.id,
      parallel_with_load_id: linkedId(load), message: 'ربط الدروس المتزامنة غير صالح؛ تحقق من النصابين والشعبة والعدد الأسبوعي والمدرسين.' });
  };
  for (const [primaryId, children] of companions) {
    const primary = byId.get(primaryId);
    for (const companion of children) {
      const reason = pairReason(companion, primary);
      if (reason) { add(companion, reason); add(primary, reason); }
      if (companions.has(companion.id)) {
        add(primary, 'chain'); add(companion, 'chain');
        for (const child of companions.get(companion.id)!) add(child, 'chain');
      }
    }
    if (children.length > 1) {
      add(primary, 'multiple_companions');
      for (const child of children) add(child, 'multiple_companions');
    }
  }
  return [...issues.values()].sort((a, b) => a.load_id - b.load_id);
}

/** Returns a valid primary-first pair, or a singleton without concealing malformed demand. */
export function parallelTimetableLoadGroup<T extends TimetableParallelLoad>(load: T, loads: readonly T[]): T[] {
  if (load.status !== 'active') return [load];
  const primary = linkedId(load) == null ? load : loads.find(item => item.id === linkedId(load));
  if (!primary || primary.status !== 'active' || linkedId(primary) != null) return [load];
  const children = loads.filter(item => item.status === 'active' && linkedId(item) === primary.id);
  if (children.length !== 1 || !areParallelTimetableLoads(primary, children[0])) return [load];
  if (loads.some(item => item.status === 'active' && linkedId(item) === children[0].id)) return [load];
  return [primary, children[0]];
}

/** Build once for an immutable load snapshot, rather than rescanning it for each candidate slot. */
export function indexTimetableParallelLoadGroups<T extends TimetableParallelLoad>(loads: readonly T[]): Map<number, T[]> {
  const groups = new Map(loads.map(load => [load.id, [load]]));
  const childrenByPrimary = new Map<number, T[]>();
  for (const load of loads) {
    const primaryId = linkedId(load);
    if (load.status !== 'active' || primaryId == null) continue;
    const children = childrenByPrimary.get(primaryId) ?? [];
    children.push(load); childrenByPrimary.set(primaryId, children);
  }
  for (const primary of loads) {
    if (primary.status !== 'active' || linkedId(primary) != null) continue;
    const children = childrenByPrimary.get(primary.id);
    if (children?.length !== 1 || childrenByPrimary.has(children[0].id) || !areParallelTimetableLoads(primary, children[0])) continue;
    const pair = [primary, children[0]];
    groups.set(primary.id, pair); groups.set(children[0].id, pair);
  }
  return groups;
}

/** Section occupancy, not teacher workload. Invalid links retain their full independent demand. */
export function countTimetableSectionPeriods(loads: readonly TimetableParallelLoad[]): number {
  const seen = new Set<number>();
  const groups = indexTimetableParallelLoadGroups(loads);
  let total = 0;
  for (const load of loads) {
    if (load.status !== 'active' || seen.has(load.id)) continue;
    const group = groups.get(load.id)!;
    for (const member of group) seen.add(member.id);
    total += Number(load.weekly_periods);
  }
  return total;
}

export interface TimetableParallelEntry {
  slot_id: number;
  teaching_load_id: number;
}

export interface TimetableParallelEntryIssue {
  code: 'parallel_lessons_misaligned';
  load_id: number;
  slot_id: number;
  message: string;
}

/** Counts actual section occupancy; malformed or unmatched entries never disappear. */
export function countTimetableScheduledSectionPeriods(entries: readonly TimetableParallelEntry[], loads: readonly TimetableParallelLoad[]): number {
  const groups = indexTimetableParallelLoadGroups(loads);
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = `${entry.teaching_load_id}:${entry.slot_id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let total = entries.length;
  for (const load of loads) {
    const group = groups.get(load.id)!;
    if (group.length !== 2 || group[0].id !== load.id) continue;
    const slots = new Set(entries.filter(entry => entry.teaching_load_id === load.id).map(entry => entry.slot_id));
    for (const slotId of slots) total -= Math.min(counts.get(`${load.id}:${slotId}`) ?? 0, counts.get(`${group[1].id}:${slotId}`) ?? 0);
  }
  return total;
}

/** Complete schedules and adopted proposals must contain both pair members in every occupied slot. */
export function validateTimetableParallelEntries(entries: readonly TimetableParallelEntry[], loads: readonly TimetableParallelLoad[]): TimetableParallelEntryIssue[] {
  const issues: TimetableParallelEntryIssue[] = [];
  const groups = indexTimetableParallelLoadGroups(loads);
  for (const load of loads) {
    const group = groups.get(load.id)!;
    if (group.length !== 2 || group[0].id !== load.id) continue;
    const primary = entries.filter(entry => entry.teaching_load_id === group[0].id);
    const companion = entries.filter(entry => entry.teaching_load_id === group[1].id);
    const slots = new Set([...primary, ...companion].map(entry => entry.slot_id));
    for (const slotId of slots) {
      const primaryCount = primary.filter(entry => entry.slot_id === slotId).length;
      const companionCount = companion.filter(entry => entry.slot_id === slotId).length;
      if (primaryCount === companionCount) continue;
      issues.push({code: 'parallel_lessons_misaligned', load_id: primaryCount > companionCount ? group[0].id : group[1].id,
        slot_id: slotId, message: 'يجب أن يكون الدرسان المرتبطان في الفترة نفسها وبعدد متساوٍ من الدروس.'});
    }
  }
  return issues;
}
