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
const secret = 'timetable-grid-test-secret-with-adequate-entropy-18a3';
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
  constructor(database) { this.database = database; this.prepareCount = 0; }
  prepare(sql) { this.prepareCount += 1; return new LocalStatement(this.database, sql); }
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
      (2, 1, 'Class C', 'ابتدائي', 2, 'active'),
      (3, 2, 'Class B', 'ابتدائي', 1, 'active');
    INSERT INTO sections (id, school_id, class_id, name, status) VALUES
      (1, 1, 1, 'A', 'active'),
      (2, 1, 1, 'B', 'active'),
      (3, 1, 2, 'C', 'active'),
      (4, 2, 3, 'B', 'active');
    INSERT INTO subjects (id, school_id, class_id, section_id, name, status) VALUES
      (1, 1, 1, NULL, 'Math', 'active'),
      (2, 1, 1, NULL, 'Arabic', 'active'),
      (3, 1, 2, NULL, 'History', 'active'),
      (4, 2, 3, NULL, 'Math B', 'active');
    INSERT INTO employees (id, school_id, full_name, role, status) VALUES
      (1, 1, 'Teacher A', 'teacher', 'active'),
      (2, 1, 'Teacher C', 'teacher', 'active'),
      (3, 2, 'Teacher B', 'teacher', 'active'),
      (4, 1, 'Archived Teacher', 'teacher', 'archived');
    INSERT INTO users (id, school_id, full_name, email, role_id, status, auth_version) VALUES
      (1, 1, 'Owner A', 'owner@example.test', 2, 'active', 1),
      (2, NULL, 'System Admin', 'admin@example.test', 1, 'active', 1),
      (3, 1, 'Teacher User', 'teacher@example.test', 5, 'active', 1),
      (4, 1, 'Registrar User', 'registrar@example.test', 7, 'active', 1),
      (5, 1, 'Accountant User', 'accountant@example.test', 6, 'active', 1);
  `);
  const tokens = {
    owner: await signJWT({ email: 'owner@example.test', auth_version: 1 }, secret),
    admin: await signJWT({ email: 'admin@example.test', auth_version: 1 }, secret),
    teacher: await signJWT({ email: 'teacher@example.test', auth_version: 1 }, secret),
    registrar: await signJWT({ email: 'registrar@example.test', auth_version: 1 }, secret),
    accountant: await signJWT({ email: 'accountant@example.test', auth_version: 1 }, secret),
  };
  const d1 = new LocalD1(database);
  return { database, d1, env: { DB: d1, JWT_SECRET: secret, APP_ENV: 'test' }, tokens };
}

async function api(context, token, method, path, body) {
  return app.request(`http://localhost${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  }, context.env);
}

function setup(context) {
  const db = context.database;
  db.exec(`
    INSERT INTO timetable_days (school_id, academic_year_id, day_of_week, is_active, order_index) VALUES
      (1, 1, 0, 1, 0), (1, 1, 1, 1, 1), (1, 1, 2, 0, 2);
    INSERT INTO timetable_slots
      (id, school_id, academic_year_id, day_of_week, slot_index, slot_type, lesson_number, label, start_time, end_time, is_active)
    VALUES
      (1, 1, 1, 0, 1, 'lesson', 1, 'First', '08:00', '08:40', 1),
      (2, 1, 1, 0, 2, 'lesson', 2, 'Second', '08:40', '09:20', 1),
      (3, 1, 1, 0, 3, 'break', NULL, 'Break', '09:20', '09:35', 1),
      (4, 1, 1, 0, 4, 'lesson', 3, 'Third', '09:35', '10:15', 1),
      (5, 1, 1, 1, 1, 'lesson', 1, 'First', '08:00', '08:40', 1),
      (6, 1, 1, 1, 2, 'lesson', 2, 'Second', '08:40', '09:20', 1),
      (7, 1, 1, 1, 3, 'lesson', 3, 'Disabled', '09:20', '10:00', 0),
      (8, 1, 1, 2, 1, 'lesson', 1, 'Inactive day', '08:00', '08:40', 1);
    INSERT INTO timetable_teaching_loads
      (id, school_id, academic_year_id, class_id, section_id, subject_id, employee_id, weekly_periods, status)
    VALUES
      (1, 1, 1, 1, 1, 1, 1, 4, 'active'),
      (2, 1, 1, 1, 1, 2, 2, 2, 'active'),
      (3, 1, 1, 1, 2, 1, 2, 2, 'active'),
      (4, 1, 1, 2, 3, 3, 1, 2, 'active'),
      (5, 1, 1, 1, 2, 2, NULL, 2, 'active');
  `);
}

const createBody = (overrides = {}) => ({ school_id: 1, academic_year_id: 1, slot_id: 1, teaching_load_id: 1, ...overrides });

test('grid API returns active days, active lessons, visible breaks and scoped loads', async () => {
  const context = await fixture(); setup(context);
  const response = await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1');
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.deepEqual(data.days.map((row) => row.day_of_week), [0, 1]);
  assert.ok(data.slots.some((row) => row.slot_type === 'break'));
  assert.equal(data.slots.some((row) => row.id === 7 || row.id === 8), false);
  assert.deepEqual(data.loads.map((row) => row.id), [1, 2]);
});

test('grid loading uses a bounded constant number of D1 queries', async () => {
  const context = await fixture(); setup(context);
  context.d1.prepareCount = 0;
  const response = await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1');
  assert.equal(response.status, 200);
  assert.ok(context.d1.prepareCount <= 14, `query count: ${context.d1.prepareCount}`);
});

test('owner and registrar can create a schedule entry and readiness reports progress', async () => {
  for (const role of ['owner', 'registrar']) {
    const context = await fixture(); setup(context);
    const response = await api(context, context.tokens[role], 'POST', '/api/timetable/entries', createBody());
    assert.equal(response.status, 201, role);
    const readiness = await api(context, context.tokens[role], 'GET', '/api/timetable/readiness?school_id=1&academic_year_id=1');
    assert.equal(readiness.status, 200);
    const data = (await readiness.json()).data;
    assert.equal(data.total_scheduled_periods, 1);
    assert.ok(data.total_unscheduled_periods > 0);
  }
});

test('teacher and accountant cannot create, move or delete schedule entries', async () => {
  for (const role of ['teacher', 'accountant']) {
    const context = await fixture(); setup(context);
    const entryId = Number(context.database.prepare(`INSERT INTO timetable_entries
      (school_id, academic_year_id, slot_id, teaching_load_id) VALUES (1,1,1,1) RETURNING id`).get().id);
    for (const [method, path, body] of [
      ['POST', '/api/timetable/entries', createBody({ slot_id: 2 })],
      ['PUT', `/api/timetable/entries/${entryId}`, { school_id: 1, academic_year_id: 1, slot_id: 2 }],
      ['DELETE', `/api/timetable/entries/${entryId}`, { school_id: 1, academic_year_id: 1 }],
    ]) assert.equal((await api(context, context.tokens[role], method, path, body)).status, 403, `${role} ${method}`);
  }
});

test('system admin must provide an explicit school for writes', async () => {
  const context = await fixture(); setup(context);
  const response = await api(context, context.tokens.admin, 'POST', '/api/timetable/entries', {
    academic_year_id: 1, slot_id: 1, teaching_load_id: 1,
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'invalid_tenant_scope');
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 0);
});

test('tenant-bound owner cannot target another school', async () => {
  const context = await fixture(); setup(context);
  const response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ school_id: 2 }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'invalid_tenant_scope');
});

test('cross-school and cross-year slot or load references are rejected', async () => {
  const context = await fixture(); setup(context);
  context.database.exec(`
    INSERT INTO timetable_days (school_id, academic_year_id, day_of_week, is_active, order_index) VALUES (2,2,0,1,0);
    INSERT INTO timetable_slots (id, school_id, academic_year_id, day_of_week, slot_index, slot_type, lesson_number, label, start_time, end_time, is_active)
      VALUES (20,2,2,0,1,'lesson',1,'Other','08:00','08:40',1);
    INSERT INTO timetable_teaching_loads (id, school_id, academic_year_id, class_id, section_id, subject_id, employee_id, weekly_periods, status)
      VALUES (20,2,2,3,4,4,3,2,'active');
  `);
  for (const body of [createBody({ slot_id: 20 }), createBody({ teaching_load_id: 20 })]) {
    const response = await api(context, context.tokens.admin, 'POST', '/api/timetable/entries', body);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'invalid_tenant_scope');
  }
});

test('break, disabled day, disabled slot and inactive load return distinct stable codes', async () => {
  const context = await fixture(); setup(context);
  for (const [body, code] of [
    [createBody({ slot_id: 3 }), 'slot_not_schedulable'],
    [createBody({ slot_id: 7 }), 'inactive_slot'],
    [createBody({ slot_id: 8 }), 'inactive_day'],
  ]) {
    const response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', body);
    assert.equal(response.status, 400, code);
    assert.equal((await response.json()).code, code);
  }
  context.database.prepare("UPDATE timetable_teaching_loads SET status = 'inactive' WHERE id = 1").run();
  const response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody());
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'invalid_teaching_load');
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 0);
});

test('same-school cross-year slot and load references return invalid_academic_year', async () => {
  const context = await fixture(); setup(context);
  context.database.exec(`
    INSERT INTO academic_years (id, school_id, name, starts_at, ends_at, is_active)
      VALUES (3,1,'2027-2028','2027-09-01','2028-06-30',0);
    INSERT INTO timetable_days (school_id, academic_year_id, day_of_week, is_active, order_index)
      VALUES (1,3,0,1,0);
    INSERT INTO timetable_slots (id, school_id, academic_year_id, day_of_week, slot_index, slot_type, lesson_number, label, start_time, end_time, is_active)
      VALUES (30,1,3,0,1,'lesson',1,'Future','08:00','08:40',1);
    INSERT INTO timetable_teaching_loads (id, school_id, academic_year_id, class_id, section_id, subject_id, employee_id, weekly_periods, status)
      VALUES (30,1,3,1,1,1,1,2,'active');
  `);
  for (const body of [createBody({ slot_id: 30 }), createBody({ teaching_load_id: 30 })]) {
    const response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'invalid_academic_year');
  }
});

test('group collision returns a stable code and preserves the first entry', async () => {
  const context = await fixture(); setup(context);
  assert.equal((await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody())).status, 201);
  const response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ teaching_load_id: 2 }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'class_section_collision');
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 1);
});

test('different sections schedule concurrently when group and teacher do not collide', async () => {
  const context = await fixture(); setup(context);
  assert.equal((await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody())).status, 201);
  const response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ teaching_load_id: 3 }));
  assert.equal(response.status, 201);
});

test('teacher collision returns a stable code across unrelated groups', async () => {
  const context = await fixture(); setup(context);
  await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody());
  const response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ teaching_load_id: 4 }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'teacher_collision');
});

test('missing teacher is visibly schedulable and retained in grid output', async () => {
  const context = await fixture(); setup(context);
  const response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ teaching_load_id: 5 }));
  assert.equal(response.status, 201);
  const grid = await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=2');
  const entry = (await grid.json()).data.entries[0];
  assert.equal(entry.employee_id, null);
  assert.equal(entry.employee_name, null);
});

test('weekly-period overrun and unavailable override return stable hard codes', async () => {
  const context = await fixture(); setup(context);
  context.database.prepare('UPDATE timetable_teaching_loads SET weekly_periods = 1 WHERE id = 1').run();
  await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody());
  let response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 2 }));
  assert.equal((await response.json()).code, 'weekly_periods_exceeded');
  context.database.exec(`INSERT INTO timetable_teacher_availability
    (school_id, academic_year_id, employee_id, slot_id, status) VALUES (1,1,2,2,'unavailable')`);
  response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 2, teaching_load_id: 2 }));
  assert.equal((await response.json()).code, 'teacher_unavailable');
});

test('daily, working-day and consecutive hard limits return stable codes', async () => {
  for (const [column, value, firstSlot, secondSlot, code] of [
    ['max_periods_per_day', 1, 1, 2, 'teacher_max_periods_per_day'],
    ['max_working_days', 1, 1, 5, 'teacher_max_working_days'],
    ['max_consecutive_periods', 1, 1, 2, 'teacher_max_consecutive_periods'],
  ]) {
    const context = await fixture(); setup(context);
    context.database.prepare(`INSERT INTO timetable_teacher_constraints
      (school_id, academic_year_id, employee_id, ${column}) VALUES (1,1,1,?)`).run(value);
    await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: firstSlot }));
    const response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: secondSlot }));
    assert.equal(response.status, 409, column);
    assert.equal((await response.json()).code, code, column);
  }
});

test('soft preference warnings are returned without blocking save', async () => {
  const context = await fixture(); setup(context);
  context.database.exec(`
    INSERT INTO timetable_teacher_availability (school_id, academic_year_id, employee_id, slot_id, status)
      VALUES (1,1,1,1,'preferred'), (1,1,1,2,'avoid');
    INSERT INTO timetable_teacher_constraints
      (school_id, academic_year_id, employee_id, avoid_first_period, prefer_compact_schedule)
      VALUES (1,1,1,1,1);
  `);
  const preferredResponse = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 1 }));
  assert.equal(preferredResponse.status, 201);
  assert.ok((await preferredResponse.json()).meta.warnings.some((warning) => warning.code === 'preferred_slot'));
  const response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 2 }));
  assert.equal(response.status, 201);
  const warnings = (await response.json()).meta.warnings;
  assert.ok(warnings.some((warning) => warning.code === 'avoid_slot'));
  assert.ok(warnings.some((warning) => warning.code === 'outside_preferred_slots'));
  const grid = await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1');
  const savedEntry = (await grid.json()).data.entries.find((entry) => entry.slot_id === 2);
  assert.ok(savedEntry.warnings.some((warning) => warning.code === 'avoid_slot'));
  assert.ok(savedEntry.warnings.some((warning) => warning.code === 'outside_preferred_slots'));
});

test('move revalidates target atomically and successful move keeps one row', async () => {
  const context = await fixture(); setup(context);
  const created = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody());
  const entryId = (await created.json()).data.id;
  const moved = await api(context, context.tokens.owner, 'PUT', `/api/timetable/entries/${entryId}`, {
    school_id: 1, academic_year_id: 1, slot_id: 2,
  });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).data.slot_id, 2);
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 1);
});

test('failed move keeps original placement unchanged', async () => {
  const context = await fixture(); setup(context);
  const first = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody());
  const firstId = (await first.json()).data.id;
  await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 2, teaching_load_id: 2 }));
  const response = await api(context, context.tokens.owner, 'PUT', `/api/timetable/entries/${firstId}`, {
    school_id: 1, academic_year_id: 1, slot_id: 2,
  });
  assert.equal(response.status, 409);
  assert.equal(context.database.prepare('SELECT slot_id FROM timetable_entries WHERE id = ?').get(firstId).slot_id, 1);
});

test('delete removes only the entry and leaves its canonical load and slot', async () => {
  const context = await fixture(); setup(context);
  const created = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody());
  const entryId = (await created.json()).data.id;
  const response = await api(context, context.tokens.owner, 'DELETE', `/api/timetable/entries/${entryId}`, {
    school_id: 1, academic_year_id: 1,
  });
  assert.equal(response.status, 200);
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 0);
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_teaching_loads WHERE id=1').get().count, 1);
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_slots WHERE id=1').get().count, 1);
});

test('parent edits cannot silently invalidate scheduled entries', async () => {
  const context = await fixture(); setup(context);
  await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody());
  const slotPayload = {
    school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: 1,
    slot_type: 'lesson', lesson_number: 1, label: 'Renamed', start_time: '08:00', end_time: '08:40', is_active: 1,
  };
  assert.equal((await api(context, context.tokens.owner, 'PUT', '/api/timetable/slots/1', slotPayload)).status, 200);
  assert.equal((await api(context, context.tokens.owner, 'PUT', '/api/timetable/slots/1', { ...slotPayload, start_time: '08:05' })).status, 400);
  assert.equal((await api(context, context.tokens.owner, 'DELETE', '/api/timetable/slots/1', { school_id: 1, academic_year_id: 1 })).status, 409);
  const loadResponse = await api(context, context.tokens.owner, 'PUT', '/api/timetable/teaching-loads/1', {
    school_id: 1, academic_year_id: 1, class_id: 1, section_id: 1,
    subject_id: 1, employee_id: 2, weekly_periods: 4,
  });
  assert.equal(loadResponse.status, 400);
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 1);
});
