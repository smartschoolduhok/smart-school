import assert from 'node:assert/strict';
import test from 'node:test';
import { SCHOOL_REGISTERS, EVALUATION_CRITERIA, parseRegisterData, validRegisterDate } from '../src/lib/schoolRegisters.ts';

const evaluation = () => ({ employee_id: 1, evaluation: { visits: Array.from({ length: 4 }, () => ({ date: null, scores: Array(20).fill(null) })) } });

test('all 29 indexed records are available and uncertain templates are clearly marked', () => {
  assert.equal(SCHOOL_REGISTERS.length, 29);
  assert.equal(new Set(SCHOOL_REGISTERS.map(row => row.key)).size, 29);
  assert.deepEqual(SCHOOL_REGISTERS.map(row => row.number), Array.from({ length: 29 }, (_, index) => index + 1));
  assert.equal(SCHOOL_REGISTERS.find(row => row.number === 26).templateStatus, 'proposed');
  assert.match(SCHOOL_REGISTERS.find(row => row.number === 26).description, /لا يفترض/);
  assert.equal(EVALUATION_CRITERIA.length, 20);
  assert.deepEqual([...new Set(EVALUATION_CRITERIA.map(row => row.domain))].map(domain => EVALUATION_CRITERIA.filter(row => row.domain === domain).length), [6, 8, 6]);
});

test('evaluation preserves empty scores and validates the complete 4 by 20 matrix', () => {
  const input = evaluation();
  input.evaluation.visits[0].date = '2026-10-06';
  input.evaluation.visits[0].scores[0] = 5;
  const parsed = parseRegisterData('teacher-evaluation', input);
  assert.equal(parsed.evaluation.visits[0].scores[0], 5);
  assert.equal(parsed.evaluation.visits[0].scores[1], null);
  assert.equal(parsed.evaluation.visits[1].date, null);
  for (const bad of [0, 6, -1, 2.5, '5', false, undefined, NaN, Infinity]) {
    const candidate = evaluation(); candidate.evaluation.visits[0].scores[0] = bad;
    assert.throws(() => parseRegisterData('teacher-evaluation', candidate));
  }
  for (const mutate of [
    value => value.evaluation.visits.pop(),
    value => value.evaluation.visits[0].scores.pop(),
    value => { value.evaluation.visits[0].date = '2026-02-30'; },
    value => { value.evaluation.visits[0].extra = 'surprise'; },
    value => { value.evaluation.extra = 1; },
    value => { delete value.employee_id; },
    value => { value.employee_id = true; },
  ]) {
    const candidate = evaluation(); mutate(candidate);
    assert.throws(() => parseRegisterData('teacher-evaluation', candidate));
  }
});

test('typed fields, custom fields and calendar dates reject ambiguous or oversized input', () => {
  assert.equal(validRegisterDate('2024-02-29'), true);
  for (const value of ['2025-02-29', '2026-04-31', '2026-13-01', '2026-1-1', null]) assert.equal(validRegisterDate(value), false);
  const parsed = parseRegisterData('control-register', { details: 'تفاصيل', extra_fields: [{ label: ' وصف ', value: ' قيمة ' }] });
  assert.deepEqual(parsed.extra_fields, [{ label: 'وصف', value: 'قيمة' }]);
  for (const input of [
    { extra_fields: Array.from({ length: 21 }, () => ({ label: 'حقل', value: '' })) },
    { extra_fields: [{ label: '', value: 'x' }] },
    { extra_fields: [{ label: 'x', value: 5 }] },
    { extra_fields: [{ label: 'x', value: '', unexpected: true }] },
    { extra_fields: [{ label: 'x', value: 'a'.repeat(2001) }] },
    { unknown: 'discarding this would lose user data' },
    { details: {} },
  ]) assert.throws(() => parseRegisterData('control-register', input));
  assert.throws(() => parseRegisterData('school-visitors', { arrival_time: '25:00' }));
  assert.throws(() => parseRegisterData('teacher-leaves', { start_date: '2026-02-30' }));
});

test('complete leave, delegation and development periods reject reversed endpoints without inventing missing dates', () => {
  assert.throws(() => parseRegisterData('teacher-leaves', { start_date: '2026-10-10', end_date: '2026-10-05' }));
  assert.throws(() => parseRegisterData('ikal', { start_date: '2026-10-06', end_date: '2026-10-06', start_time: '14:00', end_time: '09:00' }));
  assert.throws(() => parseRegisterData('development-plan', { start_date: '2026-10-10', due_date: '2026-10-05' }));
  assert.deepEqual(parseRegisterData('teacher-leaves', { start_date: '2026-10-10' }), { start_date: '2026-10-10' });
  assert.deepEqual(parseRegisterData('teacher-leaves', { start_date: '2026-10-10', end_date: '2026-10-10' }), { start_date: '2026-10-10', end_date: '2026-10-10' });
  const overnight = { start_date: '2026-10-06', end_date: '2026-10-07', start_time: '20:00', end_time: '08:00' };
  assert.deepEqual(parseRegisterData('ikal', overnight), overnight);
});
