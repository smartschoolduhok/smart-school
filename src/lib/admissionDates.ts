import { ensure } from './schoolWorkflow.ts';

export function validDate(value: unknown): string {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value,
  'invalid_date', 'التاريخ غير صالح');
  return value;
}
export function baghdadDate() { return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10); }
export function ageInMonths(birth: string, reference: string): number {
  const b = validDate(birth).split('-').map(Number), r = validDate(reference).split('-').map(Number);
  return (r[0] - b[0]) * 12 + r[1] - b[1] - (r[2] < b[2] ? 1 : 0);
}
