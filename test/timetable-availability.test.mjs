import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildTeacherAvailabilityMatrix,
  buildTimetableReadiness,
  calculateTeacherAvailabilitySummary,
  validateTeacherAvailabilityDayInput,
  validateTeacherAvailabilityOverrideInput,
  validateTeacherConstraintsInput,
} from '../src/lib/timetable.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const migration = (name) => readFileSync(join(rootDir, 'migrations', name), 'utf8');

function createFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  for (const name of [
    '0001_initial_schema.sql',
    '0002_phase2_academic_tables.sql',
    '0010_employees.sql',
  ]) database.exec(migration(name));
  database.exec(`
    INSERT INTO schools (id, name, school_type, city, status) VALUES
      (1, 'School A', 'خاص', 'Duhok', 'active'),
      (2, 'School B', 'خاص', 'Duhok', 'active');
    INSERT INTO academic_years (id, school_id, name, starts_at, ends_at, is_active) VALUES
      (1, 1, '2026-2027', '2026-09-01', '2027-06-30', 1),
      (2, 1, '2027-2028', '2027-09-01', '2028-06-30', 0),
      (3, 2, '2026-2027', '2026-09-01', '2027-06-30', 1);
    INSERT INTO employees (id, school_id, full_name, role, status) VALUES
      (1, 1, 'Teacher A', 'teacher', 'active'),
      (2, 1, 'Teacher B', 'teacher', 'active'),
      (3, 2, 'Teacher C', 'teacher', 'active'),
      (4, 1, 'Accountant', 'accountant', 'active'),
      (5, 1, 'Archived Teacher', 'teacher', 'archived');
  `);
  database.exec(migration('0023_timetable_foundation.sql'));
  database.exec(migration('0024_teacher_timetable_constraints.sql'));
  return database;
}

function addDay(database, { schoolId = 1, yearId = 1, day = 0, active = 1 } = {}) {
  return Number(database.prepare(`
    INSERT INTO timetable_days (school_id, academic_year_id, day_of_week, is_active, order_index)
    VALUES (?, ?, ?, ?, ?) RETURNING id
  `).get(schoolId, yearId, day, active, day).id);
}

function addSlot(database, {
  schoolId = 1,
  yearId = 1,
  day = 0,
  slotIndex = 1,
  type = 'lesson',
  active = 1,
} = {}) {
  const startMinutes = 8 * 60 + (slotIndex - 1) * 50;
  const endMinutes = startMinutes + 40;
  const format = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return Number(database.prepare(`
    INSERT INTO timetable_slots (
      school_id, academic_year_id, day_of_week, slot_index, slot_type,
      lesson_number, label, start_time, end_time, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
  `).get(
    schoolId,
    yearId,
    day,
    slotIndex,
    type,
    type === 'lesson' ? slotIndex : null,
    type === 'lesson' ? `Lesson ${slotIndex}` : 'Break',
    format(startMinutes),
    format(endMinutes),
    active,
  ).id);
}

function addOverride(database, { schoolId = 1, yearId = 1, employeeId = 1, slotId, status = 'unavailable' }) {
  return database.prepare(`
    INSERT INTO timetable_teacher_availability (school_id, academic_year_id, employee_id, slot_id, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(schoolId, yearId, employeeId, slotId, status);
}

function defaultConstraints(overrides = {}) {
  return {
    id: null,
    school_id: 1,
    academic_year_id: 1,
    employee_id: 1,
    max_periods_per_day: null,
    max_consecutive_periods: null,
    max_working_days: null,
    prefer_compact_schedule: 0,
    avoid_first_period: 0,
    avoid_last_period: 0,
    ...overrides,
  };
}

test('0024 applies to the genuine employee schema and creates canonical tables, indexes and triggers', () => {
  const database = createFixture();
  const employeeColumns = database.prepare('PRAGMA table_info(employees)').all().map((row) => row.name);
  assert.ok(employeeColumns.includes('role'));
  assert.equal(employeeColumns.includes('employee_type'), false);
  const slotColumns = database.prepare('PRAGMA table_info(timetable_slots)').all().map((row) => row.name);
  assert.ok(slotColumns.includes('is_active'));
  const tables = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => row.name));
  assert.ok(tables.has('timetable_teacher_availability'));
  assert.ok(tables.has('timetable_teacher_constraints'));
  const indexes = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'index'").all().map((row) => row.name));
  assert.ok(indexes.has('idx_timetable_teacher_availability_scope'));
  assert.ok(indexes.has('idx_timetable_teacher_constraints_scope'));
  const triggers = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger'").all().map((row) => row.name));
  for (const name of [
    'trg_timetable_teacher_availability_validate_insert',
    'trg_timetable_teacher_availability_validate_update',
    'trg_timetable_teacher_constraints_validate_insert',
    'trg_timetable_teacher_constraints_validate_update',
    'trg_timetable_teacher_availability_updated_at',
    'trg_timetable_teacher_constraints_updated_at',
  ]) assert.ok(triggers.has(name), name);
});

test('availability schema rejects duplicates, bad statuses, breaks, cross-year, cross-school and non-teachers', () => {
  const database = createFixture();
  addDay(database);
  addDay(database, { yearId: 2 });
  addDay(database, { schoolId: 2, yearId: 3 });
  const lesson = addSlot(database);
  const breakSlot = addSlot(database, { slotIndex: 2, type: 'break' });
  const futureSlot = addSlot(database, { yearId: 2 });
  const foreignSlot = addSlot(database, { schoolId: 2, yearId: 3 });
  addOverride(database, { slotId: lesson });
  assert.throws(() => addOverride(database, { slotId: lesson }), /UNIQUE constraint failed/);
  assert.throws(() => addOverride(database, { employeeId: 2, slotId: lesson, status: 'available' }), /CHECK constraint failed/);
  assert.throws(() => addOverride(database, { employeeId: 2, slotId: breakSlot }), /slot invalid/);
  assert.throws(() => addOverride(database, { employeeId: 2, slotId: futureSlot }), /slot invalid/);
  assert.throws(() => addOverride(database, { employeeId: 2, slotId: foreignSlot }), /slot invalid/);
  assert.throws(() => addOverride(database, { employeeId: 4, slotId: lesson }), /employee invalid/);
  assert.throws(() => addOverride(database, { employeeId: 5, slotId: lesson }), /employee invalid/);
});

test('default, hard and soft availability semantics exclude disabled days, slots and breaks', () => {
  const days = [
    { id: 1, school_id: 1, academic_year_id: 1, day_of_week: 0, is_active: 1, order_index: 0 },
    { id: 2, school_id: 1, academic_year_id: 1, day_of_week: 1, is_active: 0, order_index: 1 },
  ];
  const slots = [
    { id: 1, school_id: 1, academic_year_id: 1, day_of_week: 0, slot_type: 'lesson', is_active: 1 },
    { id: 2, school_id: 1, academic_year_id: 1, day_of_week: 0, slot_type: 'lesson', is_active: 1 },
    { id: 3, school_id: 1, academic_year_id: 1, day_of_week: 0, slot_type: 'lesson', is_active: 1 },
    { id: 4, school_id: 1, academic_year_id: 1, day_of_week: 0, slot_type: 'lesson', is_active: 0 },
    { id: 5, school_id: 1, academic_year_id: 1, day_of_week: 0, slot_type: 'break', is_active: 1 },
    { id: 6, school_id: 1, academic_year_id: 1, day_of_week: 1, slot_type: 'lesson', is_active: 1 },
  ];
  const overrides = [
    { employee_id: 1, slot_id: 1, status: 'unavailable' },
    { employee_id: 1, slot_id: 2, status: 'preferred' },
    { employee_id: 1, slot_id: 3, status: 'avoid' },
    { employee_id: 1, slot_id: 4, status: 'unavailable' },
    { employee_id: 1, slot_id: 6, status: 'unavailable' },
  ];
  const summary = calculateTeacherAvailabilitySummary({
    schoolId: 1,
    academicYearId: 1,
    employeeId: 1,
    employeeName: 'Teacher A',
    assignedWeeklyPeriods: 2,
    days,
    slots,
    overrides,
  });
  assert.equal(summary.total_active_lesson_slots, 3);
  assert.equal(summary.unavailable_active_lesson_slots, 1);
  assert.equal(summary.effective_available_slots, 2);
  assert.equal(summary.preferred_slots, 1);
  assert.equal(summary.avoid_slots, 1);
  assert.equal(summary.hard_weekly_capacity, 2);
  assert.equal(summary.feasible, true);
  const matrix = buildTeacherAvailabilityMatrix({
    schoolId: 1,
    academicYearId: 1,
    teacher: { id: 1, full_name: 'Teacher A', role: 'teacher', status: 'active' },
    days,
    slots,
    overrides,
    assignedWeeklyPeriods: 2,
  });
  assert.equal(matrix.days[0].slots.find((slot) => slot.id === 2).effectively_schedulable, true, 'preferred remains schedulable');
  assert.equal(matrix.days[0].slots.find((slot) => slot.id === 3).effectively_schedulable, true, 'avoid remains schedulable');
  assert.equal(matrix.days[0].slots.find((slot) => slot.id === 5).presentation_status, 'break');
});

test('daily and working-day hard limits use the highest-capacity days without blind multiplication', () => {
  const days = [0, 1, 2].map((day) => ({ id: day + 1, school_id: 1, academic_year_id: 1, day_of_week: day, is_active: 1, order_index: day }));
  const slots = [];
  let id = 1;
  for (const [day, count] of [[0, 5], [1, 4], [2, 3]]) {
    for (let index = 0; index < count; index += 1) slots.push({ id: id++, school_id: 1, academic_year_id: 1, day_of_week: day, slot_type: 'lesson', is_active: 1 });
  }
  const constraints = defaultConstraints({ max_periods_per_day: 3, max_consecutive_periods: 2, max_working_days: 2 });
  const infeasible = calculateTeacherAvailabilitySummary({
    schoolId: 1, academicYearId: 1, employeeId: 1, employeeName: 'Teacher A',
    assignedWeeklyPeriods: 7, days, slots, overrides: [], constraints,
  });
  assert.deepEqual(infeasible.daily_capacities.map((day) => day.hard_capacity), [3, 3, 3]);
  assert.equal(infeasible.hard_weekly_capacity, 6);
  assert.equal(infeasible.feasible, false);
  assert.equal(infeasible.blockers[0].code, 'teacher_load_exceeds_availability');
  const feasible = calculateTeacherAvailabilitySummary({
    schoolId: 1, academicYearId: 1, employeeId: 1, employeeName: 'Teacher A',
    assignedWeeklyPeriods: 6, days, slots, overrides: [], constraints,
  });
  assert.equal(feasible.feasible, true);
});

test('constraint schema stores nullable limits and rejects non-positive or excessive values', () => {
  const database = createFixture();
  database.prepare(`
    INSERT INTO timetable_teacher_constraints (
      school_id, academic_year_id, employee_id, max_periods_per_day,
      max_consecutive_periods, max_working_days
    ) VALUES (1, 1, 1, NULL, NULL, NULL)
  `).run();
  assert.throws(() => database.prepare(`
    INSERT INTO timetable_teacher_constraints (school_id, academic_year_id, employee_id, max_periods_per_day)
    VALUES (1, 1, 2, 0)
  `).run(), /CHECK constraint failed/);
  assert.throws(() => database.prepare(`
    UPDATE timetable_teacher_constraints SET max_consecutive_periods = -1 WHERE employee_id = 1
  `).run(), /CHECK constraint failed/);
  assert.throws(() => database.prepare(`
    UPDATE timetable_teacher_constraints SET max_working_days = 8 WHERE employee_id = 1
  `).run(), /CHECK constraint failed/);
  assert.throws(() => database.prepare(`
    INSERT INTO timetable_teacher_constraints (school_id, academic_year_id, employee_id)
    VALUES (1, 1, 1)
  `).run(), /UNIQUE constraint failed/);
});

test('history survives teacher/day/slot deactivation while permanent slot deletion cascades its override', () => {
  const database = createFixture();
  addDay(database);
  const slotId = addSlot(database);
  addOverride(database, { slotId, status: 'preferred' });
  database.prepare('UPDATE employees SET status = ? WHERE id = 1').run('archived');
  database.prepare('UPDATE timetable_days SET is_active = 0 WHERE school_id = 1 AND academic_year_id = 1').run();
  database.prepare('UPDATE timetable_slots SET is_active = 0 WHERE id = ?').run(slotId);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM timetable_teacher_availability').get().count, 1);
  database.prepare('UPDATE employees SET status = ? WHERE id = 1').run('active');
  database.prepare('UPDATE timetable_days SET is_active = 1 WHERE school_id = 1 AND academic_year_id = 1').run();
  database.prepare('UPDATE timetable_slots SET is_active = 1 WHERE id = ?').run(slotId);
  assert.equal(database.prepare('SELECT status FROM timetable_teacher_availability').get().status, 'preferred');
  database.prepare('DELETE FROM timetable_slots WHERE id = ?').run(slotId);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM timetable_teacher_availability').get().count, 0);
});

test('readiness preserves academic demand and blocks only hard availability shortages', () => {
  const days = [{ id: 1, school_id: 1, academic_year_id: 1, day_of_week: 0, is_active: 1, order_index: 0 }];
  const slots = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, school_id: 1, academic_year_id: 1, day_of_week: 0, slot_type: 'lesson', is_active: 1 }));
  const load = {
    id: 1, school_id: 1, academic_year_id: 1, class_id: 1, class_status: 'active', class_school_id: 1,
    section_id: null, active_section_count: 0, subject_id: 1, subject_status: 'active', subject_school_id: 1,
    subject_class_id: 1, subject_section_id: null, employee_id: 1, employee_name: 'Teacher A',
    employee_status: 'active', employee_school_id: 1, employee_role: 'teacher', weekly_periods: 4, status: 'active',
  };
  const base = {
    days,
    slots,
    placements: [{ class_id: 1, class_name: 'Class A', section_id: null, section_name: null }],
    subjects: [{ id: 1, class_id: 1, section_id: null, name: 'Math', status: 'active' }],
    loads: [load],
  };
  const unavailable = buildTimetableReadiness({
    ...base,
    teacherAvailability: slots.map((slot, index) => ({ id: index + 1, school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: slot.id, status: 'unavailable' })),
  });
  assert.equal(unavailable.total_required_periods, 4);
  assert.equal(unavailable.placements[0].required_periods, 4);
  assert.equal(unavailable.teacher_feasibility_issues[0].code, 'teacher_no_available_slots');
  assert.equal(unavailable.ready, false);
  const soft = buildTimetableReadiness({
    ...base,
    teacherAvailability: [
      { id: 1, school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: 1, status: 'preferred' },
      { id: 2, school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: 2, status: 'avoid' },
    ],
  });
  assert.equal(soft.teacher_feasibility_issues.length, 0);
  assert.equal(soft.ready, true);
});

test('availability and constraint input validation fail closed', () => {
  assert.equal(validateTeacherAvailabilityOverrideInput({ academic_year_id: 1, employee_id: 1, slot_id: 1, status: 'available' }).ok, false);
  assert.equal(validateTeacherAvailabilityDayInput({ academic_year_id: 1, employee_id: 1, day_of_week: 7, status: null }).ok, false);
  assert.equal(validateTeacherConstraintsInput({ academic_year_id: 1, employee_id: 1, max_periods_per_day: 0 }).ok, false);
  assert.equal(validateTeacherConstraintsInput({ academic_year_id: 1, employee_id: 1, max_working_days: 8 }).ok, false);
  assert.equal(validateTeacherConstraintsInput({ academic_year_id: 1, employee_id: 1, max_working_days: null }).ok, true);
});
