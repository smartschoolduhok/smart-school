import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTimetableScope, timetableLoadMatchesScope, scopedTimetableSolverLoads, collectTimetableFixedEntries } from '../src/lib/timetableScope.ts';
import { computeTimetableProposalDigest } from '../src/lib/timetableAdoption.ts';

const loads = [
  { id: 1, class_id: 10, class_stage: 'ابتدائي', section_id: 11, weekly_periods: 5 },
  { id: 2, class_id: 10, class_stage: 'ابتدائي', section_id: 12, weekly_periods: 6 },
  { id: 3, class_id: 20, class_stage: 'متوسط', section_id: null, weekly_periods: 4 },
];
const entries = [{ slot_id: 1, teaching_load_id: 1, is_locked: 1 }, { slot_id: 2, teaching_load_id: 2, is_locked: 0 }];

test('scope parsing rejects ambiguous, coerced or mismatched shapes', () => {
  assert.deepEqual(parseTimetableScope(undefined), { kind: 'school' });
  for (const value of [null, {}, { kind: 'section', class_id: 10 }, { kind: 'class', class_id: '10' },
    { kind: 'school', class_id: 1 }, { kind: 'stage', stage: '' }, { kind: 'class', class_id: -1 }]) assert.equal(parseTimetableScope(value), null);
});

test('stage, class and section scopes resolve distinct canonical teaching loads', () => {
  for (const [scope, ids] of [[{ kind: 'stage', stage: 'ابتدائي' }, [1, 2]], [{ kind: 'class', class_id: 10 }, [1, 2]],
    [{ kind: 'section', class_id: 10, section_id: 12 }, [2]], [{ kind: 'section', class_id: 20, section_id: 12 }, []]]) {
    assert.deepEqual(loads.filter(load => timetableLoadMatchesScope(load, scope)).map(load => load.id), ids);
  }
});

test('targeted solver models only existing outside occupancy without altering original load demand', () => {
  const original = structuredClone(loads);
  const scoped = scopedTimetableSolverLoads(loads, entries, { kind: 'section', class_id: 10, section_id: 11 });
  assert.deepEqual(scoped.map(load => [load.id, load.weekly_periods]), [[1, 5], [2, 1]]);
  assert.deepEqual(loads, original);
});

test('fixed collection always preserves persisted locks and outside unlocked status', () => {
  const requested = [{ slot_id: 1, teaching_load_id: 1 }, { slot_id: 2, teaching_load_id: 2 }];
  assert.deepEqual(collectTimetableFixedEntries(loads, entries, { kind: 'section', class_id: 10, section_id: 11 }, requested), entries);
  assert.deepEqual(collectTimetableFixedEntries(loads, entries, { kind: 'school' }, []), [entries[0]]);
});

test('proposal integrity includes targeted generation scope', async () => {
  const input = { schoolId: 1, academicYearId: 1, revision: 1, entries };
  assert.notEqual(await computeTimetableProposalDigest({ ...input, generationScope: { kind: 'class', class_id: 10 } }),
    await computeTimetableProposalDigest({ ...input, generationScope: { kind: 'class', class_id: 20 } }));
  assert.equal(await computeTimetableProposalDigest(input), await computeTimetableProposalDigest({ ...input, generationScope: { kind: 'school' } }));
});
