import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { TimetableSolverSafetyLimitError, solveTimetable, validateTimetableSolverProposal } from '../src/lib/timetableSolver.ts';
import { classifyTimetableSubject, createTimetablePedagogyScorer } from '../src/lib/timetablePedagogy.ts';

function week(dayCount = 5, lessonsPerDay = 6, options = {}) {
  const days = [];
  const slots = [];
  let slotId = 1;
  for (let dayOfWeek = 0; dayOfWeek < dayCount; dayOfWeek += 1) {
    days.push({ id: dayOfWeek + 1, school_id: 1, academic_year_id: 1, day_of_week: dayOfWeek, is_active: 1, order_index: dayOfWeek, created_at: 0, updated_at: 0 });
    for (let index = 1; index <= lessonsPerDay; index += 1) {
      const hour = 8 + Math.floor((index - 1) * 40 / 60);
      const minute = ((index - 1) * 40) % 60;
      const endMinutes = hour * 60 + minute + 40;
      slots.push({
        id: slotId++, school_id: 1, academic_year_id: 1, day_of_week: dayOfWeek,
        slot_index: index, slot_type: 'lesson', lesson_number: index, label: `Lesson ${index}`,
        start_time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        end_time: `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`,
        is_active: 1, created_at: 0, updated_at: 0,
      });
    }
    if (options.breaks) {
      slots.push({
        id: slotId++, school_id: 1, academic_year_id: 1, day_of_week: dayOfWeek,
        slot_index: lessonsPerDay + 1, slot_type: 'break', lesson_number: null, label: 'Break',
        start_time: '12:30', end_time: '12:45', is_active: 1, created_at: 0, updated_at: 0,
      });
    }
  }
  return { days, slots };
}

function placement(id, sectionId = null) {
  return { class_id: id, class_name: `Class ${id}`, section_id: sectionId, section_name: sectionId == null ? null : `Section ${sectionId}` };
}

function teachingLoad(id, overrides = {}) {
  const classId = overrides.class_id ?? id;
  const sectionId = Object.hasOwn(overrides, 'section_id') ? overrides.section_id : null;
  const employeeId = Object.hasOwn(overrides, 'employee_id') ? overrides.employee_id : id;
  return {
    id,
    school_id: overrides.school_id ?? 1,
    academic_year_id: overrides.academic_year_id ?? 1,
    class_id: classId,
    class_name: overrides.class_name ?? `Class ${classId}`,
    class_status: overrides.class_status ?? 'active',
    class_school_id: overrides.class_school_id ?? 1,
    active_section_count: sectionId == null ? 0 : 1,
    section_id: sectionId,
    section_name: sectionId == null ? null : `Section ${sectionId}`,
    section_status: sectionId == null ? null : (overrides.section_status ?? 'active'),
    section_school_id: sectionId == null ? null : (overrides.section_school_id ?? 1),
    section_class_id: sectionId == null ? null : (overrides.section_class_id ?? classId),
    subject_id: overrides.subject_id ?? id,
    subject_name: overrides.subject_name ?? `Subject ${id}`,
    subject_status: overrides.subject_status ?? 'active',
    subject_school_id: overrides.subject_school_id ?? 1,
    subject_class_id: overrides.subject_class_id ?? classId,
    subject_section_id: overrides.subject_section_id ?? null,
    employee_id: employeeId,
    employee_name: employeeId == null ? null : (overrides.employee_name ?? `Teacher ${employeeId}`),
    employee_status: employeeId == null ? null : (overrides.employee_status ?? 'active'),
    employee_school_id: employeeId == null ? null : (overrides.employee_school_id ?? 1),
    employee_role: employeeId == null ? null : (overrides.employee_role ?? 'teacher'),
    weekly_periods: overrides.weekly_periods ?? 2,
    parallel_with_load_id: overrides.parallel_with_load_id ?? null,
    status: overrides.status ?? 'active',
    created_at: 0,
    updated_at: 0,
  };
}

function solverInput({ days, slots, loads, placements, availability = [], constraints = [], limits, currentEntries = [], fixedEntries = [] }) {
  return {
    schoolId: 1,
    academicYearId: 1,
    days,
    slots,
    loads,
    placements,
    teacherAvailability: availability,
    teacherConstraints: constraints,
    currentEntries,
    fixedEntries,
    limits: limits || { time_budget_ms: 4_000, max_attempts: 200_000, max_backtracks: 10_000, max_local_improvement_attempts: 500 },
  };
}

function parallelInput(overrides = {}) {
  return solverInput({...week(2, 2), loads: [
    teachingLoad(1, {class_id: 1, section_id: 9, weekly_periods: 2}),
    teachingLoad(2, {class_id: 1, section_id: 9, weekly_periods: 2, parallel_with_load_id: 1}),
  ], placements: [placement(1, 9)], ...overrides});
}

function assertCompletePairs(result, primaryId = 1, companionId = 2) {
  assert.deepEqual(result.entries.filter(entry => entry.teaching_load_id === primaryId).map(entry => entry.slot_id).sort(),
    result.entries.filter(entry => entry.teaching_load_id === companionId).map(entry => entry.slot_id).sort());
}

test('parallel pair consumes two section periods and produces four co-timed teacher entries', () => {
  const input = parallelInput(week(1, 2));
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.equal(result.required_periods, 2);
  assert.equal(result.scheduled_periods, 2);
  assert.equal(result.unscheduled_periods, 0);
  assert.equal(result.entries.length, 4);
  assert.equal(result.readiness.overloaded_class_sections.length, 0);
  assertCompletePairs(result);
  assert.ok(result.entries.filter(entry => entry.teaching_load_id === 2).every(entry => entry.parallel_with_load_id === 1));
});

test('33 section periods remain exactly 33 when two religious lessons run in parallel', () => {
  const input = parallelInput(week(5, 7));
  input.slots = input.slots.slice(0, 33);
  input.loads.push(teachingLoad(3, {class_id: 1, section_id: 9, weekly_periods: 31}));
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.equal(result.required_periods, 33);
  assert.equal(result.scheduled_periods, 33);
  assert.equal(result.entries.length, 35);
  assertCompletePairs(result);
});

test('pair candidate domain respects both teachers and permits missing teacher demand explicitly', () => {
  const input = parallelInput({availability: [
    {school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: 1, status: 'unavailable'},
    {school_id: 1, academic_year_id: 1, employee_id: 2, slot_id: 2, status: 'unavailable'},
  ]});
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.ok(result.entries.every(entry => [3, 4].includes(entry.slot_id)));
  assertCompletePairs(result);
  input.loads[1].employee_id = null;
  const noTeacher = solveTimetable(input);
  assert.equal(noTeacher.status, 'complete');
  assert.equal(noTeacher.readiness.missing_teacher_count, 1);
  assertCompletePairs(noTeacher);
});

test('disjoint teacher availability produces no half pair and still schedules independent demand', () => {
  const input = parallelInput({availability: [
    ...[1, 2].map(slot_id => ({school_id: 1, academic_year_id: 1, employee_id: 1, slot_id, status: 'unavailable'})),
    ...[3, 4].map(slot_id => ({school_id: 1, academic_year_id: 1, employee_id: 2, slot_id, status: 'unavailable'})),
  ]});
  input.loads.push(teachingLoad(3, {weekly_periods: 1}));
  input.placements.push(placement(3));
  const result = solveTimetable(input);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].teaching_load_id, 3);
  assertCompletePairs(result);
  assert.deepEqual(result.unscheduled.map(item => [item.teaching_load_id, item.remaining_count]), [[1, 2], [2, 2]]);
  assert.ok(result.unscheduled.every(item => item.reason_codes.includes('teacher_unavailable')));
});

test('teacher daily and working-day constraints from either member apply to the whole pair', () => {
  for (const employee_id of [1, 2]) {
    const result = solveTimetable(parallelInput({constraints: [{school_id: 1, academic_year_id: 1, employee_id,
      max_periods_per_day: 1, max_working_days: 1, max_consecutive_periods: null, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0}]}));
    assert.equal(result.status, 'impossible');
    assert.equal(result.entries.length, 2);
    assertCompletePairs(result);
    assert.equal(result.scheduled_periods, 1);
    assert.equal(result.unscheduled_periods, 1);
  }
});

test('consecutive limit of the companion keeps both subjects separated by a free lesson', () => {
  const result = solveTimetable(parallelInput({...week(1, 3), constraints: [{school_id: 1, academic_year_id: 1, employee_id: 2,
    max_periods_per_day: null, max_working_days: null, max_consecutive_periods: 1, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0}]}));
  assert.equal(result.status, 'complete');
  assertCompletePairs(result);
  assert.deepEqual(result.entries.filter(entry => entry.teaching_load_id === 1).map(entry => entry.slot_id), [1, 3]);
});

test('a companion teacher already teaching another class cannot be reused by a pair', () => {
  const input = parallelInput(week(1, 2));
  input.loads.push(teachingLoad(3, {employee_id: 2, weekly_periods: 1}));
  input.placements.push(placement(3));
  input.fixedEntries = [{slot_id: 1, teaching_load_id: 3, is_locked: 1}];
  const result = solveTimetable(input);
  assertCompletePairs(result);
  assert.ok(result.entries.filter(entry => [1, 2].includes(entry.teaching_load_id)).every(entry => entry.slot_id === 2));
});

test('fixing one member anchors its partner without inventing a second user lock', () => {
  const result = solveTimetable(parallelInput({fixedEntries: [{slot_id: 4, teaching_load_id: 2, is_locked: 1}]}));
  assert.equal(result.status, 'complete');
  assertCompletePairs(result);
  assert.equal(result.entries.find(entry => entry.slot_id === 4 && entry.teaching_load_id === 2).is_locked, 1);
  assert.equal(result.entries.find(entry => entry.slot_id === 4 && entry.teaching_load_id === 1).is_locked, 0);
});

test('fixed complete pair preserves both explicit lock states without duplicate entries', () => {
  const result = solveTimetable(parallelInput({fixedEntries: [
    {slot_id: 4, teaching_load_id: 1, is_locked: 0}, {slot_id: 4, teaching_load_id: 2, is_locked: 1},
  ]}));
  assert.equal(result.status, 'complete');
  assert.equal(result.entries.length, 4);
  assertCompletePairs(result);
  assert.equal(result.entries.filter(entry => entry.slot_id === 4 && entry.is_locked === 1).length, 1);
});

test('fixed primary fails if the required companion teacher is unavailable there', () => {
  const result = solveTimetable(parallelInput({fixedEntries: [{slot_id: 1, teaching_load_id: 1}],
    availability: [{school_id: 1, academic_year_id: 1, employee_id: 2, slot_id: 1, status: 'unavailable'}]}));
  assert.equal(result.status, 'fixed_conflict');
  assert.deepEqual(result.entries, []);
  assert.ok(result.fixed_conflicts.some(issue => issue.code === 'fixed_teacher_unavailable' && issue.teaching_load_id === 2));
});

test('incompatible fixed locations cannot split a one-period pair', () => {
  const input = parallelInput({fixedEntries: [{slot_id: 1, teaching_load_id: 1}, {slot_id: 2, teaching_load_id: 2}]});
  input.loads.forEach(load => {load.weekly_periods = 1;});
  const result = solveTimetable(input);
  assert.equal(result.status, 'fixed_conflict');
  assert.equal(result.entries.length, 0);
  assert.ok(result.fixed_conflicts.some(issue => issue.code === 'fixed_weekly_limit'));
});

for (const [name, mutate] of [
  ['missing parent', input => {input.loads[1].parallel_with_load_id = 99;}],
  ['inactive parent', input => {input.loads[0].status = 'inactive';}],
  ['invalid parent reference', input => {input.loads[0].subject_status = 'archived';}],
  ['same teacher', input => {input.loads[1].employee_id = 1;}],
  ['duplicate companion', input => {input.loads.push(teachingLoad(4, {class_id: 1, section_id: 9, parallel_with_load_id: 1}));}],
]) {
  test(`parallel ${name} is explicit impossible demand and does not suppress an independent section`, () => {
    const input = parallelInput(); mutate(input);
    input.loads.push(teachingLoad(3, {weekly_periods: 1})); input.placements.push(placement(3));
    const result = solveTimetable(input);
    assert.equal(result.status, 'impossible');
    assert.ok(result.readiness.hard_feasibility_blockers.some(issue => issue.code === 'invalid_teaching_load'));
    assert.ok(result.unscheduled.some(item => item.teaching_load_id === 2 && item.reason_codes.includes('invalid_teaching_load')));
    assert.ok(result.entries.some(entry => entry.teaching_load_id === 3));
    assert.equal(result.entries.some(entry => entry.teaching_load_id === 2), false);
  });
}

test('bounded search and local improvement never emit a split pair', () => {
  const input = parallelInput({limits: {time_budget_ms: 4000, max_attempts: 9, max_backtracks: 2, max_local_improvement_attempts: 4}});
  const result = solveTimetable(input);
  assertCompletePairs(result);
  assert.equal(result.entries.length % 2, 0);
  assert.deepEqual(result.entries, solveTimetable(input).entries);
});

test('authoritative proposal validation rejects a half pair or split pair even without a class collision', () => {
  const input = parallelInput();
  const first = {id: 1, slot_id: 1, teaching_load_id: 1};
  const second = {id: 2, slot_id: 2, teaching_load_id: 2};
  assert.ok(validateTimetableSolverProposal(input, [first]).some(issue => issue.code === 'parallel_lesson_missing'));
  assert.ok(validateTimetableSolverProposal(input, [first, second]).some(issue => issue.code === 'parallel_lesson_missing'));
  second.slot_id = 1;
  assert.deepEqual(validateTimetableSolverProposal(input, [first, second]), []);
});

test('excluding either subject leaves the surviving subject independently schedulable', () => {
  for (const excludedId of [1, 2]) {
    const input = parallelInput();
    input.loads.find(load => load.id === excludedId).status = 'inactive';
    if (excludedId === 1) input.loads[1].parallel_with_load_id = null;
    const result = solveTimetable(input);
    assert.equal(result.status, 'complete');
    assert.equal(result.required_periods, 2);
    assert.equal(result.entries.length, 2);
    assert.ok(result.entries.every(entry => entry.teaching_load_id !== excludedId));
  }
});

test('invalid teacher blocks both pair members without inflating section demand', () => {
  const input = parallelInput(); input.loads[0].employee_status = 'archived';
  const result = solveTimetable(input);
  assert.equal(result.status, 'impossible');
  assert.equal(result.required_periods, 2);
  assert.equal(result.unscheduled_periods, 2);
  assert.equal(result.entries.length, 0);
  assert.equal(result.unscheduled.length, 2);
  assert.equal(result.readiness.invalid_load_count, 2);
});

test('fixed lesson is preserved at the exact slot and marked locked', () => {
  const { days, slots } = week(3, 4);
  const result = solveTimetable(solverInput({
    days, slots, loads: [teachingLoad(1, { weekly_periods: 3 })], placements: [placement(1)],
    fixedEntries: [{ slot_id: 4, teaching_load_id: 1 }],
  }));
  const fixed = result.entries.find((entry) => entry.slot_id === 4 && entry.teaching_load_id === 1);
  assert.equal(result.status, 'complete');
  assert.equal(fixed?.is_locked, 1);
});

test('multiple fixed lessons on each day cannot hide an exceeded working-day limit', () => {
  const { days, slots } = week(2, 4);
  const constraints = [{ id: 1, school_id: 1, academic_year_id: 1, employee_id: 1, max_periods_per_day: null,
    max_consecutive_periods: null, max_working_days: 1, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0 }];
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 4 })],
    placements: [placement(1)], constraints, fixedEntries: [1, 2, 5, 6].map(slot_id => ({ slot_id, teaching_load_id: 1 })) }));
  assert.equal(result.status, 'fixed_conflict');
  assert.ok(result.fixed_conflicts.some(conflict => conflict.code === 'fixed_working_days_limit'));
});

test('unequal weekday capacity preserves manual placements and prevents shared teacher collisions', () => {
  const { days, slots: allSlots } = week(5, 7);
  const dailyCounts = [7, 7, 6, 6, 5];
  const slots = allSlots.filter(slot => slot.lesson_number <= dailyCounts[slot.day_of_week]);
  const result = solveTimetable(solverInput({ days, slots,
    loads: [teachingLoad(1, { weekly_periods: 12 }), teachingLoad(2, { employee_id: 1, weekly_periods: 12 })],
    placements: [placement(1), placement(2)], fixedEntries: [{ slot_id: 7, teaching_load_id: 1 }, { slot_id: 14, teaching_load_id: 1 }] }));
  assert.equal(result.status, 'complete');
  assert.equal(result.statistics.active_lesson_slot_count, 31);
  assert.equal(new Set(result.entries.map(entry => entry.slot_id)).size, result.entries.length);
  assert.deepEqual(result.entries.filter(entry => entry.is_locked).map(entry => entry.slot_id), [7, 14]);
});

test('section-specific fixed lesson remains in its exact canonical placement', () => {
  const { days, slots } = week(3, 4);
  const result = solveTimetable(solverInput({
    days, slots,
    loads: [teachingLoad(1, { class_id: 1, section_id: 9, weekly_periods: 2 })],
    placements: [placement(1, 9)],
    fixedEntries: [{ slot_id: 3, teaching_load_id: 1 }],
  }));
  assert.equal(result.status, 'complete');
  assert.ok(result.entries.some((entry) => entry.slot_id === 3 && entry.teaching_load_id === 1 && entry.section_id === 9 && entry.is_locked === 1));
});

test('fixed entry with an invalid teaching load is rejected explicitly', () => {
  const { days, slots } = week(2, 3);
  const result = solveTimetable(solverInput({
    days, slots,
    loads: [teachingLoad(1, { employee_status: 'archived' })],
    placements: [placement(1)],
    fixedEntries: [{ slot_id: 1, teaching_load_id: 1 }],
  }));
  assert.equal(result.status, 'fixed_conflict');
  assert.ok(result.fixed_conflicts.some((item) => item.code === 'fixed_invalid_load'));
});

test('fixed entry from another timetable scope is rejected explicitly', () => {
  const { days, slots } = week(2, 3);
  const result = solveTimetable(solverInput({
    days, slots,
    loads: [teachingLoad(1)],
    placements: [placement(1)],
    fixedEntries: [{ slot_id: 999, teaching_load_id: 1 }],
  }));
  assert.equal(result.status, 'fixed_conflict');
  assert.ok(result.fixed_conflicts.some((item) => item.code === 'fixed_invalid_scope' || item.code === 'fixed_inactive_slot'));
});

test('fixed entries consume weekly demand and only the unlocked remainder is generated', () => {
  const { days, slots } = week(3, 4);
  const result = solveTimetable(solverInput({
    days, slots, loads: [teachingLoad(1, { weekly_periods: 3 })], placements: [placement(1)],
    fixedEntries: [{ slot_id: 1, teaching_load_id: 1 }, { slot_id: 5, teaching_load_id: 1 }],
  }));
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries.filter((entry) => entry.is_locked === 1).length, 2);
  assert.equal(result.entries.filter((entry) => entry.is_locked === 0).length, 1);
});

test('same input and fixed entries produce the same deterministic proposal', () => {
  const { days, slots } = week(4, 5);
  const input = solverInput({
    days, slots,
    loads: [teachingLoad(1, { weekly_periods: 4 }), teachingLoad(2, { weekly_periods: 3 })],
    placements: [placement(1), placement(2)], fixedEntries: [{ slot_id: 2, teaching_load_id: 1 }],
  });
  const first = solveTimetable(input);
  const second = solveTimetable(input);
  assert.deepEqual(first.entries, second.entries);
});

test('duplicate fixed entry is rejected explicitly', () => {
  const { days, slots } = week(2, 3);
  const result = solveTimetable(solverInput({
    days, slots, loads: [teachingLoad(1)], placements: [placement(1)],
    fixedEntries: [{ slot_id: 1, teaching_load_id: 1 }, { slot_id: 1, teaching_load_id: 1 }],
  }));
  assert.equal(result.status, 'fixed_conflict');
  assert.ok(result.fixed_conflicts.some((item) => item.code === 'fixed_duplicate'));
});

test('fixed entry on an inactive lesson slot is rejected explicitly', () => {
  const { days, slots } = week(2, 3);
  slots[0].is_active = 0;
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1)], placements: [placement(1)], fixedEntries: [{ slot_id: 1, teaching_load_id: 1 }] }));
  assert.equal(result.status, 'fixed_conflict');
  assert.ok(result.fixed_conflicts.some((item) => item.code === 'fixed_inactive_slot'));
});

test('fixed teacher collision is rejected explicitly', () => {
  const { days, slots } = week(2, 3);
  const loads = [teachingLoad(1, { employee_id: 1 }), teachingLoad(2, { employee_id: 1 })];
  const result = solveTimetable(solverInput({ days, slots, loads, placements: [placement(1), placement(2)], fixedEntries: [{ slot_id: 1, teaching_load_id: 1 }, { slot_id: 1, teaching_load_id: 2 }] }));
  assert.equal(result.status, 'fixed_conflict');
  assert.ok(result.fixed_conflicts.some((item) => item.code === 'fixed_teacher_collision'));
});

test('fixed class-wide collision with a section-specific lesson is rejected', () => {
  const { days, slots } = week(2, 3);
  const loads = [teachingLoad(1, { class_id: 1, section_id: null }), teachingLoad(2, { class_id: 1, section_id: 9, employee_id: 2 })];
  const result = solveTimetable(solverInput({ days, slots, loads, placements: [placement(1, 9)], fixedEntries: [{ slot_id: 1, teaching_load_id: 1 }, { slot_id: 1, teaching_load_id: 2 }] }));
  assert.equal(result.status, 'fixed_conflict');
  assert.ok(result.fixed_conflicts.some((item) => item.code === 'fixed_class_collision'));
});

test('fixed unavailable teacher placement is rejected', () => {
  const { days, slots } = week(2, 3);
  const availability = [{ id: 1, school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: 1, status: 'unavailable', created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0 }];
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1)], placements: [placement(1)], availability, fixedEntries: [{ slot_id: 1, teaching_load_id: 1 }] }));
  assert.equal(result.status, 'fixed_conflict');
  assert.ok(result.fixed_conflicts.some((item) => item.code === 'fixed_teacher_unavailable'));
});

test('fixed entries respect teacher maximum periods per day', () => {
  const { days, slots } = week(2, 3);
  const constraints = [{ id: 1, school_id: 1, academic_year_id: 1, employee_id: 1, max_periods_per_day: 1, max_consecutive_periods: null, max_working_days: null, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0 }];
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1)], placements: [placement(1)], constraints, fixedEntries: [{ slot_id: 1, teaching_load_id: 1 }, { slot_id: 2, teaching_load_id: 1 }] }));
  assert.equal(result.status, 'fixed_conflict');
  assert.ok(result.fixed_conflicts.some((item) => item.code === 'fixed_daily_limit'));
});

test('fixed entries respect teacher maximum working days', () => {
  const { days, slots } = week(2, 3);
  const constraints = [{ id: 1, school_id: 1, academic_year_id: 1, employee_id: 1, max_periods_per_day: null, max_consecutive_periods: null, max_working_days: 1, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0 }];
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1)], placements: [placement(1)], constraints, fixedEntries: [{ slot_id: 1, teaching_load_id: 1 }, { slot_id: 4, teaching_load_id: 1 }] }));
  assert.equal(result.status, 'fixed_conflict');
  assert.ok(result.fixed_conflicts.some((item) => item.code === 'fixed_working_days_limit'));
});

test('fixed entries respect teacher maximum consecutive periods', () => {
  const { days, slots } = week(2, 3);
  const constraints = [{ id: 1, school_id: 1, academic_year_id: 1, employee_id: 1, max_periods_per_day: null, max_consecutive_periods: 1, max_working_days: null, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0 }];
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1)], placements: [placement(1)], constraints, fixedEntries: [{ slot_id: 1, teaching_load_id: 1 }, { slot_id: 2, teaching_load_id: 1 }] }));
  assert.equal(result.status, 'fixed_conflict');
  assert.ok(result.fixed_conflicts.some((item) => item.code === 'fixed_consecutive_limit'));
});

test('fixed entries cannot exceed the teaching load weekly count', () => {
  const { days, slots } = week(2, 3);
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 1 })], placements: [placement(1)], fixedEntries: [{ slot_id: 1, teaching_load_id: 1 }, { slot_id: 4, teaching_load_id: 1 }] }));
  assert.equal(result.status, 'fixed_conflict');
  assert.ok(result.fixed_conflicts.some((item) => item.code === 'fixed_weekly_limit'));
});

function internalEntries(result) {
  return result.entries.map((entry, index) => ({
    id: index + 1,
    school_id: 1,
    academic_year_id: 1,
    slot_id: entry.slot_id,
    teaching_load_id: entry.teaching_load_id,
    created_by_user_id: null,
    updated_by_user_id: null,
    created_at: 0,
    updated_at: 0,
  }));
}

test('simple feasible timetable completes with exact weekly demand', () => {
  const { days, slots } = week(3, 4);
  const loads = [teachingLoad(1, { weekly_periods: 3 }), teachingLoad(2, { weekly_periods: 2 })];
  const input = solverInput({ days, slots, loads, placements: [placement(1), placement(2)] });
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.equal(result.required_periods, 5);
  assert.equal(result.scheduled_periods, 5);
  assert.equal(result.unscheduled_periods, 0);
  assert.equal(validateTimetableSolverProposal(input, internalEntries(result)).length, 0);
});

test('each teaching load receives exactly weekly_periods placements', () => {
  const { days, slots } = week(4, 5);
  const loads = [teachingLoad(1, { weekly_periods: 5 }), teachingLoad(2, { weekly_periods: 3 })];
  const result = solveTimetable(solverInput({ days, slots, loads, placements: [placement(1), placement(2)] }));
  for (const load of loads) assert.equal(result.entries.filter((entry) => entry.teaching_load_id === load.id).length, load.weekly_periods);
});

test('class capacity overload is impossible and never emits a class collision', () => {
  const { days, slots } = week(1, 2);
  const loads = [teachingLoad(1, { class_id: 1, employee_id: 1, weekly_periods: 2 }), teachingLoad(2, { class_id: 1, employee_id: 2, weekly_periods: 2 })];
  const input = solverInput({ days, slots, loads, placements: [placement(1)] });
  const result = solveTimetable(input);
  assert.equal(result.status, 'impossible');
  assert.equal(result.readiness.overloaded_class_sections.length, 1);
  assert.ok(result.unscheduled.every((item) => item.reason_codes.includes('no_class_capacity')));
  assert.equal(validateTimetableSolverProposal(input, internalEntries(result)).length, 0);
});

test('one teacher cannot collide across classes', () => {
  const { days, slots } = week(1, 3);
  const loads = [teachingLoad(1, { employee_id: 1, weekly_periods: 3 }), teachingLoad(2, { employee_id: 1, weekly_periods: 3 })];
  const input = solverInput({ days, slots, loads, placements: [placement(1), placement(2)] });
  const result = solveTimetable(input);
  assert.equal(result.status, 'impossible');
  assert.equal(result.readiness.overloaded_teachers.length, 1);
  assert.equal(new Set(result.entries.map((entry) => `${entry.employee_id}:${entry.slot_id}`)).size, result.entries.length);
});

test('unavailable teacher slots are always respected', () => {
  const { days, slots } = week(2, 3);
  const unavailable = slots.slice(0, 4).map((slot, index) => ({ id: index + 1, school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: slot.id, status: 'unavailable', created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0 }));
  const load = teachingLoad(1, { weekly_periods: 2 });
  const result = solveTimetable(solverInput({ days, slots, loads: [load], placements: [placement(1)], availability: unavailable }));
  assert.equal(result.status, 'complete');
  assert.ok(result.entries.every((entry) => !unavailable.some((item) => item.slot_id === entry.slot_id)));
});

test('max periods per day is a hard constraint', () => {
  const { days, slots } = week(3, 3);
  const constraints = [{ school_id: 1, academic_year_id: 1, employee_id: 1, max_periods_per_day: 1, max_consecutive_periods: null, max_working_days: null, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0, id: 1 }];
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 3 })], placements: [placement(1)], constraints }));
  const counts = new Map();
  for (const entry of result.entries) counts.set(entry.day_of_week, (counts.get(entry.day_of_week) || 0) + 1);
  assert.ok([...counts.values()].every((count) => count <= 1));
  assert.equal(result.status, 'complete');
});

test('max working days is a hard constraint', () => {
  const { days, slots } = week(3, 3);
  const constraints = [{ school_id: 1, academic_year_id: 1, employee_id: 1, max_periods_per_day: null, max_consecutive_periods: null, max_working_days: 1, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0, id: 1 }];
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 3 })], placements: [placement(1)], constraints }));
  assert.equal(new Set(result.entries.map((entry) => entry.day_of_week)).size, 1);
});

test('max consecutive periods is a hard constraint', () => {
  const { days, slots } = week(1, 4);
  const constraints = [{ school_id: 1, academic_year_id: 1, employee_id: 1, max_periods_per_day: null, max_consecutive_periods: 1, max_working_days: null, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0, id: 1 }];
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 2 })], placements: [placement(1)], constraints }));
  const indexes = result.entries.map((entry) => slots.find((slot) => slot.id === entry.slot_id).slot_index).sort();
  assert.equal(result.status, 'complete');
  assert.ok(Math.abs(indexes[1] - indexes[0]) > 1);
});

test('missing-teacher demand remains schedulable and clearly labelled', () => {
  const { days, slots } = week(2, 3);
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { employee_id: null, weekly_periods: 3 })], placements: [placement(1)] }));
  assert.equal(result.status, 'complete');
  assert.equal(result.entries.length, 3);
  assert.ok(result.entries.every((entry) => entry.employee_id == null && entry.employee_name == null));
  assert.equal(result.readiness.missing_teacher_count, 1);
});

test('archived or structurally invalid teaching loads are rejected as impossible demand', () => {
  const { days, slots } = week(2, 3);
  const loads = [teachingLoad(1, { employee_status: 'archived' }), teachingLoad(2, { subject_school_id: 2 })];
  const result = solveTimetable(solverInput({ days, slots, loads, placements: [placement(1), placement(2)] }));
  assert.equal(result.status, 'impossible');
  assert.equal(result.readiness.invalid_load_count, 2);
  assert.equal(result.entries.length, 0);
  assert.ok(result.unscheduled.every((item) => item.reason_codes.includes('invalid_teaching_load')));
});

test('inactive teaching loads create no demand', () => {
  const { days, slots } = week(2, 3);
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { status: 'inactive', weekly_periods: 4 })], placements: [placement(1)] }));
  assert.equal(result.required_periods, 0);
  assert.equal(result.entries.length, 0);
  assert.equal(result.status, 'complete');
});

test('inactive slots and break slots are excluded', () => {
  const { days, slots } = week(2, 3, { breaks: true });
  slots[0].is_active = 0;
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 4 })], placements: [placement(1)] }));
  assert.ok(result.entries.every((entry) => {
    const target = slots.find((slot) => slot.id === entry.slot_id);
    return target.is_active === 1 && target.slot_type === 'lesson';
  }));
});

test('disabled days are excluded', () => {
  const { days, slots } = week(2, 3);
  days[0].is_active = 0;
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 3 })], placements: [placement(1)] }));
  assert.ok(result.entries.every((entry) => entry.day_of_week === 1));
});

test('no active days or no active lesson slots is impossible', () => {
  const first = week(2, 2);
  first.days.forEach((day) => { day.is_active = 0; });
  assert.equal(solveTimetable(solverInput({ ...first, loads: [teachingLoad(1)], placements: [placement(1)] })).status, 'impossible');
  const second = week(2, 2);
  second.slots.forEach((slot) => { slot.slot_type = 'break'; slot.lesson_number = null; });
  assert.equal(solveTimetable(solverInput({ ...second, loads: [teachingLoad(1)], placements: [placement(1)] })).status, 'impossible');
});

test('cross-school and cross-year slots cannot become proposal targets', () => {
  const { days, slots } = week(2, 2);
  slots[0].school_id = 2;
  slots[1].academic_year_id = 2;
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 2 })], placements: [placement(1)] }));
  assert.ok(result.entries.every((entry) => ![slots[0].id, slots[1].id].includes(entry.slot_id)));
  assert.equal(result.statistics.active_lesson_slot_count, 2);
});

test('same input produces the same proposal and quality score', () => {
  const { days, slots } = week(4, 4);
  const input = solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 4 }), teachingLoad(2, { weekly_periods: 4 })], placements: [placement(1), placement(2)] });
  const first = solveTimetable(input);
  const second = solveTimetable(input);
  assert.deepEqual(first.entries, second.entries);
  assert.equal(first.quality_score, second.quality_score);
  assert.deepEqual(first.scoring, second.scoring);
});

test('bounded search returns partial with unresolved reason codes instead of hanging', () => {
  const { days, slots } = week(5, 6);
  const result = solveTimetable(solverInput({
    days, slots,
    loads: [teachingLoad(1, { weekly_periods: 10 })],
    placements: [placement(1)],
    limits: { time_budget_ms: 2_000, max_attempts: 10, max_backtracks: 2, max_local_improvement_attempts: 0 },
  }));
  assert.equal(result.status, 'partial');
  assert.equal(result.statistics.stopped_by_limit, true);
  assert.ok(result.unscheduled.length > 0);
  assert.deepEqual(result.unscheduled[0].reason_codes, ['search_budget_exhausted']);
  assert.ok(result.quality_score < 100);
  assert.ok(result.statistics.attempts <= 10);
});

test('subject demand is distributed across the week when alternatives exist', () => {
  const { days, slots } = week(4, 3);
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 4 })], placements: [placement(1)] }));
  assert.equal(new Set(result.entries.map((entry) => entry.day_of_week)).size, 4);
  assert.equal(result.scoring.penalties.subject_clustering, 0);
});

test('pedagogy classification recognizes normalized school labels and leaves unknown subjects neutral', () => {
  for (const name of [' التّربية الأَخلاقِيّة ', 'التربية الفنية', 'التربية البدنية', 'اللغة الکوردیة', 'اللغة الفرنسية', 'الحاسوب', 'PHYSICAL EDUCATION']) {
    assert.equal(classifyTimetableSubject(name), 'light', name);
  }
  for (const name of ['الرّياضيّات', 'اللغة العربية', 'اللغة الإنكليزية', 'الفيزياء', 'الكيمياء', 'الأحياء']) {
    assert.equal(classifyTimetableSubject(name), 'heavy', name);
  }
  for (const name of ['المطالعة', 'الاسلامية', 'المسيحية', 'مادة مدرسية جديدة', '', null]) {
    assert.equal(classifyTimetableSubject(name), 'neutral', String(name));
  }
});

test('pedagogy resets heavy runs at recess but allows teacher section continuity across it', () => {
  const {slots} = week(1, 4);
  for (const slot of slots) if (slot.lesson_number >= 3) slot.slot_index += 1;
  Object.assign(slots[2], {start_time: '09:30', end_time: '10:10'});
  Object.assign(slots[3], {start_time: '10:10', end_time: '10:50'});
  slots.push({...slots[1], id: 99, slot_index: 3, slot_type: 'break', lesson_number: null, start_time: '09:20', end_time: '09:30'});
  const heavy = teachingLoad(1, {subject_name: 'الرياضيات', weekly_periods: 4});
  const scorer = createTimetablePedagogyScorer([heavy], slots);
  assert.equal(scorer.score([1, 2, 3, 4].map(slot_id => ({slot_id, teaching_load_id: 1}))).metrics.heavy_run_excess, 0);
  const sectionLoads = [
    teachingLoad(2, {class_id: 2, section_id: 21, employee_id: 2, subject_name: 'اللغة العربية'}),
    teachingLoad(3, {class_id: 2, section_id: 22, employee_id: 2, subject_name: 'اللغة العربية'}),
  ];
  const continuity = createTimetablePedagogyScorer(sectionLoads, slots);
  assert.equal(continuity.score([{slot_id: 2, teaching_load_id: 2}, {slot_id: 3, teaching_load_id: 3}]).metrics.consecutive_section_pairs, 1);
  assert.equal(continuity.score([{slot_id: 1, teaching_load_id: 2}, {slot_id: 3, teaching_load_id: 3}]).metrics.consecutive_section_pairs, 0,
    'an intervening lesson prevents consecutive continuity');
});

for (const [label, secondOverrides] of [
  ['different teacher', {employee_id: 2}],
  ['different class', {class_id: 2}],
  ['different subject', {subject_name: 'اللغة العربية'}],
  ['same section', {section_id: 1}],
  ['unassigned teacher', {employee_id: null}],
  ['whole class', {section_id: null}],
]) test(`pedagogy does not reward false section continuity for ${label}`, () => {
  const first = {class_id: 1, section_id: 1, employee_id: 1, subject_name: 'الرياضيات', weekly_periods: 1};
  const second = {...first, section_id: 2, ...secondOverrides};
  const scorer = createTimetablePedagogyScorer([teachingLoad(1, first), teachingLoad(2, second)], week(1, 2).slots);
  const score = scorer.score([{slot_id: 1, teaching_load_id: 1}, {slot_id: 2, teaching_load_id: 2}]);
  assert.equal(score.metrics.consecutive_section_pairs, 0);
  assert.equal(score.metrics.possible_section_pairs, 0);
});

test('pedagogy counts each lesson once when three sections form a continuous run', () => {
  const loads = [1, 2, 3].map(id => teachingLoad(id, {class_id: 1, section_id: id, employee_id: 1,
    subject_name: 'الرياضيات', weekly_periods: 1}));
  const score = createTimetablePedagogyScorer(loads, week(1, 3).slots)
    .score(loads.map(load => ({teaching_load_id: load.id, slot_id: load.id})));
  assert.equal(score.metrics.possible_section_pairs, 1);
  assert.equal(score.metrics.consecutive_section_pairs, 1);
});

test('pedagogy counts parallel pupil periods once for early lessons and heavy runs', () => {
  const loads = [
    teachingLoad(1, {class_id: 1, section_id: 9, subject_name: 'الرياضيات', weekly_periods: 3}),
    teachingLoad(2, {class_id: 1, section_id: 9, subject_name: 'الفيزياء', weekly_periods: 3, parallel_with_load_id: 1}),
    teachingLoad(3, {class_id: 2, section_id: 10, subject_name: 'الفنية', weekly_periods: 1}),
    teachingLoad(4, {class_id: 2, section_id: 10, subject_name: 'التربية الأخلاقية', weekly_periods: 1, parallel_with_load_id: 3}),
  ];
  const entries = [1, 2, 3].flatMap(slot_id => [1, 2].map(teaching_load_id => ({slot_id, teaching_load_id})));
  entries.push({slot_id: 1, teaching_load_id: 3}, {slot_id: 1, teaching_load_id: 4});
  const score = createTimetablePedagogyScorer(loads, week(1, 3).slots).score(entries);
  assert.equal(score.metrics.heavy_run_excess, 1);
  assert.equal(score.metrics.early_light_lessons, 1);
  assert.equal(score.penalties.early_light_subjects, 40);
});

for (const subject_name of ['التربية الأخلاقية', 'الفنية', 'الرياضة', 'اللغة الكردية', 'اللغة الفرنسية', 'الحاسوب']) {
  test(`pedagogy keeps ${subject_name} out of the first two lessons when capacity permits`, () => {
    const input = solverInput({...week(1, 3), placements: [placement(1)], loads: [
      teachingLoad(1, {class_id: 1, subject_name, weekly_periods: 1}),
      teachingLoad(2, {class_id: 1, subject_name: 'الرياضيات', weekly_periods: 1}),
      teachingLoad(3, {class_id: 1, subject_name: 'اللغة العربية', weekly_periods: 1}),
    ]});
    const before = structuredClone(input);
    const result = solveTimetable(input);
    assert.equal(result.status, 'complete');
    assert.equal(result.entries.find(entry => entry.teaching_load_id === 1).lesson_number, 3);
    assert.equal(result.scoring.penalties.early_light_subjects, 0);
    assert.deepEqual(validateTimetableSolverProposal(input, internalEntries(result)), []);
    assert.deepEqual(input, before, 'preferences must not change school settings or teacher assignments');
  });
}

test('pedagogy prefers the second lesson over the first when a short day cannot avoid both', () => {
  const input = solverInput({...week(1, 2), placements: [placement(1)], loads: [
    teachingLoad(1, {subject_name: 'اللغة الفرنسية', weekly_periods: 1}),
  ]});
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.equal(result.entries[0].lesson_number, 2);
  assert.equal(result.scoring.pedagogy.early_light_lessons, 1);
});

test('pedagogy permits a light first lesson when hard teacher availability requires it', () => {
  const input = solverInput({...week(1, 3), placements: [placement(1)], loads: [
    teachingLoad(1, {subject_name: 'الفنية', weekly_periods: 1}),
  ], availability: [2, 3].map(slot_id => ({school_id: 1, academic_year_id: 1, employee_id: 1, slot_id, status: 'unavailable'}))});
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.equal(result.entries[0].lesson_number, 1);
  assert.ok(result.scoring.penalties.early_light_subjects > 0);
  assert.deepEqual(validateTimetableSolverProposal(input, internalEntries(result)), []);
});

test('pedagogy preserves a fixed light first lesson instead of moving or rejecting it', () => {
  const input = solverInput({...week(2, 3), placements: [placement(1)], loads: [
    teachingLoad(1, {subject_name: 'الرياضة', weekly_periods: 2}),
  ], fixedEntries: [{slot_id: 1, teaching_load_id: 1, is_locked: 1}]});
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.ok(result.entries.some(entry => entry.slot_id === 1 && entry.teaching_load_id === 1 && entry.is_locked === 1));
  assert.equal(result.scoring.pedagogy.early_light_lessons, 1);
  assert.deepEqual(validateTimetableSolverProposal(input, internalEntries(result)), []);
});

test('pedagogy separates four heavy lessons with an available neutral lesson in a full day', () => {
  const names = ['الرياضيات', 'اللغة العربية', 'الفيزياء', 'الكيمياء', 'المطالعة'];
  const input = solverInput({...week(1, 5), placements: [placement(1)], loads: names.map((subject_name, index) =>
    teachingLoad(index + 1, {class_id: 1, subject_name, weekly_periods: 1}))});
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.equal(result.entries.find(entry => entry.teaching_load_id === 5).lesson_number, 3);
  assert.equal(result.scoring.pedagogy.heavy_run_excess, 0);
  assert.deepEqual(validateTimetableSolverProposal(input, internalEntries(result)), []);
});

test('pedagogy keeps unavoidable heavy runs soft when every period is required', () => {
  const input = solverInput({...week(1, 4), placements: [placement(1)], loads: [
    teachingLoad(1, {subject_name: 'الرياضيات', weekly_periods: 4}),
  ]});
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.equal(result.scheduled_periods, 4);
  assert.equal(result.scoring.pedagogy.heavy_run_excess, 2);
  assert.deepEqual(validateTimetableSolverProposal(input, internalEntries(result)), []);
});

test('pedagogy prefers consecutive A to B lessons for the same teacher and normalized subject', () => {
  const input = solverInput({...week(1, 4), placements: [placement(1, 1), placement(1, 2)], loads: [
    teachingLoad(1, {class_id: 1, section_id: 1, employee_id: 1, subject_name: 'اللُّغة العَرَبيّة', weekly_periods: 1}),
    teachingLoad(2, {class_id: 1, section_id: 2, employee_id: 1, subject_name: 'اللغة العربية', weekly_periods: 1}),
  ]});
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  const lessons = result.entries.map(entry => entry.lesson_number).sort((left, right) => left - right);
  assert.equal(lessons[1] - lessons[0], 1);
  assert.equal(result.scoring.pedagogy.consecutive_section_pairs, 1);
  assert.equal(result.scoring.pedagogy.possible_section_pairs, 1);
  assert.equal(result.scoring.penalties.missed_section_continuity, 0);
  assert.deepEqual(validateTimetableSolverProposal(input, internalEntries(result)), []);
});

test('pedagogy never sacrifices teacher consecutive limits for cross-section continuity', () => {
  const input = solverInput({...week(1, 3), placements: [placement(1, 1), placement(1, 2)], loads: [
    teachingLoad(1, {class_id: 1, section_id: 1, employee_id: 1, subject_name: 'الرياضيات', weekly_periods: 1}),
    teachingLoad(2, {class_id: 1, section_id: 2, employee_id: 1, subject_name: 'الرياضيات', weekly_periods: 1}),
  ], constraints: [{school_id: 1, academic_year_id: 1, employee_id: 1, max_consecutive_periods: 1,
    max_periods_per_day: null, max_working_days: null, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0}]});
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.entries.map(entry => entry.lesson_number).sort(), [1, 3]);
  assert.equal(result.scoring.pedagogy.consecutive_section_pairs, 0);
  assert.deepEqual(validateTimetableSolverProposal(input, internalEntries(result)), []);
});

test('pedagogy evaluates a light parallel companion while keeping both teachers co-timed', () => {
  const input = solverInput({...week(1, 3), placements: [placement(1, 9)], loads: [
    teachingLoad(1, {class_id: 1, section_id: 9, subject_name: 'الرياضيات', weekly_periods: 1}),
    teachingLoad(2, {class_id: 1, section_id: 9, subject_name: 'التربية الأخلاقية', weekly_periods: 1, parallel_with_load_id: 1}),
    teachingLoad(3, {class_id: 1, section_id: 9, subject_name: 'اللغة العربية', weekly_periods: 1}),
    teachingLoad(4, {class_id: 1, section_id: 9, subject_name: 'المطالعة', weekly_periods: 1}),
  ]});
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.equal(result.scheduled_periods, 3);
  assert.equal(result.entries.length, 4);
  assertCompletePairs(result);
  assert.equal(result.entries.find(entry => entry.teaching_load_id === 2).lesson_number, 3);
  assert.deepEqual(validateTimetableSolverProposal(input, internalEntries(result)), []);
});

test('compact teacher preference avoids unnecessary gaps', () => {
  const { days, slots } = week(1, 4);
  const constraints = [{ school_id: 1, academic_year_id: 1, employee_id: 1, max_periods_per_day: null, max_consecutive_periods: null, max_working_days: null, prefer_compact_schedule: 1, avoid_first_period: 0, avoid_last_period: 0, id: 1 }];
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 2 })], placements: [placement(1)], constraints }));
  const indexes = result.entries.map((entry) => slots.find((slot) => slot.id === entry.slot_id).slot_index).sort();
  assert.equal(indexes[1] - indexes[0], 1);
  assert.equal(result.scoring.penalties.teacher_gaps, 0);
});

test('preferred and avoid slot scoring influences deterministic placement', () => {
  const { days, slots } = week(1, 3);
  const availability = [
    { id: 1, school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: slots[0].id, status: 'avoid', created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0 },
    { id: 2, school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: slots[1].id, status: 'preferred', created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0 },
  ];
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 1 })], placements: [placement(1)], availability }));
  assert.equal(result.entries[0].slot_id, slots[1].id);
  assert.equal(result.scoring.preferred_slots_used, 1);
});

test('final authoritative validator rejects a class-wide/section collision', () => {
  const { days, slots } = week(1, 2);
  const loads = [
    teachingLoad(1, { class_id: 1, section_id: null, weekly_periods: 1 }),
    teachingLoad(2, { class_id: 1, section_id: 2, weekly_periods: 1, subject_section_id: 2, employee_id: 2 }),
  ];
  loads[0].active_section_count = 0;
  const input = solverInput({ days, slots, loads, placements: [placement(1, 2)] });
  const entries = [1, 2].map((loadId, index) => ({ id: index + 1, school_id: 1, academic_year_id: 1, slot_id: slots[0].id, teaching_load_id: loadId, created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0 }));
  assert.ok(validateTimetableSolverProposal(input, entries).some((notice) => notice.code === 'class_section_collision'));
});

test('exact class capacity boundary can complete', () => {
  const { days, slots } = week(2, 2);
  const loads = [teachingLoad(1, { class_id: 1, weekly_periods: 2 }), teachingLoad(2, { class_id: 1, employee_id: 2, weekly_periods: 2 })];
  const result = solveTimetable(solverInput({ days, slots, loads, placements: [placement(1)] }));
  assert.equal(result.status, 'complete');
  assert.equal(result.entries.length, slots.length);
});

test('current timetable entries are measured without mutating records or reusing their record identifiers', () => {
  const { days, slots } = week(2, 2);
  const loads = [teachingLoad(1, { weekly_periods: 2 })];
  const currentEntries = [{ id: 99, school_id: 1, academic_year_id: 1, slot_id: slots[0].id, teaching_load_id: 1, created_by_user_id: 1, updated_by_user_id: 1, created_at: 1, updated_at: 1 }];
  const snapshot = structuredClone(currentEntries);
  const result = solveTimetable(solverInput({ days, slots, loads, placements: [placement(1)], currentEntries }));
  assert.deepEqual(currentEntries, snapshot);
  assert.equal(result.statistics.current_valid_entry_count, 1);
  assert.equal(result.entries.some((entry) => entry.proposal_id === '99'), false);
});

test('a valid complete saved timetable retains coverage and fixed parallel groups under a tiny search budget', () => {
  const input = parallelInput();
  input.loads.push(teachingLoad(3, {class_id: 1, section_id: 9, subject_name: 'الحاسوب', weekly_periods: 2}));
  const saved = solveTimetable(input);
  assert.equal(saved.status, 'complete');
  input.currentEntries = internalEntries(saved);
  const fixedSlot = saved.entries.find(entry => entry.teaching_load_id === 1).slot_id;
  input.fixedEntries = [1, 2].map(teaching_load_id => ({slot_id: fixedSlot, teaching_load_id, is_locked: 1}));
  for (const entry of input.currentEntries) entry.is_locked = entry.slot_id === fixedSlot && entry.teaching_load_id !== 3 ? 1 : 0;
  input.limits = {time_budget_ms: 1000, max_attempts: 1, max_backtracks: 1, max_local_improvement_attempts: 0};
  const before = structuredClone(input);
  const result = solveTimetable(input);
  assert.equal(result.status, 'complete');
  assert.equal(result.scheduled_periods, 4);
  assert.equal(result.entries.length, 6);
  assert.ok(result.statistics.attempts <= 1);
  for (const fixed of input.fixedEntries) assert.ok(result.entries.some(entry => entry.slot_id === fixed.slot_id
    && entry.teaching_load_id === fixed.teaching_load_id && entry.is_locked === 1));
  assertCompletePairs(result);
  assert.deepEqual(validateTimetableSolverProposal(input, internalEntries(result)), []);
  assert.deepEqual(input, before);
});

test('soft optimization stops with a valid complete proposal while retaining time for final validation', () => {
  const input = solverInput({...week(1, 3), placements: [placement(1)], loads: [
    teachingLoad(1, {class_id: 1, subject_name: 'الفنية', weekly_periods: 1}),
    teachingLoad(2, {class_id: 1, subject_name: 'الرياضيات', weekly_periods: 2}),
  ], limits: {time_budget_ms: 1000, max_attempts: 1000, max_backtracks: 100, max_local_improvement_attempts: 500}});
  const originalNow = Date.now;
  let first = true, result;
  Date.now = () => { if (first) { first = false; return 0; } return 750; };
  try { result = solveTimetable(input); } finally { Date.now = originalNow; }
  assert.equal(result.status, 'complete');
  assert.equal(result.statistics.local_improvement_attempts, 0);
  assert.equal(result.scheduled_periods, 3);
  assert.deepEqual(validateTimetableSolverProposal(input, internalEntries(result)), []);
});

function benchmarkInput(placementCount, teacherCount, loadCount) {
  const { days, slots } = week(5, 7, { breaks: true });
  const placements = Array.from({ length: placementCount }, (_, index) => placement(index + 1));
  const loads = Array.from({ length: loadCount }, (_, index) => teachingLoad(index + 1, {
    class_id: (index % placementCount) + 1,
    employee_id: (index % teacherCount) + 1,
    subject_id: index + 1,
    weekly_periods: 2,
  }));
  const input = solverInput({ days, slots, loads, placements });
  delete input.limits;
  return input;
}

for (const benchmark of [
  { name: 'small', placements: 5, teachers: 8, loads: 10 },
  { name: 'medium', placements: 15, teachers: 30, loads: 36 },
  { name: 'large', placements: 30, teachers: 60, loads: 105 },
]) {
  test(`solver ${benchmark.name} benchmark stays bounded and complete`, () => {
    const input = benchmarkInput(benchmark.placements, benchmark.teachers, benchmark.loads);
    const startedAt = performance.now();
    const result = solveTimetable(input);
    const runtime = Math.round(performance.now() - startedAt);
    console.log(`SOLVER_BENCHMARK ${benchmark.name} runtime_ms=${runtime} attempts=${result.statistics.attempts} backtracks=${result.statistics.backtracks} scheduled_pct=${Math.round(result.scheduled_periods / result.required_periods * 100)} quality=${result.quality_score}`);
    assert.equal(result.status, 'complete');
    assert.equal(result.scheduled_periods, result.required_periods);
    assert.ok(runtime < 2_500);
    assert.ok(result.statistics.attempts <= result.statistics.attempt_budget);
    assert.equal(validateTimetableSolverProposal(input, internalEntries(result)).length, 0);
  });
}

test('solver many-locked benchmark remains bounded and preserves every fixed placement', () => {
  const input = benchmarkInput(15, 30, 36);
  const baseline = solveTimetable(input);
  const fixedEntries = baseline.entries
    .filter((_, index) => index % 2 === 0)
    .map(({ slot_id, teaching_load_id }) => ({ slot_id, teaching_load_id }));
  const startedAt = performance.now();
  const result = solveTimetable({ ...input, fixedEntries });
  const runtime = Math.round(performance.now() - startedAt);
  console.log(`SOLVER_BENCHMARK many-locked runtime_ms=${runtime} attempts=${result.statistics.attempts} backtracks=${result.statistics.backtracks} scheduled_pct=${Math.round(result.scheduled_periods / result.required_periods * 100)} locked=${fixedEntries.length} quality=${result.quality_score}`);
  assert.equal(result.status, 'complete');
  assert.ok(runtime < 2_500);
  for (const fixed of fixedEntries) {
    assert.ok(result.entries.some((entry) => entry.slot_id === fixed.slot_id && entry.teaching_load_id === fixed.teaching_load_id && entry.is_locked === 1));
  }
});

test('an impossible overloaded class still preserves an independent feasible class proposal', () => {
  const { days, slots } = week(1, 2);
  const loads = [
    teachingLoad(1, { class_id: 1, employee_id: 1, weekly_periods: 2 }),
    teachingLoad(2, { class_id: 1, employee_id: 2, weekly_periods: 1 }),
    teachingLoad(3, { class_id: 2, employee_id: 3, weekly_periods: 2 }),
  ];
  const input = solverInput({ days, slots, loads, placements: [placement(1), placement(2)] });
  const result = solveTimetable(input);
  assert.equal(result.status, 'impossible');
  assert.equal(result.entries.filter((entry) => entry.class_id === 2).length, 2);
  assert.equal(result.scheduled_periods, 4);
  assert.equal(validateTimetableSolverProposal(input, internalEntries(result)).length, 0);
});

test('an invalid load does not suppress independent valid demand', () => {
  const { days, slots } = week(2, 2);
  const loads = [
    teachingLoad(1, { employee_status: 'archived', weekly_periods: 2 }),
    teachingLoad(2, { class_id: 2, employee_id: 2, weekly_periods: 3 }),
  ];
  const input = solverInput({ days, slots, loads, placements: [placement(1), placement(2)] });
  const result = solveTimetable(input);
  assert.equal(result.status, 'impossible');
  assert.equal(result.entries.filter((entry) => entry.teaching_load_id === 2).length, 3);
  assert.equal(result.unscheduled.find((item) => item.teaching_load_id === 1)?.reason_codes[0], 'invalid_teaching_load');
});

test('preferred override on an inactive slot does not affect current ranking or quality', () => {
  const { days, slots } = week(1, 3);
  slots[0].is_active = 0;
  const load = teachingLoad(1, { weekly_periods: 1 });
  const baseline = solveTimetable(solverInput({ days, slots, loads: [load], placements: [placement(1)] }));
  const historicalAvailability = [
    { id: 1, school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: slots[0].id, status: 'preferred', created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0 },
  ];
  const result = solveTimetable(solverInput({ days, slots, loads: [load], placements: [placement(1)], availability: historicalAvailability }));
  assert.equal(result.scoring.preferred_slots_used, 0);
  assert.equal(result.scoring.penalties.outside_preferred_slots, 0);
  assert.equal(result.quality_score, baseline.quality_score);
  assert.deepEqual(result.entries.map((entry) => entry.slot_id), baseline.entries.map((entry) => entry.slot_id));
});

test('preferred override on a disabled day does not affect current ranking or quality', () => {
  const { days, slots } = week(2, 2);
  days[0].is_active = 0;
  const load = teachingLoad(1, { weekly_periods: 1 });
  const baseline = solveTimetable(solverInput({ days, slots, loads: [load], placements: [placement(1)] }));
  const availability = [
    { id: 1, school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: slots[0].id, status: 'preferred', created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0 },
  ];
  const result = solveTimetable(solverInput({ days, slots, loads: [load], placements: [placement(1)], availability }));
  assert.equal(result.scoring.preferred_slots_used, 0);
  assert.equal(result.scoring.penalties.outside_preferred_slots, 0);
  assert.equal(result.quality_score, baseline.quality_score);
  assert.deepEqual(result.entries.map((entry) => entry.slot_id), baseline.entries.map((entry) => entry.slot_id));
});

test('active preferred override remains authoritative for ranking and scoring', () => {
  const { days, slots } = week(1, 3);
  const availability = [
    { id: 1, school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: slots[2].id, status: 'preferred', created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0 },
  ];
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 1 })], placements: [placement(1)], availability }));
  assert.equal(result.entries[0].slot_id, slots[2].id);
  assert.equal(result.scoring.preferred_slots_used, 1);
  assert.equal(result.scoring.penalties.outside_preferred_slots, 0);
});

test('readiness accounts for max consecutive periods when teacher demand is impossible', () => {
  const { days, slots } = week(1, 4);
  const constraints = [{ school_id: 1, academic_year_id: 1, employee_id: 1, max_periods_per_day: null, max_consecutive_periods: 1, max_working_days: null, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0, id: 1 }];
  const input = solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 3 })], placements: [placement(1)], constraints });
  const result = solveTimetable(input);
  assert.equal(result.status, 'impossible');
  assert.equal(result.readiness.overloaded_teachers.length, 1);
  assert.equal(result.readiness.overloaded_teachers[0].available_capacity, 2);
  assert.equal(result.scheduled_periods, 2);
  assert.equal(validateTimetableSolverProposal(input, internalEntries(result)).length, 0);
});

test('an overloaded teacher does not suppress unrelated feasible teachers', () => {
  const { days, slots } = week(1, 3);
  const loads = [
    teachingLoad(1, { class_id: 1, employee_id: 1, weekly_periods: 2 }),
    teachingLoad(2, { class_id: 2, employee_id: 1, weekly_periods: 2 }),
    teachingLoad(3, { class_id: 3, employee_id: 3, weekly_periods: 3 }),
  ];
  const input = solverInput({ days, slots, loads, placements: [placement(1), placement(2), placement(3)] });
  const result = solveTimetable(input);
  assert.equal(result.status, 'impossible');
  assert.equal(result.entries.filter((entry) => entry.employee_id === 3).length, 3);
  assert.equal(result.scheduled_periods, 6);
  assert.equal(validateTimetableSolverProposal(input, internalEntries(result)).length, 0);
});

test('no active scheduling domain naturally returns an empty impossible proposal', () => {
  const noDays = week(2, 2);
  noDays.days.forEach((day) => { day.is_active = 0; });
  const first = solveTimetable(solverInput({ ...noDays, loads: [teachingLoad(1)], placements: [placement(1)] }));
  assert.equal(first.status, 'impossible');
  assert.equal(first.scheduled_periods, 0);
  assert.equal(first.entries.length, 0);

  const noLessons = week(2, 2);
  noLessons.slots.forEach((slot) => { slot.slot_type = 'break'; slot.lesson_number = null; });
  const second = solveTimetable(solverInput({ ...noLessons, loads: [teachingLoad(1)], placements: [placement(1)] }));
  assert.equal(second.status, 'impossible');
  assert.equal(second.scheduled_periods, 0);
  assert.equal(second.entries.length, 0);
});

test('cross-tenant and cross-year loads are invalid demand and never proposed', () => {
  const { days, slots } = week(2, 2);
  const loads = [
    teachingLoad(1, { school_id: 2, class_school_id: 2, subject_school_id: 2, employee_school_id: 2 }),
    teachingLoad(2, { academic_year_id: 2 }),
    teachingLoad(3, { class_id: 3, employee_id: 3, weekly_periods: 2 }),
  ];
  const input = solverInput({ days, slots, loads, placements: [placement(1), placement(2), placement(3)] });
  const result = solveTimetable(input);
  assert.equal(result.status, 'impossible');
  assert.equal(result.readiness.invalid_load_count, 2);
  assert.deepEqual(result.entries.map((entry) => entry.teaching_load_id), [3, 3]);
  assert.ok(result.unscheduled.filter((item) => item.teaching_load_id !== 3)
    .every((item) => item.reason_codes.length === 1 && item.reason_codes[0] === 'invalid_teaching_load'));
});

test('unscheduled reason codes identify exact teacher hard limits without conflict noise', () => {
  const scenarios = [
    {
      expected: 'teacher_unavailable',
      week: week(1, 3),
      constraints: [],
      availability: null,
      required: 1,
    },
    {
      expected: 'teacher_daily_limit',
      week: week(2, 2),
      constraints: [{ school_id: 1, academic_year_id: 1, employee_id: 1, max_periods_per_day: 1, max_consecutive_periods: null, max_working_days: null, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0, id: 1 }],
      availability: [],
      required: 3,
    },
    {
      expected: 'teacher_working_days_limit',
      week: week(2, 2),
      constraints: [{ school_id: 1, academic_year_id: 1, employee_id: 1, max_periods_per_day: null, max_consecutive_periods: null, max_working_days: 1, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0, id: 1 }],
      availability: [],
      required: 3,
    },
    {
      expected: 'teacher_consecutive_limit',
      week: week(1, 4),
      constraints: [{ school_id: 1, academic_year_id: 1, employee_id: 1, max_periods_per_day: null, max_consecutive_periods: 1, max_working_days: null, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0, id: 1 }],
      availability: [],
      required: 3,
    },
  ];
  scenarios[0].availability = scenarios[0].week.slots.map((slot, index) => ({ id: index + 1, school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: slot.id, status: 'unavailable', created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0 }));

  for (const scenario of scenarios) {
    const input = solverInput({
      ...scenario.week,
      loads: [teachingLoad(1, { weekly_periods: scenario.required })],
      placements: [placement(1)],
      availability: scenario.availability,
      constraints: scenario.constraints,
    });
    const result = solveTimetable(input);
    assert.equal(result.status, 'impossible');
    assert.ok(result.unscheduled[0].reason_codes.includes(scenario.expected), `${scenario.expected}: ${result.unscheduled[0].reason_codes.join(',')}`);
    assert.equal(validateTimetableSolverProposal(input, internalEntries(result)).length, 0);
  }
});

test('teacher collision is reported when shared demand exceeds the teacher slot domain', () => {
  const { days, slots } = week(1, 2);
  const loads = [
    teachingLoad(1, { class_id: 1, employee_id: 1, weekly_periods: 2 }),
    teachingLoad(2, { class_id: 2, employee_id: 1, weekly_periods: 1 }),
  ];
  const result = solveTimetable(solverInput({ days, slots, loads, placements: [placement(1), placement(2)] }));
  assert.equal(result.status, 'impossible');
  assert.ok(result.unscheduled.some((item) => item.reason_codes.includes('teacher_collision')));
});

test('difficult default-limit input is deterministic across repeated runs', () => {
  const { days, slots } = week(3, 4);
  const constraints = [{ school_id: 1, academic_year_id: 1, employee_id: 1, max_periods_per_day: 2, max_consecutive_periods: 1, max_working_days: 3, prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0, id: 1 }];
  const loads = [
    teachingLoad(1, { class_id: 1, employee_id: 1, weekly_periods: 7 }),
    ...Array.from({ length: 5 }, (_, index) => teachingLoad(index + 2, { class_id: index + 2, employee_id: index + 2, weekly_periods: 3 })),
  ];
  const input = solverInput({ days, slots, loads, placements: loads.map((load) => placement(load.class_id)), constraints });
  delete input.limits;
  const normalize = (result) => ({
    status: result.status,
    quality: result.quality_score,
    entries: result.entries,
    unscheduled: result.unscheduled,
    attempts: result.statistics.attempts,
    backtracks: result.statistics.backtracks,
    stopped: result.statistics.stopped_by_limit,
  });
  const expected = normalize(solveTimetable(input));
  for (let iteration = 0; iteration < 7; iteration += 1) {
    assert.deepEqual(normalize(solveTimetable(input)), expected);
  }
});

test('wall clock is an emergency abort and never returns an ordinary speed-dependent proposal', () => {
  const { days, slots } = week(2, 3);
  const input = solverInput({
    days,
    slots,
    loads: [teachingLoad(1, { weekly_periods: 4 })],
    placements: [placement(1)],
    limits: { time_budget_ms: 1, max_attempts: 10_000, max_backtracks: 1_000, max_local_improvement_attempts: 100 },
  });
  const originalNow = Date.now;
  let clock = 0;
  Date.now = () => ++clock;
  try {
    assert.throws(() => solveTimetable(input), TimetableSolverSafetyLimitError);
  } finally {
    Date.now = originalNow;
  }
});

function denseParallelSchoolInput() {
  const {days, slots} = week(5, 7);
  const input = solverInput({days, slots: slots.filter(slot => slot.day_of_week < 3 || slot.lesson_number <= 6), loads: [], placements: []});
  const weekly = [6, 4, 4, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1];
  for (let section = 1; section <= 10; section += 1) {
    const classId = Math.ceil(section / 2);
    input.placements.push(placement(classId, section));
    for (let subject = 0; subject < weekly.length; subject += 1) {
      const id = input.loads.length + 1;
      input.loads.push(teachingLoad(id, {class_id: classId, section_id: section, subject_id: classId * 100 + subject,
        employee_id: 1 + (subject + section) % 23, weekly_periods: weekly[subject],
        parallel_with_load_id: subject === 12 ? id - 1 : null}));
    }
  }
  delete input.limits;
  return input;
}

test('dense 130-load school completes all 330 section periods with atomic parallel repair and a frozen clock', () => {
  const input = denseParallelSchoolInput();
  const before = structuredClone(input);
  const originalNow = Date.now;
  Date.now = () => 100;
  let result;
  const started = performance.now();
  try { result = solveTimetable(input); } finally { Date.now = originalNow; }
  assert.equal(result.status, 'complete');
  assert.equal(result.required_periods, 330);
  assert.equal(result.scheduled_periods, 330);
  assert.equal(result.entries.length, 340);
  for (let section = 0; section < 10; section += 1) assertCompletePairs(result, section * 13 + 12, section * 13 + 13);
  assert.ok(result.statistics.attempts <= result.statistics.attempt_budget);
  assert.equal(validateTimetableSolverProposal(input, internalEntries(result)).length, 0);
  assert.deepEqual(input, before);
  assert.ok(performance.now() - started < 2_500);
});

test('dense repair respects fixed pairs and ends at the deterministic budget even when the clock is frozen', () => {
  const input = denseParallelSchoolInput();
  input.fixedEntries = [{slot_id: 1, teaching_load_id: 12, is_locked: 1}, {slot_id: 1, teaching_load_id: 13, is_locked: 1}];
  input.limits = {time_budget_ms: 2000, max_attempts: 12_000, max_backtracks: 100, max_local_improvement_attempts: 10};
  const originalNow = Date.now;
  Date.now = () => 100;
  let result;
  try { result = solveTimetable(input); } finally { Date.now = originalNow; }
  assert.ok(result.statistics.attempts <= input.limits.max_attempts);
  for (const fixed of input.fixedEntries) assert.ok(result.entries.some(entry => entry.slot_id === fixed.slot_id
    && entry.teaching_load_id === fixed.teaching_load_id && entry.is_locked === 1));
  for (let section = 0; section < 10; section += 1) assertCompletePairs(result, section * 13 + 12, section * 13 + 13);
  assert.equal(validateTimetableSolverProposal(input, internalEntries(result)).length, 0);
});

test('unscheduled known archived placements are dormant but restored, scheduled or fixed references remain explicit', () => {
  const input = solverInput({...week(1, 2), loads: [teachingLoad(1), teachingLoad(2, {section_id: 2, section_status: 'archived'})], placements: [placement(1)]});
  const before = structuredClone(input);
  const dormant = solveTimetable(input);
  assert.equal(dormant.status, 'complete');
  assert.equal(dormant.required_periods, 2);
  assert.equal(dormant.readiness.invalid_load_count, 0);
  assert.deepEqual(input, before);
  input.loads[1].section_status = 'active';
  assert.equal(solveTimetable(input).required_periods, 4);
  input.loads[1].section_status = 'archived';
  input.currentEntries = [{id: 1, slot_id: 1, teaching_load_id: 2}];
  const occupied = solveTimetable(input);
  assert.equal(occupied.readiness.invalid_load_count, 1);
  assert.equal(occupied.statistics.existing_invalid_entry_count, 1);
  input.currentEntries = [];
  input.fixedEntries = [{slot_id: 1, teaching_load_id: 2, is_locked: 1}];
  assert.equal(solveTimetable(input).status, 'fixed_conflict');
});

test('authoritative final validation remains clean for a highly constrained generated proposal', () => {
  const { days, slots } = week(4, 5);
  const constraints = Array.from({ length: 4 }, (_, index) => ({
    school_id: 1, academic_year_id: 1, employee_id: index + 1,
    max_periods_per_day: 2, max_consecutive_periods: 1, max_working_days: 3,
    prefer_compact_schedule: 0, avoid_first_period: index % 2, avoid_last_period: (index + 1) % 2, id: index + 1,
  }));
  const availability = [];
  for (let employeeId = 1; employeeId <= 4; employeeId += 1) {
    for (const slot of slots) {
      if ((slot.id + employeeId) % 6 === 0) availability.push({ id: availability.length + 1, school_id: 1, academic_year_id: 1, employee_id: employeeId, slot_id: slot.id, status: 'unavailable', created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0 });
    }
  }
  const loads = Array.from({ length: 8 }, (_, index) => teachingLoad(index + 1, { class_id: (index % 4) + 1, employee_id: (index % 4) + 1, weekly_periods: 2 }));
  const input = solverInput({ days, slots, loads, placements: Array.from({ length: 4 }, (_, index) => placement(index + 1)), constraints, availability });
  const result = solveTimetable(input);
  assert.equal(validateTimetableSolverProposal(input, internalEntries(result)).length, 0);
  assert.equal(result.entries.some((entry) => availability.some((item) => item.employee_id === entry.employee_id && item.slot_id === entry.slot_id)), false);
});

function constrainedBenchmarkInput(placementCount, teacherCount, loadCount, options = {}) {
  const { days, slots } = week(5, 7, { breaks: true });
  const placements = Array.from({ length: placementCount }, (_, index) => placement(index + 1));
  const loads = Array.from({ length: loadCount }, (_, index) => teachingLoad(index + 1, {
    class_id: (index % placementCount) + 1,
    employee_id: (index % teacherCount) + 1,
    subject_id: index + 1,
    weekly_periods: options.weeklyPeriods ?? 2,
  }));
  const constraints = Array.from({ length: teacherCount }, (_, index) => ({
    school_id: 1, academic_year_id: 1, employee_id: index + 1,
    max_periods_per_day: 3, max_consecutive_periods: 2, max_working_days: 4,
    prefer_compact_schedule: 1, avoid_first_period: index % 3 === 0 ? 1 : 0,
    avoid_last_period: index % 4 === 0 ? 1 : 0, id: index + 1,
  }));
  const availability = [];
  for (let employeeId = 1; employeeId <= teacherCount; employeeId += 1) {
    for (const slot of slots.filter((item) => item.slot_type === 'lesson')) {
      if ((slot.id * 3 + employeeId) % 17 === 0) availability.push({ id: availability.length + 1, school_id: 1, academic_year_id: 1, employee_id: employeeId, slot_id: slot.id, status: 'unavailable', created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0 });
      else if ((slot.id + employeeId) % 19 === 0) availability.push({ id: availability.length + 1, school_id: 1, academic_year_id: 1, employee_id: employeeId, slot_id: slot.id, status: 'preferred', created_by_user_id: null, updated_by_user_id: null, created_at: 0, updated_at: 0 });
    }
  }
  const input = solverInput({ days, slots, loads, placements, constraints, availability });
  delete input.limits;
  return input;
}

for (const benchmark of [
  { name: 'constrained-medium', placements: 12, teachers: 20, loads: 32 },
  { name: 'constrained-large', placements: 24, teachers: 40, loads: 80 },
]) {
  test(`solver ${benchmark.name} full-pipeline benchmark remains bounded and valid`, () => {
    const input = constrainedBenchmarkInput(benchmark.placements, benchmark.teachers, benchmark.loads);
    const startedAt = performance.now();
    const result = solveTimetable(input);
    const runtime = Math.round(performance.now() - startedAt);
    console.log(`SOLVER_BENCHMARK ${benchmark.name} runtime_ms=${runtime} attempts=${result.statistics.attempts} backtracks=${result.statistics.backtracks} scheduled_pct=${Math.round(result.scheduled_periods / result.required_periods * 100)} quality=${result.quality_score}`);
    assert.ok(runtime < 2_500);
    assert.equal(result.scheduled_periods, result.required_periods);
    assert.equal(validateTimetableSolverProposal(input, internalEntries(result)).length, 0);
  });
}

test('impossible constrained stress maximizes independent coverage within deterministic limits', () => {
  const input = constrainedBenchmarkInput(18, 28, 56);
  Object.assign(input.loads[0], {
    class_id: 99,
    class_name: 'Isolated constrained class',
    subject_class_id: 99,
    employee_id: 99,
    employee_name: 'Isolated constrained teacher',
    weekly_periods: 30,
  });
  input.placements.push(placement(99));
  input.teacherConstraints.push({
    school_id: 1, academic_year_id: 1, employee_id: 99,
    max_periods_per_day: 1, max_consecutive_periods: 1, max_working_days: 5,
    prefer_compact_schedule: 0, avoid_first_period: 0, avoid_last_period: 0, id: 99,
  });
  const startedAt = performance.now();
  const result = solveTimetable(input);
  const runtime = Math.round(performance.now() - startedAt);
  const independentRequired = input.loads.slice(1).reduce((sum, load) => sum + load.weekly_periods, 0);
  const independentScheduled = result.entries.filter((entry) => entry.teaching_load_id !== input.loads[0].id).length;
  console.log(`SOLVER_BENCHMARK constrained-impossible runtime_ms=${runtime} attempts=${result.statistics.attempts} backtracks=${result.statistics.backtracks} scheduled=${result.scheduled_periods}/${result.required_periods} quality=${result.quality_score}`);
  assert.equal(result.status, 'impossible');
  assert.equal(independentScheduled, independentRequired);
  assert.equal(result.scheduled_periods, independentRequired + 5);
  assert.ok(runtime < 2_500);
  assert.equal(validateTimetableSolverProposal(input, internalEntries(result)).length, 0);
});
