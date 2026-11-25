// Student roster order per class (migration 0064). SQL and JS share one Arabic
// sort key so the server order and any client-side sort agree.

export const ROSTER_ORDERS = ['alphabetical', 'girls_first', 'boys_first'] as const;
export type RosterOrder = typeof ROSTER_ORDERS[number];
export const ROSTER_ORDER_LABELS: Record<RosterOrder, string> = {
  alphabetical: 'أبجدي',
  girls_first: 'البنات أولاً ثم أبجدي',
  boys_first: 'البنين أولاً ثم أبجدي',
};
export const isRosterOrder = (value: unknown): value is RosterOrder => ROSTER_ORDERS.includes(value as RosterOrder);

// Arabic dictionary order ignores hamza seats and final forms, and Duhok names
// often use Kurdish/Persian letters: fold them onto the Arabic letter they sort with.
// Spaces are dropped so «عبد الله» and «عبدالله» sort together.
const FOLDS: Array<[string, string]> = [
  ['أ', 'ا'], ['إ', 'ا'], ['آ', 'ا'], ['ٱ', 'ا'], ['ى', 'ي'], ['ی', 'ي'], ['ئ', 'ي'], ['ؤ', 'و'],
  ['ة', 'ه'], ['ە', 'ه'], ['ک', 'ك'], ['گ', 'ك'], ['پ', 'ب'], ['چ', 'ج'], ['ژ', 'ز'], ['ڤ', 'ف'],
  ['ـ', ''], [' ', ''],
];

export function arabicNameKey(name: string | null | undefined): string {
  return FOLDS.reduce((key, [from, to]) => key.split(from).join(to), String(name ?? '').trim());
}

export function arabicNameKeySql(expression: string): string {
  return FOLDS.reduce((sql, [from, to]) => `replace(${sql}, '${from}', '${to}')`, `trim(${expression})`);
}

/**
 * ORDER BY items for a student roster: the class setting's gender group, then the
 * Arabic name key, then the id (stable). `classId` is the SQL expression of the
 * student's class for the roster being listed (enrollment or effective class).
 */
export function rosterOrderSql(student: string, classId: string): string {
  const setting = `(SELECT roster_class.roster_order FROM classes AS roster_class WHERE roster_class.id = ${classId})`;
  return `CASE ${setting} WHEN 'girls_first' THEN (CASE ${student}.gender WHEN 'female' THEN 0 ELSE 1 END)`
    + ` WHEN 'boys_first' THEN (CASE ${student}.gender WHEN 'male' THEN 0 ELSE 1 END) ELSE 0 END,`
    + ` ${arabicNameKeySql(`${student}.full_name`)}, ${student}.id`;
}

/** Client-side comparator matching rosterOrderSql for one class. */
export function compareRoster(order: RosterOrder) {
  const group = (gender: unknown) => order === 'girls_first' ? (gender === 'female' ? 0 : 1) : order === 'boys_first' ? (gender === 'male' ? 0 : 1) : 0;
  return (a: { full_name: string; gender?: unknown; id: number }, b: { full_name: string; gender?: unknown; id: number }) => {
    const byGroup = group(a.gender) - group(b.gender);
    if (byGroup) return byGroup;
    const keyA = arabicNameKey(a.full_name), keyB = arabicNameKey(b.full_name);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : a.id - b.id;
  };
}
