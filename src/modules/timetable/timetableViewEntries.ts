import type { TimetablePlacement } from '../../lib/timetable';

/** Keep every co-timed subject in a placement; retain exact-section precedence. */
export function timetableEntriesForPlacement<T extends {slot_id: number; class_id: number; section_id: number | null}>(
  entries: T[], slotId: number, placement: Pick<TimetablePlacement, 'class_id' | 'section_id'>,
): T[] {
  const candidates = entries.filter(entry => Number(entry.slot_id) === Number(slotId)
    && Number(entry.class_id) === Number(placement.class_id)
    && (entry.section_id == null || Number(entry.section_id) === Number(placement.section_id)));
  const exact = placement.section_id == null ? [] : candidates.filter(entry => Number(entry.section_id) === Number(placement.section_id));
  return exact.length ? exact : candidates.filter(entry => entry.section_id == null);
}
