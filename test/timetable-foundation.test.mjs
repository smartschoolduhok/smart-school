import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  buildTimetableReadiness,
  calculateWeeklyCapacity,
  dormantTimetableLoadIds,
  timetableLoadReferenceReasons,
  validateTimetableDayInput,
  validateTimetableLoadInput,
  validateTimetableSlotInput,
} from '../src/lib/timetable.ts';
import { ACADEMIC_MANAGEMENT_ROLES, hasRole } from '../src/lib/rbac.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const readMigration = (name) => readFileSync(join(rootDir, 'migrations', name), 'utf8');
const workerSource = readFileSync(join(rootDir, 'src', 'worker.ts'), 'utf8');
const migration = readMigration('0023_timetable_foundation.sql');
const availabilityMigration = readMigration('0024_teacher_timetable_constraints.sql');
const entriesMigration = readMigration('0025_timetable_entries.sql');
const teacherCollisionVisibilityMigration = readMigration('0037_timetable_teacher_collision_visibility.sql');
const savedLessonTimeMigration = readMigration('0047_timetable_edit_saved_lesson_times.sql');

function insertId(database, sql, ...params) {
  return Number(database.prepare(`${sql} RETURNING id`).get(...params).id);
}

function createFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(readMigration('0001_initial_schema.sql'));
  database.exec(readMigration('0002_phase2_academic_tables.sql'));
  database.exec(readMigration('0010_employees.sql'));
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
      (2, 1, 'Class without sections', 'ابتدائي', 2, 'active'),
      (3, 2, 'Class B', 'ابتدائي', 1, 'active'),
      (4, 1, 'Archived class', 'ابتدائي', 3, 'archived');
    INSERT INTO sections (id, school_id, class_id, name, status) VALUES
      (1, 1, 1, 'A', 'active'),
      (2, 1, 1, 'B', 'active'),
      (3, 2, 3, 'B', 'active'),
      (4, 1, 1, 'Archived', 'archived');
    INSERT INTO subjects (id, school_id, class_id, section_id, name, order_index, status) VALUES
      (1, 1, 1, NULL, 'Mathematics', 1, 'active'),
      (2, 1, 1, 1, 'Art A', 2, 'active'),
      (3, 1, 2, NULL, 'Science', 1, 'active'),
      (4, 2, 3, 3, 'School B Subject', 1, 'active'),
      (5, 1, 1, NULL, 'Archived Subject', 3, 'archived');
    INSERT INTO employees (id, school_id, full_name, role, status) VALUES
      (1, 1, 'Teacher One', 'teacher', 'active'),
      (2, 1, 'Teacher Two', 'teacher', 'active'),
      (3, 2, 'Teacher B', 'teacher', 'active'),
      (4, 1, 'Archived Teacher', 'teacher', 'archived'),
      (5, 1, 'Accountant One', 'accountant', 'active'),
      (6, 1, 'Staff One', 'staff', 'active');
  `);
  database.exec(migration);
  database.exec(availabilityMigration);
  database.exec(entriesMigration);
  return database;
}

function addDay(database, { schoolId = 1, yearId = 1, day = 0, active = 1, order = day } = {}) {
  return insertId(database, `
    INSERT INTO timetable_days (school_id, academic_year_id, day_of_week, is_active, order_index)
    VALUES (?, ?, ?, ?, ?)
  `, schoolId, yearId, day, active, order);
}

function addSlot(database, {
  schoolId = 1,
  yearId = 1,
  day = 0,
  slotIndex = 1,
  type = 'lesson',
  lessonNumber = type === 'lesson' ? slotIndex : null,
  start = '08:00',
  end = '08:40',
} = {}) {
  return insertId(database, `
    INSERT INTO timetable_slots (
      school_id, academic_year_id, day_of_week, slot_index, slot_type,
      lesson_number, label, start_time, end_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, schoolId, yearId, day, slotIndex, type, lessonNumber, type === 'lesson' ? `Lesson ${slotIndex}` : 'Break', start, end);
}

function addLoad(database, {
  schoolId = 1,
  yearId = 1,
  classId = 1,
  sectionId = 1,
  subjectId = 1,
  employeeId = 1,
  weeklyPeriods = 4,
  status = 'active',
} = {}) {
  return insertId(database, `
    INSERT INTO timetable_teaching_loads (
      school_id, academic_year_id, class_id, section_id, subject_id,
      employee_id, weekly_periods, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, schoolId, yearId, classId, sectionId, subjectId, employeeId, weeklyPeriods, status);
}

test('saved lesson bell times can change without moving or deactivating the lesson', () => {
  const database = createFixture();
  database.exec(savedLessonTimeMigration);
  addDay(database);
  const slotId = addSlot(database);
  const loadId = addLoad(database);
  database.prepare('INSERT INTO timetable_entries (school_id, academic_year_id, slot_id, teaching_load_id) VALUES (1, 1, ?, ?)').run(slotId, loadId);
  database.prepare("UPDATE timetable_slots SET start_time = '08:05', end_time = '08:45' WHERE id = ?").run(slotId);
  assert.equal(database.prepare('SELECT start_time FROM timetable_slots WHERE id = ?').get(slotId).start_time, '08:05');
  assert.throws(() => database.prepare('UPDATE timetable_slots SET lesson_number = 2 WHERE id = ?').run(slotId));
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM timetable_entries WHERE slot_id = ?').get(slotId).count, 1);
  database.close();
});

test('0037 permits teacher overlap while retaining the other entry validation triggers', () => {
  const database = createFixture();
  database.exec(teacherCollisionVisibilityMigration);
  addDay(database);
  const slotId = addSlot(database);
  const firstLoadId = addLoad(database, { classId: 1, sectionId: 1, subjectId: 1, employeeId: 1 });
  const otherClassLoadId = addLoad(database, { classId: 2, sectionId: null, subjectId: 3, employeeId: 1 });
  const sameGroupLoadId = addLoad(database, { classId: 1, sectionId: 1, subjectId: 2, employeeId: 2 });

  database.prepare(`INSERT INTO timetable_entries
    (school_id, academic_year_id, slot_id, teaching_load_id)
    VALUES (1, 1, ?, ?)`).run(slotId, firstLoadId);
  assert.doesNotThrow(() => database.prepare(`INSERT INTO timetable_entries
    (school_id, academic_year_id, slot_id, teaching_load_id)
    VALUES (1, 1, ?, ?)`).run(slotId, otherClassLoadId));
  assert.throws(() => database.prepare(`INSERT INTO timetable_entries
    (school_id, academic_year_id, slot_id, teaching_load_id)
    VALUES (1, 1, ?, ?)`).run(slotId, sameGroupLoadId), /group collision/);

  const triggerSql = database.prepare(`SELECT group_concat(sql, '\n') AS sql
    FROM sqlite_schema WHERE type = 'trigger'
      AND name IN ('trg_timetable_entries_validate_insert', 'trg_timetable_entries_validate_update')`).get().sql;
  assert.doesNotMatch(triggerSql, /teacher collision/);
  assert.match(triggerSql, /teacher unavailable/);
  assert.match(triggerSql, /max periods per day/);
});

test('0023 and 0024 create scoped timetable tables, indexes and validation triggers', () => {
  const database = createFixture();
  const tables = new Set(database.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table'`).all().map((row) => row.name));
  for (const tableName of ['timetable_days', 'timetable_slots', 'timetable_teaching_loads', 'timetable_teacher_availability', 'timetable_teacher_constraints']) assert.ok(tables.has(tableName));
  const indexes = new Set(database.prepare(`SELECT name FROM sqlite_schema WHERE type = 'index'`).all().map((row) => row.name));
  for (const indexName of [
    'idx_timetable_days_school_year',
    'idx_timetable_slots_school_year_day',
    'idx_timetable_slots_lesson_number',
    'idx_timetable_loads_active_without_section',
    'idx_timetable_loads_active_with_section',
    'idx_timetable_loads_employee',
    'idx_timetable_teacher_availability_scope',
    'idx_timetable_teacher_constraints_scope',
  ]) assert.ok(indexes.has(indexName), indexName);
  const triggers = new Set(database.prepare(`SELECT name FROM sqlite_schema WHERE type = 'trigger'`).all().map((row) => row.name));
  for (const triggerName of [
    'trg_timetable_days_validate_insert',
    'trg_timetable_slots_validate_insert',
    'trg_timetable_slots_validate_update',
    'trg_timetable_slots_preserve_teacher_availability',
    'trg_timetable_loads_validate_insert',
    'trg_timetable_loads_validate_update',
    'trg_timetable_days_updated_at',
    'trg_timetable_slots_updated_at',
    'trg_timetable_loads_updated_at',
    'trg_timetable_teacher_availability_validate_insert',
    'trg_timetable_teacher_availability_validate_update',
    'trg_timetable_teacher_constraints_validate_insert',
    'trg_timetable_teacher_constraints_validate_update',
    'trg_timetable_teacher_availability_updated_at',
    'trg_timetable_teacher_constraints_updated_at',
  ]) assert.ok(triggers.has(triggerName), triggerName);
});

test('all seven canonical weekdays are accepted while values outside 0 through 6 are rejected', () => {
  const database = createFixture();
  for (let day = 0; day <= 6; day += 1) addDay(database, { day });
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM timetable_days').get().count, 7);
  assert.throws(() => addDay(database, { day: 7 }), /CHECK constraint failed/);
});

test('day/year and all teaching-load references fail closed across schools or inactive records', () => {
  const database = createFixture();
  assert.throws(() => addDay(database, { schoolId: 1, yearId: 3 }), /academic year school mismatch/);
  assert.throws(() => addLoad(database, { yearId: 3 }), /academic year school mismatch/);
  assert.throws(() => addLoad(database, { classId: 3, sectionId: 3, subjectId: 4, employeeId: 3 }), /class invalid/);
  assert.throws(() => addLoad(database, { sectionId: 3 }), /section invalid/);
  assert.throws(() => addLoad(database, { subjectId: 4 }), /subject invalid/);
  assert.throws(() => addLoad(database, { employeeId: 3 }), /employee invalid/);
  assert.throws(() => addLoad(database, { classId: 4, sectionId: null, subjectId: 1 }), /class invalid/);
  assert.throws(() => addLoad(database, { subjectId: 5 }), /subject invalid/);
  assert.throws(() => addLoad(database, { employeeId: 4 }), /employee invalid/);
});

test('section rules require active class sections and enforce subject placement', () => {
  const database = createFixture();
  assert.throws(() => addLoad(database, { sectionId: null }), /requires section/);
  assert.throws(() => addLoad(database, { sectionId: 2, subjectId: 2 }), /subject invalid/);
  const classWide = addLoad(database, { sectionId: 2, subjectId: 1 });
  const withoutSection = addLoad(database, { classId: 2, sectionId: null, subjectId: 3 });
  assert.ok(classWide > 0);
  assert.ok(withoutSection > 0);
});

test('database accepts active teachers and rejects non-teacher employee roles', () => {
  const database = createFixture();
  assert.ok(addLoad(database, { employeeId: 1 }) > 0);
  database.prepare('DELETE FROM timetable_teaching_loads').run();
  assert.throws(() => addLoad(database, { employeeId: 5 }), /employee invalid/);
  assert.throws(() => addLoad(database, { employeeId: 6 }), /employee invalid/);
  assert.throws(() => addLoad(database, { employeeId: 4 }), /employee invalid/);
  assert.throws(() => addLoad(database, { employeeId: 3 }), /employee invalid/);
});

test('active load uniqueness works both with a section and with NULL section', () => {
  const database = createFixture();
  const activeLoadId = addLoad(database);
  assert.throws(() => addLoad(database), /UNIQUE constraint failed/);
  addLoad(database, { status: 'inactive' });
  database.prepare("UPDATE timetable_teaching_loads SET status = 'inactive' WHERE id = ?").run(activeLoadId);
  assert.ok(addLoad(database) > 0, 'a deactivated load may be replaced by one active load');
  addLoad(database, { classId: 2, sectionId: null, subjectId: 3 });
  assert.throws(() => addLoad(database, { classId: 2, sectionId: null, subjectId: 3 }), /UNIQUE constraint failed/);
});

test('canonical academic records are never cascaded from timetable loads', () => {
  const database = createFixture();
  const loadId = addLoad(database);
  database.prepare('DELETE FROM timetable_teaching_loads WHERE id = ?').run(loadId);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM classes WHERE id = 1').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sections WHERE id = 1').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM subjects WHERE id = 1').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM employees WHERE id = 1').get().count, 1);

  addLoad(database);
  assert.throws(() => database.prepare('DELETE FROM subjects WHERE id = 1').run(), /FOREIGN KEY constraint failed/);
  assert.throws(() => database.prepare('DELETE FROM sections WHERE id = 1').run(), /FOREIGN KEY constraint failed/);
  database.prepare('DELETE FROM employees WHERE id = 1').run();
  assert.equal(database.prepare('SELECT employee_id FROM timetable_teaching_loads').get().employee_id, null);
});

test('database update triggers refresh timetable timestamps deterministically', () => {
  const database = createFixture();
  const dayId = addDay(database);
  database.prepare('UPDATE timetable_days SET updated_at = 1 WHERE id = ?').run(dayId);
  database.prepare('UPDATE timetable_days SET is_active = 0 WHERE id = ?').run(dayId);
  assert.ok(database.prepare('SELECT updated_at FROM timetable_days WHERE id = ?').get(dayId).updated_at > 1);
});

test('slot validation covers duplicates, insert/update overlap, day moves and day-scoped cascading', () => {
  const database = createFixture();
  addDay(database);
  addDay(database, { day: 1 });
  assert.throws(() => addSlot(database, { start: '25:00' }), /CHECK constraint failed/);
  assert.throws(() => addSlot(database, { start: '09:00', end: '08:00' }), /CHECK constraint failed/);
  assert.throws(() => addSlot(database, { type: 'break', lessonNumber: 1 }), /CHECK constraint failed/);
  const firstSlotId = addSlot(database, { start: '08:00', end: '08:40' });
  assert.throws(() => addSlot(database, { lessonNumber: 2, start: '09:00', end: '09:40' }), /UNIQUE constraint failed/);
  assert.throws(() => addSlot(database, { slotIndex: 2, lessonNumber: 1, start: '09:00', end: '09:40' }), /UNIQUE constraint failed/);
  assert.throws(() => addSlot(database, { slotIndex: 2, lessonNumber: 2, start: '08:30', end: '09:00' }), /slot overlap/);
  const secondSlotId = addSlot(database, { slotIndex: 2, lessonNumber: 2, start: '08:40', end: '09:20' });
  assert.throws(() => database.prepare(`
    UPDATE timetable_slots SET start_time = '08:30', end_time = '09:10' WHERE id = ?
  `).run(secondSlotId), /slot overlap/);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM timetable_slots').get().count, 2);
  database.prepare(`
    UPDATE timetable_slots SET day_of_week = 1, slot_index = 1, lesson_number = 1,
      start_time = '08:00', end_time = '08:40' WHERE id = ?
  `).run(secondSlotId);
  assert.equal(database.prepare('SELECT day_of_week FROM timetable_slots WHERE id = ?').get(secondSlotId).day_of_week, 1);
  database.prepare('DELETE FROM timetable_days WHERE school_id = 1 AND academic_year_id = 1 AND day_of_week = 0').run();
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM timetable_slots WHERE id = ?').get(firstSlotId).count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM timetable_slots WHERE id = ?').get(secondSlotId).count, 1);
});

test('disabled days and breaks are excluded from weekly teaching capacity', () => {
  const days = [
    { day_of_week: 0, is_active: 1 },
    { day_of_week: 1, is_active: 0 },
  ];
  const slots = [
    { day_of_week: 0, slot_type: 'lesson' },
    { day_of_week: 0, slot_type: 'break' },
    { day_of_week: 1, slot_type: 'lesson' },
  ];
  assert.deepEqual(calculateWeeklyCapacity(days, slots), {
    teachingDays: 1,
    lessonSlots: 1,
    breakSlots: 1,
    weeklyCapacity: 1,
  });
});

function readinessFixture({ capacity = 8, loadPeriods = [4, 4], missingTeacher = false } = {}) {
  const days = [{ day_of_week: 0, is_active: 1 }];
  const slots = Array.from({ length: capacity }, (_, index) => ({ day_of_week: 0, slot_type: 'lesson', id: index + 1 }));
  const placements = [
    { class_id: 1, class_name: 'Class A', section_id: 1, section_name: 'A' },
    { class_id: 1, class_name: 'Class A', section_id: 2, section_name: 'B' },
  ];
  const subjects = [{ id: 1, class_id: 1, section_id: null, name: 'Math', status: 'active' }];
  const loads = loadPeriods.map((weeklyPeriods, index) => ({
    id: index + 1,
    school_id: 1,
    class_id: 1,
    section_id: index + 1,
    subject_id: 1,
    employee_id: missingTeacher && index === 0 ? null : 1,
    employee_name: 'Teacher One',
    weekly_periods: weeklyPeriods,
    status: 'active',
    class_status: 'active',
    class_school_id: 1,
    section_status: 'active',
    section_school_id: 1,
    section_class_id: 1,
    subject_status: 'active',
    subject_school_id: 1,
    subject_class_id: 1,
    subject_section_id: null,
    employee_status: missingTeacher && index === 0 ? null : 'active',
    employee_school_id: missingTeacher && index === 0 ? null : 1,
    employee_role: missingTeacher && index === 0 ? null : 'teacher',
  }));
  return { days, slots, placements, subjects, loads };
}

function excludedSubjectReadinessFixture() {
  const input = readinessFixture({ capacity: 33, loadPeriods: [30] });
  input.schoolId = 1;
  input.academicYearId = 1;
  input.placements = [input.placements[0]];
  input.subjects = ['Math', 'English', 'Sports', 'Art'].map((name, i) => ({ id: i + 1, class_id: 1, section_id: null, name, status: 'active' }));
  input.loads = input.subjects.map((subject, i) => ({
    ...input.loads[0], id: subject.id, academic_year_id: 1, subject_id: subject.id, subject_name: subject.name,
    weekly_periods: i === 0 ? 30 : i === 1 ? 3 : 1, status: i < 2 ? 'active' : 'inactive',
  }));
  return input;
}

test('explicit inactive section loads exclude sports and art while the 33-lesson active plan is ready', () => {
  const input = excludedSubjectReadinessFixture();
  const summary = buildTimetableReadiness(input);
  assert.equal(summary.ready, true);
  assert.equal(summary.placements[0].status, 'exact');
  assert.deepEqual(summary.placements[0].missing_subjects, []);
  assert.equal(summary.total_required_periods, 33);
  assert.equal(summary.total_assignments, 2);
  assert.deepEqual(summary.load_progress.map(load => load.teaching_load_id), [1, 2]);
  assert.equal(summary.teacher_workloads[0].total_weekly_periods, 33);
  assert.ok(input.subjects.every(subject => subject.status === 'active'), 'catalog subjects stay active outside this timetable choice');
});

test('subjects without a section load record still require configuration', () => {
  const input = excludedSubjectReadinessFixture();
  input.loads = input.loads.filter(load => load.subject_id !== 4);
  const summary = buildTimetableReadiness(input);
  assert.equal(summary.ready, false);
  assert.deepEqual(summary.placements[0].missing_subjects, [{ id: 4, name: 'Art' }]);
  assert.equal(summary.total_required_periods, 33);
});

for (const [name, overrides] of [
  ['other school', { school_id: 2, class_school_id: 2, section_school_id: 2, subject_school_id: 2, employee_school_id: 2 }],
  ['other year', { academic_year_id: 2 }],
  ['other class', { class_id: 2, subject_class_id: 2, section_class_id: 2 }],
  ['other section', { section_id: 2 }],
  ['whole class', { section_id: null }],
  ['invalid academic reference', { subject_class_id: 2 }],
]) test(`inactive ${name} load cannot exclude a subject for this section`, () => {
  const input = excludedSubjectReadinessFixture();
  Object.assign(input.loads.find(load => load.subject_id === 3), overrides);
  const summary = buildTimetableReadiness(input);
  assert.equal(summary.ready, false);
  assert.deepEqual(summary.placements[0].missing_subjects, [{ id: 3, name: 'Sports' }]);
});

for (const [name, overrides] of [
  ['valid active replacement', {}],
  ['active replacement without a teacher', { employee_id: null }],
  ['active replacement with archived teacher', { employee_status: 'archived' }],
  ['active replacement with invalid academic reference', { subject_class_id: 2 }],
]) test(`${name} takes precedence over older inactive exclusions`, () => {
  const input = excludedSubjectReadinessFixture();
  input.loads.push({ ...input.loads[2], id: 30, status: 'active', ...overrides });
  const summary = buildTimetableReadiness(input);
  assert.equal(summary.ready, false);
  if (overrides.subject_class_id) {
    assert.deepEqual(summary.placements[0].missing_subjects, [{ id: 3, name: 'Sports' }]);
    assert.equal(summary.invalid_reference_count, 1);
  } else {
    assert.deepEqual(summary.placements[0].missing_subjects, []);
    assert.equal(summary.total_required_periods, 34);
    assert.equal(summary.placements[0].status, 'over_capacity');
    if (overrides.employee_id === null) assert.deepEqual(summary.placements[0].missing_teacher_load_ids, [30]);
    if (overrides.employee_status) assert.deepEqual(summary.placements[0].invalid_load_ids, [30]);
  }
});

test('readiness distinguishes under, exact, over, empty and missing-teacher states', () => {
  const exactAndUnderFixture = readinessFixture({ capacity: 4, loadPeriods: [4, 3] });
  exactAndUnderFixture.loads[1].employee_id = 2;
  exactAndUnderFixture.loads[1].employee_name = 'Teacher Two';
  const exactAndUnder = buildTimetableReadiness(exactAndUnderFixture);
  assert.deepEqual(exactAndUnder.placements.map((row) => row.status), ['exact', 'unallocated']);
  assert.equal(exactAndUnder.ready, true, 'unused capacity is only a warning');
  const over = buildTimetableReadiness(readinessFixture({ capacity: 3, loadPeriods: [4, 3] }));
  assert.equal(over.placements[0].status, 'over_capacity');
  assert.equal(over.ready, false);
  const empty = buildTimetableReadiness({ ...readinessFixture(), days: [] });
  assert.equal(empty.placements[0].status, 'empty_week');
  assert.equal(empty.ready, false);
  const missingTeacher = buildTimetableReadiness(readinessFixture({ capacity: 4, missingTeacher: true }));
  assert.equal(missingTeacher.missing_teacher_count, 1);
  assert.equal(missingTeacher.ready, false);
});

test('invalid teachers never erase academic periods or configured subject loads', () => {
  const input = readinessFixture({ capacity: 35, loadPeriods: [30] });
  input.placements = [input.placements[0]];
  input.subjects = [
    { id: 1, class_id: 1, section_id: null, name: 'Math', status: 'active' },
    { id: 2, class_id: 1, section_id: null, name: 'Science', status: 'active' },
  ];
  input.loads = [
    { ...input.loads[0], id: 1, subject_id: 1, weekly_periods: 30 },
    {
      ...input.loads[0], id: 2, subject_id: 2, weekly_periods: 10,
      employee_id: 2, employee_name: 'Archived Teacher', employee_status: 'archived',
    },
  ];

  const summary = buildTimetableReadiness(input);
  assert.equal(summary.total_required_periods, 40);
  assert.equal(summary.placements[0].required_periods, 40);
  assert.equal(summary.placements[0].status, 'over_capacity');
  assert.deepEqual(summary.placements[0].missing_subjects, []);
  assert.equal(summary.invalid_reference_count, 1);
  assert.equal(summary.ready, false);
  assert.deepEqual(summary.teacher_workloads, [{
    employee_id: 1,
    employee_name: 'Teacher One',
    total_weekly_periods: 30,
    assignment_count: 1,
  }]);
});

test('teacher role or school changes block readiness and workload without changing weekly requirements', () => {
  const input = readinessFixture({ capacity: 20, loadPeriods: [10] });
  input.placements = [input.placements[0]];
  input.loads[0].employee_role = 'staff';
  const summary = buildTimetableReadiness(input);
  assert.equal(summary.total_required_periods, 10);
  assert.equal(summary.placements[0].required_periods, 10);
  assert.deepEqual(summary.placements[0].missing_subjects, []);
  assert.deepEqual(summary.teacher_workloads, []);
  assert.equal(summary.invalid_reference_count, 1);
  assert.equal(summary.ready, false);

  input.loads[0].employee_role = 'teacher';
  input.loads[0].employee_school_id = 2;
  const wrongSchoolSummary = buildTimetableReadiness(input);
  assert.equal(wrongSchoolSummary.total_required_periods, 10);
  assert.deepEqual(wrongSchoolSummary.teacher_workloads, []);
  assert.equal(wrongSchoolSummary.invalid_reference_count, 1);
  assert.equal(wrongSchoolSummary.ready, false);
});

test('a null teacher preserves the requirement and configured subject while reporting missing teacher', () => {
  const input = readinessFixture({ capacity: 20, loadPeriods: [10], missingTeacher: true });
  input.placements = [input.placements[0]];
  const summary = buildTimetableReadiness(input);
  assert.equal(summary.total_required_periods, 10);
  assert.equal(summary.placements[0].required_periods, 10);
  assert.deepEqual(summary.placements[0].missing_subjects, []);
  assert.deepEqual(summary.placements[0].missing_teacher_load_ids, [1]);
  assert.equal(summary.missing_teacher_count, 1);
  assert.equal(summary.invalid_reference_count, 0);
  assert.equal(summary.ready, false);
});

test('teacher aggregate combines assignments across all classes and sections', () => {
  const input = readinessFixture({ capacity: 6, loadPeriods: [4, 5] });
  input.placements.push({ class_id: 2, class_name: 'Class B', section_id: null, section_name: null });
  input.subjects.push({ id: 2, class_id: 2, section_id: null, name: 'Physics', status: 'active' });
  input.loads.push({
    id: 3, class_id: 2, section_id: null, subject_id: 2, employee_id: 1,
    employee_name: 'Teacher One', weekly_periods: 3, status: 'active',
    class_status: 'active', section_status: null, subject_status: 'active',
    subject_class_id: 2, subject_section_id: null, employee_status: 'active',
    employee_role: 'teacher',
  });
  const summary = buildTimetableReadiness(input);
  assert.equal(summary.total_required_periods, 12, 'each active academic load is counted exactly once');
  assert.deepEqual(summary.teacher_workloads, [{
    employee_id: 1,
    employee_name: 'Teacher One',
    total_weekly_periods: 12,
    assignment_count: 3,
  }]);
});

test('readiness exposes references that become inactive or structurally invalid later', () => {
  const input = readinessFixture({ capacity: 4, loadPeriods: [4, 4] });
  input.loads[0].employee_status = 'archived';
  input.loads[1].subject_status = 'archived';
  const summary = buildTimetableReadiness(input);
  assert.equal(summary.invalid_reference_count, 2);
  assert.equal(summary.total_required_periods, 4, 'teacher-invalid load counts; subject-invalid load does not');
  assert.equal(summary.placements[0].required_periods, 4);
  assert.equal(summary.placements[1].required_periods, 0);
  assert.equal(summary.ready, false);

  const archivedClassSummary = buildTimetableReadiness({
    ...input,
    placements: [input.placements[0]],
    loads: [{ ...input.loads[0], academic_year_id: 1, class_status: 'archived', employee_status: 'active' }],
  });
  assert.equal(archivedClassSummary.total_required_periods, 0);
  assert.equal(archivedClassSummary.invalid_reference_count, 0);
  assert.equal(archivedClassSummary.archived_load_count, 1);

  const archivedSectionSummary = buildTimetableReadiness({
    ...input,
    placements: [input.placements[0]],
    loads: [{ ...input.loads[0], academic_year_id: 1, section_status: 'archived', employee_status: 'active' }],
  });
  assert.equal(archivedSectionSummary.total_required_periods, 0);
  assert.equal(archivedSectionSummary.invalid_reference_count, 0);
  assert.equal(archivedSectionSummary.archived_load_count, 1);

  const nullSectionLoad = {
    ...input.loads[0],
    id: 10,
    class_id: 2,
    section_id: null,
    subject_id: 2,
    class_status: 'active',
    class_school_id: 1,
    active_section_count: 1,
    subject_status: 'active',
    subject_school_id: 1,
    subject_class_id: 2,
    subject_section_id: null,
    employee_status: 'active',
    employee_school_id: 1,
  };
  const structuralSummary = buildTimetableReadiness({
    days: input.days,
    slots: input.slots,
    placements: [{ class_id: 2, class_name: 'Class B', section_id: 3, section_name: 'A' }],
    subjects: [{ id: 2, class_id: 2, section_id: null, name: 'Science', status: 'active' }],
    loads: [nullSectionLoad],
  });
  assert.equal(structuralSummary.invalid_reference_count, 1);
  assert.equal(structuralSummary.ready, false);

  nullSectionLoad.section_id = 3;
  nullSectionLoad.section_status = 'active';
  nullSectionLoad.section_school_id = 1;
  nullSectionLoad.section_class_id = 99;
  const movedSectionSummary = buildTimetableReadiness({
    days: input.days,
    slots: input.slots,
    placements: [{ class_id: 2, class_name: 'Class B', section_id: 3, section_name: 'A' }],
    subjects: [{ id: 2, class_id: 2, section_id: null, name: 'Science', status: 'active' }],
    loads: [nullSectionLoad],
  });
  assert.equal(movedSectionSummary.invalid_reference_count, 1);
});

test('nineteen unscheduled archived-section loads remain visible history outside current demand and placement rows', () => {
  const input = readinessFixture({capacity: 4, loadPeriods: [4,4]});
  input.schoolId=1; input.academicYearId=1;
  const base={...input.loads[0],academic_year_id:1};
  input.loads=input.loads.map(load=>({...load,academic_year_id:1}));
  input.loads[1].employee_id=2;
  for(let i=0;i<19;i++)input.loads.push({...base,id:100+i,section_id:i<11?10:18,section_name:'Archived',section_status:'archived',employee_status:i===18?'archived':'active'});
  const original=JSON.stringify(input),summary=buildTimetableReadiness(input);
  assert.equal(summary.invalid_reference_count,0);assert.equal(summary.archived_load_count,19);assert.equal(summary.total_assignments,2);assert.equal(summary.total_required_periods,8);
  assert.equal(summary.ready,true);assert.ok(summary.placements.every(p=>p.invalid_load_ids.length===0));
  assert.equal(summary.archived_load_details.length,19);assert.ok(summary.archived_load_details.every(load=>load.scheduled_entry_count===0&&load.reasons.some(r=>r.code==='section_archived')));
  assert.deepEqual(summary.archived_load_details.at(-1).reasons.map(r=>r.code),['section_archived','teacher_archived']);
  assert.deepEqual(summary.invalid_load_details,[]);assert.equal(JSON.stringify(input),original,'readiness never edits historical loads');
});

for(const [name,patch] of [
  ['missing subject',{subject_status:null}],['foreign subject',{subject_school_id:2}],['wrong subject class',{subject_class_id:2}],
  ['wrong subject section',{subject_section_id:55}],['missing teacher',{employee_status:null}],['foreign teacher',{employee_school_id:2}],
  ['nonteacher',{employee_role:'accountant'}],['foreign class',{class_school_id:2}],['moved section',{section_class_id:2}],
  ['foreign section',{section_school_id:2}],['missing section',{section_status:null}],['different school',{school_id:2}],['different year',{academic_year_id:2}],
])test(`dormant archive detection does not hide ${name}`,()=>{
  const load={...readinessFixture().loads[0],academic_year_id:1,section_status:'archived',...patch};
  assert.equal(dormantTimetableLoadIds([load],[],1,1).size,0);
});

test('archived loads with current lessons remain blockers and restored sections revalidate teachers',()=>{
  const input=readinessFixture({capacity:4,loadPeriods:[4]});input.placements=[input.placements[0]];
  const load={...input.loads[0],academic_year_id:1,section_status:'archived',employee_status:'archived'};input.loads=[load];
  input.entries=[{id:1,school_id:1,academic_year_id:1,slot_id:input.slots[0].id,teaching_load_id:load.id,is_locked:0}];
  let summary=buildTimetableReadiness(input);assert.equal(summary.archived_load_count,0);assert.equal(summary.invalid_reference_count,1);assert.equal(summary.invalid_load_details[0].scheduled_entry_count,1);
  assert.deepEqual(summary.invalid_load_details[0].reasons.map(r=>r.code),['section_archived','teacher_archived']);
  input.entries=[];load.section_status='active';summary=buildTimetableReadiness(input);assert.equal(summary.archived_load_count,0);assert.equal(summary.invalid_reference_count,1);assert.deepEqual(summary.invalid_load_details[0].reasons.map(r=>r.code),['teacher_archived']);
  load.employee_status='active';summary=buildTimetableReadiness(input);assert.equal(summary.invalid_reference_count,0);assert.equal(summary.total_required_periods,4);assert.equal(summary.ready,true);
});

test('diagnostic reasons explain structural invalid references without calling a missing teacher invalid',()=>{
  const base={...readinessFixture().loads[0],academic_year_id:1};
  for(const [patch,code] of [
    [{class_status:null},'class_unavailable'],[{class_school_id:2},'class_school_mismatch'],
    [{section_id:null,active_section_count:2},'section_required'],[{section_status:null},'section_unavailable'],
    [{section_school_id:2},'section_school_mismatch'],[{section_class_id:2},'section_class_mismatch'],
    [{subject_status:null},'subject_unavailable'],[{subject_status:'archived'},'subject_archived'],
    [{subject_school_id:2},'subject_school_mismatch'],[{subject_class_id:2},'subject_class_mismatch'],
    [{subject_section_id:99},'subject_section_mismatch'],[{employee_status:null},'teacher_unavailable'],
    [{employee_school_id:2},'teacher_school_mismatch'],[{employee_role:'accountant'},'employee_not_teacher'],
  ]){const reason=timetableLoadReferenceReasons({...base,...patch}).find(r=>r.code===code);assert.ok(reason,code);assert.ok(reason.message&&reason.action);}
  assert.deepEqual(timetableLoadReferenceReasons({...base,employee_id:null}),[]);
});

test('input validation rejects malformed payloads before database writes', () => {
  assert.equal(validateTimetableDayInput({ academic_year_id: 1, day_of_week: 7, is_active: 1 }).ok, false);
  assert.equal(validateTimetableSlotInput({ academic_year_id: 1, day_of_week: 0, slot_index: 1, slot_type: 'lesson', lesson_number: 1, label: 'x', start_time: '08:40', end_time: '08:00' }).ok, false);
  assert.equal(validateTimetableSlotInput({ academic_year_id: 1, day_of_week: 0, slot_index: 1, slot_type: 'break', lesson_number: 1, label: 'x', start_time: '08:00', end_time: '08:40' }).ok, false);
  assert.equal(validateTimetableLoadInput({ academic_year_id: 1, class_id: 1, subject_id: 1, weekly_periods: 0 }).ok, false);
});

test('worker exposes scoped CRUD and summary routes behind academic management RBAC', () => {
  const timetableWorkerSource = workerSource.slice(
    workerSource.indexOf('// API ROUTES: Timetable foundation'),
    workerSource.indexOf('// API ROUTES: Dashboard Stats'),
  );
  for (const route of [
    "app.get('/api/timetable/week-setup'",
    "app.get('/api/timetable/days'",
    "app.put('/api/timetable/days/:day'",
    "app.get('/api/timetable/slots'",
    "app.post('/api/timetable/slots'",
    "app.put('/api/timetable/slots/:id'",
    "app.delete('/api/timetable/slots/:id'",
    "app.get('/api/timetable/teaching-loads'",
    "app.get('/api/timetable/teaching-load-matrix'",
    "app.post('/api/timetable/teaching-load-matrix/copy-preview'",
    "app.post('/api/timetable/teaching-loads'",
    "app.put('/api/timetable/teaching-loads/:id'",
    "app.delete('/api/timetable/teaching-loads/:id'",
    "app.get('/api/timetable/readiness'",
    "app.get('/api/timetable/teacher-workloads'",
    "app.get('/api/timetable/preferences'",
    "app.put('/api/timetable/preferences'",
    "app.on('POST', ['/api/timetable/solver/preview', '/api/timetable/solver/prepare']",
    "app.get('/api/timetable/master-grid'",
    "app.get('/api/timetable/teacher-availability'",
    "app.put('/api/timetable/teacher-availability/:slotId'",
    "app.delete('/api/timetable/teacher-availability/:slotId'",
    "app.put('/api/timetable/teacher-availability/day/:day'",
    "app.delete('/api/timetable/teacher-availability'",
    "app.get('/api/timetable/teacher-constraints'",
    "app.put('/api/timetable/teacher-constraints'",
    "app.get('/api/timetable/teacher-availability-summary'",
    "app.put('/api/timetable/entries/:id/drop'",
    "app.put('/api/timetable/entries/lock-scope'",
    "app.post('/api/timetable/clear-preview'",
    "app.post('/api/timetable/clear'",
  ]) assert.ok(workerSource.includes(route), route);
  const routeGuards = timetableWorkerSource.match(/app\.(?:(?:get|post|put|delete)\(|on\('POST',\s*)\[?'\/api\/timetable[^\n]*requireRoles\(ACADEMIC_MANAGEMENT_ROLES\)/g) || [];
  assert.equal(routeGuards.length, 42);
  assert.match(timetableWorkerSource, /for \(const operation of \['preview', 'apply'\] as const\)/);
  assert.ok(timetableWorkerSource.includes("app.post(`/api/timetable/teaching-load-matrix/${operation}`, requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES)"));
  assert.ok(timetableWorkerSource.includes("app.post(`/api/timetable/week-setup/${operation}`, requireSameSchoolOrAdmin(), requireRoles(ACADEMIC_MANAGEMENT_ROLES)"));
  assert.match(workerSource, /resolveActiveWriteSchool\(c\.env\.DB, user, body\.school_id\)/);
  assert.doesNotMatch(timetableWorkerSource, /school_id\s*(?:\?\?|\|\|)\s*1/);
  assert.doesNotMatch(timetableWorkerSource, /students\.class_id|students\.section_id/);
  assert.doesNotMatch(timetableWorkerSource, /employee_type/);
  assert.match(timetableWorkerSource, /employee\.role AS employee_role/);
  const readinessHelper = workerSource.slice(
    workerSource.indexOf('async function loadTimetableReadinessSummary'),
    workerSource.indexOf('// Middleware: explicit CORS'),
  );
  const schedulingContext = workerSource.slice(
    workerSource.indexOf('async function loadTimetableSchedulingContext'),
    workerSource.indexOf('type TimetableProposalPayloadValidation'),
  );
  assert.equal((schedulingContext.match(/db\.prepare\(/g) || []).length, 6, 'scheduling context uses six set-based queries');
  assert.equal((readinessHelper.match(/db\.prepare\(/g) || []).length, 2, 'readiness adds only placement and subject queries');
  assert.doesNotMatch(readinessHelper, /\bIN\s*\(\s*\?/i, 'readiness has no variable-size binding list');
});

test('timetable management role matrix reuses academic management policy exactly', () => {
  for (const role of ['system_admin', 'school_owner', 'principal', 'vice_principal', 'registrar']) {
    assert.equal(hasRole(role, ACADEMIC_MANAGEMENT_ROLES), true, role);
  }
  for (const role of ['teacher', 'accountant', 'parent']) {
    assert.equal(hasRole(role, ACADEMIC_MANAGEMENT_ROLES), false, role);
  }
});
