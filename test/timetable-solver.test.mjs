import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { solveTimetable, validateTimetableSolverProposal } from '../src/lib/timetableSolver.ts';

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
    status: overrides.status ?? 'active',
    created_at: 0,
    updated_at: 0,
  };
}

function solverInput({ days, slots, loads, placements, availability = [], constraints = [], limits, currentEntries = [] }) {
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
    limits: limits || { time_budget_ms: 4_000, max_attempts: 200_000, max_backtracks: 10_000, max_local_improvement_attempts: 500 },
  };
}

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
  assert.ok(result.unscheduled[0].reason_codes.length > 0);
  assert.ok(result.quality_score < 100);
  assert.ok(result.statistics.attempts <= 10);
});

test('subject demand is distributed across the week when alternatives exist', () => {
  const { days, slots } = week(4, 3);
  const result = solveTimetable(solverInput({ days, slots, loads: [teachingLoad(1, { weekly_periods: 4 })], placements: [placement(1)] }));
  assert.equal(new Set(result.entries.map((entry) => entry.day_of_week)).size, 4);
  assert.equal(result.scoring.penalties.subject_clustering, 0);
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

test('current timetable entries are measured but never mutated or used as proposal placements', () => {
  const { days, slots } = week(2, 2);
  const loads = [teachingLoad(1, { weekly_periods: 2 })];
  const currentEntries = [{ id: 99, school_id: 1, academic_year_id: 1, slot_id: slots[0].id, teaching_load_id: 1, created_by_user_id: 1, updated_by_user_id: 1, created_at: 1, updated_at: 1 }];
  const snapshot = structuredClone(currentEntries);
  const result = solveTimetable(solverInput({ days, slots, loads, placements: [placement(1)], currentEntries }));
  assert.deepEqual(currentEntries, snapshot);
  assert.equal(result.statistics.current_valid_entry_count, 1);
  assert.equal(result.entries.some((entry) => entry.proposal_id === '99'), false);
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
