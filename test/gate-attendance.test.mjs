import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';
import { verifyGateCardPayload } from '../src/lib/gateAttendance.ts';
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

const secret = 'generated-local-gate-attendance-secret-only';
const identities = {
  owner: 'owner@matrix.test',
  admin: 'admin@matrix.test',
  teacher: 'teacher@matrix.test',
  principal: 'principal@matrix.test',
  registrar: 'registrar@matrix.test',
  accountant: 'accountant@matrix.test',
  parentOne: 'parent-one@gate.test',
  parentTwo: 'parent-two@gate.test',
  foreignParent: 'foreign-parent@gate.test',
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
    INSERT INTO users(id,school_id,full_name,email,role_id,status,auth_version)
    VALUES
      (8,1,'Parent One','parent-one@gate.test',8,'active',1),
      (9,1,'Parent Two','parent-two@gate.test',8,'active',1),
      (10,2,'Foreign Parent','foreign-parent@gate.test',8,'active',1);
    INSERT INTO students(id,school_id,student_number,full_name,gender,status,class_id,section_id)
    VALUES
      (1,1,'S-001','Student One','ذكر','active',1,1),
      (2,1,'S-002','Student Two','أنثى','active',1,1),
      (3,2,'X-001','Foreign Student','ذكر','active',3,3);
    INSERT INTO student_enrollments(
      id,school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id
    ) VALUES
      (1,1,1,1,1,1,'active','pending',1),
      (2,1,2,1,1,1,'active','pending',1),
      (3,2,3,3,3,3,'active','pending',2);
    INSERT INTO parent_student_links(school_id,parent_user_id,student_id,relationship,status,created_by_user_id)
    VALUES
      (1,8,1,'الأب','active',1),
      (1,9,2,'الأم','active',1),
      (2,10,3,'الأب','active',2);
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

async function issue(fixture, studentId = 1) {
  return api(fixture, 'owner', 'POST', '/api/gate-attendance/cards', { school_id: 1, student_id: studentId });
}

test('gate settings default safely and remain management- and tenant-scoped', async t => {
  const fixture = createFixture(t);
  const defaults = await api(fixture, 'owner', 'GET', '/api/gate-attendance/settings?school_id=1');
  assert.equal(defaults.status, 200, JSON.stringify(defaults.body));
  assert.deepEqual(defaults.body.data, {
    school_id: 1,
    school_start_time: '08:00',
    late_grace_minutes: 10,
    school_end_time: '14:00',
    early_exit_grace_minutes: 0,
    duplicate_window_seconds: 60,
    parent_notifications_enabled: true,
    updated_at: null,
  });

  assert.equal((await api(fixture, 'teacher', 'GET', '/api/gate-attendance/settings?school_id=1')).status, 403);
  assert.equal((await api(fixture, 'accountant', 'GET', '/api/gate-attendance/settings?school_id=1')).status, 403);
  assert.equal((await api(fixture, 'owner', 'GET', '/api/gate-attendance/settings?school_id=2')).status, 403);
  assert.equal((await api(fixture, 'admin', 'GET', '/api/gate-attendance/settings')).status, 400);
  assert.equal((await api(fixture, 'admin', 'GET', '/api/gate-attendance/settings?school_id=2')).status, 200);

  const saved = await api(fixture, 'registrar', 'PUT', '/api/gate-attendance/settings', {
    school_id: 1,
    school_start_time: '07:45',
    late_grace_minutes: 7,
    school_end_time: '13:30',
    early_exit_grace_minutes: 5,
    duplicate_window_seconds: 90,
    parent_notifications_enabled: false,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.school_start_time, '07:45');
  assert.equal(saved.body.data.parent_notifications_enabled, false);
  assert.equal(fixture.database.prepare('SELECT updated_by_user_id FROM gate_attendance_settings').get().updated_by_user_id, 7);
});

test('issued QR cards are signed, unique per active student, revocable and fail closed after revocation', async t => {
  const fixture = createFixture(t);
  assert.equal((await api(fixture, 'teacher', 'POST', '/api/gate-attendance/cards', { school_id: 1, student_id: 1 })).status, 403);
  const created = await issue(fixture, 1);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.student_name, 'Student One');
  assert.equal(await verifyGateCardPayload(created.body.data.qr_value, secret), created.body.data.public_id);
  assert.equal((await issue(fixture, 1)).status, 409);

  const forged = created.body.data.qr_value.slice(0, -1) + (created.body.data.qr_value.endsWith('a') ? 'b' : 'a');
  const rejected = await api(fixture, 'owner', 'POST', '/api/gate-attendance/scan', {
    school_id: 1, card_payload: forged, direction: 'entry', gate_label: 'Main',
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, 'invalid_gate_card');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM student_gate_events').get().count, 0);

  const revoked = await api(fixture, 'principal', 'POST', `/api/gate-attendance/cards/${created.body.data.id}/revoke`, {
    school_id: 1, reason: 'Lost card',
  });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.data.status, 'revoked');
  const afterRevocation = await api(fixture, 'owner', 'POST', '/api/gate-attendance/scan', {
    school_id: 1, card_payload: created.body.data.qr_value, direction: 'entry', gate_label: 'Main',
  });
  assert.equal(afterRevocation.status, 409);
  assert.equal(afterRevocation.body.code, 'invalid_gate_card');
  assert.throws(() => fixture.database.prepare('DELETE FROM student_gate_cards WHERE id=?').run(created.body.data.id), /gate card history immutable/);
});

test('card scan is atomic, deduplicated and notifies only the linked parent', async t => {
  const fixture = createFixture(t);
  const card = await issue(fixture, 1);
  const scan = await api(fixture, 'owner', 'POST', '/api/gate-attendance/scan', {
    school_id: 1,
    card_payload: card.body.data.qr_value,
    direction: 'entry',
    gate_label: 'البوابة الرئيسية',
  });
  assert.equal(scan.status, 201, JSON.stringify(scan.body));
  assert.equal(scan.body.data.student_id, 1);
  assert.equal(scan.body.data.event_type, 'entry');
  assert.equal(scan.body.data.record_status, 'active');

  const duplicate = await api(fixture, 'owner', 'POST', '/api/gate-attendance/scan', {
    school_id: 1,
    card_payload: card.body.data.qr_value,
    direction: 'entry',
    gate_label: 'البوابة الرئيسية',
  });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
  assert.equal(duplicate.body.code, 'gate_scan_duplicate');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM student_gate_events').get().count, 1);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM school_notifications').get().count, 1);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM notification_recipients').get().count, 1);

  const parentOne = await api(fixture, 'parentOne', 'GET', '/api/gate-attendance/parent?from=2000-01-01&to=2100-12-31');
  assert.equal(parentOne.status, 400, 'range is deliberately capped');
  const today = scan.body.data.attendance_date;
  const linkedFeed = await api(fixture, 'parentOne', 'GET', `/api/gate-attendance/parent?from=${today}&to=${today}`);
  assert.equal(linkedFeed.status, 200, JSON.stringify(linkedFeed.body));
  assert.deepEqual(linkedFeed.body.data.events.map(event => event.student_id), [1]);
  assert.equal(linkedFeed.body.data.events[0].note, null);
  const unlinkedFeed = await api(fixture, 'parentTwo', 'GET', `/api/gate-attendance/parent?from=${today}&to=${today}`);
  assert.deepEqual(unlinkedFeed.body.data.events, []);

  const notifications = await api(fixture, 'parentOne', 'GET', '/api/notifications');
  assert.equal(notifications.status, 200, JSON.stringify(notifications.body));
  assert.equal(notifications.body.data.unread_count, 1);
  assert.equal(notifications.body.data.notifications[0].reference_key, scan.body.data.event_key);
  const key = notifications.body.data.notifications[0].notification_key;
  assert.equal((await api(fixture, 'parentTwo', 'POST', `/api/notifications/${key}/read`, {})).status, 404);
  const read = await api(fixture, 'parentOne', 'POST', `/api/notifications/${key}/read`, {});
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal((await api(fixture, 'parentOne', 'GET', '/api/notifications')).body.data.unread_count, 0);

  fixture.database.exec("UPDATE parent_student_links SET status='inactive' WHERE parent_user_id=8 AND student_id=1");
  assert.equal((await api(fixture, 'parentOne', 'GET', '/api/notifications')).body.data.notifications.length, 0);
  assert.deepEqual(
    (await api(fixture, 'parentOne', 'GET', `/api/gate-attendance/parent?from=${today}&to=${today}`)).body.data.events,
    [],
  );
});

test('manual events require a reason, keep internal notes private and support audited non-destructive voiding', async t => {
  const fixture = createFixture(t);
  const now = Math.floor(Date.now() / 1000);
  const missingReason = await api(fixture, 'owner', 'POST', '/api/gate-attendance/manual', {
    school_id: 1, student_id: 2, direction: 'exit', occurred_at: now,
    gate_label: 'Side', note: 'Internal note', reason: '',
  });
  assert.equal(missingReason.status, 400);
  assert.equal(missingReason.body.code, 'gate_manual_reason_required');
  assert.equal((await api(fixture, 'teacher', 'POST', '/api/gate-attendance/manual', {
    school_id: 1, student_id: 2, direction: 'exit', occurred_at: now,
    gate_label: 'Side', note: null, reason: 'Reader failure',
  })).status, 403);

  const created = await api(fixture, 'registrar', 'POST', '/api/gate-attendance/manual', {
    school_id: 1, student_id: 2, direction: 'exit', occurred_at: now,
    gate_label: 'Side', note: 'Internal health detail', reason: 'Reader failure',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.source, 'manual');
  const day = created.body.data.attendance_date;
  const parent = await api(fixture, 'parentTwo', 'GET', `/api/gate-attendance/parent?from=${day}&to=${day}`);
  assert.equal(parent.status, 200, JSON.stringify(parent.body));
  assert.equal(parent.body.data.events.length, 1);
  const serialized = JSON.stringify(parent.body);
  for (const hidden of ['Internal health detail', 'Reader failure', 'manual_reason', 'recorded_by_user_id']) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }

  const voided = await api(fixture, 'principal', 'POST', `/api/gate-attendance/events/${created.body.data.id}/void`, {
    school_id: 1, reason: 'Recorded for the wrong student',
  });
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  assert.equal(voided.body.data.record_status, 'voided');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM student_gate_events').get().count, 1);
  const audit = fixture.database.prepare('SELECT old_record_status,new_record_status,reason,changed_by_user_id FROM student_gate_event_audit').get();
  assert.deepEqual({ ...audit }, {
    old_record_status: 'active',
    new_record_status: 'voided',
    reason: 'Recorded for the wrong student',
    changed_by_user_id: 5,
  });
  assert.throws(
    () => fixture.database.prepare("UPDATE student_gate_event_audit SET reason='Changed'").run(),
    /gate event audit immutable/,
  );
  assert.throws(
    () => fixture.database.prepare('DELETE FROM student_gate_event_audit').run(),
    /gate event audit immutable/,
  );
  assert.throws(() => fixture.database.prepare(`
    INSERT INTO student_gate_event_audit (
      school_id, gate_event_id, student_id, old_record_status, new_record_status,
      reason, changed_by_user_id, changed_at
    ) VALUES (1, ?, 2, 'active', 'voided', 'Forged reason', 5, unixepoch())
  `).run(created.body.data.id), /gate event audit invalid|UNIQUE constraint failed/);
  assert.deepEqual((await api(fixture, 'parentTwo', 'GET', `/api/gate-attendance/parent?from=${day}&to=${day}`)).body.data.events, []);
  assert.equal((await api(fixture, 'parentTwo', 'GET', '/api/notifications')).body.data.notifications.length, 0);
  assert.equal((await api(fixture, 'principal', 'POST', `/api/gate-attendance/events/${created.body.data.id}/void`, {
    school_id: 1, reason: 'Retry',
  })).status, 409);
  assert.throws(() => fixture.database.prepare('DELETE FROM student_gate_events WHERE id=?').run(created.body.data.id), /gate event history immutable/);
  assert.equal(fixture.database.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('manual time limits and cross-tenant student/card targets fail without writes', async t => {
  const fixture = createFixture(t);
  const before = fixture.database.prepare('SELECT COUNT(*) count FROM student_gate_events').get().count;
  const tooOld = await api(fixture, 'owner', 'POST', '/api/gate-attendance/manual', {
    school_id: 1, student_id: 1, direction: 'entry',
    occurred_at: Math.floor(Date.now() / 1000) - 31 * 86_400,
    gate_label: null, note: null, reason: 'Historical correction',
  });
  assert.equal(tooOld.status, 400);
  assert.equal(tooOld.body.code, 'gate_manual_time_out_of_range');
  const crossTenant = await api(fixture, 'owner', 'POST', '/api/gate-attendance/cards', { school_id: 1, student_id: 3 });
  assert.equal(crossTenant.status, 409);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM student_gate_events').get().count, before);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM student_gate_cards').get().count, 0);
});
