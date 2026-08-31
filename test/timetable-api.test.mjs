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
const secret = 'timetable-test-secret-with-adequate-entropy-18a1';
const vite = await createServer({ root: rootDir, appType: 'custom', server: { middlewareMode: true } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(async () => vite.close());

class LocalStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }
  bind(...values) { return new LocalStatement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values), success: true, meta: {} }; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
  }
}

class LocalD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new LocalStatement(this.database, sql); }
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

async function createApiFixture() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(migration('0001_initial_schema.sql'));
  database.exec(migration('0002_phase2_academic_tables.sql'));
  database.exec(migration('0010_employees.sql'));
  database.exec(migration('0016_auth_security.sql'));
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
      (2, 2, 'Class B', 'ابتدائي', 1, 'active');
    INSERT INTO sections (id, school_id, class_id, name, status) VALUES
      (1, 1, 1, 'A', 'active'),
      (2, 2, 2, 'B', 'active');
    INSERT INTO subjects (id, school_id, class_id, section_id, name, status) VALUES
      (1, 1, 1, NULL, 'Math', 'active'),
      (2, 2, 2, NULL, 'Math B', 'active');
    INSERT INTO employees (id, school_id, full_name, role, status) VALUES
      (1, 1, 'Teacher A', 'teacher', 'active'),
      (2, 2, 'Teacher B', 'teacher', 'active'),
      (3, 1, 'Accountant A', 'accountant', 'active'),
      (4, 1, 'Staff A', 'staff', 'active'),
      (5, 1, 'Archived Teacher A', 'teacher', 'archived');
    INSERT INTO users (id, school_id, full_name, email, role_id, status, auth_version) VALUES
      (1, 1, 'Owner A', 'owner-a@example.test', 2, 'active', 1),
      (2, NULL, 'System Admin', 'admin@example.test', 1, 'active', 1),
      (3, 1, 'Teacher User', 'teacher@example.test', 5, 'active', 1);
  `);
  database.exec(migration('0023_timetable_foundation.sql'));
  const tokens = {
    owner: await signJWT({ email: 'owner-a@example.test', auth_version: 1 }, secret),
    admin: await signJWT({ email: 'admin@example.test', auth_version: 1 }, secret),
    teacher: await signJWT({ email: 'teacher@example.test', auth_version: 1 }, secret),
  };
  return { database, env: { DB: new LocalD1(database), JWT_SECRET: secret, APP_ENV: 'test' }, tokens };
}

async function api(fixture, token, method, path, body) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  return app.request(`http://localhost${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  }, fixture.env);
}

test('timetable day and slot API CRUD persists scoped records', async () => {
  const fixture = await createApiFixture();
  const dayResponse = await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/days/0', {
    school_id: 1, academic_year_id: 1, is_active: 1, order_index: 0,
  });
  assert.equal(dayResponse.status, 200);

  const createResponse = await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/slots', {
    school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: 1,
    slot_type: 'lesson', lesson_number: 1, label: 'First', start_time: '08:00', end_time: '08:40',
  });
  assert.equal(createResponse.status, 201);
  const slotId = (await createResponse.json()).data.id;

  const updateResponse = await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/slots/${slotId}`, {
    school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: 1,
    slot_type: 'lesson', lesson_number: 1, label: 'Updated', start_time: '08:00', end_time: '08:45',
  });
  assert.equal(updateResponse.status, 200);
  assert.equal((await updateResponse.json()).data.label, 'Updated');

  const listResponse = await api(fixture, fixture.tokens.owner, 'GET', '/api/timetable/slots?school_id=1&academic_year_id=1');
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).data.length, 1);

  const deleteResponse = await api(fixture, fixture.tokens.owner, 'DELETE', `/api/timetable/slots/${slotId}`, {
    school_id: 1, academic_year_id: 1,
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM timetable_slots').get().count, 0);
});

test('teaching-load API creates, edits and history-safely deactivates one canonical row', async () => {
  const fixture = await createApiFixture();
  const createResponse = await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/teaching-loads', {
    school_id: 1, academic_year_id: 1, class_id: 1, section_id: 1,
    subject_id: 1, employee_id: null, weekly_periods: 4,
  });
  assert.equal(createResponse.status, 201);
  const loadId = (await createResponse.json()).data.id;

  const updateResponse = await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/teaching-loads/${loadId}`, {
    school_id: 1, academic_year_id: 1, class_id: 1, section_id: 1,
    subject_id: 1, employee_id: 1, weekly_periods: 5,
  });
  assert.equal(updateResponse.status, 200);
  assert.equal((await updateResponse.json()).data.weekly_periods, 5);

  const duplicate = await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/teaching-loads', {
    school_id: 1, academic_year_id: 1, class_id: 1, section_id: 1,
    subject_id: 1, employee_id: 1, weekly_periods: 2,
  });
  assert.equal(duplicate.status, 409);

  const deactivateResponse = await api(fixture, fixture.tokens.owner, 'DELETE', `/api/timetable/teaching-loads/${loadId}`, {
    school_id: 1, academic_year_id: 1,
  });
  assert.equal(deactivateResponse.status, 200);
  assert.equal(fixture.database.prepare('SELECT status FROM timetable_teaching_loads WHERE id = ?').get(loadId).status, 'inactive');
});

test('teaching-load API uses the genuine employee role schema and rejects non-teachers', async () => {
  const fixture = await createApiFixture();
  const employeeColumns = fixture.database.prepare('PRAGMA table_info(employees)').all().map((column) => column.name);
  assert.ok(employeeColumns.includes('role'));
  assert.equal(employeeColumns.includes('employee_type'), false);

  const base = {
    school_id: 1, academic_year_id: 1, class_id: 1, section_id: 1,
    subject_id: 1, weekly_periods: 4,
  };
  for (const [employeeId, expectedStatus] of [[3, 400], [4, 400], [5, 400], [2, 403]]) {
    const response = await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/teaching-loads', {
      ...base, employee_id: employeeId,
    });
    assert.equal(response.status, expectedStatus, `employee ${employeeId}`);
  }

  const teacherResponse = await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/teaching-loads', {
    ...base, employee_id: 1,
  });
  assert.equal(teacherResponse.status, 201);

  const listResponse = await api(fixture, fixture.tokens.owner, 'GET', '/api/timetable/teaching-loads?school_id=1&academic_year_id=1');
  assert.equal(listResponse.status, 200);
  const [load] = (await listResponse.json()).data;
  assert.equal(load.employee_role, 'teacher');
  assert.equal(Object.hasOwn(load, 'employee_type'), false);

  const readinessResponse = await api(fixture, fixture.tokens.owner, 'GET', '/api/timetable/readiness?school_id=1&academic_year_id=1');
  assert.equal(readinessResponse.status, 200);
  assert.equal((await readinessResponse.json()).data.invalid_reference_count, 0);
});

test('API enforces management RBAC, explicit admin targeting and tenant isolation', async () => {
  const fixture = await createApiFixture();
  const payload = { school_id: 1, academic_year_id: 1, is_active: 1, order_index: 0 };
  assert.equal((await api(fixture, fixture.tokens.teacher, 'PUT', '/api/timetable/days/0', payload)).status, 403);
  assert.equal((await api(fixture, fixture.tokens.admin, 'PUT', '/api/timetable/days/0', { ...payload, school_id: undefined })).status, 400);
  assert.equal((await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/days/0', { ...payload, school_id: 2 })).status, 403);
  assert.equal((await api(fixture, fixture.tokens.owner, 'GET', '/api/timetable/days?school_id=2&academic_year_id=3')).status, 403);
});

test('forged year, class, section, subject and employee IDs are rejected by API authority', async () => {
  const fixture = await createApiFixture();
  const base = {
    school_id: 1, academic_year_id: 1, class_id: 1, section_id: 1,
    subject_id: 1, employee_id: 1, weekly_periods: 4,
  };
  for (const payload of [
    { ...base, academic_year_id: 3 },
    { ...base, class_id: 2 },
    { ...base, section_id: 2 },
    { ...base, subject_id: 2 },
    { ...base, employee_id: 2 },
  ]) {
    const response = await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/teaching-loads', payload);
    assert.equal(response.status, 403);
  }
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM timetable_teaching_loads').get().count, 0);
});

test('readiness API counts lessons, excludes breaks and aggregates teacher assignments', async () => {
  const fixture = await createApiFixture();
  await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/days/0', {
    school_id: 1, academic_year_id: 1, is_active: 1, order_index: 0,
  });
  await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/slots', {
    school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: 1,
    slot_type: 'lesson', lesson_number: 1, label: 'Lesson', start_time: '08:00', end_time: '08:40',
  });
  await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/slots', {
    school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: 2,
    slot_type: 'break', lesson_number: null, label: 'Break', start_time: '08:40', end_time: '09:00',
  });
  await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/teaching-loads', {
    school_id: 1, academic_year_id: 1, class_id: 1, section_id: 1,
    subject_id: 1, employee_id: 1, weekly_periods: 1,
  });
  const response = await api(fixture, fixture.tokens.owner, 'GET', '/api/timetable/readiness?school_id=1&academic_year_id=1');
  assert.equal(response.status, 200);
  const summary = (await response.json()).data;
  assert.equal(summary.weekly_capacity, 1);
  assert.equal(summary.break_slots, 1);
  assert.deepEqual(summary.teacher_workloads, [{ employee_id: 1, employee_name: 'Teacher A', total_weekly_periods: 1, assignment_count: 1 }]);
});
