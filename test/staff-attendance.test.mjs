import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';
import { verifyEmployeeAttendanceCardPayload } from '../src/lib/staffAttendance.ts';
import {
  LocalD1,
  fixtureSQL,
  migrationFiles,
  migrationSQL,
  root,
} from './helpers/teaching-load-matrix-fixture.mjs';

const vite = await createServer({ root, appType: 'custom', server: { middlewareMode: true, hmr: false } });
const { default: app } = await vite.ssrLoadModule('/src/worker.ts');
after(() => vite.close());

const secret = 'generated-local-staff-attendance-secret-only';
const identities = {
  owner: 'owner@matrix.test',
  admin: 'admin@matrix.test',
  teacher: 'teacher@matrix.test',
  principal: 'principal@matrix.test',
  registrar: 'registrar@matrix.test',
  accountant: 'accountant@matrix.test',
};
const tokens = Object.fromEntries(await Promise.all(Object.entries(identities).map(async ([key, email]) => [
  key,
  await signJWT({ email, auth_version: 1 }, secret),
])));

function createFixture(t) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  t.after(() => database.close());
  for (const file of migrationFiles) database.exec(migrationSQL(file));
  database.exec(fixtureSQL);
  database.exec(`
    UPDATE academic_years SET starts_at='2000-01-01', ends_at='2100-12-31' WHERE id IN (1,3);
    UPDATE employees SET employee_number='EMP-001', job_title='Physics Teacher', hire_date='2020-09-01' WHERE id=1;
    UPDATE employees SET employee_number='EMP-002', job_title='English Teacher', hire_date='2021-09-01' WHERE id=2;
    UPDATE employees SET employee_number='EMP-003', job_title='Accountant', hire_date='2022-09-01' WHERE id=3;
    UPDATE employees SET employee_number='EMP-007', job_title='Gate Staff', hire_date='2023-09-01' WHERE id=7;
    INSERT INTO teacher_employee_links(
      school_id, teacher_user_id, employee_id, status, created_by_user_id
    ) VALUES (1,3,1,'active',1);
  `);
  return { database, d1: new LocalD1(database) };
}

async function api(fixture, role, method, path, body) {
  const response = await app.request(`http://localhost${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens[role]}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: fixture.d1, JWT_SECRET: secret, APP_ENV: 'test' });
  return { status: response.status, body: await response.json() };
}

async function issue(fixture, employeeId = 1) {
  return api(fixture, 'owner', 'POST', '/api/staff-attendance/cards', {
    school_id: 1,
    employee_id: employeeId,
  });
}

test('staff settings and operations are management-scoped while accountants remain report-only', async t => {
  const fixture = createFixture(t);
  const defaults = await api(fixture, 'owner', 'GET', '/api/staff-attendance/settings?school_id=1');
  assert.equal(defaults.status, 200, JSON.stringify(defaults.body));
  assert.deepEqual(defaults.body.data, {
    school_id: 1,
    work_start_time: '08:00',
    late_grace_minutes: 10,
    work_end_time: '14:00',
    early_exit_grace_minutes: 0,
    duplicate_window_seconds: 60,
    updated_at: null,
  });

  assert.equal((await api(fixture, 'teacher', 'GET', '/api/staff-attendance/settings?school_id=1')).status, 403);
  assert.equal((await api(fixture, 'accountant', 'GET', '/api/staff-attendance/settings?school_id=1')).status, 403);
  assert.equal((await api(fixture, 'owner', 'GET', '/api/staff-attendance/settings?school_id=2')).status, 403);
  assert.equal((await api(fixture, 'admin', 'GET', '/api/staff-attendance/settings')).status, 400);
  assert.equal((await api(fixture, 'admin', 'GET', '/api/staff-attendance/settings?school_id=2')).status, 200);

  const saved = await api(fixture, 'registrar', 'PUT', '/api/staff-attendance/settings', {
    school_id: 1,
    work_start_time: '07:30',
    late_grace_minutes: 5,
    work_end_time: '14:30',
    early_exit_grace_minutes: 10,
    duplicate_window_seconds: 90,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.work_start_time, '07:30');
  assert.equal(fixture.database.prepare('SELECT updated_by_user_id FROM staff_attendance_settings').get().updated_by_user_id, 7);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Baghdad' });
  assert.equal((await api(fixture, 'accountant', 'GET', `/api/staff-attendance/summary?school_id=1&date=${today}`)).status, 200);
  assert.equal((await api(fixture, 'teacher', 'GET', `/api/staff-attendance/summary?school_id=1&date=${today}`)).status, 403);
  assert.equal((await api(fixture, 'accountant', 'POST', '/api/staff-attendance/cards', { school_id: 1, employee_id: 1 })).status, 403);
});

test('employee QR cards are signed, unique, revocable and fail closed', async t => {
  const fixture = createFixture(t);
  const created = await issue(fixture, 1);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.employee_name, 'Teacher A');
  assert.equal(created.body.data.qr_value.startsWith('SSE1.'), true);
  assert.equal(
    await verifyEmployeeAttendanceCardPayload(created.body.data.qr_value, secret),
    created.body.data.public_id,
  );
  assert.equal((await issue(fixture, 1)).status, 409);
  assert.equal((await issue(fixture, 5)).status, 409, 'cross-tenant employee must fail');

  const forged = created.body.data.qr_value.slice(0, -1)
    + (created.body.data.qr_value.endsWith('a') ? 'b' : 'a');
  const rejected = await api(fixture, 'owner', 'POST', '/api/staff-attendance/scan', {
    school_id: 1,
    card_payload: forged,
    direction: 'entry',
    gate_label: 'Main',
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, 'invalid_staff_attendance_card');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM employee_attendance_events').get().count, 0);

  const revoked = await api(fixture, 'registrar', 'POST', `/api/staff-attendance/cards/${created.body.data.id}/revoke`, {
    school_id: 1,
    reason: 'Lost card',
  });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.data.status, 'revoked');
  const afterRevocation = await api(fixture, 'owner', 'POST', '/api/staff-attendance/scan', {
    school_id: 1,
    card_payload: created.body.data.qr_value,
    direction: 'entry',
    gate_label: 'Main',
  });
  assert.equal(afterRevocation.status, 409);
  assert.throws(
    () => fixture.database.prepare('DELETE FROM employee_attendance_cards WHERE id=?').run(created.body.data.id),
    /staff attendance card history immutable/,
  );
});

test('card scans are deduplicated and daily summaries are derived without payroll writes', async t => {
  const fixture = createFixture(t);
  const card = await issue(fixture, 1);
  const scan = await api(fixture, 'owner', 'POST', '/api/staff-attendance/scan', {
    school_id: 1,
    card_payload: card.body.data.qr_value,
    direction: 'entry',
    gate_label: 'البوابة الرئيسية',
  });
  assert.equal(scan.status, 201, JSON.stringify(scan.body));
  assert.equal(scan.body.data.employee_id, 1);
  assert.equal(scan.body.data.event_type, 'entry');
  assert.equal(scan.body.data.record_status, 'active');

  const duplicate = await api(fixture, 'owner', 'POST', '/api/staff-attendance/scan', {
    school_id: 1,
    card_payload: card.body.data.qr_value,
    direction: 'entry',
    gate_label: 'البوابة الرئيسية',
  });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
  assert.equal(duplicate.body.code, 'staff_attendance_scan_duplicate');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM employee_attendance_events').get().count, 1);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM employee_salaries').get().count, 0);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM treasury_transactions').get().count, 0);

  const summary = await api(
    fixture,
    'accountant',
    'GET',
    `/api/staff-attendance/summary?school_id=1&date=${scan.body.data.attendance_date}`,
  );
  assert.equal(summary.status, 200, JSON.stringify(summary.body));
  const teacher = summary.body.data.find(row => row.employee_id === 1);
  assert.equal(teacher.entry_count, 1);
  assert.equal(teacher.exit_count, 0);
  assert.equal(teacher.day_state, 'inside');
  const untouched = summary.body.data.find(row => row.employee_id === 7);
  assert.equal(untouched.day_state, 'no_record');
});

test('manual records require reasons, hide internal notes from accountants and void non-destructively', async t => {
  const fixture = createFixture(t);
  const now = Math.floor(Date.now() / 1000);
  const missingReason = await api(fixture, 'owner', 'POST', '/api/staff-attendance/manual', {
    school_id: 1,
    employee_id: 2,
    direction: 'exit',
    occurred_at: now,
    gate_label: 'Side',
    note: 'Internal HR note',
    reason: '',
  });
  assert.equal(missingReason.status, 400);
  assert.equal(missingReason.body.code, 'staff_attendance_manual_reason_required');
  assert.equal((await api(fixture, 'teacher', 'POST', '/api/staff-attendance/manual', {
    school_id: 1,
    employee_id: 2,
    direction: 'exit',
    occurred_at: now,
    gate_label: 'Side',
    note: null,
    reason: 'Reader failure',
  })).status, 403);

  const created = await api(fixture, 'registrar', 'POST', '/api/staff-attendance/manual', {
    school_id: 1,
    employee_id: 2,
    direction: 'exit',
    occurred_at: now,
    gate_label: 'Side',
    note: 'Internal HR note',
    reason: 'Reader failure',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const date = created.body.data.attendance_date;

  const accountant = await api(fixture, 'accountant', 'GET', `/api/staff-attendance/events?school_id=1&date=${date}`);
  assert.equal(accountant.status, 200, JSON.stringify(accountant.body));
  assert.equal(accountant.body.data[0].note, null);
  assert.equal(accountant.body.data[0].void_reason, null);
  assert.equal(JSON.stringify(accountant.body).includes('Reader failure'), false);

  const management = await api(fixture, 'principal', 'GET', `/api/staff-attendance/events?school_id=1&date=${date}`);
  assert.equal(management.body.data[0].note, 'Internal HR note');
  assert.equal(management.body.data[0].manual_reason, 'Reader failure');

  const voided = await api(fixture, 'principal', 'POST', `/api/staff-attendance/events/${created.body.data.id}/void`, {
    school_id: 1,
    reason: 'Recorded for the wrong employee',
  });
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  assert.equal(voided.body.data.record_status, 'voided');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM employee_attendance_events').get().count, 1);
  assert.deepEqual({ ...fixture.database.prepare(`
    SELECT old_record_status,new_record_status,reason,changed_by_user_id
    FROM employee_attendance_event_audit
  `).get() }, {
    old_record_status: 'active',
    new_record_status: 'voided',
    reason: 'Recorded for the wrong employee',
    changed_by_user_id: 5,
  });
  assert.throws(
    () => fixture.database.prepare("UPDATE employee_attendance_event_audit SET reason='Changed'").run(),
    /staff attendance audit immutable/,
  );
  assert.throws(
    () => fixture.database.prepare('DELETE FROM employee_attendance_event_audit').run(),
    /staff attendance audit immutable/,
  );
  assert.equal((await api(fixture, 'principal', 'POST', `/api/staff-attendance/events/${created.body.data.id}/void`, {
    school_id: 1,
    reason: 'Retry',
  })).status, 409);
  assert.throws(
    () => fixture.database.prepare('DELETE FROM employee_attendance_events WHERE id=?').run(created.body.data.id),
    /staff attendance event history immutable/,
  );
  assert.equal(fixture.database.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('teacher self-view is link-scoped and never exposes management-only fields', async t => {
  const fixture = createFixture(t);
  const now = Math.floor(Date.now() / 1000);
  const created = await api(fixture, 'owner', 'POST', '/api/staff-attendance/manual', {
    school_id: 1,
    employee_id: 1,
    direction: 'entry',
    occurred_at: now,
    gate_label: 'Main',
    note: 'Internal management note',
    reason: 'Reader maintenance',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const day = created.body.data.attendance_date;

  const self = await api(fixture, 'teacher', 'GET', `/api/staff-attendance/self?from=${day}&to=${day}`);
  assert.equal(self.status, 200, JSON.stringify(self.body));
  assert.equal(self.body.data.employee.id, 1);
  assert.equal(self.body.data.events.length, 1);
  assert.equal(self.body.data.events[0].note, null);
  assert.equal(self.body.data.events[0].void_reason, null);
  assert.equal(JSON.stringify(self.body).includes('Reader maintenance'), false);
  assert.equal((await api(fixture, 'teacher', 'GET', `/api/staff-attendance/events?school_id=1&date=${day}`)).status, 403);
  assert.equal((await api(fixture, 'accountant', 'GET', `/api/staff-attendance/self?from=${day}&to=${day}`)).status, 403);

  fixture.database.exec("UPDATE teacher_employee_links SET status='inactive' WHERE teacher_user_id=3");
  assert.equal((await api(fixture, 'teacher', 'GET', `/api/staff-attendance/self?from=${day}&to=${day}`)).status, 403);
});

test('manual limits, annual scope, hire date and employee lifecycle fail closed without writes', async t => {
  const fixture = createFixture(t);
  const before = fixture.database.prepare('SELECT COUNT(*) count FROM employee_attendance_events').get().count;
  const tooOld = await api(fixture, 'owner', 'POST', '/api/staff-attendance/manual', {
    school_id: 1,
    employee_id: 1,
    direction: 'entry',
    occurred_at: Math.floor(Date.now() / 1000) - 31 * 86_400,
    gate_label: null,
    note: null,
    reason: 'Historical correction',
  });
  assert.equal(tooOld.status, 400);
  assert.equal(tooOld.body.code, 'staff_attendance_manual_time_out_of_range');

  fixture.database.exec("UPDATE employees SET hire_date='2099-01-01' WHERE id=2");
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Baghdad' });
  const summary = await api(fixture, 'accountant', 'GET', `/api/staff-attendance/summary?school_id=1&date=${today}`);
  assert.equal(summary.status, 200, JSON.stringify(summary.body));
  assert.equal(summary.body.data.some(row => row.employee_id === 2), false);
  const beforeHire = await api(fixture, 'owner', 'POST', '/api/staff-attendance/manual', {
    school_id: 1,
    employee_id: 2,
    direction: 'entry',
    occurred_at: Math.floor(Date.now() / 1000),
    gate_label: null,
    note: null,
    reason: 'Incorrect historical attempt',
  });
  assert.equal(beforeHire.status, 409);

  const card = await issue(fixture, 1);
  fixture.database.exec("UPDATE employees SET status='archived' WHERE id=1");
  const archivedScan = await api(fixture, 'owner', 'POST', '/api/staff-attendance/scan', {
    school_id: 1,
    card_payload: card.body.data.qr_value,
    direction: 'entry',
    gate_label: 'Main',
  });
  assert.equal(archivedScan.status, 409);
  assert.equal(archivedScan.body.code, 'invalid_staff_attendance_employee');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM employee_attendance_events').get().count, before);
});

test('database rejects forged history and preserves the staff/student attendance boundary', async t => {
  const fixture = createFixture(t);
  const created = await api(fixture, 'owner', 'POST', '/api/staff-attendance/manual', {
    school_id: 1,
    employee_id: 7,
    direction: 'entry',
    occurred_at: Math.floor(Date.now() / 1000),
    gate_label: 'Main',
    note: null,
    reason: 'Reader offline',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.throws(
    () => fixture.database.prepare("UPDATE employee_attendance_events SET employee_name_snapshot='Forged'").run(),
    /staff attendance event identity immutable/,
  );
  assert.throws(() => fixture.database.prepare(`
    INSERT INTO employee_attendance_event_audit (
      school_id, attendance_event_id, employee_id, old_record_status,
      new_record_status, reason, changed_by_user_id, changed_at
    ) VALUES (1, ?, 7, 'active', 'voided', 'Forged', 1, unixepoch())
  `).run(created.body.data.id), /staff attendance audit invalid/);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM student_gate_events').get().count, 0);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM lesson_attendance_sessions').get().count, 0);
  assert.equal(fixture.database.prepare('PRAGMA foreign_key_check').all().length, 0);
});
