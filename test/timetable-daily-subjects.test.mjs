import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimetableDailySubjectPolicy, minimumTimetableSubjectDoubles } from '../src/lib/timetableDailySubjects.ts';

const load = (id, overrides = {}) => ({
  id, school_id: 1, academic_year_id: 2, class_id: 3, section_id: 4,
  subject_id: 5, subject_name: 'رياضيات', class_name: 'الثالث', section_name: 'أ',
  employee_id: 6, weekly_periods: 5, status: 'active', created_at: 0, updated_at: 0,
  class_status: 'active', class_school_id: 1, section_status: 'active', section_school_id: 1, section_class_id: 3,
  subject_status: 'active', subject_school_id: 1, subject_class_id: 3, subject_section_id: null,
  employee_status: 'active', employee_school_id: 1, employee_role: 'teacher',
  ...overrides,
});
const slot = (id, overrides = {}) => ({
  id, school_id: 1, academic_year_id: 2, day_of_week: 0, slot_index: id,
  slot_type: 'lesson', lesson_number: id, label: `الدرس ${id}`,
  start_time: `${String(7 + id).padStart(2, '0')}:00`, end_time: `${String(8 + id).padStart(2, '0')}:00`,
  is_active: 1, created_at: 0, updated_at: 0, ...overrides,
});
const entry = (slotId, loadId = 1) => ({slot_id: slotId, teaching_load_id: loadId});
const regularSlots = [slot(1), slot(2), slot(3), slot(4), slot(5)];

test('strict first phase accepts only one logical subject per section and day', () => {
  const policy = createTimetableDailySubjectPolicy([load(1)], regularSlots);
  assert.equal(policy.canPlace(1, 1, [], false), true);
  assert.equal(policy.canPlace(1, 2, [entry(1)], false), false);
  assert.equal(policy.validate([entry(1), entry(2)], false)[0].code, 'subject_daily_repetition');
});

test('fallback accepts a consecutive double in every grade but never a separated pair', () => {
  for (const class_name of ['الأول', 'الثالث', 'السادس']) {
    const policy = createTimetableDailySubjectPolicy([load(1, {class_name})], regularSlots);
    assert.equal(policy.canPlace(1, 2, [entry(1)], true), true);
    assert.equal(policy.canPlace(1, 1, [entry(2)], true), true);
    assert.equal(policy.canPlace(1, 3, [entry(1)], true), false);
    assert.deepEqual(policy.validate([entry(2), entry(1)]), []);
    const [notice] = policy.validate([entry(1), entry(3)]);
    assert.equal(notice.code, 'subject_daily_repetition');
    assert.equal(notice.teaching_load_id, 1);
    assert.equal(notice.slot_id, 3);
    assert.equal(notice.day_of_week, 0);
    assert.match(notice.message, /رياضيات/);
    assert.match(notice.message, /الأحد/);
  }
});

test('a third occurrence is forbidden even when all three lessons are consecutive', () => {
  const policy = createTimetableDailySubjectPolicy([load(1)], regularSlots);
  assert.equal(policy.canPlace(1, 3, [entry(1), entry(2)], true), false);
  assert.equal(policy.validate([entry(1), entry(2), entry(3)]).length, 1);
  assert.equal(policy.countDoubles([entry(1), entry(2), entry(3)]), 1);
});

test('chronological lesson order ignores breaks and inactive periods, not empty active lessons', () => {
  const slots = [
    slot(12, {slot_index: 9, start_time: '08:00'}),
    slot(50, {slot_index: 10, start_time: '08:45', slot_type: 'break'}),
    slot(90, {slot_index: 11, start_time: '08:50', is_active: 0}),
    slot(3, {slot_index: 1, start_time: '09:00'}),
    slot(7, {slot_index: 2, start_time: '10:00'}),
  ];
  const policy = createTimetableDailySubjectPolicy([load(1)], slots);
  assert.equal(policy.canPlace(1, 3, [entry(12)], true), true);
  assert.deepEqual(policy.validate([entry(12), entry(3)]), []);
  assert.equal(policy.canPlace(1, 7, [entry(12)], true), false);
  assert.equal(policy.validate([entry(12), entry(7)]).length, 1);
});

test('logical identity unifies normalized Arabic subjects and independent teaching load rows', () => {
  const loads = [load(1, {subject_name: 'كيمياء'}), load(2, {subject_id: 42, employee_id: 43, subject_name: 'كِـيمياء'})];
  const policy = createTimetableDailySubjectPolicy(loads, regularSlots);
  assert.equal(policy.canPlace(2, 3, [entry(1, 1)], true), false);
  assert.equal(policy.canPlace(2, 2, [entry(1, 1)], true), true);
  assert.equal(policy.validate([entry(1, 1), entry(3, 2)]).length, 1);
  assert.equal(policy.countDoubles([entry(1, 1), entry(2, 2)]), 1);
});

test('scope preserves unrelated entries but includes alternate rows of a selected logical subject', () => {
  const loads = [load(1), load(2, {subject_id: 22}), load(3, {section_id: 9}), load(4, {subject_name: 'فيزياء'})];
  const policy = createTimetableDailySubjectPolicy(loads, regularSlots, [1]);
  assert.equal(policy.canPlace(2, 3, [entry(1, 1)], true), false);
  assert.equal(policy.validate([entry(1, 1), entry(3, 2)]).length, 1);
  assert.deepEqual(policy.validate([entry(1, 3), entry(3, 3), entry(1, 4), entry(3, 4)]), []);
  assert.equal(policy.countDoubles([entry(1, 3), entry(3, 3)]), 0);
  const emptyScope = createTimetableDailySubjectPolicy(loads, regularSlots, []);
  assert.deepEqual(emptyScope.validate([entry(1), entry(3)]), []);
});

test('subject ID fallback keeps unnamed different subjects independent', () => {
  const policy = createTimetableDailySubjectPolicy([
    load(1, {subject_name: undefined}), load(2, {subject_name: ''}),
    load(3, {subject_name: '', subject_id: 9}),
  ], regularSlots);
  assert.equal(policy.canPlace(2, 3, [entry(1)], true), false);
  assert.equal(policy.canPlace(3, 3, [entry(1)], false), true);
});

test('days, schools, academic years, classes and sections remain independent', () => {
  const loads = [load(1), load(2, {school_id: 9}), load(3, {academic_year_id: 9}), load(4, {class_id: 9}), load(5, {section_id: null}), load(6, {section_id: 9})];
  const slots = [...regularSlots, slot(20, {day_of_week: 1}), slot(30, {school_id: 9}), slot(40, {academic_year_id: 9})];
  const policy = createTimetableDailySubjectPolicy(loads, slots);
  for (const [loadId, slotId] of [[1, 20], [2, 30], [3, 40], [4, 3], [5, 3], [6, 3]]) {
    assert.equal(policy.canPlace(loadId, slotId, [entry(1)], false), true);
    assert.deepEqual(policy.validate([entry(1), entry(slotId, loadId)], false), []);
  }
});

test('different parallel religious subjects do not count as repetition', () => {
  const policy = createTimetableDailySubjectPolicy([
    load(1, {subject_name: 'التربية الإسلامية'}),
    load(2, {subject_name: 'التربية المسيحية', parallel_with_load_id: 1}),
  ], regularSlots);
  assert.equal(policy.canPlace(2, 1, [entry(1)], false), true);
  assert.deepEqual(policy.validate([entry(1, 1), entry(1, 2)]), []);
  assert.equal(policy.countDoubles([entry(1, 1), entry(1, 2)]), 0);
});

test('unknown, unschedulable and cross-tenant references are left to the placement validator', () => {
  const policy = createTimetableDailySubjectPolicy([load(1)], [...regularSlots,
    slot(20, {school_id: 9}), slot(21, {academic_year_id: 9}),
    slot(22, {slot_type: 'break'}), slot(23, {is_active: 0}),
  ]);
  const invalid = [entry(999), entry(1, 999), entry(20), entry(21), entry(22), entry(23)];
  assert.deepEqual(policy.validate([entry(1), ...invalid]), []);
  for (const item of invalid) assert.equal(policy.canPlace(item.teaching_load_id, item.slot_id, [entry(1)], false), true);
});

test('double count counts each logical subject and day once and rejects duplicate same-slot entries', () => {
  const slots = [...regularSlots, slot(20, {day_of_week: 1}), slot(21, {day_of_week: 1})];
  const policy = createTimetableDailySubjectPolicy([load(1), load(2, {subject_name: 'فيزياء'})], slots);
  assert.equal(policy.countDoubles([entry(1), entry(2), entry(20), entry(21), entry(3, 2), entry(4, 2)]), 3);
  assert.equal(policy.canPlace(1, 1, [entry(1)], true), false);
  assert.equal(policy.validate([entry(1), entry(1)]).length, 1);
});

const proofInput = overrides => ({
  loads: [load(1, {weekly_periods: 3})],
  days: [0, 1, 2].map(day_of_week => ({school_id: 1, academic_year_id: 2, day_of_week, is_active: 1})),
  slots: [slot(1), slot(2), slot(3, {day_of_week: 1}), slot(4, {day_of_week: 2})],
  ...overrides,
});

test('mandatory double proof is zero when quota fits available days and counts only excess', () => {
  assert.equal(minimumTimetableSubjectDoubles(proofInput()), 0);
  assert.equal(minimumTimetableSubjectDoubles(proofInput({loads: [load(1, {weekly_periods: 5})]})), 2);
});

test('mandatory double proof combines cloned subject quotas and unions their available days', () => {
  const input = proofInput({loads: [load(1, {weekly_periods: 2}), load(2, {employee_id: 7, subject_id: 9, weekly_periods: 2})],
    teacherAvailability: [1, 2].map(slot_id => ({school_id: 1, academic_year_id: 2, employee_id: 6, slot_id, status: 'unavailable'}))});
  assert.equal(minimumTimetableSubjectDoubles(input), 1);
  input.dailySubjectLoadIds = [1];
  assert.equal(minimumTimetableSubjectDoubles(input), 1);
});

test('mandatory double proof considers a day available if any lesson remains available', () => {
  const oneSlotUnavailable = proofInput({teacherAvailability: [{school_id: 1, academic_year_id: 2, employee_id: 6, slot_id: 1, status: 'unavailable'}]});
  assert.equal(minimumTimetableSubjectDoubles(oneSlotUnavailable), 0);
  oneSlotUnavailable.teacherAvailability.push({school_id: 1, academic_year_id: 2, employee_id: 6, slot_id: 2, status: 'unavailable'});
  assert.equal(minimumTimetableSubjectDoubles(oneSlotUnavailable), 1);
  oneSlotUnavailable.loads[0].employee_id = null;
  assert.equal(minimumTimetableSubjectDoubles(oneSlotUnavailable), 0);
});

test('mandatory double proof ignores breaks, inactive slots and inactive days', () => {
  const input = proofInput();
  input.days[0].is_active = 0;
  input.slots[2].is_active = 0;
  input.slots[3].slot_type = 'break';
  assert.equal(minimumTimetableSubjectDoubles(input), 3);
});

test('mandatory double proof ignores unrelated availability and preserves scope boundaries', () => {
  const input = proofInput({loads: [load(1, {weekly_periods: 3}), load(2, {section_id: 9, weekly_periods: 5})],
    dailySubjectLoadIds: [1], teacherAvailability: [
      {school_id: 9, academic_year_id: 2, employee_id: 6, slot_id: 4, status: 'unavailable'},
      {school_id: 1, academic_year_id: 9, employee_id: 6, slot_id: 4, status: 'unavailable'},
      {school_id: 1, academic_year_id: 2, employee_id: 6, slot_id: 3, status: 'avoid'},
    ]});
  assert.equal(minimumTimetableSubjectDoubles(input), 0);
  input.dailySubjectLoadIds = [2];
  assert.equal(minimumTimetableSubjectDoubles(input), 2);
  input.dailySubjectLoadIds = [];
  assert.equal(minimumTimetableSubjectDoubles(input), 0);
});

test('mandatory double proof excludes inactive or invalid academic and teacher load references', () => {
  const input = proofInput({loads: [
    load(1, {weekly_periods: 9, status: 'inactive'}), load(2, {weekly_periods: 9, employee_status: 'archived'}),
    load(3, {weekly_periods: 9, subject_school_id: 9}), load(4, {weekly_periods: 0}),
  ]});
  assert.equal(minimumTimetableSubjectDoubles(input), 0);
});

test('mandatory double proof never counts another school or year lesson as an available day', () => {
  const input = proofInput();
  input.slots[2].school_id = 9;
  input.slots[3].academic_year_id = 9;
  assert.equal(minimumTimetableSubjectDoubles(input), 2);
});
