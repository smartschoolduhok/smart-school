import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';
import { signJWT } from '../src/lib/jwtSecurity.ts';
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

const secret = 'generated-local-attendance-test-secret-only';
const tokens = Object.fromEntries(await Promise.all([
  ['owner', 'owner@matrix.test'],
  ['teacher', 'teacher@matrix.test'],
  ['principal', 'principal@matrix.test'],
  ['registrar', 'registrar@matrix.test'],
  ['accountant', 'accountant@matrix.test'],
  ['parent', 'parent@attendance.test'],
  ['foreignParent', 'foreign-parent@attendance.test'],
].map(async ([key, email]) => [key, await signJWT({ email, auth_version: 1 }, secret)])));

const sessionDate = '2026-09-13'; // Sunday, matching timetable day 0.

function createFixture(t) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  t.after(() => database.close());
  for (const file of migrationFiles) database.exec(migrationSQL(file));
  database.exec(fixtureSQL);
  database.exec(`
    INSERT INTO users(id,school_id,full_name,email,role_id,status,auth_version)
    VALUES
      (8,1,'Parent One','parent@attendance.test',8,'active',1),
      (9,2,'Foreign Parent','foreign-parent@attendance.test',8,'active',1);
    INSERT INTO students(id,school_id,student_number,full_name,gender,status,class_id,section_id)
    VALUES
      (1,1,'S-001','Student One','ذكر','active',1,1),
      (2,1,'S-002','Student Two','أنثى','active',1,1),
      (3,1,'S-003','Other Section','ذكر','active',1,2),
      (4,2,'X-001','Foreign Student','ذكر','active',3,3);
    INSERT INTO student_enrollments(
      id,school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id
    ) VALUES
      (1,1,1,1,1,1,'active','pending',1),
      (2,1,2,1,1,1,'active','pending',1),
      (3,1,3,1,1,2,'active','pending',1),
      (4,2,4,3,3,3,'active','pending',2);
    INSERT INTO student_subjects(id,school_id,student_id,subject_id,class_id,section_id,assigned_by_user_id)
    VALUES
      (1,1,1,1,1,1,1),
      (2,1,2,1,1,1,1),
      (3,1,3,1,1,2,1),
      (4,2,4,5,3,3,2);
    UPDATE timetable_teaching_loads SET employee_id=1 WHERE id=1;
    INSERT INTO timetable_entries(
      id,school_id,academic_year_id,slot_id,teaching_load_id,created_by_user_id,updated_by_user_id
    ) VALUES
      (1,1,1,1,1,1,1),
      (2,1,1,2,2,1,1),
      (3,2,3,9,6,2,2);
    INSERT INTO teacher_employee_links(school_id,teacher_user_id,employee_id,status,created_by_user_id)
    VALUES(1,3,1,'active',1);
    INSERT INTO parent_student_links(school_id,parent_user_id,student_id,relationship,status,created_by_user_id)
    VALUES
      (1,8,1,'الأب','active',1),
      (2,9,4,'الأب','active',2);
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

const record = (studentId, status = 'present', options = {}) => ({
  student_id: studentId,
  status,
  late_minutes: status === 'late' ? 8 : 0,
  note: null,
  note_visibility: 'staff',
  ...options,
});

test('teacher lesson list is derived from the linked timetable load and remains tenant scoped', async t => {
  const fixture = createFixture(t);
  const teacher = await api(fixture, 'teacher', 'GET', `/api/attendance/lessons?school_id=1&date=${sessionDate}`);
  assert.equal(teacher.status, 200, JSON.stringify(teacher.body));
  assert.deepEqual(teacher.body.data.map(row => row.timetable_entry_id), [1]);
  assert.equal(teacher.body.data[0].roster_count, 2);
  assert.equal(teacher.body.data[0].teacher_name, 'Teacher A');

  const owner = await api(fixture, 'owner', 'GET', `/api/attendance/lessons?school_id=1&date=${sessionDate}`);
  assert.deepEqual(owner.body.data.map(row => row.timetable_entry_id), [1, 2]);
  assert.equal((await api(fixture, 'teacher', 'GET', `/api/attendance/lessons/2?school_id=1&date=${sessionDate}`)).status, 403);
  assert.equal((await api(fixture, 'owner', 'GET', `/api/attendance/lessons?school_id=2&date=${sessionDate}`)).status, 403);
  assert.equal((await api(fixture, 'parent', 'GET', `/api/attendance/lessons?school_id=1&date=${sessionDate}`)).status, 403);
  assert.equal((await api(fixture, 'accountant', 'GET', `/api/attendance/lessons?school_id=1&date=${sessionDate}`)).status, 403);
});

test('lesson detail builds the active annual roster and defaults unsaved students to present', async t => {
  const fixture = createFixture(t);
  const response = await api(fixture, 'teacher', 'GET', `/api/attendance/lessons/1?school_id=1&date=${sessionDate}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.lesson.session_status, null);
  assert.deepEqual(response.body.data.records.map(row => row.student_id), [1, 2]);
  assert.ok(response.body.data.records.every(row => row.status === 'present' && row.note_visibility === 'staff'));
  assert.equal(response.body.data.permissions.can_edit_draft, true);
});

test('draft is private, confirmation publishes only the linked child and parent-visible notes', async t => {
  const fixture = createFixture(t);
  const draft = await api(fixture, 'teacher', 'PUT', '/api/attendance/lessons/1', {
    school_id: 1,
    session_date: sessionDate,
    expected_revision: 0,
    action: 'draft',
    change_reason: null,
    records: [
      record(1, 'late', { note: 'Internal first note', note_visibility: 'staff' }),
      record(2, 'absent', { note: 'Visible absence note', note_visibility: 'parent' }),
    ],
  });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.equal(draft.body.data.lesson.session_status, 'draft');
  assert.equal(draft.body.data.lesson.revision, 1);
  assert.deepEqual((await api(fixture, 'parent', 'GET', `/api/attendance/parent?from=${sessionDate}&to=${sessionDate}`)).body.data.records, []);

  const confirmed = await api(fixture, 'teacher', 'PUT', '/api/attendance/lessons/1', {
    school_id: 1,
    session_date: sessionDate,
    expected_revision: 1,
    action: 'confirm',
    change_reason: null,
    records: [
      record(1, 'late', { note: 'Internal first note', note_visibility: 'staff' }),
      record(2, 'absent', { note: 'Visible absence note', note_visibility: 'parent' }),
    ],
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.data.lesson.session_status, 'confirmed');
  assert.equal(confirmed.body.data.lesson.revision, 2);

  const parent = await api(fixture, 'parent', 'GET', `/api/attendance/parent?from=${sessionDate}&to=${sessionDate}`);
  assert.equal(parent.status, 200, JSON.stringify(parent.body));
  assert.deepEqual(parent.body.data.students.map(student => student.id), [1]);
  assert.equal(parent.body.data.records.length, 1);
  assert.equal(parent.body.data.records[0].student_id, 1);
  assert.equal(parent.body.data.records[0].status, 'late');
  assert.equal(parent.body.data.records[0].late_minutes, 8);
  assert.equal(parent.body.data.records[0].note, null);
  const serialized = JSON.stringify(parent.body);
  for (const hidden of ['Internal first note', 'note_visibility', 'created_by_user_id', 'updated_by_user_id', 'change_reason']) {
    assert.equal(serialized.includes(hidden), false, hidden);
  }
});

test('confirmed attendance rejects teacher edits and requires an audited management correction reason', async t => {
  const fixture = createFixture(t);
  const confirm = await api(fixture, 'teacher', 'PUT', '/api/attendance/lessons/1', {
    school_id: 1, session_date: sessionDate, expected_revision: 0, action: 'confirm', change_reason: null,
    records: [record(1, 'absent'), record(2, 'present')],
  });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));

  const teacherEdit = await api(fixture, 'teacher', 'PUT', '/api/attendance/lessons/1', {
    school_id: 1, session_date: sessionDate, expected_revision: 1, action: 'confirm', change_reason: 'Teacher retry',
    records: [record(1, 'present'), record(2, 'present')],
  });
  assert.equal(teacherEdit.status, 409);
  assert.equal(teacherEdit.body.code, 'attendance_already_confirmed');

  const noReason = await api(fixture, 'principal', 'PUT', '/api/attendance/lessons/1', {
    school_id: 1, session_date: sessionDate, expected_revision: 1, action: 'confirm', change_reason: null,
    records: [record(1, 'present'), record(2, 'present')],
  });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.body.code, 'attendance_correction_reason_required');

  const corrected = await api(fixture, 'registrar', 'PUT', '/api/attendance/lessons/1', {
    school_id: 1, session_date: sessionDate, expected_revision: 1, action: 'confirm', change_reason: 'كتاب عذر رسمي',
    records: [
      record(1, 'excused', { note: 'تم قبول العذر', note_visibility: 'parent' }),
      record(2, 'present'),
    ],
  });
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
  assert.equal(corrected.body.data.lesson.revision, 2);
  assert.equal(corrected.body.data.lesson.session_status, 'confirmed');
  const lastAudit = fixture.database.prepare(`
    SELECT old_status,new_status,change_reason
    FROM lesson_attendance_record_audit
    WHERE student_id=1 ORDER BY id DESC LIMIT 1
  `).get();
  assert.deepEqual({ ...lastAudit }, { old_status: 'absent', new_status: 'excused', change_reason: 'كتاب عذر رسمي' });

  const parent = await api(fixture, 'parent', 'GET', `/api/attendance/parent?from=${sessionDate}&to=${sessionDate}`);
  assert.equal(parent.body.data.records[0].status, 'excused');
  assert.equal(parent.body.data.records[0].note, 'تم قبول العذر');
});

test('stale revision and changed roster fail atomically without partial records or audit', async t => {
  const fixture = createFixture(t);
  const draft = await api(fixture, 'teacher', 'PUT', '/api/attendance/lessons/1', {
    school_id: 1, session_date: sessionDate, expected_revision: 0, action: 'draft', change_reason: null,
    records: [record(1), record(2)],
  });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  const before = JSON.stringify({
    session: fixture.database.prepare('SELECT * FROM lesson_attendance_sessions').all(),
    records: fixture.database.prepare('SELECT * FROM lesson_attendance_records ORDER BY id').all(),
    audit: fixture.database.prepare('SELECT * FROM lesson_attendance_record_audit ORDER BY id').all(),
  });
  const stale = await api(fixture, 'teacher', 'PUT', '/api/attendance/lessons/1', {
    school_id: 1, session_date: sessionDate, expected_revision: 0, action: 'draft', change_reason: null,
    records: [record(1, 'absent'), record(2, 'late')],
  });
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.code, 'attendance_write_stale');
  const after = JSON.stringify({
    session: fixture.database.prepare('SELECT * FROM lesson_attendance_sessions').all(),
    records: fixture.database.prepare('SELECT * FROM lesson_attendance_records ORDER BY id').all(),
    audit: fixture.database.prepare('SELECT * FROM lesson_attendance_record_audit ORDER BY id').all(),
  });
  assert.equal(after, before);

  const mismatch = await api(fixture, 'teacher', 'PUT', '/api/attendance/lessons/1', {
    school_id: 1, session_date: sessionDate, expected_revision: 1, action: 'confirm', change_reason: null,
    records: [record(1)],
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, 'attendance_roster_changed');
  assert.equal(JSON.stringify({
    session: fixture.database.prepare('SELECT * FROM lesson_attendance_sessions').all(),
    records: fixture.database.prepare('SELECT * FROM lesson_attendance_records ORDER BY id').all(),
    audit: fixture.database.prepare('SELECT * FROM lesson_attendance_record_audit ORDER BY id').all(),
  }), before);
});

for (const [name, concurrentChange] of [
  ['student placement changes', "UPDATE student_enrollments SET section_id=2 WHERE student_id=2 AND academic_year_id=1"],
  ['teacher link is revoked', "UPDATE teacher_employee_links SET status='inactive' WHERE teacher_user_id=3"],
]) test(`in-batch authority guard rolls back when ${name}`, async t => {
  const fixture = createFixture(t);
  fixture.d1.beforeWrite = () => fixture.database.exec(concurrentChange);
  const response = await api(fixture, 'teacher', 'PUT', '/api/attendance/lessons/1', {
    school_id: 1, session_date: sessionDate, expected_revision: 0, action: 'confirm', change_reason: null,
    records: [record(1), record(2)],
  });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.code, 'attendance_write_stale');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM lesson_attendance_sessions').get().count, 0);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM lesson_attendance_records').get().count, 0);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM lesson_attendance_record_audit').get().count, 0);
  assert.equal(fixture.database.prepare('SELECT COUNT(*) count FROM lesson_attendance_write_guards').get().count, 0);
});

test('invalid statuses, weekday mismatch, cross-school targets and parent range abuse fail closed', async t => {
  const fixture = createFixture(t);
  const base = {
    school_id: 1, session_date: sessionDate, expected_revision: 0, action: 'draft', change_reason: null,
  };
  const invalidStatus = await api(fixture, 'teacher', 'PUT', '/api/attendance/lessons/1', {
    ...base, records: [record(1, 'teleported'), record(2)],
  });
  assert.equal(invalidStatus.status, 400);
  assert.equal(invalidStatus.body.code, 'invalid_attendance_status');
  const wrongDay = await api(fixture, 'teacher', 'GET', '/api/attendance/lessons/1?school_id=1&date=2026-09-14');
  assert.equal(wrongDay.status, 400);
  assert.equal(wrongDay.body.code, 'attendance_lesson_wrong_day');
  assert.equal((await api(fixture, 'teacher', 'GET', `/api/attendance/lessons/3?school_id=2&date=${sessionDate}`)).status, 403);
  const longRange = await api(fixture, 'parent', 'GET', '/api/attendance/parent?from=2025-01-01&to=2026-09-13');
  assert.equal(longRange.status, 400);
  assert.equal(longRange.body.code, 'attendance_range_too_large');
  assert.equal(fixture.database.prepare('PRAGMA foreign_key_check').all().length, 0);
});
