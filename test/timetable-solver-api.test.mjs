import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(testDir, '..');
const migration = (name) => readFileSync(join(rootDir, 'migrations', name), 'utf8');
const secret = 'timetable-solver-api-secret-with-adequate-entropy-18a5';
const vite = await createServer({ root: rootDir, appType: 'custom', server: { middlewareMode: true } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(async () => vite.close());

class LocalStatement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new LocalStatement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values), success: true, meta: {} }; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
  }
}

class LocalD1 {
  constructor(database) { this.database = database; this.prepareCount = 0; this.sqlLog = []; }
  prepare(sql) { this.prepareCount += 1; this.sqlLog.push(sql); return new LocalStatement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

async function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  for (const name of [
    '0001_initial_schema.sql', '0002_phase2_academic_tables.sql', '0010_employees.sql',
    '0016_auth_security.sql', '0023_timetable_foundation.sql',
    '0024_teacher_timetable_constraints.sql', '0025_timetable_entries.sql',
  ]) database.exec(migration(name));
  database.exec(`
    INSERT INTO schools (id, name, school_type, city, status) VALUES
      (1, 'School A', 'خاص', 'Duhok', 'active'),
      (2, 'School B', 'خاص', 'Duhok', 'active');
    INSERT INTO academic_years (id, school_id, name, starts_at, ends_at, is_active) VALUES
      (1, 1, '2026-2027', '2026-09-01', '2027-06-30', 1),
      (2, 2, '2026-2027', '2026-09-01', '2027-06-30', 1);
    INSERT INTO classes (id, school_id, name, stage, order_index, status) VALUES
      (1, 1, 'Class A', 'ابتدائي', 1, 'active'),
      (2, 1, 'Class B', 'ابتدائي', 2, 'active'),
      (3, 2, 'Other School Class', 'ابتدائي', 1, 'active');
    INSERT INTO subjects (id, school_id, class_id, section_id, name, status) VALUES
      (1, 1, 1, NULL, 'Math', 'active'),
      (2, 1, 2, NULL, 'Arabic', 'active'),
      (3, 2, 3, NULL, 'Science', 'active');
    INSERT INTO employees (id, school_id, full_name, role, status) VALUES
      (1, 1, 'Teacher A', 'teacher', 'active'),
      (2, 1, 'Teacher B', 'teacher', 'active'),
      (3, 2, 'Other Teacher', 'teacher', 'active');
    INSERT INTO users (id, school_id, full_name, email, role_id, status, auth_version) VALUES
      (1, 1, 'Owner A', 'owner@example.test', 2, 'active', 1),
      (2, NULL, 'System Admin', 'admin@example.test', 1, 'active', 1),
      (3, 1, 'Teacher User', 'teacher@example.test', 5, 'active', 1),
      (4, 1, 'Accountant User', 'accountant@example.test', 6, 'active', 1),
      (5, 1, 'Principal User', 'principal@example.test', 3, 'active', 1);
    INSERT INTO timetable_days (school_id, academic_year_id, day_of_week, is_active, order_index) VALUES
      (1, 1, 0, 1, 0), (1, 1, 1, 1, 1),
      (2, 2, 0, 1, 0);
    INSERT INTO timetable_slots
      (id, school_id, academic_year_id, day_of_week, slot_index, slot_type, lesson_number, label, start_time, end_time, is_active)
    VALUES
      (1, 1, 1, 0, 1, 'lesson', 1, 'First', '08:00', '08:40', 1),
      (2, 1, 1, 0, 2, 'lesson', 2, 'Second', '08:40', '09:20', 1),
      (3, 1, 1, 1, 1, 'lesson', 1, 'First', '08:00', '08:40', 1),
      (4, 1, 1, 1, 2, 'lesson', 2, 'Second', '08:40', '09:20', 1),
      (5, 2, 2, 0, 1, 'lesson', 1, 'First', '08:00', '08:40', 1);
    INSERT INTO timetable_teaching_loads
      (id, school_id, academic_year_id, class_id, section_id, subject_id, employee_id, weekly_periods, status)
    VALUES
      (1, 1, 1, 1, NULL, 1, 1, 2, 'active'),
      (2, 1, 1, 2, NULL, 2, 2, 2, 'active'),
      (3, 2, 2, 3, NULL, 3, 3, 1, 'active');
  `);
  const tokens = {
    owner: await signJWT({ email: 'owner@example.test', auth_version: 1 }, secret),
    admin: await signJWT({ email: 'admin@example.test', auth_version: 1 }, secret),
    teacher: await signJWT({ email: 'teacher@example.test', auth_version: 1 }, secret),
    accountant: await signJWT({ email: 'accountant@example.test', auth_version: 1 }, secret),
    principal: await signJWT({ email: 'principal@example.test', auth_version: 1 }, secret),
  };
  const d1 = new LocalD1(database);
  return { database, d1, env: { DB: d1, JWT_SECRET: secret, APP_ENV: 'test' }, tokens };
}

async function api(context, token, body) {
  return app.request('http://localhost/api/timetable/solver/preview', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, context.env);
}

function tableCounts(database) {
  return Object.fromEntries(['timetable_days', 'timetable_slots', 'timetable_teaching_loads', 'timetable_teacher_availability', 'timetable_teacher_constraints', 'timetable_entries']
    .map((table) => [table, Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));
}

test('solver preview endpoint returns a complete school proposal and performs no writes', async () => {
  const context = await fixture();
  const before = tableCounts(context.database);
  context.d1.prepareCount = 0;
  context.d1.sqlLog = [];
  const response = await api(context, context.tokens.owner, { school_id: 1, academic_year_id: 1 });
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.status, 'complete');
  assert.equal(data.required_periods, 4);
  assert.equal(data.scheduled_periods, 4);
  assert.deepEqual(tableCounts(context.database), before);
  assert.equal(context.d1.sqlLog.some((sql) => /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|REPLACE)\b/i.test(sql)), false);
  assert.equal(data.statistics.source_query_count, 9);
  assert.ok(context.d1.prepareCount <= 11, `expected bounded query count, got ${context.d1.prepareCount}`);
});

test('system admin requires an explicit active target school', async () => {
  const context = await fixture();
  const missing = await api(context, context.tokens.admin, { academic_year_id: 1 });
  assert.equal(missing.status, 400);
  const explicit = await api(context, context.tokens.admin, { school_id: 1, academic_year_id: 1 });
  assert.equal(explicit.status, 200);
  assert.equal((await explicit.json()).data.required_periods, 4);
});

test('tenant role is locked to its JWT school', async () => {
  const context = await fixture();
  const response = await api(context, context.tokens.owner, { school_id: 2, academic_year_id: 2 });
  assert.equal(response.status, 403);
});

test('teacher and accountant cannot generate a school-wide proposal', async () => {
  const context = await fixture();
  assert.equal((await api(context, context.tokens.teacher, { school_id: 1, academic_year_id: 1 })).status, 403);
  assert.equal((await api(context, context.tokens.accountant, { school_id: 1, academic_year_id: 1 })).status, 403);
});

test('principal retains existing academic timetable management access', async () => {
  const context = await fixture();
  assert.equal((await api(context, context.tokens.principal, { school_id: 1, academic_year_id: 1 })).status, 200);
});

test('academic year cannot cross the selected school scope', async () => {
  const context = await fixture();
  assert.equal((await api(context, context.tokens.admin, { school_id: 1, academic_year_id: 2 })).status, 403);
});

test('query count remains constant as teaching-load row count grows', async () => {
  const base = await fixture();
  base.d1.prepareCount = 0;
  assert.equal((await api(base, base.tokens.owner, { school_id: 1, academic_year_id: 1 })).status, 200);
  const baseCount = base.d1.prepareCount;

  const larger = await fixture();
  for (let id = 10; id < 20; id += 1) {
    larger.database.prepare("INSERT INTO classes (id, school_id, name, stage, order_index, status) VALUES (?, 1, ?, 'ابتدائي', ?, 'active')").run(id, `Class ${id}`, id);
    larger.database.prepare("INSERT INTO subjects (id, school_id, class_id, name, status) VALUES (?, 1, ?, ?, 'active')").run(id, id, `Subject ${id}`);
    larger.database.prepare("INSERT INTO timetable_teaching_loads (id, school_id, academic_year_id, class_id, subject_id, employee_id, weekly_periods, status) VALUES (?, 1, 1, ?, ?, NULL, 1, 'active')").run(id, id, id);
  }
  larger.d1.prepareCount = 0;
  assert.equal((await api(larger, larger.tokens.owner, { school_id: 1, academic_year_id: 1 })).status, 200);
  assert.equal(larger.d1.prepareCount, baseCount);
});

test('existing valid and later-invalid entries are reported separately without blocking proposal generation', async () => {
  const context = await fixture();
  context.database.prepare('INSERT INTO timetable_entries (school_id, academic_year_id, slot_id, teaching_load_id) VALUES (1, 1, 1, 1)').run();
  context.database.prepare('UPDATE timetable_slots SET is_active = 0 WHERE id = 1').run();
  const response = await api(context, context.tokens.owner, { school_id: 1, academic_year_id: 1 });
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.statistics.current_valid_entry_count, 0);
  assert.equal(data.statistics.existing_invalid_entry_count, 1);
  assert.ok(data.scheduled_periods > 0);
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 1);
});

test('invalid archived-teacher demand is exposed and never proposed', async () => {
  const context = await fixture();
  context.database.prepare("UPDATE employees SET status = 'archived' WHERE id = 1").run();
  const response = await api(context, context.tokens.owner, { school_id: 1, academic_year_id: 1 });
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data.status, 'impossible');
  assert.equal(data.readiness.invalid_load_count, 1);
  assert.equal(data.entries.some((entry) => entry.teaching_load_id === 1), false);
  assert.ok(data.unscheduled.some((item) => item.teaching_load_id === 1 && item.reason_codes.includes('invalid_teaching_load')));
});
