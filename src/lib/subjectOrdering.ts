export interface SubjectOrderRecord {
  id: number;
  school_id: number;
  class_id: number;
  status: string;
}

export type SubjectOrderValidation =
  | { ok: true; orderedIds: number[] }
  | {
      ok: false;
      code:
        | 'not_array'
        | 'invalid_id'
        | 'duplicate_id'
        | 'subject_missing'
        | 'cross_school'
        | 'wrong_class'
        | 'inactive_subject'
        | 'partial_list';
    };

function hasValidUniqueSubjectIds(ids: readonly number[]): boolean {
  return ids.every((id) => Number.isInteger(id) && id > 0) && new Set(ids).size === ids.length;
}

export function buildCanonicalSubjectOrder(
  orderedSubjectIds: readonly number[],
): Array<{ id: number; order_index: number }> {
  if (!hasValidUniqueSubjectIds(orderedSubjectIds)) {
    throw new Error('Subject order IDs must be unique positive integers');
  }
  return orderedSubjectIds.map((id, index) => ({ id, order_index: index + 1 }));
}

export function buildAtomicSubjectOrderUpdateSql(orderedSubjectIds: readonly number[]): string {
  const canonicalOrder = buildCanonicalSubjectOrder(orderedSubjectIds);
  if (canonicalOrder.length === 0) throw new Error('Subject order cannot be empty');

  const idList = canonicalOrder.map((subject) => subject.id).join(', ');
  const orderCases = canonicalOrder
    .map((subject) => `WHEN ${subject.id} THEN ${subject.order_index}`)
    .join(' ');
  return `
    UPDATE subjects AS target
    SET order_index = CASE target.id ${orderCases} ELSE target.order_index END,
        updated_at = unixepoch()
    WHERE target.school_id = ? AND target.class_id = ? AND target.status = 'active'
      AND target.id IN (${idList})
      AND (
        SELECT COUNT(*) FROM subjects AS active
        WHERE active.school_id = ? AND active.class_id = ? AND active.status = 'active'
      ) = ?
      AND NOT EXISTS (
        SELECT 1 FROM subjects AS unexpected
        WHERE unexpected.school_id = ? AND unexpected.class_id = ? AND unexpected.status = 'active'
          AND unexpected.id NOT IN (${idList})
      )
  `;
}

export function validateSubjectOrder(
  orderedSubjectIds: unknown,
  suppliedSubjects: readonly SubjectOrderRecord[],
  activeSubjectIds: readonly number[],
  schoolId: number,
  classId: number,
): SubjectOrderValidation {
  if (!Array.isArray(orderedSubjectIds)) return { ok: false, code: 'not_array' };
  if (!orderedSubjectIds.every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0)) {
    return { ok: false, code: 'invalid_id' };
  }

  const orderedIds = orderedSubjectIds as number[];
  if (!hasValidUniqueSubjectIds(orderedIds)) {
    return { ok: false, code: 'duplicate_id' };
  }
  if (suppliedSubjects.length !== orderedIds.length) {
    return { ok: false, code: 'subject_missing' };
  }

  const recordsById = new Map(suppliedSubjects.map((subject) => [subject.id, subject]));
  for (const id of orderedIds) {
    const subject = recordsById.get(id);
    if (!subject) return { ok: false, code: 'subject_missing' };
    if (subject.school_id !== schoolId) return { ok: false, code: 'cross_school' };
    if (subject.class_id !== classId) return { ok: false, code: 'wrong_class' };
    if (subject.status !== 'active') return { ok: false, code: 'inactive_subject' };
  }

  if (
    activeSubjectIds.length !== orderedIds.length ||
    activeSubjectIds.some((id) => !recordsById.has(id))
  ) {
    return { ok: false, code: 'partial_list' };
  }

  return { ok: true, orderedIds };
}

export function moveOrderedItem<T extends { id: number }>(
  items: readonly T[],
  movedId: number,
  targetId: number,
): T[] {
  const fromIndex = items.findIndex((item) => item.id === movedId);
  const toIndex = items.findIndex((item) => item.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [...items];

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function mergeReturnedSubjectOrder<T extends { id: number }>(
  current: readonly T[],
  ordered: readonly (Partial<T> & Pick<T, 'id'>)[],
): T[] {
  const updates = new Map(ordered.map((subject) => [subject.id, subject]));
  return current.map((subject) => {
    const updated = updates.get(subject.id);
    return updated ? { ...subject, ...updated } : subject;
  });
}
