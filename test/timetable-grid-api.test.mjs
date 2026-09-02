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
      (5, 1, 'Accountant User', 'accountant@example.test', 6, 'active', 1),
      (6, 1, 'Principal User', 'principal@example.test', 3, 'active', 1),
      (7, 1, 'Vice Principal User', 'vice@example.test', 4, 'active', 1);
  `);
  const tokens = {
    owner: await signJWT({ email: 'owner@example.test', auth_version: 1 }, secret),
    admin: await signJWT({ email: 'admin@example.test', auth_version: 1 }, secret),
    teacher: await signJWT({ email: 'teacher@example.test', auth_version: 1 }, secret),
    registrar: await signJWT({ email: 'registrar@example.test', auth_version: 1 }, secret),
    accountant: await signJWT({ email: 'accountant@example.test', auth_version: 1 }, secret),
    principal: await signJWT({ email: 'principal@example.test', auth_version: 1 }, secret),
    vice: await signJWT({ email: 'vice@example.test', auth_version: 1 }, secret),
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
      (5, 1, 1, 1, 1, 'lesson', 1, 'Monday Opening', '07:50', '08:30', 1),
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
  assert.deepEqual(data.historical_entries, []);
  assert.deepEqual(data.loads.map((row) => row.id), [1, 2]);
  assert.deepEqual(
    data.slots.filter((row) => row.slot_index === 1).map((row) => [row.day_of_week, row.label, row.start_time, row.end_time]),
    [[0, 'First', '08:00', '08:40'], [1, 'Monday Opening', '07:50', '08:30']],
  );
});

test('grid loading uses a bounded constant number of D1 queries', async () => {
  const context = await fixture(); setup(context);
  assert.equal((await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody())).status, 201);
  context.database.prepare('UPDATE timetable_slots SET is_active = 0 WHERE id = 1').run();
  context.d1.prepareCount = 0;
  const response = await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1');
  assert.equal(response.status, 200);
  assert.ok(context.d1.prepareCount <= 14, `query count: ${context.d1.prepareCount}`);
  assert.equal((await response.json()).data.historical_entries.length, 1);
});

test('grid and readiness query counts stay exactly constant as scheduling rows grow', async () => {
  async function counts(large) {
    const context = await fixture(); setup(context);
    if (large) {
      const insertClass = context.database.prepare(`INSERT INTO classes
        (id, school_id, name, stage, order_index, status) VALUES (?,1,?,'ابتدائي',?,'active')`);
      const insertSection = context.database.prepare(`INSERT INTO sections
        (id, school_id, class_id, name, status) VALUES (?,1,?,?,'active')`);
      const insertSubject = context.database.prepare(`INSERT INTO subjects
        (id, school_id, class_id, section_id, name, status) VALUES (?,1,?,NULL,?,'active')`);
      const insertEmployee = context.database.prepare(`INSERT INTO employees
        (id, school_id, full_name, role, status) VALUES (?,1,?,'teacher','active')`);
      const insertLoad = context.database.prepare(`INSERT INTO timetable_teaching_loads
        (id, school_id, academic_year_id, class_id, section_id, subject_id, employee_id, weekly_periods, status)
        VALUES (?,1,1,?,?,?,?,1,'active')`);
      const insertEntry = context.database.prepare(`INSERT INTO timetable_entries
        (school_id, academic_year_id, slot_id, teaching_load_id) VALUES (1,1,1,?)`);
      for (let offset = 0; offset < 24; offset += 1) {
        const id = 100 + offset;
        insertClass.run(id, `Class ${id}`, id);
        insertSection.run(id, id, `Section ${id}`);
        insertSubject.run(id, id, `Subject ${id}`);
        insertEmployee.run(id, `Teacher ${id}`);
        insertLoad.run(id, id, id, id, id);
        insertEntry.run(id);
      }
    }
    context.d1.prepareCount = 0;
    assert.equal((await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1')).status, 200);
    const grid = context.d1.prepareCount;
    context.d1.prepareCount = 0;
    assert.equal((await api(context, context.tokens.owner, 'GET', '/api/timetable/readiness?school_id=1&academic_year_id=1')).status, 200);
    return { grid, readiness: context.d1.prepareCount };
  }
  const small = await counts(false);
  const large = await counts(true);
  assert.deepEqual(small, { grid: 12, readiness: 11 });
  assert.deepEqual(large, small);
});

test('disabled-slot entries stay visible for repair, reject new placement, and support move or delete', async () => {
  const context = await fixture(); setup(context);
  context.database.prepare('UPDATE timetable_teaching_loads SET weekly_periods = 1 WHERE id = 1').run();
  const createdResponse = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 1 }));
  assert.equal(createdResponse.status, 201);
  const entryId = (await createdResponse.json()).data.id;
  context.database.prepare('UPDATE timetable_slots SET is_active = 0 WHERE id = 1').run();

  let response = await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1');
  let data = (await response.json()).data;
  assert.equal(data.entries.some((entry) => entry.id === entryId), false);
  const historical = data.historical_entries.find((entry) => entry.id === entryId);
  assert.equal(historical.slot.label, 'First');
  assert.equal(historical.slot.start_time, '08:00');
  assert.ok(historical.hard_conflicts.some((conflict) => conflict.code === 'inactive_slot'));
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries WHERE id = ?').get(entryId).count, 1);

  response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 1 }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'inactive_slot');

  response = await api(context, context.tokens.owner, 'PUT', `/api/timetable/entries/${entryId}`, {
    school_id: 1, academic_year_id: 1, slot_id: 2,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.id, entryId);
  assert.equal(context.database.prepare('SELECT slot_id FROM timetable_entries WHERE id = ?').get(entryId).slot_id, 2);
  data = (await (await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1')).json()).data;
  assert.equal(data.historical_entries.length, 0);
  assert.ok(data.entries.some((entry) => entry.id === entryId));
  const repairedLoad = data.loads.find((load) => load.id === 1);
  assert.equal(repairedLoad.total_placements, 1);
  assert.equal(repairedLoad.scheduled_periods, 1);
  assert.equal(repairedLoad.invalid_placements, 0);
  assert.equal(repairedLoad.remaining_periods, 0);
  response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 4 }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'weekly_periods_exceeded');

  const deleteContext = await fixture(); setup(deleteContext);
  const deleteCreated = await api(deleteContext, deleteContext.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 1 }));
  const deleteEntryId = (await deleteCreated.json()).data.id;
  deleteContext.database.prepare('UPDATE timetable_slots SET is_active = 0 WHERE id = 1').run();
  response = await api(deleteContext, deleteContext.tokens.owner, 'DELETE', `/api/timetable/entries/${deleteEntryId}`, {
    school_id: 1, academic_year_id: 1,
  });
  assert.equal(response.status, 200);
  assert.equal(deleteContext.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries WHERE id = ?').get(deleteEntryId).count, 0);
});

test('disabled-day entries stay visible with inactive_day and can move only to an active day', async () => {
  const context = await fixture(); setup(context);
  const createdResponse = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 1 }));
  const entryId = (await createdResponse.json()).data.id;
  context.database.prepare('UPDATE timetable_days SET is_active = 0 WHERE school_id = 1 AND academic_year_id = 1 AND day_of_week = 0').run();

  let response = await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1');
  let data = (await response.json()).data;
  const historical = data.historical_entries.find((entry) => entry.id === entryId);
  assert.equal(historical.slot.day_of_week, 0);
  assert.ok(historical.hard_conflicts.some((conflict) => conflict.code === 'inactive_day'));
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries WHERE id = ?').get(entryId).count, 1);

  response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 2 }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'inactive_day');

  response = await api(context, context.tokens.owner, 'PUT', `/api/timetable/entries/${entryId}`, {
    school_id: 1, academic_year_id: 1, slot_id: 5,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.id, entryId);
  assert.equal(context.database.prepare('SELECT slot_id FROM timetable_entries WHERE id = ?').get(entryId).slot_id, 5);
  data = (await (await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1')).json()).data;
  assert.equal(data.historical_entries.length, 0);
  assert.ok(data.entries.some((entry) => entry.id === entryId));
});

test('readiness and grid progress exclude an inactive historical placement from valid scheduling', async () => {
  const context = await fixture(); setup(context);
  assert.equal((await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 1 }))).status, 201);
  const before = (await (await api(context, context.tokens.owner, 'GET', '/api/timetable/readiness?school_id=1&academic_year_id=1')).json()).data;
  context.database.prepare('UPDATE timetable_slots SET is_active = 0 WHERE id = 1').run();
  const after = (await (await api(context, context.tokens.owner, 'GET', '/api/timetable/readiness?school_id=1&academic_year_id=1')).json()).data;
  assert.equal(after.total_required_periods, before.total_required_periods);
  assert.equal(after.total_scheduled_periods, before.total_scheduled_periods - 1);
  assert.equal(after.total_unscheduled_periods, before.total_unscheduled_periods + 1);
  assert.equal(after.schedule_ready, false);
  assert.ok(after.entry_issues.some((issue) => issue.hard_conflicts.some((conflict) => conflict.code === 'inactive_slot')));

  const grid = (await (await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1')).json()).data;
  const load = grid.loads.find((item) => item.id === 1);
  assert.equal(load.total_placements, 1);
  assert.equal(load.scheduled_periods, 0);
  assert.equal(load.invalid_placements, 1);
  assert.equal(load.remaining_periods, load.weekly_periods);
});

test('historical entries remain strictly scoped to their own tenant and academic year', async () => {
  const context = await fixture(); setup(context);
  context.database.exec(`
    INSERT INTO timetable_days (school_id, academic_year_id, day_of_week, is_active, order_index) VALUES (2,2,0,1,0);
    INSERT INTO timetable_slots (id, school_id, academic_year_id, day_of_week, slot_index, slot_type, lesson_number, label, start_time, end_time, is_active)
      VALUES (20,2,2,0,1,'lesson',1,'Foreign','08:00','08:40',1);
    INSERT INTO timetable_teaching_loads (id, school_id, academic_year_id, class_id, section_id, subject_id, employee_id, weekly_periods, status)
      VALUES (20,2,2,3,4,4,3,1,'active');
    INSERT INTO timetable_entries (id, school_id, academic_year_id, slot_id, teaching_load_id)
      VALUES (20,2,2,20,20);
    UPDATE timetable_slots SET is_active = 0 WHERE id = 20;
  `);

  const schoolOne = (await (await api(context, context.tokens.admin, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1')).json()).data;
  assert.equal(schoolOne.historical_entries.some((entry) => entry.id === 20), false);
  const schoolTwoResponse = await api(context, context.tokens.admin, 'GET', '/api/timetable/grid?school_id=2&academic_year_id=2&class_id=3&section_id=4');
  assert.equal(schoolTwoResponse.status, 200);
  const schoolTwo = (await schoolTwoResponse.json()).data;
  assert.deepEqual(schoolTwo.historical_entries.map((entry) => entry.id), [20]);
  assert.ok(schoolTwo.historical_entries[0].hard_conflicts.some((conflict) => conflict.code === 'inactive_slot'));
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

test('principal and vice principal retain timetable management access', async () => {
  for (const role of ['principal', 'vice']) {
    const context = await fixture(); setup(context);
    const response = await api(context, context.tokens[role], 'POST', '/api/timetable/entries', createBody());
    assert.equal(response.status, 201, role);
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

test('inactive preferred slots and days stay stored but do not define the current preferred window', async () => {
  for (const inactiveParent of ['slot', 'day']) {
    const context = await fixture(); setup(context);
    const preferredSlotId = inactiveParent === 'slot' ? 2 : 5;
    context.database.prepare(`INSERT INTO timetable_teacher_availability
      (school_id, academic_year_id, employee_id, slot_id, status) VALUES (1,1,1,?,'preferred')`).run(preferredSlotId);
    if (inactiveParent === 'slot') {
      context.database.prepare('UPDATE timetable_slots SET is_active = 0 WHERE id = ?').run(preferredSlotId);
    } else {
      context.database.prepare('UPDATE timetable_days SET is_active = 0 WHERE school_id = 1 AND academic_year_id = 1 AND day_of_week = 1').run();
    }

    const response = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 1 }));
    assert.equal(response.status, 201, inactiveParent);
    const warnings = (await response.json()).meta.warnings;
    assert.equal(warnings.some((warning) => warning.code === 'outside_preferred_slots'), false, inactiveParent);
    assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_teacher_availability WHERE slot_id = ?').get(preferredSlotId).count, 1);
  }
});

test('grid returns hard conflicts for saved entries invalidated by later availability and keeps soft notices separate', async () => {
  const context = await fixture(); setup(context);
  const created = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 1 }));
  assert.equal(created.status, 201);
  context.database.exec(`
    INSERT INTO timetable_teacher_availability (school_id, academic_year_id, employee_id, slot_id, status)
      VALUES (1,1,1,1,'unavailable');
    INSERT INTO timetable_teacher_constraints (school_id, academic_year_id, employee_id, avoid_first_period)
      VALUES (1,1,1,1);
  `);

  const response = await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1');
  assert.equal(response.status, 200);
  const savedEntry = (await response.json()).data.entries[0];
  assert.ok(savedEntry.hard_conflicts.some((conflict) => conflict.code === 'teacher_unavailable'));
  assert.ok(savedEntry.warnings.some((warning) => warning.code === 'first_period_preference'));
  assert.equal(savedEntry.hard_conflicts.some((conflict) => conflict.code === 'first_period_preference'), false);
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 1);
});

test('grid returns invalid_teaching_load when a scheduled teacher is archived later', async () => {
  const context = await fixture(); setup(context);
  const created = await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 1 }));
  assert.equal(created.status, 201);
  context.database.prepare("UPDATE employees SET status = 'archived' WHERE id = 1").run();

  const response = await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1');
  assert.equal(response.status, 200);
  const savedEntry = (await response.json()).data.entries[0];
  assert.ok(savedEntry.hard_conflicts.some((conflict) => conflict.code === 'invalid_teaching_load'));
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 1);
});

test('inactive load with a saved entry remains visible as invalid demand in grid and readiness', async () => {
  const context = await fixture(); setup(context);
  assert.equal((await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 1 }))).status, 201);
  context.database.prepare("UPDATE timetable_teaching_loads SET status = 'inactive' WHERE id = 1").run();

  const gridResponse = await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1');
  assert.equal(gridResponse.status, 200);
  const grid = (await gridResponse.json()).data;
  const load = grid.loads.find((item) => item.id === 1);
  assert.equal(load.status, 'inactive');
  assert.equal(load.total_placements, 1);
  assert.equal(load.scheduled_periods, 0);
  assert.equal(load.invalid_placements, 1);
  assert.equal(load.remaining_periods, 4);
  assert.ok(grid.entries[0].hard_conflicts.some((item) => item.code === 'invalid_teaching_load'));

  const readinessResponse = await api(context, context.tokens.owner, 'GET', '/api/timetable/readiness?school_id=1&academic_year_id=1');
  assert.equal(readinessResponse.status, 200);
  const readiness = (await readinessResponse.json()).data;
  assert.equal(readiness.total_required_periods, 12);
  assert.equal(readiness.total_scheduled_periods, 0);
  assert.equal(readiness.total_unscheduled_periods, 12);
  assert.equal(readiness.invalid_reference_count, 1);
  assert.equal(readiness.load_progress.find((item) => item.teaching_load_id === 1).remaining_periods, 4);
  assert.ok(readiness.entry_issues[0].hard_conflicts.some((item) => item.code === 'invalid_teaching_load'));
  assert.equal(readiness.schedule_ready, false);
});

test('stale client assumptions are rejected by current server state without partial writes', async () => {
  const collision = await fixture(); setup(collision);
  assert.equal((await api(collision, collision.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1')).status, 200);
  assert.equal((await api(collision, collision.tokens.owner, 'POST', '/api/timetable/entries', createBody())).status, 201);
  const staleCollision = await api(collision, collision.tokens.owner, 'POST', '/api/timetable/entries', createBody({ teaching_load_id: 2 }));
  assert.equal(staleCollision.status, 409);
  assert.equal((await staleCollision.json()).code, 'class_section_collision');
  assert.equal(collision.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 1);

  const availability = await fixture(); setup(availability);
  assert.equal((await api(availability, availability.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1')).status, 200);
  availability.database.exec(`INSERT INTO timetable_teacher_availability
    (school_id, academic_year_id, employee_id, slot_id, status) VALUES (1,1,1,1,'unavailable')`);
  const staleAvailability = await api(availability, availability.tokens.owner, 'POST', '/api/timetable/entries', createBody());
  assert.equal(staleAvailability.status, 409);
  assert.equal((await staleAvailability.json()).code, 'teacher_unavailable');
  assert.equal(availability.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 0);

  const weekly = await fixture(); setup(weekly);
  weekly.database.prepare('UPDATE timetable_teaching_loads SET weekly_periods = 1 WHERE id = 1').run();
  assert.equal((await api(weekly, weekly.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1')).status, 200);
  assert.equal((await api(weekly, weekly.tokens.owner, 'POST', '/api/timetable/entries', createBody())).status, 201);
  const staleWeekly = await api(weekly, weekly.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 2 }));
  assert.equal(staleWeekly.status, 409);
  assert.equal((await staleWeekly.json()).code, 'weekly_periods_exceeded');
  assert.equal(weekly.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 1);
});

test('grid returns a later hard daily constraint violation for existing entries', async () => {
  const context = await fixture(); setup(context);
  assert.equal((await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 1, teaching_load_id: 1 }))).status, 201);
  assert.equal((await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 2, teaching_load_id: 4 }))).status, 201);
  context.database.exec(`INSERT INTO timetable_teacher_constraints
    (school_id, academic_year_id, employee_id, max_periods_per_day) VALUES (1,1,1,1)`);

  const response = await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1');
  assert.equal(response.status, 200);
  const savedEntry = (await response.json()).data.entries[0];
  assert.ok(savedEntry.hard_conflicts.some((conflict) => conflict.code === 'teacher_max_periods_per_day'));
  assert.equal(context.database.prepare('SELECT COUNT(*) AS count FROM timetable_entries').get().count, 2);
});

test('valid scheduled entries expose empty hard-conflict collections', async () => {
  const context = await fixture(); setup(context);
  assert.equal((await api(context, context.tokens.owner, 'POST', '/api/timetable/entries', createBody({ slot_id: 1 }))).status, 201);
  const response = await api(context, context.tokens.owner, 'GET', '/api/timetable/grid?school_id=1&academic_year_id=1&class_id=1&section_id=1');
  const savedEntry = (await response.json()).data.entries[0];
  assert.deepEqual(savedEntry.hard_conflicts, []);
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
