import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  canonicalTimetableProposalEntries,
  compareTimetableSchedules,
  computeTimetableProposalDigest,
  timetableProposalDigestSource,
  validateCompleteTimetableSchedule,
} from '../src/lib/timetableAdoption.ts';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const migration = (name) => readFileSync(join(rootDir, 'migrations', name), 'utf8');

function databaseFixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of [
    '0001_initial_schema.sql', '0002_phase2_academic_tables.sql', '0010_employees.sql',
    '0016_auth_security.sql', '0023_timetable_foundation.sql',
    '0024_teacher_timetable_constraints.sql', '0025_timetable_entries.sql',
    '0026_timetable_adoption_locking.sql',
  ]) db.exec(migration(name));
  db.exec(`
    INSERT INTO schools (id, name, school_type, city, status) VALUES
      (1, 'School A', 'خاص', 'Duhok', 'active'),
      (2, 'School B', 'خاص', 'Duhok', 'active');
    INSERT INTO academic_years (id, school_id, name, starts_at, ends_at, is_active) VALUES
      (1, 1, '2026-2027', '2026-09-01', '2027-06-30', 1),
      (2, 2, '2026-2027', '2026-09-01', '2027-06-30', 1);
    INSERT INTO classes (id, school_id, name, stage, order_index, status) VALUES
      (1, 1, 'Class A', 'ابتدائي', 1, 'active'),
      (2, 1, 'Class B', 'ابتدائي', 2, 'active'),
      (3, 2, 'Other Class', 'ابتدائي', 1, 'active');
    INSERT INTO subjects (id, school_id, class_id, name, status) VALUES
      (1, 1, 1, 'Math', 'active'),
      (2, 1, 2, 'Arabic', 'active'),
      (3, 2, 3, 'Science', 'active');
    INSERT INTO employees (id, school_id, full_name, role, status) VALUES
      (1, 1, 'Teacher A', 'teacher', 'active'),
      (2, 1, 'Teacher B', 'teacher', 'active'),
      (3, 2, 'Other Teacher', 'teacher', 'active');
    INSERT INTO users (id, school_id, full_name, email, role_id, status, auth_version) VALUES
      (1, 1, 'Owner', 'owner@example.test', 2, 'active', 1);
    INSERT INTO timetable_days (id, school_id, academic_year_id, day_of_week, is_active, order_index) VALUES
      (1, 1, 1, 0, 1, 0), (2, 1, 1, 1, 1, 1), (3, 2, 2, 0, 1, 0);
    INSERT INTO timetable_slots
      (id, school_id, academic_year_id, day_of_week, slot_index, slot_type, lesson_number, label, start_time, end_time, is_active)
    VALUES
      (1, 1, 1, 0, 1, 'lesson', 1, 'First', '08:00', '08:40', 1),
      (2, 1, 1, 0, 2, 'lesson', 2, 'Second', '08:40', '09:20', 1),
      (3, 1, 1, 1, 1, 'lesson', 1, 'First', '08:00', '08:40', 1),
      (4, 1, 1, 1, 2, 'lesson', 2, 'Second', '08:40', '09:20', 1),
      (5, 2, 2, 0, 1, 'lesson', 1, 'First', '08:00', '08:40', 1);
    INSERT INTO timetable_teaching_loads
      (id, school_id, academic_year_id, class_id, subject_id, employee_id, weekly_periods, status)
    VALUES
      (1, 1, 1, 1, 1, 1, 2, 'active'),
      (2, 1, 1, 2, 2, 2, 2, 'active'),
      (3, 2, 2, 3, 3, 3, 1, 'active');
  `);
  return db;
}

function revision(db, schoolId = 1, academicYearId = 1) {
  return Number(db.prepare('SELECT revision FROM timetable_revisions WHERE school_id = ? AND academic_year_id = ?').get(schoolId, academicYearId)?.revision || 0);
}

function load(id, overrides = {}) {
  return {
    id, school_id: 1, academic_year_id: 1, class_id: id, class_name: `Class ${id}`,
    class_status: 'active', class_school_id: 1, active_section_count: 0,
    section_id: null, section_name: null, section_status: null, section_school_id: null, section_class_id: null,
    subject_id: id, subject_name: `Subject ${id}`, subject_status: 'active', subject_school_id: 1,
    subject_class_id: id, subject_section_id: null, employee_id: id, employee_name: `Teacher ${id}`,
    employee_status: 'active', employee_school_id: 1, employee_role: 'teacher', weekly_periods: 2,
    status: 'active', created_at: 0, updated_at: 0, ...overrides,
  };
}

function validationContext(overrides = {}) {
  const days = [0, 1].map((day) => ({ id: day + 1, school_id: 1, academic_year_id: 1, day_of_week: day, is_active: 1, order_index: day, created_at: 0, updated_at: 0 }));
  const slots = [
    { id: 1, day_of_week: 0, slot_index: 1 }, { id: 2, day_of_week: 0, slot_index: 2 },
    { id: 3, day_of_week: 1, slot_index: 1 }, { id: 4, day_of_week: 1, slot_index: 2 },
  ].map((slot) => ({ ...slot, school_id: 1, academic_year_id: 1, slot_type: 'lesson', lesson_number: slot.slot_index, label: 'Lesson', start_time: slot.slot_index === 1 ? '08:00' : '08:40', end_time: slot.slot_index === 1 ? '08:40' : '09:20', is_active: 1, created_at: 0, updated_at: 0 }));
  return { schoolId: 1, academicYearId: 1, days, slots, loads: [load(1), load(2)], availability: [], constraints: [], ...overrides };
}

test('0026 adds a default-unlocked canonical timetable entry field', () => {
  const db = databaseFixture();
  const columns = db.prepare("PRAGMA table_info('timetable_entries')").all();
  const column = columns.find((item) => item.name === 'is_locked');
  assert.equal(column.notnull, 1);
  assert.equal(String(column.dflt_value), '0');
  db.prepare('INSERT INTO timetable_entries (school_id, academic_year_id, slot_id, teaching_load_id) VALUES (1,1,1,1)').run();
  assert.equal(db.prepare('SELECT is_locked FROM timetable_entries').get().is_locked, 0);
});

test('0026 rejects lock values outside zero and one', () => {
  const db = databaseFixture();
  assert.throws(() => db.prepare('INSERT INTO timetable_entries (school_id, academic_year_id, slot_id, teaching_load_id, is_locked) VALUES (1,1,1,1,2)').run());
});

test('0026 creates revision, version, assertion and override schema', () => {
  const db = databaseFixture();
  const names = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => row.name));
  for (const name of ['timetable_revisions', 'timetable_revision_assertions', 'timetable_schedule_versions', 'timetable_schedule_version_entries', 'timetable_locked_entry_overrides']) assert.ok(names.has(name), name);
});

for (const [label, mutate] of [
  ['day', (db) => db.prepare('UPDATE timetable_days SET order_index = 4 WHERE id = 1').run()],
  ['slot', (db) => db.prepare("UPDATE timetable_slots SET label = 'Changed' WHERE id = 1").run()],
  ['teaching load', (db) => db.prepare('UPDATE timetable_teaching_loads SET weekly_periods = 3 WHERE id = 1').run()],
  ['availability', (db) => db.prepare("INSERT INTO timetable_teacher_availability (school_id, academic_year_id, employee_id, slot_id, status) VALUES (1,1,1,1,'preferred')").run()],
  ['constraints', (db) => db.prepare('INSERT INTO timetable_teacher_constraints (school_id, academic_year_id, employee_id, max_periods_per_day) VALUES (1,1,1,2)').run()],
  ['entry', (db) => db.prepare('INSERT INTO timetable_entries (school_id, academic_year_id, slot_id, teaching_load_id) VALUES (1,1,1,1)').run()],
]) test(`${label} mutation increments the authoritative timetable revision`, () => {
  const db = databaseFixture();
  const before = revision(db);
  mutate(db);
  assert.equal(revision(db), before + 1);
});

test('lock mutation increments the authoritative revision', () => {
  const db = databaseFixture();
  db.prepare('INSERT INTO timetable_entries (id, school_id, academic_year_id, slot_id, teaching_load_id) VALUES (1,1,1,1,1)').run();
  const before = revision(db);
  db.prepare('UPDATE timetable_entries SET is_locked = 1 WHERE id = 1').run();
  assert.equal(revision(db), before + 1);
});

test('atomic assertion accepts the exact revision and rejects a stale one', () => {
  const db = databaseFixture();
  const current = revision(db);
  db.prepare('INSERT INTO timetable_revision_assertions (token, school_id, academic_year_id, expected_revision) VALUES (?,?,?,?)').run('fresh', 1, 1, current);
  assert.throws(() => db.prepare('INSERT INTO timetable_revision_assertions (token, school_id, academic_year_id, expected_revision) VALUES (?,?,?,?)').run('stale', 1, 1, current - 1), /stale_timetable_proposal/);
});

test('revision assertion rejects cross-school academic years', () => {
  const db = databaseFixture();
  assert.throws(() => db.prepare('INSERT INTO timetable_revision_assertions (token, school_id, academic_year_id, expected_revision) VALUES (?,1,2,0)').run('cross'), /school mismatch/);
});

function insertVersion(db) {
  return Number(db.prepare("INSERT INTO timetable_schedule_versions (version_key, school_id, academic_year_id, source, previous_revision, created_by_user_id, old_entry_count, new_entry_count, locked_entry_count, proposal_digest) VALUES ('v1',1,1,'automatic_adoption',0,1,1,1,0,'digest')").run().lastInsertRowid);
}

test('schedule version metadata is immutable', () => {
  const db = databaseFixture();
  const id = insertVersion(db);
  assert.throws(() => db.prepare('UPDATE timetable_schedule_versions SET old_entry_count = 2 WHERE id = ?').run(id), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM timetable_schedule_versions WHERE id = ?').run(id), /immutable/);
});

test('schedule version entries are immutable and scope checked', () => {
  const db = databaseFixture();
  const id = insertVersion(db);
  db.prepare('INSERT INTO timetable_schedule_version_entries (version_id, school_id, academic_year_id, slot_id, teaching_load_id, is_locked) VALUES (?,1,1,1,1,0)').run(id);
  assert.throws(() => db.prepare('UPDATE timetable_schedule_version_entries SET is_locked = 1 WHERE version_id = ?').run(id), /immutable/);
  assert.throws(() => db.prepare('INSERT INTO timetable_schedule_version_entries (version_id, school_id, academic_year_id, slot_id, teaching_load_id, is_locked) VALUES (?,2,2,5,3,0)').run(id), /scope mismatch/);
});

function lockedEntryDb() {
  const db = databaseFixture();
  db.prepare('INSERT INTO timetable_entries (id, school_id, academic_year_id, slot_id, teaching_load_id, is_locked) VALUES (1,1,1,1,1,1)').run();
  return db;
}

test('direct SQL cannot move a locked entry', () => {
  const db = lockedEntryDb();
  assert.throws(() => db.prepare('UPDATE timetable_entries SET slot_id = 2 WHERE id = 1').run(), /explicit unlock/);
  assert.equal(db.prepare('SELECT slot_id FROM timetable_entries WHERE id = 1').get().slot_id, 1);
});

test('direct SQL cannot delete a locked entry', () => {
  const db = lockedEntryDb();
  assert.throws(() => db.prepare('DELETE FROM timetable_entries WHERE id = 1').run(), /explicit unlock/);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM timetable_entries').get().count, 1);
});

test('direct SQL cannot silently unlock a locked entry', () => {
  const db = lockedEntryDb();
  assert.throws(() => db.prepare('UPDATE timetable_entries SET is_locked = 0 WHERE id = 1').run(), /explicit unlock/);
});

test('short-lived explicit override permits an intentional unlock', () => {
  const db = lockedEntryDb();
  db.exec('BEGIN IMMEDIATE');
  db.prepare("INSERT INTO timetable_locked_entry_overrides (token, entry_id, school_id, academic_year_id, action) VALUES ('ok',1,1,1,'unlock')").run();
  db.prepare('UPDATE timetable_entries SET is_locked = 0 WHERE id = 1').run();
  db.prepare("DELETE FROM timetable_locked_entry_overrides WHERE token = 'ok'").run();
  db.exec('COMMIT');
  assert.equal(db.prepare('SELECT is_locked FROM timetable_entries WHERE id = 1').get().is_locked, 0);
});

test('schedule comparison matches unchanged equivalent weekly lessons first', () => {
  const comparison = compareTimetableSchedules([{ slot_id: 2, teaching_load_id: 1, is_locked: 0 }, { slot_id: 1, teaching_load_id: 1, is_locked: 1 }], [{ slot_id: 1, teaching_load_id: 1, is_locked: 1 }, { slot_id: 2, teaching_load_id: 1, is_locked: 0 }]);
  assert.deepEqual({ unchanged: comparison.unchanged, moved: comparison.moved, locked: comparison.locked_preserved }, { unchanged: 2, moved: 0, locked: 1 });
});

test('schedule comparison classifies remaining same-load occurrences as moved', () => {
  const comparison = compareTimetableSchedules([{ slot_id: 1, teaching_load_id: 1, is_locked: 0 }], [{ slot_id: 3, teaching_load_id: 1, is_locked: 0 }]);
  assert.deepEqual({ moved: comparison.moved, added: comparison.added, removed: comparison.removed }, { moved: 1, added: 0, removed: 0 });
});

test('schedule comparison classifies unmatched loads as additions and removals', () => {
  const comparison = compareTimetableSchedules([{ slot_id: 1, teaching_load_id: 1, is_locked: 0 }], [{ slot_id: 2, teaching_load_id: 2, is_locked: 0 }]);
  assert.deepEqual({ moved: comparison.moved, added: comparison.added, removed: comparison.removed }, { moved: 0, added: 1, removed: 1 });
});

test('proposal canonicalization is numeric and deterministic', () => {
  const entries = canonicalTimetableProposalEntries([{ slot_id: 4, teaching_load_id: 2, is_locked: 0 }, { slot_id: 1, teaching_load_id: 1, is_locked: 1 }]);
  assert.deepEqual(entries.map((entry) => [entry.teaching_load_id, entry.slot_id]), [[1, 1], [2, 4]]);
});

test('proposal digest is deterministic across input ordering', async () => {
  const one = await computeTimetableProposalDigest({ schoolId: 1, academicYearId: 1, revision: 9, entries: [{ slot_id: 4, teaching_load_id: 2, is_locked: 0 }, { slot_id: 1, teaching_load_id: 1, is_locked: 1 }] });
  const two = await computeTimetableProposalDigest({ schoolId: 1, academicYearId: 1, revision: 9, entries: [{ slot_id: 1, teaching_load_id: 1, is_locked: 1 }, { slot_id: 4, teaching_load_id: 2, is_locked: 0 }] });
  assert.equal(one, two);
  assert.match(one, /^[a-f0-9]{64}$/);
});

test('proposal digest binds school, year, revision, placement and lock state', async () => {
  const base = { schoolId: 1, academicYearId: 1, revision: 9, entries: [{ slot_id: 1, teaching_load_id: 1, is_locked: 0 }] };
  const values = await Promise.all([
    computeTimetableProposalDigest(base),
    computeTimetableProposalDigest({ ...base, schoolId: 2 }),
    computeTimetableProposalDigest({ ...base, academicYearId: 2 }),
    computeTimetableProposalDigest({ ...base, revision: 10 }),
    computeTimetableProposalDigest({ ...base, entries: [{ ...base.entries[0], is_locked: 1 }] }),
  ]);
  assert.equal(new Set(values).size, values.length);
  assert.match(timetableProposalDigestSource(base), /"revision":9/);
});

test('complete official schedule requires exact demand coverage', () => {
  const result = validateCompleteTimetableSchedule(validationContext(), [
    { slot_id: 1, teaching_load_id: 1, is_locked: 0 }, { slot_id: 3, teaching_load_id: 1, is_locked: 0 },
    { slot_id: 2, teaching_load_id: 2, is_locked: 0 }, { slot_id: 4, teaching_load_id: 2, is_locked: 0 },
  ]);
  assert.equal(result.complete, true);
  assert.equal(result.required_periods, 4);
});

test('partial proposal cannot become an official schedule', () => {
  const result = validateCompleteTimetableSchedule(validationContext(), [{ slot_id: 1, teaching_load_id: 1, is_locked: 0 }]);
  assert.equal(result.complete, false);
  assert.ok(result.blockers.some((item) => item.code === 'incomplete_weekly_demand'));
});

test('duplicate proposal pair is rejected', () => {
  const result = validateCompleteTimetableSchedule(validationContext(), [
    { slot_id: 1, teaching_load_id: 1, is_locked: 0 }, { slot_id: 1, teaching_load_id: 1, is_locked: 0 },
  ]);
  assert.equal(result.complete, false);
  assert.ok(result.blockers.some((item) => item.code === 'duplicate_proposal_entry'));
});

test('invalid active teaching load blocks adoption instead of reducing demand silently', () => {
  const context = validationContext({ loads: [load(1, { employee_status: 'archived' })] });
  const result = validateCompleteTimetableSchedule(context, []);
  assert.equal(result.complete, false);
  assert.ok(result.blockers.some((item) => item.code === 'invalid_teaching_load'));
});
