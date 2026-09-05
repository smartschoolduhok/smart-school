import { validateWeekTemplate, type WeekPeriod } from '../../lib/weekSetup';

export type DraftPeriod = Omit<WeekPeriod, 'slot_index' | 'lesson_number'> & {slot_index: string; lesson_number: string};
export const editablePeriods = (periods: WeekPeriod[]): DraftPeriod[] => periods.map(p => ({...p, slot_index: String(p.slot_index), lesson_number: p.lesson_number == null ? '' : String(p.lesson_number)}));
export const draftPeriodValues = (periods: DraftPeriod[]) => periods.map(p => ({...p,
  slot_index: Number(p.slot_index), lesson_number: p.slot_type === 'break' ? null : Number(p.lesson_number)}));
export const compilePeriods = (periods: DraftPeriod[]) => validateWeekTemplate(draftPeriodValues(periods));

// Monotonic identity survives A -> B -> A, cancelled requests, and reopened
// editors. Every raw edit advances the version, even if it cannot compile yet.
export class WeekDraftFence {
  private scope = ''; private generation = 0; private version = 0;
  setScope(scope: string) { if (scope !== this.scope) { this.scope = scope; this.invalidate(); } }
  invalidate() { this.generation++; this.version++; }
  capture() {
    const generation = ++this.generation, version = this.version, scope = this.scope;
    return () => generation === this.generation && version === this.version && scope === this.scope;
  }
}
