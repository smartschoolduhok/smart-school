import type { TimetableEntry, TimetableTeachingLoad } from './timetable.ts';

export type TimetableScope =
  | { kind: 'school' }
  | { kind: 'stage'; stage: string }
  | { kind: 'class'; class_id: number }
  | { kind: 'section'; class_id: number; section_id: number };

export function parseTimetableScope(raw: unknown): TimetableScope | null {
  if (raw === undefined) return { kind: 'school' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const id = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
  const only = (...keys: string[]) => Object.keys(value).every(key => keys.includes(key));
  if (value.kind === 'school' && only('kind')) return { kind: 'school' };
  if (value.kind === 'stage' && only('kind', 'stage') && typeof value.stage === 'string' && value.stage.trim() && value.stage.length <= 120)
    return { kind: 'stage', stage: value.stage.trim() };
  if (value.kind === 'class' && only('kind', 'class_id') && id(value.class_id)) return { kind: 'class', class_id: value.class_id };
  if (value.kind === 'section' && only('kind', 'class_id', 'section_id') && id(value.class_id) && id(value.section_id))
    return { kind: 'section', class_id: value.class_id, section_id: value.section_id };
  return null;
}

export function timetableLoadMatchesScope(load: Pick<TimetableTeachingLoad, 'class_id' | 'section_id' | 'class_stage'>, scope: TimetableScope): boolean {
  if (scope.kind === 'school') return true;
  if (scope.kind === 'stage') return load.class_stage === scope.stage;
  if (Number(load.class_id) !== scope.class_id) return false;
  return scope.kind === 'class' || Number(load.section_id) === scope.section_id;
}

/** Preserve the original outside demand in storage; only solve its existing occupancy. */
export function scopedTimetableSolverLoads(loads: TimetableTeachingLoad[], current: TimetableEntry[], scope: TimetableScope): TimetableTeachingLoad[] {
  if (scope.kind === 'school') return loads;
  const counts = new Map<number, number>();
  for (const entry of current) counts.set(entry.teaching_load_id, (counts.get(entry.teaching_load_id) || 0) + 1);
  return loads.filter(load => timetableLoadMatchesScope(load, scope) || counts.has(load.id)).map(load => (
    timetableLoadMatchesScope(load, scope) ? load : { ...load, weekly_periods: Math.min(load.weekly_periods, counts.get(load.id) || 0) }
  ));
}

export function collectTimetableFixedEntries(loads: TimetableTeachingLoad[], current: TimetableEntry[], scope: TimetableScope,
  requested: Array<{ slot_id: number; teaching_load_id: number }>) {
  const byId = new Map(loads.map(load => [load.id, load]));
  // Explicit preview locks never alter entries outside the chosen scope.
  const fixed = requested.filter(entry => {
    const load = byId.get(entry.teaching_load_id);
    return !load || timetableLoadMatchesScope(load, scope);
  }).map(entry => ({ ...entry, is_locked: 1 as 0 | 1 }));
  for (const entry of current) {
    const load = byId.get(entry.teaching_load_id);
    const outside = scope.kind !== 'school' && (!load || !timetableLoadMatchesScope(load, scope));
    if (!outside && entry.is_locked !== 1) continue;
    const index = fixed.findIndex(item => item.slot_id === entry.slot_id && item.teaching_load_id === entry.teaching_load_id);
    const value = { slot_id: entry.slot_id, teaching_load_id: entry.teaching_load_id, is_locked: entry.is_locked };
    if (index < 0) fixed.push(value); else fixed[index] = value;
  }
  return fixed;
}
