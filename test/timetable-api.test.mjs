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
      (3, 2, '2026-2027', '2026-09-01', '2027-06-30', 1),
      (4, 1, '2025-2026', '2025-09-01', '2026-06-30', 0);
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
  database.exec(migration('0024_teacher_timetable_constraints.sql'));
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

test('slot API preserves teacher availability until overrides are explicitly cleared', async () => {
  const fixture = await createApiFixture();
  await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/days/0', {
    school_id: 1, academic_year_id: 1, is_active: 1, order_index: 0,
  });
  const createResponse = await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/slots', {
    school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: 1,
    slot_type: 'lesson', lesson_number: 1, label: 'Lesson', start_time: '08:00', end_time: '08:40',
  });
  assert.equal(createResponse.status, 201);
  const slotId = (await createResponse.json()).data.id;
  const overrideResponse = await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/teacher-availability/${slotId}`, {
    school_id: 1, academic_year_id: 1, employee_id: 1, status: 'preferred',
  });
  assert.equal(overrideResponse.status, 200);

  const ordinaryEdits = [
    { label: 'Renamed lesson' },
    { start_time: '08:05', end_time: '08:45' },
    { is_active: 0 },
    { lesson_number: 2 },
  ];
  let lessonPayload = {
    school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: 1,
    slot_type: 'lesson', lesson_number: 1, label: 'Lesson', start_time: '08:00', end_time: '08:40', is_active: 1,
  };
  for (const changes of ordinaryEdits) {
    lessonPayload = { ...lessonPayload, ...changes };
    const response = await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/slots/${slotId}`, lessonPayload);
    assert.equal(response.status, 200, JSON.stringify(changes));
  }
  assert.equal(
    fixture.database.prepare('SELECT status FROM timetable_teacher_availability WHERE slot_id = ?').get(slotId).status,
    'preferred',
  );

  const breakPayload = { ...lessonPayload, slot_type: 'break', lesson_number: null };
  const blockedResponse = await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/slots/${slotId}`, breakPayload);
  assert.equal(blockedResponse.status, 400);
  assert.match((await blockedResponse.json()).error, /إعدادات توفر مدرسين.*امسح إعدادات التوفر أولًا/);
  const blockedYearMove = await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/slots/${slotId}`, {
    ...lessonPayload,
    academic_year_id: 2,
  });
  assert.equal(blockedYearMove.status, 400);
  assert.match((await blockedYearMove.json()).error, /إعدادات توفر مدرسين.*امسح إعدادات التوفر أولًا/);
  assert.equal(fixture.database.prepare('SELECT slot_type FROM timetable_slots WHERE id = ?').get(slotId).slot_type, 'lesson');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM timetable_teacher_availability WHERE slot_id = ?').get(slotId).count, 1);

  const clearResponse = await api(fixture, fixture.tokens.owner, 'DELETE', `/api/timetable/teacher-availability/${slotId}`, {
    school_id: 1, academic_year_id: 1, employee_id: 1,
  });
  assert.equal(clearResponse.status, 200);
  const retryResponse = await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/slots/${slotId}`, breakPayload);
  assert.equal(retryResponse.status, 200);
  assert.equal((await retryResponse.json()).data.slot_type, 'break');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM timetable_teacher_availability WHERE slot_id = ?').get().count, 0);
});

test('inactive future and historical academic years remain explicitly configurable and viewable', async () => {
  const fixture = await createApiFixture();
  for (const academicYearId of [2, 4]) {
    const saveResponse = await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/days/0', {
      school_id: 1, academic_year_id: academicYearId, is_active: 1, order_index: 0,
    });
    assert.equal(saveResponse.status, 200);
    const listResponse = await api(
      fixture,
      fixture.tokens.owner,
      'GET',
      `/api/timetable/days?school_id=1&academic_year_id=${academicYearId}`,
    );
    assert.equal(listResponse.status, 200);
    assert.equal((await listResponse.json()).data.length, 1);
  }
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

test('deleting a teacher preserves the academic load and readiness reports only the missing teacher', async () => {
  const fixture = await createApiFixture();
  await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/days/0', {
    school_id: 1, academic_year_id: 1, is_active: 1, order_index: 0,
  });
  await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/slots', {
    school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: 1,
    slot_type: 'lesson', lesson_number: 1, label: 'Lesson', start_time: '08:00', end_time: '08:40',
  });
  const loadResponse = await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/teaching-loads', {
    school_id: 1, academic_year_id: 1, class_id: 1, section_id: 1,
    subject_id: 1, employee_id: 1, weekly_periods: 1,
  });
  assert.equal(loadResponse.status, 201);
  fixture.database.prepare('DELETE FROM employees WHERE id = 1').run();
  assert.equal(fixture.database.prepare('SELECT employee_id FROM timetable_teaching_loads').get().employee_id, null);

  const readinessResponse = await api(fixture, fixture.tokens.owner, 'GET', '/api/timetable/readiness?school_id=1&academic_year_id=1');
  assert.equal(readinessResponse.status, 200);
  const summary = (await readinessResponse.json()).data;
  assert.equal(summary.total_required_periods, 1);
  assert.equal(summary.missing_teacher_count, 1);
  assert.equal(summary.invalid_reference_count, 0);
  assert.deepEqual(summary.placements[0].missing_subjects, []);
  assert.deepEqual(summary.teacher_workloads, []);
  assert.equal(summary.ready, false);
});

test('API enforces management RBAC, explicit admin targeting and tenant isolation', async () => {
  const fixture = await createApiFixture();
  const payload = { school_id: 1, academic_year_id: 1, is_active: 1, order_index: 0 };
  assert.equal((await api(fixture, fixture.tokens.teacher, 'PUT', '/api/timetable/days/0', payload)).status, 403);
  assert.equal((await api(fixture, fixture.tokens.admin, 'PUT', '/api/timetable/days/0', { ...payload, school_id: undefined })).status, 400);
  assert.equal((await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/days/0', { ...payload, school_id: 2 })).status, 403);
  assert.equal((await api(fixture, fixture.tokens.owner, 'GET', '/api/timetable/days?school_id=2&academic_year_id=3')).status, 403);
});

test('every timetable mutation rejects forged tenant schools and missing system-admin targets', async () => {
  const fixture = await createApiFixture();
  await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/days/0', {
    school_id: 1, academic_year_id: 1, is_active: 1, order_index: 0,
  });
  const slotResponse = await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/slots', {
    school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: 1,
    slot_type: 'lesson', lesson_number: 1, label: 'Lesson', start_time: '08:00', end_time: '08:40',
  });
  const slotId = (await slotResponse.json()).data.id;
  const loadResponse = await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/teaching-loads', {
    school_id: 1, academic_year_id: 1, class_id: 1, section_id: 1,
    subject_id: 1, employee_id: 1, weekly_periods: 1,
  });
  const loadId = (await loadResponse.json()).data.id;

  const foreignMutations = [
    ['PUT', '/api/timetable/days/1', { school_id: 2, academic_year_id: 3, is_active: 1, order_index: 1 }],
    ['POST', '/api/timetable/slots', { school_id: 2, academic_year_id: 3, day_of_week: 0, slot_index: 1, slot_type: 'lesson', lesson_number: 1, label: 'x', start_time: '08:00', end_time: '08:40' }],
    ['PUT', `/api/timetable/slots/${slotId}`, { school_id: 2, academic_year_id: 3, day_of_week: 0, slot_index: 1, slot_type: 'lesson', lesson_number: 1, label: 'x', start_time: '08:00', end_time: '08:40' }],
    ['DELETE', `/api/timetable/slots/${slotId}`, { school_id: 2, academic_year_id: 3 }],
    ['POST', '/api/timetable/teaching-loads', { school_id: 2, academic_year_id: 3, class_id: 2, section_id: 2, subject_id: 2, employee_id: 2, weekly_periods: 1 }],
    ['PUT', `/api/timetable/teaching-loads/${loadId}`, { school_id: 2, academic_year_id: 3, class_id: 2, section_id: 2, subject_id: 2, employee_id: 2, weekly_periods: 1 }],
    ['DELETE', `/api/timetable/teaching-loads/${loadId}`, { school_id: 2, academic_year_id: 3 }],
  ];
  for (const [method, path, body] of foreignMutations) {
    assert.equal((await api(fixture, fixture.tokens.owner, method, path, body)).status, 403, `${method} ${path}`);
    const withoutSchool = { ...body };
    delete withoutSchool.school_id;
    assert.equal((await api(fixture, fixture.tokens.admin, method, path, withoutSchool)).status, 400, `${method} ${path}`);
  }
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

test('teacher availability API supports default, override, clear, bulk-day and reset semantics', async () => {
  const fixture = await createApiFixture();
  for (const day of [0, 1]) {
    assert.equal((await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/days/${day}`, {
      school_id: 1, academic_year_id: 1, is_active: 1, order_index: day,
    })).status, 200);
  }
  const slotIds = [];
  for (const slot of [
    { day_of_week: 0, slot_index: 1, slot_type: 'lesson', lesson_number: 1, label: 'Sunday lesson', start_time: '08:00', end_time: '08:40' },
    { day_of_week: 0, slot_index: 2, slot_type: 'break', lesson_number: null, label: 'Break', start_time: '08:40', end_time: '09:00' },
    { day_of_week: 1, slot_index: 1, slot_type: 'lesson', lesson_number: 1, label: 'Monday lesson', start_time: '08:00', end_time: '08:40' },
  ]) {
    const response = await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/slots', {
      school_id: 1, academic_year_id: 1, ...slot,
    });
    assert.equal(response.status, 201);
    slotIds.push((await response.json()).data.id);
  }

  const initial = await api(fixture, fixture.tokens.owner, 'GET', '/api/timetable/teacher-availability?school_id=1&academic_year_id=1&employee_id=1');
  assert.equal(initial.status, 200);
  assert.equal((await initial.json()).data.summary.effective_available_slots, 2, 'missing rows are available');

  const preferred = await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/teacher-availability/${slotIds[0]}`, {
    school_id: 1, academic_year_id: 1, employee_id: 1, status: 'preferred',
  });
  assert.equal(preferred.status, 200);
  assert.equal((await preferred.json()).data.status, 'preferred');
  const clear = await api(fixture, fixture.tokens.owner, 'DELETE', `/api/timetable/teacher-availability/${slotIds[0]}`, {
    school_id: 1, academic_year_id: 1, employee_id: 1,
  });
  assert.equal(clear.status, 200);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM timetable_teacher_availability').get().count, 0);

  const bulk = await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/teacher-availability/day/0', {
    school_id: 1, academic_year_id: 1, employee_id: 1, status: 'unavailable',
  });
  assert.equal(bulk.status, 200);
  const overrides = fixture.database.prepare(`
    SELECT availability.slot_id, slot.slot_type, slot.day_of_week
    FROM timetable_teacher_availability availability
    JOIN timetable_slots slot ON slot.id = availability.slot_id
  `).all();
  assert.deepEqual(overrides.map((row) => ({ ...row })), [
    { slot_id: slotIds[0], slot_type: 'lesson', day_of_week: 0 },
  ]);

  const resetDay = await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/teacher-availability/day/0', {
    school_id: 1, academic_year_id: 1, employee_id: 1, status: null,
  });
  assert.equal(resetDay.status, 200);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM timetable_teacher_availability').get().count, 0);

  await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/teacher-availability/${slotIds[2]}`, {
    school_id: 1, academic_year_id: 1, employee_id: 1, status: 'avoid',
  });
  const resetAll = await api(fixture, fixture.tokens.owner, 'DELETE', '/api/timetable/teacher-availability', {
    school_id: 1, academic_year_id: 1, employee_id: 1,
  });
  assert.equal(resetAll.status, 200);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM timetable_teacher_availability').get().count, 0);
});

test('teacher constraints and summary APIs persist nullable hard limits and soft preferences', async () => {
  const fixture = await createApiFixture();
  await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/days/0', {
    school_id: 1, academic_year_id: 1, is_active: 1, order_index: 0,
  });
  for (let slotIndex = 1; slotIndex <= 3; slotIndex += 1) {
    await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/slots', {
      school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: slotIndex,
      slot_type: 'lesson', lesson_number: slotIndex, label: `Lesson ${slotIndex}`,
      start_time: `0${7 + slotIndex}:00`, end_time: `0${7 + slotIndex}:40`,
    });
  }
  await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/teaching-loads', {
    school_id: 1, academic_year_id: 1, class_id: 1, section_id: 1,
    subject_id: 1, employee_id: 1, weekly_periods: 3,
  });
  const save = await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/teacher-constraints', {
    school_id: 1, academic_year_id: 1, employee_id: 1,
    max_periods_per_day: 2, max_consecutive_periods: 2, max_working_days: null,
    prefer_compact_schedule: 1, avoid_first_period: 1, avoid_last_period: 0,
  });
  assert.equal(save.status, 200);
  const saved = (await save.json()).data;
  assert.equal(saved.max_periods_per_day, 2);
  assert.equal(saved.prefer_compact_schedule, 1);
  const get = await api(fixture, fixture.tokens.owner, 'GET', '/api/timetable/teacher-constraints?school_id=1&academic_year_id=1&employee_id=1');
  assert.equal(get.status, 200);
  assert.equal((await get.json()).data.max_consecutive_periods, 2);
  const summaryResponse = await api(fixture, fixture.tokens.owner, 'GET', '/api/timetable/teacher-availability-summary?school_id=1&academic_year_id=1&employee_id=1');
  assert.equal(summaryResponse.status, 200);
  const summary = (await summaryResponse.json()).data;
  assert.equal(summary.assigned_weekly_periods, 3);
  assert.equal(summary.hard_weekly_capacity, 2);
  assert.equal(summary.feasible, false);
  assert.equal(summary.blockers[0].code, 'teacher_load_exceeds_availability');
});

test('availability shortage blocks readiness without erasing demand while soft preferences do not block', async () => {
  const fixture = await createApiFixture();
  await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/days/0', {
    school_id: 1, academic_year_id: 1, is_active: 1, order_index: 0,
  });
  for (let slotIndex = 1; slotIndex <= 2; slotIndex += 1) {
    await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/slots', {
      school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: slotIndex,
      slot_type: 'lesson', lesson_number: slotIndex, label: `Lesson ${slotIndex}`,
      start_time: `0${7 + slotIndex}:00`, end_time: `0${7 + slotIndex}:40`,
    });
  }
  await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/teaching-loads', {
    school_id: 1, academic_year_id: 1, class_id: 1, section_id: 1,
    subject_id: 1, employee_id: 1, weekly_periods: 2,
  });
  const hard = await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/teacher-availability/day/0', {
    school_id: 1, academic_year_id: 1, employee_id: 1, status: 'unavailable',
  });
  assert.equal(hard.status, 200);
  const blockedResponse = await api(fixture, fixture.tokens.owner, 'GET', '/api/timetable/readiness?school_id=1&academic_year_id=1');
  const blocked = (await blockedResponse.json()).data;
  assert.equal(blocked.total_required_periods, 2);
  assert.equal(blocked.placements[0].required_periods, 2);
  assert.equal(blocked.teacher_feasibility_issues[0].code, 'teacher_no_available_slots');
  assert.equal(blocked.ready, false);

  const soft = await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/teacher-availability/day/0', {
    school_id: 1, academic_year_id: 1, employee_id: 1, status: 'preferred',
  });
  assert.equal(soft.status, 200);
  const readyResponse = await api(fixture, fixture.tokens.owner, 'GET', '/api/timetable/readiness?school_id=1&academic_year_id=1');
  const ready = (await readyResponse.json()).data;
  assert.equal(ready.teacher_feasibility_issues.length, 0);
  assert.equal(ready.ready, true);
});

test('availability APIs enforce RBAC, explicit admin school and cross-tenant/year references atomically', async () => {
  const fixture = await createApiFixture();
  for (const [schoolId, yearId] of [[1, 1], [1, 2], [2, 3]]) {
    await api(fixture, schoolId === 2 ? fixture.tokens.admin : fixture.tokens.owner, 'PUT', '/api/timetable/days/0', {
      school_id: schoolId, academic_year_id: yearId, is_active: 1, order_index: 0,
    });
  }
  const ownSlotResponse = await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/slots', {
    school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: 1,
    slot_type: 'lesson', lesson_number: 1, label: 'Own', start_time: '08:00', end_time: '08:40',
  });
  const ownSlotId = (await ownSlotResponse.json()).data.id;
  const futureSlotResponse = await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/slots', {
    school_id: 1, academic_year_id: 2, day_of_week: 0, slot_index: 1,
    slot_type: 'lesson', lesson_number: 1, label: 'Future', start_time: '08:00', end_time: '08:40',
  });
  const futureSlotId = (await futureSlotResponse.json()).data.id;
  const foreignSlotResponse = await api(fixture, fixture.tokens.admin, 'POST', '/api/timetable/slots', {
    school_id: 2, academic_year_id: 3, day_of_week: 0, slot_index: 1,
    slot_type: 'lesson', lesson_number: 1, label: 'Foreign', start_time: '08:00', end_time: '08:40',
  });
  const foreignSlotId = (await foreignSlotResponse.json()).data.id;
  const ownPayload = { school_id: 1, academic_year_id: 1, employee_id: 1, status: 'unavailable' };
  assert.equal((await api(fixture, fixture.tokens.teacher, 'PUT', `/api/timetable/teacher-availability/${ownSlotId}`, ownPayload)).status, 403);
  const adminMissingSchool = { ...ownPayload };
  delete adminMissingSchool.school_id;
  assert.equal((await api(fixture, fixture.tokens.admin, 'PUT', `/api/timetable/teacher-availability/${ownSlotId}`, adminMissingSchool)).status, 400);
  assert.equal((await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/teacher-availability/${ownSlotId}`, { ...ownPayload, school_id: 2, academic_year_id: 3, employee_id: 2 })).status, 403);
  assert.equal((await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/teacher-availability/${futureSlotId}`, ownPayload)).status, 400);
  assert.equal((await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/teacher-availability/${foreignSlotId}`, ownPayload)).status, 403);
  assert.equal((await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/teacher-availability/${ownSlotId}`, { ...ownPayload, employee_id: 2 })).status, 403);
  assert.equal((await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/teacher-availability/${ownSlotId}`, { ...ownPayload, employee_id: 3 })).status, 400);
  assert.equal((await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/teacher-availability/${ownSlotId}`, { ...ownPayload, employee_id: 5 })).status, 400);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM timetable_teacher_availability').get().count, 0, 'failed writes remain atomic');
  assert.equal((await api(fixture, fixture.tokens.owner, 'GET', '/api/timetable/teacher-availability?school_id=2&academic_year_id=3&employee_id=2')).status, 403);
});

test('stored teacher configuration remains readable and clearable after teacher archival', async () => {
  const fixture = await createApiFixture();
  await api(fixture, fixture.tokens.owner, 'PUT', '/api/timetable/days/0', {
    school_id: 1, academic_year_id: 1, is_active: 1, order_index: 0,
  });
  const slotResponse = await api(fixture, fixture.tokens.owner, 'POST', '/api/timetable/slots', {
    school_id: 1, academic_year_id: 1, day_of_week: 0, slot_index: 1,
    slot_type: 'lesson', lesson_number: 1, label: 'Lesson', start_time: '08:00', end_time: '08:40',
  });
  const slotId = (await slotResponse.json()).data.id;
  assert.equal((await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/teacher-availability/${slotId}`, {
    school_id: 1, academic_year_id: 1, employee_id: 1, status: 'avoid',
  })).status, 200);
  fixture.database.prepare("UPDATE employees SET status = 'archived' WHERE id = 1").run();
  assert.equal((await api(fixture, fixture.tokens.owner, 'GET', '/api/timetable/teacher-availability?school_id=1&academic_year_id=1&employee_id=1')).status, 200);
  assert.equal((await api(fixture, fixture.tokens.owner, 'PUT', `/api/timetable/teacher-availability/${slotId}`, {
    school_id: 1, academic_year_id: 1, employee_id: 1, status: 'preferred',
  })).status, 400);
  assert.equal((await api(fixture, fixture.tokens.owner, 'DELETE', '/api/timetable/teacher-availability', {
    school_id: 1, academic_year_id: 1, employee_id: 1,
  })).status, 200);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM timetable_teacher_availability').get().count, 0);
});
