import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildTimetableReadiness,
  evaluateTimetableEntryPlacement,
  validateTimetableEntryInput,
  validateTimetableGridScopeInput,
} from '../src/lib/timetable.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const migration = (name) => readFileSync(join(rootDir, 'migrations', name), 'utf8');

function insertId(database, sql, ...values) {
  return Number(database.prepare(`${sql} RETURNING id`).get(...values).id);
}

function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  for (const name of [
    '0001_initial_schema.sql',
    '0002_phase2_academic_tables.sql',
    '0010_employees.sql',
    '0023_timetable_foundation.sql',
    '0024_teacher_timetable_constraints.sql',
    '0025_timetable_entries.sql',
  ]) database.exec(migration(name));
  database.exec(`
    INSERT INTO schools (id, name, school_type, city, status) VALUES
      (1, 'School A', 'خاص', 'Duhok', 'active'),
      (2, 'School B', 'خاص', 'Duhok', 'active');
    INSERT INTO academic_years (id, school_id, name, starts_at, ends_at, is_active) VALUES
      (1, 1, '2026-2027', '2026-09-01', '2027-06-30', 1),
      (2, 1, '2027-2028', '2027-09-01', '2028-06-30', 0),
      (3, 2, '2026-2027', '2026-09-01', '2027-06-30', 1);
    INSERT INTO classes (id, school_id, name, stage, order_index, status) VALUES
      (1, 1, 'Class A', 'ابتدائي', 1, 'active'),
      (2, 1, 'Class Wide', 'ابتدائي', 2, 'active'),
      (3, 1, 'Class C', 'ابتدائي', 3, 'active'),
      (4, 2, 'Class B', 'ابتدائي', 1, 'active');
    INSERT INTO sections (id, school_id, class_id, name, status) VALUES
      (1, 1, 1, 'A', 'active'),
      (2, 1, 1, 'B', 'active'),
      (3, 1, 3, 'C', 'active'),
      (4, 2, 4, 'B', 'active');
    INSERT INTO subjects (id, school_id, class_id, section_id, name, order_index, status) VALUES
      (1, 1, 1, NULL, 'Math', 1, 'active'),
      (2, 1, 1, NULL, 'Arabic', 2, 'active'),
      (3, 1, 2, NULL, 'Science', 1, 'active'),
      (4, 1, 3, NULL, 'History', 1, 'active'),
      (5, 2, 4, NULL, 'Math B', 1, 'active');
    INSERT INTO employees (id, school_id, full_name, role, status) VALUES
      (1, 1, 'Teacher One', 'teacher', 'active'),
      (2, 1, 'Teacher Two', 'teacher', 'active'),
      (3, 2, 'Teacher B', 'teacher', 'active');
  `);
  return database;
}

function day(database, { school = 1, year = 1, dow = 0, active = 1 } = {}) {
  return insertId(database, `INSERT INTO timetable_days
    (school_id, academic_year_id, day_of_week, is_active, order_index)
    VALUES (?, ?, ?, ?, ?)`, school, year, dow, active, dow);
}

function slot(database, {
  school = 1, year = 1, dow = 0, index = 1, type = 'lesson', active = 1,
  start = '08:00', end = '08:40',
} = {}) {
  return insertId(database, `INSERT INTO timetable_slots
    (school_id, academic_year_id, day_of_week, slot_index, slot_type,
     lesson_number, label, start_time, end_time, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  school, year, dow, index, type, type === 'lesson' ? index : null,
  type === 'lesson' ? `Lesson ${index}` : 'Break', start, end, active);
}

function load(database, {
  school = 1, year = 1, classId = 1, sectionId = 1, subjectId = 1,
  employeeId = 1, weekly = 4, status = 'active',
} = {}) {
  return insertId(database, `INSERT INTO timetable_teaching_loads
    (school_id, academic_year_id, class_id, section_id, subject_id, employee_id, weekly_periods, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  school, year, classId, sectionId, subjectId, employeeId, weekly, status);
}

function entry(database, { school = 1, year = 1, slotId, loadId, updatedAt } = {}) {
  return insertId(database, `INSERT INTO timetable_entries
    (school_id, academic_year_id, slot_id, teaching_load_id, updated_at)
    VALUES (?, ?, ?, ?, COALESCE(?, unixepoch()))`, school, year, slotId, loadId, updatedAt ?? null);
}

function simpleWeek(database) {
  day(database);
  day(database, { dow: 1 });
  const slots = [
    slot(database, { index: 1, start: '08:00', end: '08:40' }),
    slot(database, { index: 2, start: '08:40', end: '09:20' }),
    slot(database, { index: 3, type: 'break', start: '09:20', end: '09:35' }),
    slot(database, { index: 4, start: '09:35', end: '10:15' }),
    slot(database, { dow: 1, index: 1, start: '08:00', end: '08:40' }),
    slot(database, { dow: 1, index: 2, start: '08:40', end: '09:20' }),
  ];
  return slots;
}

test('0025 creates the empty scoped entries table, indexes, foreign keys and triggers', () => {
  const database = fixture();
  const columns = database.prepare('PRAGMA table_info(timetable_entries)').all().map((row) => row.name);
  for (const name of ['id', 'school_id', 'academic_year_id', 'slot_id', 'teaching_load_id', 'created_by_user_id', 'updated_by_user_id', 'created_at', 'updated_at']) assert.ok(columns.includes(name), name);
  const indexes = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type='index'").all().map((row) => row.name));
  for (const name of ['idx_timetable_entries_scope_slot', 'idx_timetable_entries_scope_load']) assert.ok(indexes.has(name), name);
  const triggers = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type='trigger'").all().map((row) => row.name));
  for (const name of ['trg_timetable_entries_validate_insert', 'trg_timetable_entries_validate_update', 'trg_timetable_entries_updated_at', 'trg_timetable_slots_preserve_entries', 'trg_timetable_loads_preserve_entries']) assert.ok(triggers.has(name), name);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 0);
});

test('same section cannot receive two entries in the same slot', () => {
  const database = fixture();
  const [slotId] = simpleWeek(database);
  entry(database, { slotId, loadId: load(database) });
  assert.throws(() => entry(database, { slotId, loadId: load(database, { subjectId: 2, employeeId: 2 }) }), /group collision/);
});

test('different sections may use the same slot with different teachers', () => {
  const database = fixture();
  const [slotId] = simpleWeek(database);
  entry(database, { slotId, loadId: load(database) });
  assert.ok(entry(database, { slotId, loadId: load(database, { sectionId: 2, subjectId: 2, employeeId: 2 }) }) > 0);
});

test('class-wide load conflicts with section-specific load in the same slot', () => {
  const database = fixture();
  const [slotId] = simpleWeek(database);
  const classWideLoad = load(database, { classId: 2, sectionId: null, subjectId: 3 });
  database.exec("INSERT INTO sections (id, school_id, class_id, name, status) VALUES (5, 1, 2, 'Later', 'active')");
  database.exec("INSERT INTO subjects (id, school_id, class_id, section_id, name, status) VALUES (6, 1, 2, 5, 'Section Science', 'active')");
  const sectionLoad = load(database, { classId: 2, sectionId: 5, subjectId: 6, employeeId: 2 });
  entry(database, { slotId, loadId: classWideLoad });
  assert.throws(() => entry(database, { slotId, loadId: sectionLoad }), /group collision/);
});

test('teacher collision is enforced across unrelated classes', () => {
  const database = fixture();
  const [slotId] = simpleWeek(database);
  entry(database, { slotId, loadId: load(database) });
  assert.throws(() => entry(database, { slotId, loadId: load(database, { classId: 3, sectionId: 3, subjectId: 4 }) }), /teacher collision/);
});

test('weekly-period capacity rejects the next placement', () => {
  const database = fixture();
  const slots = simpleWeek(database);
  const loadId = load(database, { weekly: 1 });
  entry(database, { slotId: slots[0], loadId });
  assert.throws(() => entry(database, { slotId: slots[1], loadId }), /weekly periods exceeded/);
});

test('break, disabled slot and inactive day reject new placements', () => {
  const database = fixture();
  const slots = simpleWeek(database);
  const loadId = load(database);
  assert.throws(() => entry(database, { slotId: slots[2], loadId }), /slot not schedulable/);
  database.prepare('UPDATE timetable_slots SET is_active = 0 WHERE id = ?').run(slots[1]);
  assert.throws(() => entry(database, { slotId: slots[1], loadId }), /slot inactive/);
  database.prepare('UPDATE timetable_days SET is_active = 0 WHERE day_of_week = 1').run();
  assert.throws(() => entry(database, { slotId: slots[4], loadId }), /day inactive/);
});

test('placements preserved on disabled slots do not consume active demand or teacher capacity', () => {
  const database = fixture();
  const slots = simpleWeek(database);
  const loadId = load(database, { weekly: 1 });
  database.exec(`INSERT INTO timetable_teacher_constraints
    (school_id, academic_year_id, employee_id, max_periods_per_day)
    VALUES (1, 1, 1, 1)`);
  entry(database, { slotId: slots[0], loadId });
  database.prepare('UPDATE timetable_slots SET is_active = 0 WHERE id = ?').run(slots[0]);
  assert.ok(entry(database, { slotId: slots[1], loadId }) > 0);
});

test('explicit unavailable teacher override is a hard database conflict', () => {
  const database = fixture();
  const [slotId] = simpleWeek(database);
  const loadId = load(database);
  database.prepare(`INSERT INTO timetable_teacher_availability
    (school_id, academic_year_id, employee_id, slot_id, status)
    VALUES (1, 1, 1, ?, 'unavailable')`).run(slotId);
  assert.throws(() => entry(database, { slotId, loadId }), /teacher unavailable/);
});

test('maximum daily periods is enforced atomically', () => {
  const database = fixture();
  const slots = simpleWeek(database);
  const loadId = load(database);
  database.exec(`INSERT INTO timetable_teacher_constraints
    (school_id, academic_year_id, employee_id, max_periods_per_day)
    VALUES (1, 1, 1, 1)`);
  entry(database, { slotId: slots[0], loadId });
  assert.throws(() => entry(database, { slotId: slots[1], loadId }), /max periods per day/);
});

test('maximum working days is enforced only when adding a new day', () => {
  const database = fixture();
  const slots = simpleWeek(database);
  const loadId = load(database);
  database.exec(`INSERT INTO timetable_teacher_constraints
    (school_id, academic_year_id, employee_id, max_working_days)
    VALUES (1, 1, 1, 1)`);
  entry(database, { slotId: slots[0], loadId });
  entry(database, { slotId: slots[1], loadId });
  assert.throws(() => entry(database, { slotId: slots[4], loadId }), /max working days/);
});

test('maximum consecutive periods rejects an uninterrupted overrun', () => {
  const database = fixture();
  const slots = simpleWeek(database);
  const loadId = load(database);
  database.exec(`INSERT INTO timetable_teacher_constraints
    (school_id, academic_year_id, employee_id, max_consecutive_periods)
    VALUES (1, 1, 1, 1)`);
  entry(database, { slotId: slots[0], loadId });
  assert.throws(() => entry(database, { slotId: slots[1], loadId }), /max consecutive periods/);
});

test('an actual break interrupts consecutive periods', () => {
  const database = fixture();
  const slots = simpleWeek(database);
  const loadId = load(database);
  database.exec(`INSERT INTO timetable_teacher_constraints
    (school_id, academic_year_id, employee_id, max_consecutive_periods)
    VALUES (1, 1, 1, 1)`);
  entry(database, { slotId: slots[1], loadId });
  assert.ok(entry(database, { slotId: slots[3], loadId }) > 0);
});

test('moving an entry excludes itself from weekly-period counting', () => {
  const database = fixture();
  const slots = simpleWeek(database);
  const loadId = load(database, { weekly: 1 });
  const entryId = entry(database, { slotId: slots[0], loadId });
  database.prepare('UPDATE timetable_entries SET slot_id = ? WHERE id = ?').run(slots[1], entryId);
  assert.equal(database.prepare('SELECT slot_id FROM timetable_entries WHERE id = ?').get(entryId).slot_id, slots[1]);
});

test('moving into a group collision is rejected without partial mutation', () => {
  const database = fixture();
  const slots = simpleWeek(database);
  const first = entry(database, { slotId: slots[0], loadId: load(database) });
  const second = entry(database, { slotId: slots[1], loadId: load(database, { subjectId: 2, employeeId: 2 }) });
  assert.throws(() => database.prepare('UPDATE timetable_entries SET slot_id = ? WHERE id = ?').run(slots[0], second), /group collision/);
  assert.equal(database.prepare('SELECT slot_id FROM timetable_entries WHERE id = ?').get(second).slot_id, slots[1]);
  assert.equal(database.prepare('SELECT slot_id FROM timetable_entries WHERE id = ?').get(first).slot_id, slots[0]);
});

test('moving into a teacher collision across groups is rejected', () => {
  const database = fixture();
  const slots = simpleWeek(database);
  entry(database, { slotId: slots[0], loadId: load(database) });
  const second = entry(database, { slotId: slots[1], loadId: load(database, { classId: 3, sectionId: 3, subjectId: 4 }) });
  assert.throws(() => database.prepare('UPDATE timetable_entries SET slot_id = ? WHERE id = ?').run(slots[0], second), /teacher collision/);
});

test('cross-school and cross-year slot/load combinations fail closed', () => {
  const database = fixture();
  const [slotId] = simpleWeek(database);
  day(database, { school: 2, year: 3 });
  const otherSlot = slot(database, { school: 2, year: 3 });
  const ownLoad = load(database);
  const otherLoad = load(database, { school: 2, year: 3, classId: 4, sectionId: 4, subjectId: 5, employeeId: 3 });
  assert.throws(() => entry(database, { slotId: otherSlot, loadId: ownLoad }), /tenant scope mismatch/);
  assert.throws(() => entry(database, { slotId, loadId: otherLoad }), /tenant scope mismatch/);
  assert.throws(() => entry(database, { school: 1, year: 2, slotId, loadId: ownLoad }), /academic year mismatch/);
});

test('inactive loads reject new placements but missing-teacher loads are schedulable', () => {
  const database = fixture();
  const slots = simpleWeek(database);
  assert.throws(() => entry(database, { slotId: slots[0], loadId: load(database, { status: 'inactive' }) }), /teaching load not schedulable/);
  assert.ok(entry(database, { slotId: slots[1], loadId: load(database, { employeeId: null }) }) > 0);
});

test('archiving a teacher preserves the load and rejects new placements', () => {
  const database = fixture();
  const [slotId] = simpleWeek(database);
  const loadId = load(database);
  database.exec("UPDATE employees SET status = 'archived' WHERE id = 1");
  assert.throws(() => entry(database, { slotId, loadId }), /teaching load not schedulable/);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM timetable_teaching_loads WHERE id = ?').get(loadId).count, 1);
});

test('slot and load structural re-scope is blocked while entries exist', () => {
  const database = fixture();
  const [slotId] = simpleWeek(database);
  const loadId = load(database);
  entry(database, { slotId, loadId });
  assert.throws(() => database.prepare("UPDATE timetable_slots SET slot_type='break', lesson_number=NULL WHERE id=?").run(slotId), /scheduled entries/);
  assert.throws(() => database.prepare('UPDATE timetable_slots SET day_of_week = 1 WHERE id = ?').run(slotId), /scheduled entries/);
  assert.throws(() => database.prepare('UPDATE timetable_teaching_loads SET class_id = 3, section_id = 3, subject_id = 4 WHERE id = ?').run(loadId), /scheduled entries/);
  assert.throws(() => database.prepare('UPDATE timetable_teaching_loads SET employee_id = 2 WHERE id = ?').run(loadId), /scheduled entries/);
});

test('weekly requirement cannot shrink below scheduled count', () => {
  const database = fixture();
  const slots = simpleWeek(database);
  const loadId = load(database, { weekly: 3 });
  entry(database, { slotId: slots[0], loadId });
  entry(database, { slotId: slots[1], loadId });
  assert.throws(() => database.prepare('UPDATE timetable_teaching_loads SET weekly_periods = 1 WHERE id = ?').run(loadId), /below scheduled entries/);
});

test('deleting only the placement preserves every canonical parent record', () => {
  const database = fixture();
  const [slotId] = simpleWeek(database);
  const loadId = load(database);
  const entryId = entry(database, { slotId, loadId });
  database.prepare('DELETE FROM timetable_entries WHERE id = ?').run(entryId);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM timetable_slots WHERE id = ?').get(slotId).count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM timetable_teaching_loads WHERE id = ?').get(loadId).count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM subjects WHERE id = 1').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM employees WHERE id = 1').get().count, 1);
});

test('entry update refreshes updated_at deterministically', () => {
  const database = fixture();
  const slots = simpleWeek(database);
  const loadId = load(database);
  const entryId = entry(database, { slotId: slots[0], loadId, updatedAt: 1 });
  database.prepare('UPDATE timetable_entries SET slot_id = ? WHERE id = ?').run(slots[1], entryId);
  assert.ok(database.prepare('SELECT updated_at FROM timetable_entries WHERE id = ?').get(entryId).updated_at > 1);
});

function pureContext(overrides = {}) {
  const days = [{ id: 1, school_id: 1, academic_year_id: 1, day_of_week: 0, is_active: 1, order_index: 0, created_at: 1, updated_at: 1 }];
  const slots = [
    { id: 1, school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: 1, slot_type: 'lesson', lesson_number: 1, label: 'First', start_time: '08:00', end_time: '08:40', is_active: 1, created_at: 1, updated_at: 1 },
    { id: 2, school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: 2, slot_type: 'lesson', lesson_number: 2, label: 'Second', start_time: '08:40', end_time: '09:20', is_active: 1, created_at: 1, updated_at: 1 },
    { id: 3, school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: 3, slot_type: 'lesson', lesson_number: 3, label: 'Last', start_time: '09:20', end_time: '10:00', is_active: 1, created_at: 1, updated_at: 1 },
  ];
  const load = {
    id: 1, school_id: 1, academic_year_id: 1, class_id: 1, class_name: 'Class', class_status: 'active', class_school_id: 1,
    active_section_count: 1, section_id: 1, section_name: 'A', section_status: 'active', section_school_id: 1, section_class_id: 1,
    subject_id: 1, subject_name: 'Math', subject_status: 'active', subject_school_id: 1, subject_class_id: 1, subject_section_id: null,
    employee_id: 1, employee_name: 'Teacher', employee_status: 'active', employee_school_id: 1, employee_role: 'teacher',
    weekly_periods: 3, status: 'active', created_at: 1, updated_at: 1,
  };
  return { days, slots, loads: [load], entries: [], teacherAvailability: [], teacherConstraints: [], ...overrides };
}

test('soft avoid and preferred-window warnings never become hard conflicts', () => {
  const context = pureContext({ teacherAvailability: [
    { id: 1, school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: 1, status: 'preferred' },
    { id: 2, school_id: 1, academic_year_id: 1, employee_id: 1, slot_id: 2, status: 'avoid' },
  ] });
  const result = evaluateTimetableEntryPlacement({ ...context, candidate: { slot_id: 2, teaching_load_id: 1 } });
  const preferred = evaluateTimetableEntryPlacement({ ...context, candidate: { slot_id: 1, teaching_load_id: 1 } });
  assert.deepEqual(result.hard_conflicts, []);
  assert.ok(result.warnings.some((item) => item.code === 'avoid_slot'));
  assert.ok(result.warnings.some((item) => item.code === 'outside_preferred_slots'));
  assert.deepEqual(preferred.hard_conflicts, []);
  assert.ok(preferred.warnings.some((item) => item.code === 'preferred_slot'));
});

test('first and last period preferences produce nonblocking warnings', () => {
  const context = pureContext({ teacherConstraints: [{
    id: 1, school_id: 1, academic_year_id: 1, employee_id: 1,
    max_periods_per_day: null, max_consecutive_periods: null, max_working_days: null,
    prefer_compact_schedule: 0, avoid_first_period: 1, avoid_last_period: 1,
  }] });
  const first = evaluateTimetableEntryPlacement({ ...context, candidate: { slot_id: 1, teaching_load_id: 1 } });
  const last = evaluateTimetableEntryPlacement({ ...context, candidate: { slot_id: 3, teaching_load_id: 1 } });
  assert.ok(first.warnings.some((item) => item.code === 'first_period_preference'));
  assert.ok(last.warnings.some((item) => item.code === 'last_period_preference'));
  assert.equal(first.hard_conflicts.length + last.hard_conflicts.length, 0);
});

test('compact-schedule preference warns only for a separated placement', () => {
  const context = pureContext({
    entries: [{ id: 1, school_id: 1, academic_year_id: 1, slot_id: 1, teaching_load_id: 1 }],
    teacherConstraints: [{
      id: 1, school_id: 1, academic_year_id: 1, employee_id: 1,
      max_periods_per_day: null, max_consecutive_periods: null, max_working_days: null,
      prefer_compact_schedule: 1, avoid_first_period: 0, avoid_last_period: 0,
    }],
  });
  const adjacent = evaluateTimetableEntryPlacement({ ...context, candidate: { slot_id: 2, teaching_load_id: 1 } });
  const separated = evaluateTimetableEntryPlacement({ ...context, candidate: { slot_id: 3, teaching_load_id: 1 } });
  assert.equal(adjacent.warnings.some((item) => item.code === 'non_compact_schedule'), false);
  assert.equal(separated.warnings.some((item) => item.code === 'non_compact_schedule'), true);
});

test('readiness reports required, scheduled and remaining demand without erasing missing teacher loads', () => {
  const context = pureContext();
  context.loads[0].employee_id = null;
  context.loads[0].employee_name = null;
  context.entries = [{ id: 1, school_id: 1, academic_year_id: 1, slot_id: 1, teaching_load_id: 1 }];
  const summary = buildTimetableReadiness({
    ...context,
    placements: [{ class_id: 1, class_name: 'Class', section_id: 1, section_name: 'A' }],
    subjects: [{ id: 1, class_id: 1, section_id: null, name: 'Math', status: 'active' }],
  });
  assert.equal(summary.total_required_periods, 3);
  assert.equal(summary.total_scheduled_periods, 1);
  assert.equal(summary.total_unscheduled_periods, 2);
  assert.equal(summary.missing_teacher_count, 1);
  assert.equal(summary.ready, false);
  assert.equal(summary.schedule_ready, false);
});

test('entry and grid validators reject incomplete scope input', () => {
  assert.equal(validateTimetableEntryInput({ academic_year_id: 1, slot_id: 1 }).ok, false);
  assert.equal(validateTimetableGridScopeInput({ academic_year_id: 1, class_id: 1 }).ok, true);
  assert.equal(validateTimetableGridScopeInput({ academic_year_id: 1 }).ok, false);
});
